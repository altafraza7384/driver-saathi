import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { db, requireVerifiedDriver } from "./shared";

const REGION = "asia-south1";

// Audit item 5, owner decision 2026-11-21: at most ONE active SOS request
// per driver at a time, and at most MAX_SOS_PER_DAY new SOS submissions
// per driver per day. Enforced here, server-side and atomically inside a
// single transaction; client direct creates are denied in firestore.rules
// so the quota cannot be bypassed.
export const ACTIVE_SOS_STATUSES = ["pending", "accepted", "onway", "arrived"] as const;
export const MAX_SOS_PER_DAY = 5;

// The quota day is the Asia/Kolkata calendar day: the drivers are in India
// and the app already presents IST times, so the daily limit resets at
// midnight IST, not midnight UTC.
export function istDayIso(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// End of the IST calendar day containing d, in epoch millis. IST is fixed
// UTC+05:30 (no DST), so this is exact. Stored on the quota doc so
// firestore.rules can compare numerically — rules cannot format an IST
// calendar day from request.time.
export function istDayEndMs(d: Date): number {
  return new Date(`${istDayIso(d)}T00:00:00+05:30`).getTime() + 86_400_000;
}

const CATEGORIES = new Set(["car", "battery", "towing", "other", "custom"]);

export interface SosCreateInput {
  requestId: string;
  category: string;
  description: string | null;
  approxLat: number | null;
  approxLng: number | null;
  geohash: string | null;
  areaText: string | null;
  driverPhone: string;
  driverName: string | null;
  exactLat: number | null;
  exactLng: number | null;
}

function strOrNull(v: unknown, maxLen: number, field: string): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || v.length > maxLen) {
    throw new HttpsError("invalid-argument", `${field} must be a string of at most ${maxLen} chars`);
  }
  return v;
}

function numOrNull(v: unknown, min: number, max: number, field: string): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
    throw new HttpsError("invalid-argument", `${field} must be a number between ${min} and ${max}`);
  }
  return v;
}

// Validates everything the client sends. driverId/status are NEVER taken
// from the client: driverId is the auth uid and status starts 'pending'.
export function validateSosInput(data: unknown): SosCreateInput {
  const d = (data ?? {}) as Record<string, unknown>;
  const requestId = d.requestId;
  if (typeof requestId !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(requestId)) {
    throw new HttpsError("invalid-argument", "requestId must be 8-64 chars of [A-Za-z0-9-]");
  }
  const category = d.category;
  if (typeof category !== "string" || !CATEGORIES.has(category)) {
    throw new HttpsError("invalid-argument", "unknown category");
  }
  const driverPhone = typeof d.driverPhone === "string" ? d.driverPhone.replace(/\D/g, "") : "";
  if (!/^\d{10,15}$/.test(driverPhone)) {
    throw new HttpsError("invalid-argument", "driverPhone must be 10-15 digits");
  }
  return {
    requestId,
    category,
    description: strOrNull(d.description, 500, "description"),
    approxLat: numOrNull(d.approxLat, -90, 90, "approxLat"),
    approxLng: numOrNull(d.approxLng, -180, 180, "approxLng"),
    geohash: strOrNull(d.geohash, 12, "geohash"),
    areaText: strOrNull(d.areaText, 200, "areaText"),
    driverPhone,
    driverName: strOrNull(d.driverName, 100, "driverName"),
    exactLat: numOrNull(d.exactLat, -90, 90, "exactLat"),
    exactLng: numOrNull(d.exactLng, -180, 180, "exactLng"),
  };
}

/**
 * Core of the createSosRequest callable (exported for tests).
 *
 * Atomicity: the active-marker doc (sos_active/{uid}) and the daily
 * counter (sos_quota/{uid}) are read and written in the SAME transaction
 * as the request + details docs. Firestore transactions serialise on
 * document conflicts, so two simultaneous creates for one driver cannot
 * both pass: the loser's marker read conflicts and it retries against
 * the winner's marker, then fails with failed-precondition.
 *
 * Retry semantics: the client generates requestId once per user tap and
 * the callable stores it. A retried call with the same id returns the
 * existing request (deduped) WITHOUT counting against the daily quota a
 * second time — the quota counts created requests, not attempts.
 *
 * Stale-marker self-heal: the sosActiveCleanup trigger removes the marker
 * when a request leaves an active status, but triggers are asynchronous.
 * If the marker points at a request that is already closed (or gone), it
 * is treated as absent and overwritten, so a driver is never stuck behind
 * a dead marker in an emergency.
 */
