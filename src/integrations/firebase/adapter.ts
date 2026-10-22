// Firebase backend adapter.
//
// Implements the subset of the Supabase client API that this app actually
// uses — PostgREST-style query builder (from/select/eq/gte/lte/order/limit/
// single/maybeSingle/insert/update/upsert/delete, count+head), auth,
// storage, rpc("has_role") and functions.invoke — on top of Firebase Auth,
// Firestore, Cloud Storage and Callable Functions. `src/lib/backend.ts`
// selects this adapter or the real Supabase client via VITE_BACKEND, so
// pages keep identical data shapes and behavior on either backend.
//
// Data model (firebase/firestore.rules, staged):
//   profiles                -> users/{uid}                  (profile document)
//   per-user tables         -> users/{uid}/{table}/{docId}
//   marketplace_posts       -> marketplace_posts/{id}       (top-level)
//   marketplace_categories  -> marketplace_categories/{id}  (top-level)
//   subscription_plans      -> subscription_plans/{id}      (top-level)
//   roles                   -> roles/{uid}                  (read-only here)
// Firestore document ids are exposed as `id`; created_at / updated_at are
// ISO strings, matching what the staged Cloud Functions write.
//
// Known simplifications vs PostgREST (deliberate for this staged port):
// - Filters run server-side (where). Ordering + limit are ALSO pushed
//   server-side (orderBy/limit) whenever the pair appears together and
//   Firestore's constraint rules allow it — see readQuery(). Ordering on
//   its own stays client-side: it would save no reads, and Firestore's
//   orderBy silently drops documents missing the sort field (e.g.
//   emergency_contacts.is_primary is optional), which would change the
//   returned row set. The order+limit pairings the app uses are covered
//   by the composite indexes staged in firebase/firestore.indexes.json.
// - Joins are emulated client-side (marketplace_posts -> category embed).
// - Writes stamp created_at/updated_at (ISO) like the Postgres defaults did.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  query as fsQuery,
  where,
  orderBy,
  limit as fsLimit,
  documentId,
  getCountFromServer,
  type CollectionReference,
  type Query,
  type QueryConstraint,
} from "firebase/firestore";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  sendPasswordResetEmail,
  confirmPasswordReset,
  updatePassword,
  updateProfile,
  getRedirectResult,
  type User as FirebaseUser,
} from "firebase/auth";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { firebaseAuth, firebaseDb, firebaseStorage, firebaseFunctions } from "./client";

/* ---------------------------------- errors --------------------------------- */

export class BackendError extends Error {
  code?: string;
  details: string | null = null;
  hint: string | null = null;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "BackendError";
    this.code = code;
  }
}

// Map common Firebase Auth error codes onto the Supabase-style messages the
// app already knows how to present (see formatAuthError in useAuthActions).
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  "auth/invalid-credential": "Invalid login credentials",
  "auth/wrong-password": "Invalid login credentials",
  "auth/user-not-found": "Invalid login credentials",
  "auth/invalid-email": "Invalid email address",
  "auth/email-already-in-use": "User already registered",
  "auth/weak-password": "Password should be at least 6 characters",
  "auth/user-disabled": "This account has been disabled",
  "auth/too-many-requests": "Too many attempts. Please try again later.",
  "auth/network-request-failed": "Network request failed",
  "auth/requires-recent-login": "Please sign in again to complete this action",
};

function toErr(e: unknown): BackendError {
  if (e instanceof BackendError) return e;
  const code = (e as { code?: string })?.code;
  if (code && AUTH_ERROR_MESSAGES[code]) return new BackendError(AUTH_ERROR_MESSAGES[code], code);
  if (e instanceof Error) return new BackendError(e.message, code);
  return new BackendError(String(e), code);
}

/* ---------------------------------- helpers -------------------------------- */

const nowIso = () => new Date().toISOString();

/**
 * Strip values Firestore can't or shouldn't store: undefined (Firestore
 * rejects it outright) and NaN (Firestore stores it as a double, where it
 * then poisons every downstream sum and renders as "₹NaN"). A NaN here
 * always comes from a failed parse upstream, i.e. "no value" — dropping
 * the key matches how undefined is treated.
 */
function clean<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (v === undefined) continue;
    if (typeof v === "number" && Number.isNaN(v)) continue;
    out[k] = v;
  }
  return out;
}

