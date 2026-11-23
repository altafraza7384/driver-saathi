import { describe, expect, it } from "vitest";
import { debtPaymentId, newPaymentAttemptKey, planDebtPayment } from "./debts";

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
