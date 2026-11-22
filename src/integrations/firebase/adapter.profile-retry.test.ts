/**
 * Deterministic mocked-auth tests for the 2026-11-21 verification policy's
 * profile-creation retry (ensureVerifiedProfileForCurrentUser) and the token
 * refresh it relies on (reloadCurrentUser). The Firebase client module and
 * the firestore/auth SDK entry points are mocked, so no network or emulator
 * is involved; the rules side of the same flow is covered by the
 * emulator-backed tests in firebase/functions/test/rules.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: string[] = [];

const currentUserHolder: { user: unknown } = { user: null };

vi.mock("@/integrations/firebase/client", () => ({
  firebaseAuth: {
    get currentUser() {
      return currentUserHolder.user;
    },
  },
  firebaseDb: {},
  firebaseStorage: {},
  firebaseFunctions: {},
  // Logout write gate (client.ts): never closed in these tests.
  isLogoutWriteGateClosed: () => false,
}));

const getDocMock = vi.fn();
const setDocMock = vi.fn();
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(),
  doc: vi.fn((...args: unknown[]) => ({ kind: "docRef", args })),
  getDoc: (...args: unknown[]) => getDocMock(...args),
  getDocs: vi.fn(),
  setDoc: (...args: unknown[]) => setDocMock(...args),
  updateDoc: vi.fn(),
  addDoc: vi.fn(),
  deleteDoc: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  documentId: vi.fn(),
  getCountFromServer: vi.fn(),
}));

vi.mock("firebase/auth", () => ({
  onIdTokenChanged: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendEmailVerification: vi.fn(),
  confirmPasswordReset: vi.fn(),
  updatePassword: vi.fn(),
  updateProfile: vi.fn(),
  getRedirectResult: vi.fn(async () => null),
}));

vi.mock("firebase/storage", () => ({ ref: vi.fn(), uploadBytes: vi.fn(), getDownloadURL: vi.fn() }));
vi.mock("firebase/functions", () => ({ httpsCallable: vi.fn() }));

import {
  reloadCurrentUser,
  ensureVerifiedProfileForCurrentUser,
} from "@/integrations/firebase/adapter";

function fakeUser(overrides: Record<string, unknown> = {}) {
  return {
    uid: "u1",
    email: "driver@example.com",
    displayName: "Driver One",
    photoURL: null,
    emailVerified: false,
    reload: vi.fn(async () => {
      calls.push("reload");
    }),
    getIdToken: vi.fn(async () => {
      calls.push("getIdToken");
      return "tok";
    }),
    ...overrides,
  };
}

beforeEach(() => {
  calls.length = 0;
  currentUserHolder.user = null;
  getDocMock.mockReset();
  setDocMock.mockReset();
  vi.restoreAllMocks();
});

describe("reloadCurrentUser", () => {
  it("reloads the user and THEN force-refreshes the ID token (rules see email_verified)", async () => {
    currentUserHolder.user = fakeUser();
    await reloadCurrentUser();
    const u = currentUserHolder.user as ReturnType<typeof fakeUser>;
    expect(u.reload).toHaveBeenCalledOnce();
    expect(u.getIdToken).toHaveBeenCalledWith(true);
    expect(calls).toEqual(["reload", "getIdToken"]);
  });

  it("is a no-op when signed out", async () => {
    await expect(reloadCurrentUser()).resolves.toBeUndefined();
  });
});

describe("ensureVerifiedProfileForCurrentUser (2026-11-21 policy retry)", () => {
  it("unverified user: NO profile write (the rules would deny it)", async () => {
    currentUserHolder.user = fakeUser({ emailVerified: false });
    await ensureVerifiedProfileForCurrentUser();
    expect(getDocMock).not.toHaveBeenCalled();
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it("verified user with missing profile: creates users/{uid} and the promise settles (awaited before page reload)", async () => {
    currentUserHolder.user = fakeUser({ emailVerified: true });
    getDocMock.mockResolvedValue({ exists: () => false });
    setDocMock.mockResolvedValue(undefined);
    await expect(ensureVerifiedProfileForCurrentUser()).resolves.toBeUndefined();
    expect(setDocMock).toHaveBeenCalledOnce();
    const [refArg, payload] = setDocMock.mock.calls[0] as [{ args: unknown[] }, Record<string, unknown>];
    expect(refArg.args).toEqual([{}, "users", "u1"]);
    expect(payload).toMatchObject({ user_id: "u1", email: "driver@example.com", full_name: "Driver One" });
  });

  it("verified user whose profile already exists: does NOT overwrite it", async () => {
    currentUserHolder.user = fakeUser({ emailVerified: true });
    getDocMock.mockResolvedValue({ exists: () => true });
    await ensureVerifiedProfileForCurrentUser();
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it("no signed-in user: resolves quietly with no writes", async () => {
    await expect(ensureVerifiedProfileForCurrentUser()).resolves.toBeUndefined();
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it("admin-only account: never creates a driver profile even when verified", async () => {
    currentUserHolder.user = fakeUser({ emailVerified: true, email: "altafraza7384@gmail.com" });
    await ensureVerifiedProfileForCurrentUser();
    expect(getDocMock).not.toHaveBeenCalled();
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it("firestore failure: swallows and logs, never throws into the Verify screen", async () => {
    currentUserHolder.user = fakeUser({ emailVerified: true });
    getDocMock.mockRejectedValue(new Error("permission-denied"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(ensureVerifiedProfileForCurrentUser()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("ensureProfile failed", expect.any(Error));
  });
});