function currentUid(): string | null {
  return firebaseAuth.currentUser?.uid ?? null;
}

/* ----------------------------------- auth ---------------------------------- */

function mapUser(u: FirebaseUser | null) {
  if (!u) return null;
  return {
    id: u.uid,
    aud: "authenticated",
    role: "authenticated",
    email: u.email ?? undefined,
    phone: u.phoneNumber ?? undefined,
    email_confirmed_at: u.emailVerified ? u.metadata.creationTime : undefined,
    created_at: u.metadata.creationTime,
    last_sign_in_at: u.metadata.lastSignInTime,
    app_metadata: {
      provider: u.providerData[0]?.providerId ?? "email",
      providers: u.providerData.map((p) => p.providerId),
    },
    user_metadata: {
      full_name: u.displayName ?? undefined,
      name: u.displayName ?? undefined,
      avatar_url: u.photoURL ?? undefined,
      picture: u.photoURL ?? undefined,
      email: u.email ?? undefined,
      email_verified: u.emailVerified,
    },
    identities: u.providerData,
  };
}

async function buildSession(u: FirebaseUser | null) {
  if (!u) return null;
  const access_token = await u.getIdToken();
  return {
    access_token,
    refresh_token: "", // Firebase SDK manages refresh internally.
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: mapUser(u),
  };
}

/**
 * Mirror of the old Postgres trigger that created a profiles row on signup:
 * create users/{uid} on first sign-in if it does not exist yet.
 * Callers fire-and-forget this (`void ensureProfile(...)`): sign-in and
 * session bootstrap must never wait on this Firestore round trip — the UI
 * unblocks on auth state alone and the profile merges when it lands.
 */
async function ensureProfile(u: FirebaseUser, fullName?: string) {
  try {
    const ref = doc(firebaseDb, "users", u.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        user_id: u.uid,
        email: u.email ?? null,
        full_name: fullName ?? u.displayName ?? null,
        avatar_url: u.photoURL ?? null,
        created_at: nowIso(),
        updated_at: nowIso(),
      });
    }
  } catch (e) {
    console.warn("ensureProfile failed", e);
  }
}

// sessionStorage flag set immediately before every signInWithRedirect
// call. getRedirectResult() waits on the auth-domain redirect handshake,
// so it must only run when a redirect is actually in flight: awaiting it
// on every cold start (via readyUser/getSession) stalled auth bootstrap
// behind a result that was never coming — the "Connecting…" hang. When no
// redirect is pending, completion resolves immediately.
const REDIRECT_PENDING_KEY = "ds:redirectPending";

function markRedirectPending() {
  try {
    sessionStorage.setItem(REDIRECT_PENDING_KEY, "1");
  } catch {
    // sessionStorage unavailable: takeRedirectPending() then defaults to
    // consuming the redirect result, i.e. the old always-check behavior.
  }
}

function takeRedirectPending(): boolean {
  try {
    const pending = sessionStorage.getItem(REDIRECT_PENDING_KEY) === "1";
    if (pending) sessionStorage.removeItem(REDIRECT_PENDING_KEY);
    return pending;
  } catch {
    return true;
  }
}

let redirectResultPromise: Promise<unknown> | null = null;
function completeRedirectOnce() {
  if (!redirectResultPromise) {
    if (!takeRedirectPending()) {
      redirectResultPromise = Promise.resolve(null);
    } else {
      redirectResultPromise = getRedirectResult(firebaseAuth)
        .then((res) => {
          // Background: bootstrap must not wait on the profile write.
          if (res?.user) void ensureProfile(res.user);
          return res;
        })
        .catch((e) => {
          // Do not swallow redirect errors silently: a failed web redirect
          // sign-in (expired link, unauthorized domain, …) otherwise looks
          // like "Google login just does nothing".
          const code = (e as { code?: string })?.code ?? "unknown";
          console.error(`Redirect sign-in completion failed [${code}]`, e);
          return null;
        });
    }
  }
  return redirectResultPromise;
}

// Kick off redirect completion at adapter init: if this page load is the
// return leg of a web signInWithRedirect (flag set), consume the result
// immediately instead of waiting for the first getSession() call. With no
// redirect pending this is a no-op. Guarded by the promise singleton
// above, so it still runs exactly once.
void completeRedirectOnce();

async function readyUser(): Promise<FirebaseUser | null> {
  await completeRedirectOnce();
  if (typeof firebaseAuth.authStateReady === "function") {
    await firebaseAuth.authStateReady();
  }
  return firebaseAuth.currentUser;
}

