import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingPaymentAttempt,
  debtPaymentId,
  loadPendingPaymentAttempts,
  newPaymentAttemptKey,
  paymentAttemptStorageKey,
  planDebtPayment,
  savePendingPaymentAttempt,
} from "./debts";

describe("debtPaymentId / newPaymentAttemptKey", () => {
  it("is deterministic for the same debt + attempt key", () => {
    expect(debtPaymentId("d1", "k1")).toBe(debtPaymentId("d1", "k1"));
    expect(debtPaymentId("d1", "k1")).toBe("dp_d1_k1");
  });

  it("differs across attempt keys and debts, so distinct payments get distinct rows", () => {
    expect(debtPaymentId("d1", "k1")).not.toBe(debtPaymentId("d1", "k2"));
    expect(debtPaymentId("d1", "k1")).not.toBe(debtPaymentId("d2", "k1"));
    expect(newPaymentAttemptKey()).not.toBe(newPaymentAttemptKey());
  });

  it("never contains a slash (illegal in a Firestore doc id)", () => {
    for (let i = 0; i < 20; i++) {
      expect(newPaymentAttemptKey()).not.toContain("/");
      expect(debtPaymentId("d1", newPaymentAttemptKey())).not.toContain("/");
    }
  });
});

describe("planDebtPayment", () => {
  it("adds to total_paid and marks fully paid at the principal", () => {
    expect(planDebtPayment({ principal: 1200, total_paid: 1100 }, 100)).toEqual({
      newTotalPaid: 1200,
      isFullyPaid: true,
    });
    expect(planDebtPayment({ principal: 1200, total_paid: 0 }, 100)).toEqual({
      newTotalPaid: 100,
      isFullyPaid: false,
    });
  });

  it("coerces missing totals instead of producing NaN", () => {
    expect(planDebtPayment({ principal: 1200, total_paid: undefined as unknown as number }, 100)).toEqual({
      newTotalPaid: 100,
      isFullyPaid: false,
    });
  });
});

describe("pending payment attempts (durable per-attempt registry, survives remount/reload)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("keys attempts by user + debt + attempt id, so two attempts never share a slot", () => {
    // The legacy two-arg key is the shared prefix (and the old
    // single-slot key, still read for upgrade safety).
    expect(paymentAttemptStorageKey("u1", "d1")).toBe("ds:pay-attempt:u1:d1");
    expect(paymentAttemptStorageKey("u1", "d1", "k1")).toBe("ds:pay-attempt:u1:d1:k1");
    expect(paymentAttemptStorageKey("u1", "d1", "k1")).not.toBe(
      paymentAttemptStorageKey("u1", "d1", "k2"),
    );
    expect(paymentAttemptStorageKey("u1", "d1", "k1")).not.toBe(
      paymentAttemptStorageKey("u1", "d2", "k1"),
    );
  });

  it("round-trips a saved attempt: the same key + amount + session come back", () => {
    expect(loadPendingPaymentAttempts("u1", "d1")).toEqual([]);
    expect(savePendingPaymentAttempt("u1", "d1", "k1", 100, "s1")).toBe(true);
    expect(loadPendingPaymentAttempts("u1", "d1")).toEqual([
      expect.objectContaining({ key: "k1", amount: 100, sessionId: "s1" }),
    ]);
  });

  it("two attempts for the same debt coexist — saving the second never overwrites the first", () => {
    // REGRESSION (round 4, bug a): the old single slot overwrote the
    // first attempt when a second payment started, so a later retry of
    // the first amount could mint a fresh id and double-record — or a
    // failed cleanup could make the second payment reuse the first
    // attempt's id and silently drop it.
    savePendingPaymentAttempt("u1", "d1", "k1", 100, "s1");
    savePendingPaymentAttempt("u1", "d1", "k2", 150, "s1");
    const loaded = loadPendingPaymentAttempts("u1", "d1");
    expect(loaded).toHaveLength(2);
    expect(loaded.map((a) => a.key).sort()).toEqual(["k1", "k2"]);
    expect(loaded.find((a) => a.key === "k1")).toMatchObject({ amount: 100 });
    expect(loaded.find((a) => a.key === "k2")).toMatchObject({ amount: 150 });
  });

  it("clear removes only that attempt, and only on full success", () => {
    savePendingPaymentAttempt("u1", "d1", "k1", 100, "s1");
    savePendingPaymentAttempt("u1", "d1", "k2", 150, "s1");
    savePendingPaymentAttempt("u1", "d2", "k3", 50, "s1");
    clearPendingPaymentAttempt("u1", "d1", "k1");
    expect(loadPendingPaymentAttempts("u1", "d1")).toEqual([
      expect.objectContaining({ key: "k2", amount: 150 }),
    ]);
    expect(loadPendingPaymentAttempts("u1", "d2")).toEqual([
      expect.objectContaining({ key: "k3", amount: 50 }),
    ]);
  });

  it("a corrupt stored entry is skipped, never crashing the pay flow", () => {
    savePendingPaymentAttempt("u1", "d1", "k1", 100, "s1");
    window.localStorage.setItem(paymentAttemptStorageKey("u1", "d1", "k2"), "{not json");
    window.localStorage.setItem(
      paymentAttemptStorageKey("u1", "d1", "k3"),
      JSON.stringify({ amount: "100", sessionId: "s1" }),
    );
    const loaded = loadPendingPaymentAttempts("u1", "d1");
    expect(loaded).toEqual([expect.objectContaining({ key: "k1", amount: 100 })]);
  });

  it("the legacy single-slot attempt is still surfaced (upgrade safety)", () => {
    // Written by the round-3 code; the registry never writes this key,
    // but a pending attempt left by it must be reconciled, not lost.
    window.localStorage.setItem(
      paymentAttemptStorageKey("u1", "d1"),
      JSON.stringify({ key: "k-old", amount: 100 }),
    );
    expect(loadPendingPaymentAttempts("u1", "d1")).toEqual([
      expect.objectContaining({ key: "k-old", amount: 100, sessionId: "" }),
    ]);
  });

  it("entries older than 24h are pruned on load (dead tabs never block a new payment)", () => {
    savePendingPaymentAttempt("u1", "d1", "k1", 100, "s1");
    window.localStorage.setItem(
      paymentAttemptStorageKey("u1", "d1", "k1"),
      JSON.stringify({ amount: 100, sessionId: "s1", createdAt: Date.now() - 25 * 3600 * 1000 }),
    );
    expect(loadPendingPaymentAttempts("u1", "d1")).toEqual([]);
    expect(window.localStorage.getItem(paymentAttemptStorageKey("u1", "d1", "k1"))).toBeNull();
  });

  it("save reports false when storage throws, so the caller can abort instead of minting a fresh id", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    try {
      expect(savePendingPaymentAttempt("u1", "d1", "k1", 100, "s1")).toBe(false);
      expect(loadPendingPaymentAttempts("u1", "d1")).toEqual([]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("load surfaces a storage read failure instead of silently pretending no attempt exists", () => {
    savePendingPaymentAttempt("u1", "d1", "k1", 100, "s1");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    try {
      expect(() => loadPendingPaymentAttempts("u1", "d1")).toThrow();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