export async function createSosRequestForUser(
  uid: string,
  input: SosCreateInput,
): Promise<{ requestId: string; deduped: boolean }> {
  const profile = await db.doc(`users/${uid}`).get();
  if (profile.get("is_blocked") === true) {
    throw new HttpsError("permission-denied", "This account is blocked.");
  }
  const reqRef = db.doc(`sos_requests/${input.requestId}`);
  const detRef = db.doc(`sos_request_details/${input.requestId}`);
  const markerRef = db.doc(`sos_active/${uid}`);
  const quotaRef = db.doc(`sos_quota/${uid}`);
  return db.runTransaction(async (tx) => {
    const [reqSnap, markerSnap, quotaSnap] = await Promise.all([
      tx.get(reqRef),
      tx.get(markerRef),
      tx.get(quotaRef),
    ]);
    // Idempotent retry: this exact request was already created.
    if (reqSnap.exists) {
      if (reqSnap.get("driverId") === uid) {
        return { requestId: input.requestId, deduped: true };
      }
      throw new HttpsError("already-exists", "requestId already in use");
    }
    if (markerSnap.exists) {
      const activeId = markerSnap.get("requestId") as string;
      const activeSnap = await tx.get(db.doc(`sos_requests/${activeId}`));
      const status = activeSnap.get("status") as string | undefined;
      if (
        activeSnap.exists &&
        (ACTIVE_SOS_STATUSES as readonly string[]).includes(status ?? "")
      ) {
        throw new HttpsError("failed-precondition", "sos-active-exists");
      }
      // Stale marker: the request is already closed (cleanup trigger
      // lagging) — fall through and overwrite it.
    } else {
      // Pre-rollout compatibility: requests created before markers existed
      // have no sos_active doc. Equality+equality queries need no composite
      // index; this runs at most until the driver's first post-rollout
      // create writes the marker. Two simultaneous first-creates still
      // serialise on the marker write below.
      for (const st of ACTIVE_SOS_STATUSES) {
        const legacy = await tx.get(
          db.collection("sos_requests")
            .where("driverId", "==", uid)
            .where("status", "==", st)
            .limit(1),
        );
        if (!legacy.empty) {
          throw new HttpsError("failed-precondition", "sos-active-exists");
        }
      }
    }
    const today = istDayIso(new Date());
    // Rollout boundary (documented in the PR): the daily counter only
    // counts requests created through this callable; requests made before
    // the rollout do not retroactively consume today's quota.
    const count =
      quotaSnap.get("day") === today ? ((quotaSnap.get("count") as number | undefined) ?? 0) : 0;
    if (count >= MAX_SOS_PER_DAY) {
      throw new HttpsError("resource-exhausted", "sos-daily-limit");
    }
    const now = new Date().toISOString();
    // The public request doc carries NO phone and NO exact location
    // (same split the client used to write; audit 2026-10-24).
    tx.set(reqRef, {
      id: input.requestId,
      driverId: uid,
      // Quota-claim flag: this doc is born counted because the counter is
      // incremented in THIS transaction. The legacy-counting trigger and
      // the rollout backfill skip any doc carrying counted:true, so no
      // path can double-count a request.
      counted: true,
      category: input.category,
      description: input.description,
      approxLat: input.approxLat,
      approxLng: input.approxLng,
      geohash: input.geohash,
      areaText: input.areaText,
      status: "pending",
      mechanicId: null,
      mechanicName: null,
      mechanicPhone: null,
      chargesAgreed: null,
      rating: null,
      created_at: now,
      updated_at: now,
    });
    tx.set(detRef, {
      id: input.requestId,
      requestId: input.requestId,
      driverId: uid,
      driverPhone: input.driverPhone,
      driverName: input.driverName,
      exactLat: input.exactLat,
      exactLng: input.exactLng,
      mechanicId: null,
    });
    tx.set(markerRef, { requestId: input.requestId, created_at: now });
    tx.set(quotaRef, { day: today, count: count + 1, dayEnd: Timestamp.fromMillis(istDayEndMs(new Date())) });
    return { requestId: input.requestId, deduped: false };
  });
}

export const createSosRequest = onCall({ region: REGION }, async (req) => {
  const uid = requireVerifiedDriver(req);
  const input = validateSosInput(req.data);
  return createSosRequestForUser(uid, input);
});

/**
 * Claims ONE sos_requests doc for quota counting — the single counting
 * path shared by the legacy-create trigger and the rollout backfill
 * (both exported callers below).
 *
 * Idempotency protocol: a doc is counted iff its `counted` flag flips
 * false→true inside the same transaction that increments the counter.
 * Callable-created docs are BORN with counted:true (the callable already
 * incremented in its own transaction), so all three writers — callable,
 * trigger, backfill — are mutually exclusive without ordering
 * guarantees: trigger retries, backfill re-runs and backfill/trigger
 * races all converge on count==1 per doc.
 *
 * The increment lands on the counter for the doc's OWN IST day, derived
 * from the SERVER-ASSIGNED createTime (DocumentSnapshot.createTime) —
 * never the client-written created_at field, which a malicious client
 * could backdate to charge a past day's counter.
 *
 * Marker convergence: when the claimed doc is itself active and no
 * marker points at a genuinely active request, the marker is set to this
 * doc — so a legacy client's second create (checked in rules or by the
 * callable) sees the active state. A marker pointing at an active
 * request is never clobbered: concurrent legacy creates keep today's
 * pre-quota behaviour rather than hiding one of them.
 */