const authAdapter = {
  async getSession() {
    try {
      const u = await readyUser();
      return { data: { session: await buildSession(u) }, error: null };
    } catch (e) {
      return { data: { session: null }, error: toErr(e) };
    }
  },

  onAuthStateChange(callback: (event: string, session: unknown) => void) {
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (u) => {
      try {
        callback(u ? "SIGNED_IN" : "SIGNED_OUT", await buildSession(u));
      } catch {
        callback(u ? "SIGNED_IN" : "SIGNED_OUT", null);
      }
    });
    return {
      data: {
        subscription: {
          id: "firebase-auth",
          callback,
          unsubscribe,
        },
      },
    };
  },

  async signInWithPassword(credentials: { email: string; password: string }) {
    try {
      const cred = await signInWithEmailAndPassword(firebaseAuth, credentials.email, credentials.password);
      void ensureProfile(cred.user);
      return {
        data: { user: mapUser(cred.user), session: await buildSession(cred.user) },
        error: null,
      };
    } catch (e) {
      return { data: { user: null, session: null }, error: toErr(e) };
    }
  },

  async signUp(params: {
    email: string;
    password: string;
    options?: { data?: { full_name?: string }; emailRedirectTo?: string };
  }) {
    try {
      const cred = await createUserWithEmailAndPassword(firebaseAuth, params.email, params.password);
      const fullName = params.options?.data?.full_name;
      if (fullName) {
        await updateProfile(cred.user, { displayName: fullName }).catch(() => undefined);
      }
      void ensureProfile(cred.user, fullName);
      return {
        data: { user: mapUser(cred.user), session: await buildSession(cred.user) },
        error: null,
      };
    } catch (e) {
      return { data: { user: null, session: null }, error: toErr(e) };
    }
  },

  async signOut(_options?: { scope?: string }) {
    try {
      await fbSignOut(firebaseAuth);
    } catch (e) {
      return { error: toErr(e) };
    }
    // Native: also sign out of the FirebaseAuthentication plugin so the
    // native Google account-chooser state is cleared and the next sign-in
    // asks for an account again. Best-effort — the JS SDK session (the
    // source of truth) is already gone at this point.
    try {
      const { Capacitor } = await import("@capacitor/core");
      if (Capacitor.isNativePlatform()) {
        const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
        await FirebaseAuthentication.signOut();
      }
    } catch (e) {
      console.warn("Native FirebaseAuthentication sign-out failed", e);
    }
    return { error: null };
  },

  async resetPasswordForEmail(email: string, options?: { redirectTo?: string }) {
    try {
      await sendPasswordResetEmail(
        firebaseAuth,
        email,
        options?.redirectTo ? { url: options.redirectTo, handleCodeInApp: true } : undefined,
      );
      return { data: {}, error: null };
    } catch (e) {
      return { data: null, error: toErr(e) };
    }
  },

  async updateUser(params: { password?: string; data?: Record<string, unknown> }) {
    try {
      const u = firebaseAuth.currentUser;
      if (!u) throw new BackendError("Not authenticated", "auth/no-current-user");
      if (params.password) await updatePassword(u, params.password);
      if (params.data && typeof params.data.full_name === "string") {
        await updateProfile(u, { displayName: params.data.full_name });
        await updateDoc(doc(firebaseDb, "users", u.uid), {
          full_name: params.data.full_name,
          updated_at: nowIso(),
        }).catch(() => undefined);
      }
      return { data: { user: mapUser(u) }, error: null };
    } catch (e) {
      return { data: { user: null }, error: toErr(e) };
    }
  },

  // Not reachable in the Firebase flow (Google sign-in is native to Firebase
  // Auth — see signInWithGoogleFirebase below). Kept for API compatibility.
  async setSession() {
    const u = firebaseAuth.currentUser;
    return { data: { user: mapUser(u), session: await buildSession(u) }, error: null };
  },
};

/** Complete a Firebase password reset from the emailed link's oobCode. */
export async function confirmFirebasePasswordReset(code: string, newPassword: string) {
  await confirmPasswordReset(firebaseAuth, code, newPassword);
}

/**
 * True when an auth error just means "the user backed out" (closed the
 * account chooser/popup, dismissed the prompt) rather than a real failure —
 * callers treat this as a quiet cancellation, not an error toast.
 */
