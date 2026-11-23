import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingPaymentAttempt,
  debtPaymentId,
  loadPendingPaymentAttempt,
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

describe("pending payment attempt (durable, survives remount/reload)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("keys the stored attempt by user + debt, so debts never share a key", () => {
    expect(paymentAttemptStorageKey("u1", "d1")).toBe("ds:pay-attempt:u1:d1");
    expect(paymentAttemptStorageKey("u1", "d1")).not.toBe(paymentAttemptStorageKey("u1", "d2"));
    expect(paymentAttemptStorageKey("u1", "d1")).not.toBe(paymentAttemptStorageKey("u2", "d1"));
  });

  it("round-trips a saved attempt: the same key + amount come back", () => {
    expect(loadPendingPaymentAttempt("u1", "d1")).toBeNull();
    expect(savePendingPaymentAttempt("u1", "d1", "k1", 100)).toBe(true);
    expect(loadPendingPaymentAttempt("u1", "d1")).toEqual({ key: "k1", amount: 100 });
  });

  it("clear removes only that debt's attempt, and only on full success", () => {
    savePendingPaymentAttempt("u1", "d1", "k1", 100);
    savePendingPaymentAttempt("u1", "d2", "k2", 50);
    clearPendingPaymentAttempt("u1", "d1");
    expect(loadPendingPaymentAttempt("u1", "d1")).toBeNull();
    expect(loadPendingPaymentAttempt("u1", "d2")).toEqual({ key: "k2", amount: 50 });
  });

  it("a corrupt stored value reads as no attempt (never crashes the pay flow)", () => {
    window.localStorage.setItem(paymentAttemptStorageKey("u1", "d1"), "{not json");
    expect(loadPendingPaymentAttempt("u1", "d1")).toBeNull();
    window.localStorage.setItem(
      paymentAttemptStorageKey("u1", "d1"),
      JSON.stringify({ key: "", amount: 100 }),
    );
    expect(loadPendingPaymentAttempt("u1", "d1")).toBeNull();
    window.localStorage.setItem(
      paymentAttemptStorageKey("u1", "d1"),
      JSON.stringify({ key: "k1", amount: "100" }),
    );
    expect(loadPendingPaymentAttempt("u1", "d1")).toBeNull();
  });

  it("save reports false when storage throws, so the caller can abort instead of minting a fresh id", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    try {
      expect(savePendingPaymentAttempt("u1", "d1", "k1", 100)).toBe(false);
      expect(loadPendingPaymentAttempt("u1", "d1")).toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("load surfaces a storage read failure instead of silently pretending no attempt exists", () => {
    savePendingPaymentAttempt("u1", "d1", "k1", 100);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    try {
      expect(() => loadPendingPaymentAttempt("u1", "d1")).toThrow();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
