/**
 * Real-callback tests for recordDebtPaymentInTransaction (round 4).
 *
 * The DebtsPage tests mock the whole transaction helper, so mock
 * semantics passing there is not enough: these tests run the REAL
 * callback from src/integrations/firebase/adapter.ts against a faithful
 * in-memory Firestore — doc refs by path, getDoc, and a runTransaction
 * that buffers writes, checks read versions at commit, and RETRIES the
 * callback on contention exactly like Firestore (re-reading the balance,
 * so a concurrent committer's total is never overwritten).
 *
 * No network or emulator is involved. The fake only implements the
 * Firestore surface the callback uses (doc / getDoc / runTransaction);
 * every other Firestore function throws if touched, so a test that
 * accidentally leans on an unimplemented path fails loudly instead of
 * passing on a stub.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const fake = vi.hoisted(() => {
  type Entry = { data: Record<string, unknown>; version: number };
  const store = new Map<string, Entry>();
  let transactionRuns = 0;

  const docRef = (...args: unknown[]) => ({
    // doc(db, "users", uid, "debts", id) — first arg is the db, drop it.
    path: args
      .slice(1)
      .map((a) => String(a))
      .join("/"),
  });

  const snapshot = (path: string) => {
    const entry = store.get(path);
    return {
      exists: () => entry !== undefined,
      data: () => (entry ? { ...entry.data } : undefined),
    };
  };

  const runTransaction = async (
    _db: unknown,
    fn: (tx: {
      get: (ref: { path: string }) => Promise<ReturnType<typeof snapshot>>;
      set: (ref: { path: string }, data: Record<string, unknown>) => void;
      update: (ref: { path: string }, data: Record<string, unknown>) => void;
    }) => Promise<unknown>,
  ): Promise<unknown> => {
    for (let attempt = 0; attempt < 5; attempt++) {
      transactionRuns++;
      const readVersions = new Map<string, number>();
      const writes = new Map<string, Record<string, unknown>>();
      const tx = {
        get: async (ref: { path: string }) => {
          // Yield so a concurrent transaction can interleave its read
          // and commit before this one does — the interleaving the
          // server resolves by retrying the loser.
          await Promise.resolve();
          const entry = store.get(ref.path);
          readVersions.set(ref.path, entry?.version ?? -1);
          return snapshot(ref.path);
        },
        set: (ref: { path: string }, data: Record<string, unknown>) => {
          writes.set(ref.path, { ...data });
        },
        update: (ref: { path: string }, data: Record<string, unknown>) => {
          const base = writes.get(ref.path) ?? store.get(ref.path)?.data;
          if (!base) throw new Error("update on missing document");
          writes.set(ref.path, { ...base, ...data });
        },
      };
      // An application error (validation, missing debt) aborts the
      // transaction outright — Firestore only retries contention.
      const result = await fn(tx);
      let conflict = false;
      for (const [path, version] of readVersions) {
        if ((store.get(path)?.version ?? -1) !== version) {
          conflict = true;
          break;
        }
      }
      if (conflict) continue;
      for (const [path, data] of writes) {
        const prev = store.get(path);
        store.set(path, { data, version: (prev?.version ?? -1) + 1 });
      }
      return result;
    }
    throw new Error("transaction contention: too many retries");
  };

  const notImplemented = () => {
    throw new Error("fake firestore: function not implemented");
  };

  return {
    store,
    get transactionRuns() {
      return transactionRuns;
    },
    reset() {
      store.clear();
      transactionRuns = 0;
    },
    docRef,
    snapshot,
    runTransaction,
    notImplemented,
  };
});

vi.mock("@/integrations/firebase/client", () => ({
  firebaseAuth: {},
  firebaseDb: {},
  firebaseStorage: {},
  firebaseFunctions: {},
}));

vi.mock("firebase/firestore", () => ({
  collection: vi.fn(() => fake.notImplemented()),
  doc: (...args: unknown[]) => fake.docRef(...args),
  getDoc: async (ref: { path: string }) => fake.snapshot(ref.path),
  getDocs: vi.fn(async () => fake.notImplemented()),
  setDoc: vi.fn(async () => fake.notImplemented()),
  updateDoc: vi.fn(async () => fake.notImplemented()),
  addDoc: vi.fn(async () => fake.notImplemented()),
  deleteDoc: vi.fn(async () => fake.notImplemented()),
  runTransaction: (db: unknown, fn: (tx: never) => Promise<unknown>) =>
    fake.runTransaction(db, fn as never),
  query: vi.fn(() => fake.notImplemented()),
  where: vi.fn(() => fake.notImplemented()),
  orderBy: vi.fn(() => fake.notImplemented()),
  limit: vi.fn(() => fake.notImplemented()),
  documentId: vi.fn(() => fake.notImplemented()),
  getCountFromServer: vi.fn(async () => fake.notImplemented()),
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
  getDebtPaymentByAttempt,
  recordDebtPaymentInTransaction,
} from "@/integrations/firebase/adapter";

const USER_ID = "u1";
const DEBT_ID = "d1";

function seedDebt(overrides: Record<string, unknown> = {}) {
  fake.store.set(`users/${USER_ID}/debts/${DEBT_ID}`, {
    data: { principal: 1200, total_paid: 0, is_active: true, ...overrides },
    version: 0,
  });
}

function readDebt() {
  return fake.store.get(`users/${USER_ID}/debts/${DEBT_ID}`)?.data as
    | { principal: number; total_paid: number; is_active: boolean }
    | undefined;
}

function paymentDocs() {
  return [...fake.store.entries()]
    .filter(([path]) => path.startsWith(`users/${USER_ID}/debt_payments/`))
    .map(([, entry]) => entry.data);
}

beforeEach(() => {
  fake.reset();
});

describe("recordDebtPaymentInTransaction (real callback, faithful fake Firestore)", () => {
  it("records the payment and the new balance together", async () => {
    seedDebt();
    const result = await recordDebtPaymentInTransaction({
      userId: USER_ID,
      debtId: DEBT_ID,
      attemptKey: "k1",
      amount: 100,
    });
    expect(result).toEqual({ newTotalPaid: 100, isFullyPaid: false, alreadyRecorded: false });
    expect(paymentDocs()).toHaveLength(1);
    expect(paymentDocs()[0]).toMatchObject({ debt_id: DEBT_ID, amount: 100 });
    expect(readDebt()?.total_paid).toBe(100);
  });

  it("same attempt key twice is idempotent: one doc, balance moved once", async () => {
    seedDebt();
    const first = await recordDebtPaymentInTransaction({
      userId: USER_ID,
      debtId: DEBT_ID,
      attemptKey: "k1",
      amount: 100,
    });
    const second = await recordDebtPaymentInTransaction({
      userId: USER_ID,
      debtId: DEBT_ID,
      attemptKey: "k1",
      amount: 100,
    });
    expect(first.alreadyRecorded).toBe(false);
    expect(second).toEqual({ newTotalPaid: 100, isFullyPaid: false, alreadyRecorded: true });
    expect(paymentDocs()).toHaveLength(1);
    expect(readDebt()?.total_paid).toBe(100);
  });

  it("overpayment throws and writes nothing (atomic rollback)", async () => {
    seedDebt({ total_paid: 1150 });
    await expect(
      recordDebtPaymentInTransaction({
        userId: USER_ID,
        debtId: DEBT_ID,
        attemptKey: "k1",
        amount: 100,
      }),
    ).rejects.toThrow(/more than the remaining amount/);
    expect(paymentDocs()).toHaveLength(0);
    expect(readDebt()?.total_paid).toBe(1150);
  });

  it("missing debt throws and writes nothing", async () => {
    await expect(
      recordDebtPaymentInTransaction({
        userId: USER_ID,
        debtId: DEBT_ID,
        attemptKey: "k1",
        amount: 100,
      }),
    ).rejects.toThrow(/could not be found/);
    expect(paymentDocs()).toHaveLength(0);
  });

  it("two concurrent distinct payments both count (latest balance, loser retries)", async () => {
    seedDebt();
    const [a, b] = await Promise.all([
      recordDebtPaymentInTransaction({
        userId: USER_ID,
        debtId: DEBT_ID,
        attemptKey: "kA",
        amount: 100,
      }),
      recordDebtPaymentInTransaction({
        userId: USER_ID,
        debtId: DEBT_ID,
        attemptKey: "kB",
        amount: 50,
      }),
    ]);
    expect(a.alreadyRecorded).toBe(false);
    expect(b.alreadyRecorded).toBe(false);
    expect(paymentDocs()).toHaveLength(2);
    expect(readDebt()?.total_paid).toBe(150);
    // The loser saw the winner's commit mid-flight and re-ran the
    // callback with a fresh read — without the retry the second
    // committer would have overwritten 100 with its own stale 0+50.
    expect(fake.transactionRuns).toBeGreaterThanOrEqual(3);
  });

  it("two concurrent payments with the SAME attempt key record once", async () => {
    seedDebt();
    await Promise.all([
      recordDebtPaymentInTransaction({
        userId: USER_ID,
        debtId: DEBT_ID,
        attemptKey: "k1",
        amount: 100,
      }),
      recordDebtPaymentInTransaction({
        userId: USER_ID,
        debtId: DEBT_ID,
        attemptKey: "k1",
        amount: 100,
      }),
    ]);
    expect(paymentDocs()).toHaveLength(1);
    expect(readDebt()?.total_paid).toBe(100);
  });

  it("a payment that exactly clears the loan marks it fully paid and inactive", async () => {
    seedDebt({ total_paid: 1100 });
    const result = await recordDebtPaymentInTransaction({
      userId: USER_ID,
      debtId: DEBT_ID,
      attemptKey: "k1",
      amount: 100,
    });
    expect(result).toEqual({ newTotalPaid: 1200, isFullyPaid: true, alreadyRecorded: false });
    expect(readDebt()?.total_paid).toBe(1200);
    expect(readDebt()?.is_active).toBe(false);
  });
});

describe("getDebtPaymentByAttempt (real read, faithful fake Firestore)", () => {
  it("returns null before the payment exists, the row after it is recorded", async () => {
    seedDebt();
    expect(
      await getDebtPaymentByAttempt({ userId: USER_ID, debtId: DEBT_ID, attemptKey: "k1" }),
    ).toBeNull();
    await recordDebtPaymentInTransaction({
      userId: USER_ID,
      debtId: DEBT_ID,
      attemptKey: "k1",
      amount: 100,
    });
    expect(
      await getDebtPaymentByAttempt({ userId: USER_ID, debtId: DEBT_ID, attemptKey: "k1" }),
    ).toMatchObject({ amount: 100 });
    expect(
      await getDebtPaymentByAttempt({ userId: USER_ID, debtId: DEBT_ID, attemptKey: "other" }),
    ).toBeNull();
  });
});