function isUserCancelledSignIn(e: unknown): boolean {
  const code = (e as { code?: string })?.code ?? "";
  if (code === "auth/popup-closed-by-user") return true;
  // Other firebase/auth codes are genuine failures; don't let the loose
  // substring match below reclassify them (e.g. auth/cancelled-popup-request
  // keeps its redirect-fallback handling).
  if (code.startsWith("auth/")) return false;
  const message = e instanceof Error ? e.message : String(e ?? "");
  const haystack = `${code} ${message}`.toLowerCase();
  // Native plugin cancellations surface as the platform SDK's error:
  // iOS "The user canceled the sign-in flow", Android Credential Manager
  // "user canceled", legacy Google Sign-In status 12501 (SIGN_IN_CANCELLED).
  return haystack.includes("cancel") || haystack.includes("12501");
}

/**
 * Google sign-in on the Firebase backend (replaces the Lovable-brokered
 * OAuth flow used on Supabase).
 *
 * Native (Capacitor): the FirebaseAuthentication plugin brokers the Google
 * account pick natively and — because capacitor.config.ts sets
 * skipNativeAuth — returns the Google credential WITHOUT signing in; the
 * Firebase JS SDK then performs the actual sign-in via
 * signInWithCredential, so the JS SDK stays the single source of truth for
 * auth state. (The old signInWithRedirect approach lost its result across
 * the WebView/Custom-Tab boundary and dropped users back on the Log In
 * page, signed out.)
 *
 * Web: popup first; if the popup is blocked/unavailable, fall back to
 * signInWithRedirect — its result is consumed by completeRedirectOnce()
 * (getRedirectResult) at adapter init.
 */
export async function signInWithGoogleFirebase() {
  const { Capacitor } = await import("@capacitor/core");
  if (Capacitor.isNativePlatform()) {
    return signInWithGoogleNative();
  }
  return signInWithGoogleWeb();
}

async function signInWithGoogleNative() {
  const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
  const { GoogleAuthProvider, signInWithCredential } = await import("firebase/auth");
  const result = await FirebaseAuthentication.signInWithGoogle().catch((e: unknown) => {
    if (isUserCancelledSignIn(e)) return null;
    throw toErr(e);
  });
  if (!result) {
    return { redirected: false as const, cancelled: true as const };
  }
  const idToken = result.credential?.idToken;
  if (!idToken) {
    throw new BackendError(
      "Google sign-in did not return an ID token. Verify the app's SHA-1 is registered in the Firebase console and google-services.json is up to date.",
      "auth/missing-id-token",
    );
  }
  const credential = GoogleAuthProvider.credential(idToken, result.credential?.accessToken ?? undefined);
  try {
    const cred = await signInWithCredential(firebaseAuth, credential);
    void ensureProfile(cred.user);
    return { redirected: false as const, user: mapUser(cred.user) };
  } catch (e) {
    throw toErr(e);
  }
}

async function signInWithGoogleWeb() {
  const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = await import("firebase/auth");
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    const cred = await signInWithPopup(firebaseAuth, provider);
    void ensureProfile(cred.user);
    return { redirected: false as const, user: mapUser(cred.user) };
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (
      code === "auth/popup-blocked" ||
      code === "auth/cancelled-popup-request" ||
      code === "auth/operation-not-supported-in-this-environment"
    ) {
      // Flag first: the return leg only awaits getRedirectResult() when a
      // redirect was actually started (see completeRedirectOnce).
      markRedirectPending();
      await signInWithRedirect(firebaseAuth, provider);
      return { redirected: true as const };
    }
    if (isUserCancelledSignIn(e)) {
      return { redirected: false as const, cancelled: true as const };
    }
    throw toErr(e);
  }
}

/* ------------------------------ query builder ------------------------------ */

const TOP_LEVEL_TABLES = new Set(["marketplace_posts", "marketplace_categories", "subscription_plans", "roles", "sos_requests", "sos_request_details", "mechanics", "users", "offers", "config", "insurance_leads"]);