/**
 * Inner claim with an EXPLICIT creation time — the unit under test for
 * the cross-day races (the emulator always stamps createTime as "now",
 * so yesterday-docs are simulated by calling this directly). The
 * counted-flag check and all writes stay inside ONE transaction, so
 * concurrent claims for mixed days serialise.
 *
 * Cross-day rule: the single per-user counter only ever moves FORWARD.
 * A doc whose day is OLDER than the counter's current day is stamped
 * counted WITHOUT touching the counter — yesterday's quota is irrelevant
 * to today's enforcement, and overwriting today's count would reset it
 * (a trigger retry across midnight must never hand the driver 5 fresh
 * requests). A doc whose day is NEWER starts the new day's counter.
 */
export async function claimSosCreateDoc(
  requestId: string,
  driverId: string,
  status: string | undefined,
  created: Date,
): Promise<boolean> {
  const reqRef = db.doc(`sos_requests/${requestId}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(reqRef);
    if (!snap.exists) return false;
    if (snap.get("counted") === true) return false;
    if (snap.get("driverId") !== driverId) return false;
    const markerRef = db.doc(`sos_active/${driverId}`);
    const quotaRef = db.doc(`sos_quota/${driverId}`);
    const [markerSnap, quotaSnap] = await Promise.all([tx.get(markerRef), tx.get(quotaRef)]);
    let markerBlockedBy: string | null = null;
    if (markerSnap.exists) {
      const activeId = markerSnap.get("requestId") as string;
      const activeSnap = await tx.get(db.doc(`sos_requests/${activeId}`));
      if (activeSnap.exists && (ACTIVE_SOS_STATUSES as readonly string[]).includes(activeSnap.get("status") ?? "")) {
        markerBlockedBy = activeId;
      }
    }
    const day = istDayIso(created);
    const counterDay = quotaSnap.get("day") as string | undefined;
    tx.update(reqRef, { counted: true });
    // ISO day strings compare correctly lexicographically.
    if (counterDay === undefined || counterDay <= day) {
      const count = counterDay === day ? ((quotaSnap.get("count") as number | undefined) ?? 0) : 0;
      tx.set(quotaRef, { day, count: count + 1, dayEnd: Timestamp.fromMillis(istDayEndMs(created)) });
    }
    if (!markerBlockedBy && status && (ACTIVE_SOS_STATUSES as readonly string[]).includes(status)) {
      tx.set(markerRef, { requestId, created_at: created.toISOString() });
    }
    return true;
  });
}

export async function countSosCreateIfUnclaimed(requestId: string): Promise<boolean> {
  const snap = await db.doc(`sos_requests/${requestId}`).get();
  if (!snap.exists) return false;
  const driverId = snap.get("driverId");
  if (typeof driverId !== "string" || !driverId) return false;
  const created = snap.createTime ? snap.createTime.toDate() : null;
  if (!created || Number.isNaN(created.getTime())) return false;
  return claimSosCreateDoc(requestId, driverId, snap.get("status") as string | undefined, created);
}

/**
 * Legacy-create counter: sos_requests docs written directly by OLD app
 * versions (allowed by rules until the owner-chosen cutoff) carry no
 * counted flag, so this trigger runs the shared claim transaction for
 * them. Trigger wiring itself cannot fire under the firestore-only
 * emulator; countSosCreateIfUnclaimed is unit-tested directly.
 */
export const sosLegacyCreateCounter = onDocumentCreated(
  { document: "sos_requests/{requestId}", region: REGION },
  async (event) => {
    if (!event.data) return;
    await countSosCreateIfUnclaimed(event.params.requestId);
  },
);

/**
 * Clears the active marker when a request leaves an active status —
 * including driver cancels/completes written straight through the rules
 * and mechanic-side status moves. Conditional on the marker pointing at
 * THIS request, so a newer active request is never clobbered. Exported
 * for tests; lag is covered by the stale-marker self-heal in
 * createSosRequestForUser.
 */
export async function clearActiveMarker(driverId: unknown, requestId: string): Promise<void> {
  if (typeof driverId !== "string" || !driverId) return;
  const markerRef = db.doc(`sos_active/${driverId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(markerRef);
    if (snap.exists && snap.get("requestId") === requestId) tx.delete(markerRef);
  });
}

export const sosActiveCleanup = onDocumentUpdated(
  { document: "sos_requests/{requestId}", region: REGION },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    const wasActive = (ACTIVE_SOS_STATUSES as readonly string[]).includes(before.status as string);
    const isActive = (ACTIVE_SOS_STATUSES as readonly string[]).includes(after.status as string);
    if (!wasActive || isActive) return;
    await clearActiveMarker(after.driverId, event.params.requestId);
  },
);