type Filter = { col: string; op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte"; val: unknown };
type Embed = { key: string; fields: string[] };
type Result = { data: unknown; error: BackendError | null; count?: number | null };

const OP_MAP = { eq: "==", neq: "!=", gt: ">", gte: ">=", lt: "<", lte: "<=" } as const;

function parseSelect(cols: string): { fields: string[] | null; embeds: Embed[] } {
  const embeds: Embed[] = [];
  const fields: string[] = [];
  let star = false;
  // Split on top-level commas (commas inside parens belong to embeds).
  const tokens: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of cols) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      tokens.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) tokens.push(cur);
  for (const raw of tokens) {
    const token = raw.trim();
    if (token === "*") star = true;
    else if (token.includes("(")) {
      const key = token.slice(0, token.indexOf("(")).trim();
      const inner = token.slice(token.indexOf("(") + 1, token.lastIndexOf(")"));
      embeds.push({ key, fields: inner.split(",").map((s) => s.trim()).filter(Boolean) });
    } else if (token) fields.push(token);
  }
  return { fields: star ? null : fields, embeds };
}

class QueryBuilder implements PromiseLike<Result> {
  private mode: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private filters: Filter[] = [];
  private orders: { col: string; ascending: boolean }[] = [];
  private limitN: number | null = null;
  private cols = "*";
  private countHead = false;
  private payload: Record<string, unknown> | Record<string, unknown>[] | null = null;
  private upsertOpts: { onConflict?: string } | null = null;
  private singleFlag: "single" | "maybe" | null = null;

  constructor(private table: string) {}

  select(cols = "*", opts?: { count?: string; head?: boolean }) {
    if (this.mode === "select") {
      this.cols = cols;
      if (opts?.count === "exact" && opts?.head) this.countHead = true;
    }
    return this;
  }
  eq(col: string, val: unknown) { this.filters.push({ col, op: "eq", val }); return this; }
  neq(col: string, val: unknown) { this.filters.push({ col, op: "neq", val }); return this; }
  gt(col: string, val: unknown) { this.filters.push({ col, op: "gt", val }); return this; }
  gte(col: string, val: unknown) { this.filters.push({ col, op: "gte", val }); return this; }
  lt(col: string, val: unknown) { this.filters.push({ col, op: "lt", val }); return this; }
  lte(col: string, val: unknown) { this.filters.push({ col, op: "lte", val }); return this; }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orders.push({ col, ascending: opts?.ascending !== false });
    return this;
  }
  limit(n: number) { this.limitN = n; return this; }
  single() { this.singleFlag = "single"; return this; }
  maybeSingle() { this.singleFlag = "maybe"; return this; }
  insert(payload: Record<string, unknown> | Record<string, unknown>[]) {
    this.mode = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: Record<string, unknown>) {
    this.mode = "update";
    this.payload = payload;
    return this;
  }
  upsert(payload: Record<string, unknown>, opts?: { onConflict?: string }) {
    this.mode = "upsert";
    this.payload = payload;
    this.upsertOpts = opts ?? null;
    return this;
  }
  delete() { this.mode = "delete"; return this; }

  then<TResult1 = Result, TResult2 = never>(
    onFulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onFulfilled, onRejected);
  }

  /* ------------------------------ internals ------------------------------ */

  private collectionFor(uid: string | null): CollectionReference {
    if (TOP_LEVEL_TABLES.has(this.table)) return collection(firebaseDb, this.table);
    if (!uid) throw new BackendError("Not authenticated", "PGRST301");
    return collection(firebaseDb, "users", uid, this.table);
  }

  /** Build the Firestore query with server-side filters only. */
  private filteredQuery(collRef: CollectionReference, uid: string | null): Query | CollectionReference {
    const constraints: QueryConstraint[] = [];
    for (const f of this.filters) {
      // Rows are keyed by the Firestore document id, and the `id` field
      // itself is never stored on the document (runInsert strips it).
      // An id filter must therefore target documentId() — a plain field
      // filter matches zero documents, which made every .eq("id", …)
      // update/delete silently resolve no targets and report success.
      if (f.col === "id") {
        constraints.push(where(documentId(), OP_MAP[f.op], f.val as never));
        continue;
      }
      // The subcollection path already scopes rows to the owner.
      if (!TOP_LEVEL_TABLES.has(this.table) && f.col === "user_id") {
        if (f.op === "eq" && uid && f.val !== uid) {
          // Filtering by someone else's id: match nothing.
          constraints.push(where(documentId(), "==", "__no_match__"));
        }
        continue;
      }
      constraints.push(where(f.col, OP_MAP[f.op], f.val as never));
    }
    return constraints.length ? fsQuery(collRef, ...constraints) : collRef;
  }

  /**
   * Read query for selects: filteredQuery() plus server-side orderBy /
   * limit where that cannot change the result.
   *
   * - orderBy is pushed only together with a limit (the only case where
   *   it reduces Firestore reads). On its own it stays client-side — see
   *   the header note: Firestore's orderBy excludes documents missing the
   *   sort field, which would shrink the row set for optional fields.
   * - Firestore legality: when an inequality filter (>, >=, <, <=, !=)
   *   is present, the first orderBy must be on that same field, or the
   *   query is rejected. If the caller's ordering violates that, nothing
   *   is pushed and the legacy fetch-all + client sort/limit path runs.
   * - single()/maybeSingle() depend only on the row count (0 / 1 / >1),
   *   so they are capped at 2 rows server-side regardless of ordering.
   * - sortAndLimit() still runs over the returned page as a post-pass:
   *   over an already ordered + limited page it is a no-op, and it keeps
   *   the exact legacy ordering for every non-pushed query.
   */
  private readQuery(collRef: CollectionReference, uid: string | null): Query | CollectionReference {
    const base = this.filteredQuery(collRef, uid);
    // user_id filters on per-user tables never reach Firestore (the path
    // scopes them), so exclude them from the legality check as well.
    const effectiveFilters = TOP_LEVEL_TABLES.has(this.table)
      ? this.filters
      : this.filters.filter((f) => f.col !== "user_id");
    const ineqCols = new Set(effectiveFilters.filter((f) => f.op !== "eq").map((f) => f.col));
    const orderPushable =
      this.orders.length > 0 &&
      (ineqCols.size === 0 || (ineqCols.size === 1 && ineqCols.has(this.orders[0].col)));

    let limitPush: number | null = null;
    if (this.limitN !== null && (orderPushable || this.orders.length === 0)) {
      limitPush = this.limitN;
    }
    if (this.singleFlag) {
      limitPush = limitPush === null ? 2 : Math.min(limitPush, 2);
    }
    if (limitPush === null) return base;

    const constraints: QueryConstraint[] = [];
    if (orderPushable) {
      for (const o of this.orders) constraints.push(orderBy(o.col, o.ascending ? "asc" : "desc"));
    }
    constraints.push(fsLimit(limitPush));
    return fsQuery(base, ...constraints);
  }

  private finishRows(rows: Record<string, unknown>[]): Result {
    if (this.singleFlag === "single") {
      if (rows.length === 1) return { data: rows[0], error: null };
      return {
        data: null,
        error: new BackendError("JSON object requested, multiple (or no) rows returned", "PGRST116"),
      };
    }
    if (this.singleFlag === "maybe") {
      if (rows.length === 0) return { data: null, error: null };
      if (rows.length === 1) return { data: rows[0], error: null };
      return {
        data: null,
        error: new BackendError("JSON object requested, multiple (or no) rows returned", "PGRST116"),
      };
    }
    return { data: rows, error: null };
  }

  private sortAndLimit(rows: Record<string, unknown>[]): Record<string, unknown>[] {
    let out = rows;
    for (const o of [...this.orders].reverse()) {
      out = [...out].sort((a, b) => {
        const av = a[o.col] as never;
        const bv = b[o.col] as never;
        if (av === bv) return 0;
        if (av === null || av === undefined) return o.ascending ? 1 : -1;
        if (bv === null || bv === undefined) return o.ascending ? -1 : 1;
        return (av < bv ? -1 : 1) * (o.ascending ? 1 : -1);
      });
    }
    if (this.limitN !== null) out = out.slice(0, this.limitN);
    return out;
  }

  private async applyEmbeds(rows: Record<string, unknown>[], embeds: Embed[]) {
    for (const embed of embeds) {
      // Only relationship in the schema: marketplace_posts.category_id ->
      // marketplace_categories/{id}, embedded under the table name.
      if (embed.key !== "marketplace_categories") continue;
      const cache = new Map<string, Record<string, unknown> | null>();
      for (const row of rows) {
        const catId = row.category_id as string | undefined;
        if (!catId) {
          row[embed.key] = null;
          continue;
        }
        if (!cache.has(catId)) {
          const snap = await getDoc(doc(firebaseDb, "marketplace_categories", catId));
          if (!snap.exists()) cache.set(catId, null);
          else {
            const data = snap.data() as Record<string, unknown>;
            const picked: Record<string, unknown> = {};
            for (const f of embed.fields) picked[f] = data[f] ?? null;
            cache.set(catId, picked);
          }
        }
        row[embed.key] = cache.get(catId);
      }
    }
  }

  private project(rows: Record<string, unknown>[], fields: string[] | null) {
    if (!fields) return rows;
    return rows.map((row) => {
      const out: Record<string, unknown> = { id: row.id };
      for (const f of fields) out[f] = row[f] ?? null;
      return out;
    });
  }

  private async runProfileSelect(uid: string | null): Promise<Result> {
    if (!uid) throw new BackendError("Not authenticated", "PGRST301");
    if (this.countHead) {
      // Admin-only aggregate over all profiles; Firestore rules only allow
      // owners to read their own user doc, so this succeeds only if the
      // deployed rules grant the admin claim a count. Callers that need a
      // user count should prefer the adminListUsers function instead.
      const snap = await getCountFromServer(collection(firebaseDb, "users"));
      return { data: null, error: null, count: snap.data().count };
    }
    const userFilter = this.filters.find((f) => f.col === "user_id");
    if (userFilter && userFilter.val !== uid) return this.finishRows([]);
    const snap = await getDoc(doc(firebaseDb, "users", uid));
    if (!snap.exists()) return this.finishRows([]);
    const row = { ...(snap.data() as Record<string, unknown>), id: uid, user_id: uid };
    const { fields } = parseSelect(this.cols);
    return this.finishRows(this.project([row], fields));
  }

  private async runSelect(): Promise<Result> {
    const uid = currentUid();
    if (this.table === "profiles") return this.runProfileSelect(uid);
    const collRef = this.collectionFor(uid);
    if (this.countHead) {
      const snap = await getCountFromServer(this.filteredQuery(collRef, uid));
      return { data: null, error: null, count: snap.data().count };
    }
    const snap = await getDocs(this.readQuery(collRef, uid));
    let rows: Record<string, unknown>[] = snap.docs.map((d) => ({ ...(d.data() as Record<string, unknown>), id: d.id }));
    const { fields, embeds } = parseSelect(this.cols);
    if (embeds.length) await this.applyEmbeds(rows, embeds);
    rows = this.project(rows, fields);
    rows = this.sortAndLimit(rows);
    return this.finishRows(rows);
  }

  private async resolveTargets(uid: string | null) {
    const collRef = this.collectionFor(uid);
    const snap = await getDocs(this.filteredQuery(collRef, uid));
    return snap.docs;
  }

  private async runInsert(): Promise<Result> {
    const uid = currentUid();
    const rows = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
    if (this.table === "profiles") {
      if (!uid) throw new BackendError("Not authenticated", "PGRST301");
      const data = clean(rows[0]);
      delete data.id;
      await setDoc(doc(firebaseDb, "users", uid), { ...data, updated_at: nowIso() }, { merge: true });
      return { data: null, error: null };
    }
    const collRef = this.collectionFor(uid);
    for (const row of rows) {
      const data = clean(row);
      const now = nowIso();
      if (data.created_at === undefined) data.created_at = now;
      if (data.updated_at === undefined) data.updated_at = now;
      const id = data.id as string | undefined;
      if (id) {
        delete data.id;
        await setDoc(doc(collRef, id), data);
      } else {
        await addDoc(collRef, data);
      }
    }
    return { data: null, error: null };
  }

  private async runUpdate(): Promise<Result> {
    const uid = currentUid();
    const data = clean((this.payload ?? {}) as Record<string, unknown>);
    delete data.id;
    data.updated_at = nowIso();
    if (this.table === "profiles") {
      if (!uid) throw new BackendError("Not authenticated", "PGRST301");
      const ref = doc(firebaseDb, "users", uid);
      try {
        await updateDoc(ref, data);
      } catch {
        await setDoc(ref, data, { merge: true });
      }
      return { data: null, error: null };
    }
    const targets = await this.resolveTargets(uid);
    for (const t of targets) await updateDoc(t.ref, data);
    return { data: null, error: null };
  }

  private async runUpsert(): Promise<Result> {
    const uid = currentUid();
    const data = clean((this.payload ?? {}) as Record<string, unknown>);
    // push_subscriptions case (onConflict "user_id,endpoint"): one doc per
    // endpoint per user. Reuse the existing doc if the endpoint is known.
    const conflictCols = (this.upsertOpts?.onConflict ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((c) => c && c !== "user_id");
    const collRef = this.collectionFor(uid);
    for (const col of conflictCols) {
      if (data[col] !== undefined) {
        const snap = await getDocs(fsQuery(collRef, where(col, "==", data[col] as never)));
        if (!snap.empty) {
          const existing = snap.docs[0];
          const { id: _id, ...rest } = data;
          await updateDoc(existing.ref, { ...rest, updated_at: nowIso() });
          return { data: null, error: null };
        }
      }
    }
    const now = nowIso();
    if (data.created_at === undefined) data.created_at = now;
    data.updated_at = now;
    const id = data.id as string | undefined;
    if (id) {
      delete data.id;
      await setDoc(doc(collRef, id), data, { merge: true });
    } else {
      await addDoc(collRef, data);
    }
    return { data: null, error: null };
  }

  private async runDelete(): Promise<Result> {
    const uid = currentUid();
    const targets = await this.resolveTargets(uid);
    for (const t of targets) await deleteDoc(t.ref);
    return { data: null, error: null };
  }

  private async execute(): Promise<Result> {
    try {
      switch (this.mode) {
        case "insert":
          return await this.runInsert();
        case "update":
          return await this.runUpdate();
        case "upsert":
          return await this.runUpsert();
        case "delete":
          return await this.runDelete();
        default:
          return await this.runSelect();
      }
    } catch (e) {
      return { data: null, error: toErr(e) };
    }
  }
}

/* ------------------------------ storage ------------------------------------ */

const storageAdapter = {
  from(bucket: string) {
    return {
      async upload(path: string, file: File | Blob, opts?: { upsert?: boolean; contentType?: string }) {
        try {
          const r = storageRef(firebaseStorage, `${bucket}/${path}`);
          await uploadBytes(r, file, opts?.contentType ? { contentType: opts.contentType } : undefined);
          return { data: { path: r.fullPath, id: r.fullPath, fullPath: r.fullPath }, error: null };
        } catch (e) {
          // Includes the Blaze-gated case (Storage not enabled): callers
          // already surface `error` as a toast, so the app degrades cleanly.
          return { data: null, error: toErr(e) };
        }
      },
      // Supabase's getPublicUrl is synchronous; the Firebase equivalent
      // (getDownloadURL) is not. Call sites `await` this — awaiting the
      // synchronous Supabase result is equally valid, so one code path
      // serves both backends.
      async getPublicUrl(path: string) {
        try {
          const url = await getDownloadURL(storageRef(firebaseStorage, `${bucket}/${path}`));
          return { data: { publicUrl: url } };
        } catch {
          return { data: { publicUrl: "" } };
        }
      },
    };
  },
};

/* --------------------------- rpc + functions ------------------------------- */

async function rpcAdapter(name: string, args?: Record<string, unknown>) {
  if (name === "has_role") {
    const uid = (args?._user_id as string | undefined) ?? currentUid();
    if (!uid) return { data: false, error: null };
    try {
      const snap = await getDoc(doc(firebaseDb, "roles", uid));
      const roles = snap.exists() ? ((snap.data().roles as string[] | undefined) ?? []) : [];
      return { data: roles.includes((args?._role as string) ?? "admin"), error: null };
    } catch (e) {
      return { data: null, error: toErr(e) };
    }
  }
  return { data: null, error: new BackendError(`rpc "${name}" has not been ported to Firebase`) };
}

// Supabase Edge Function name -> staged Firebase Callable Function name.
const FUNCTION_NAME_MAP: Record<string, string> = {
  "delete-account": "deleteAccount",
  "admin-list-users": "adminListUsers",
};

const functionsAdapter = {
  async invoke(name: string, opts?: { body?: Record<string, unknown>; headers?: Record<string, string> }) {
    const fnName = FUNCTION_NAME_MAP[name] ?? name;
    try {
      const callable = httpsCallable(firebaseFunctions, fnName);
      const res = await callable(opts?.body ?? {});
      return { data: res.data, error: null };
    } catch (e) {
      return { data: null, error: toErr(e) };
    }
  },
};

/* --------------------------------- export ---------------------------------- */

export const firebaseBackend = {
  from: (table: string) => new QueryBuilder(table),
  auth: authAdapter,
  storage: storageAdapter,
  rpc: rpcAdapter,
  functions: functionsAdapter,
};
