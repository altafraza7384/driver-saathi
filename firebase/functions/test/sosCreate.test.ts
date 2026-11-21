/**
 * Tests for the SOS quota callable (audit item 5, owner decision
 * 2026-11-21): 1 active SOS per driver + max 5 new SOS per driver per
 * IST day, enforced atomically server-side. Runs against the Firestore
 * emulator (the suite is executed via `firebase emulators:exec`).
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../src/shared";
import {
  createSosRequest,
  createSosRequestForUser,
  clearActiveMarker,
  validateSosInput,
  istDayIso,
  MAX_SOS_PER_DAY,
} from "../src/sosCreate";

// Unique ids per test so emulator state never leaks between tests.
const uid = () => `drv-${randomUUID()}`;
const rid = () => randomUUID();

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    requestId: rid(),
    category: "car",
    description: "puncture",
    approxLat: 18.52,
    approxLng: 73.86,
    geohash: "tejvx",
    areaText: "Pune",
    driverPhone: "9876543210",
    driverName: "Driver",
    exactLat: 18.5204,
    exactLng: 73.8567,
    ...overrides,
  };
}

async function expectHttps(p: Promise<unknown>, code: string, message?: string) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(HttpsError);
    expect((e as HttpsError).code).toBe(code);
    if (message) expect((e as HttpsError).message).toBe(message);
    return;
  }
  throw new Error(`expected HttpsError ${code}, call succeeded`);
}

describe("validateSosInput", () => {
  it("accepts the app's payload and never takes driverId/status from the client", () => {
    const v = validateSosInput(validInput({ driverId: "spoofed", status: "completed" }));
    expect(v.requestId).toBeTruthy();
    expect(v).not.toHaveProperty("driverId");
    expect(v).not.toHaveProperty("status");
  });
  it("rejects bad requestId / category / phone / coords", () => {
    expect(() => validateSosInput(validInput({ requestId: "x" }))).toThrowError(HttpsError);
    expect(() => validateSosInput(validInput({ requestId: "a b c d e f g h" }))).toThrowError(HttpsError);
    expect(() => validateSosInput(validInput({ category: "helicopter" }))).toThrowError(HttpsError);
    expect(() => validateSosInput(validInput({ driverPhone: "123" }))).toThrowError(HttpsError);
    expect(() => validateSosInput(validInput({ approxLat: 91 }))).toThrowError(HttpsError);
    expect(() => validateSosInput(validInput({ exactLng: 181 }))).toThrowError(HttpsError);
    expect(() => validateSosInput(null)).toThrowError(HttpsError);
  });
  it("strips non-digits from the phone before validating", () => {
    expect(validateSosInput(validInput({ driverPhone: "+91 98765 43210" })).driverPhone).toBe("919876543210");
  });
});

describe("createSosRequestForUser", () => {
  it("creates request + details + marker + quota count in one go", async () => {
    const u = uid();
    const input = validInput();
    const res = await createSosRequestForUser(u, input);
    expect(res).toEqual({ requestId: input.requestId, deduped: false });
    const req = await db.doc(`sos_requests/${input.requestId}`).get();
    expect(req.exists).toBe(true);
    expect(req.get("status")).toBe("pending");
    expect(req.get("driverId")).toBe(u);
    // Public doc must never carry phone/exact coords (audit 2026-10-24).
    expect(req.get("driverPhone")).toBeUndefined();
    expect(req.get("exactLat")).toBeUndefined();
    const det = await db.doc(`sos_request_details/${input.requestId}`).get();
    expect(det.get("driverPhone")).toBe("9876543210");
    expect(det.get("exactLat")).toBe(18.5204);
    const marker = await db.doc(`sos_active/${u}`).get();
    expect(marker.get("requestId")).toBe(input.requestId);
    const quota = await db.doc(`sos_quota/${u}`).get();
    expect(quota.get("day")).toBe(istDayIso(new Date()));
    expect(quota.get("count")).toBe(1);
  });

  it("denies a second SOS while one is active (any active status)", async () => {
    const u = uid();
    await createSosRequestForUser(u, validInput());
    await expectHttps(createSosRequestForUser(u, validInput()), "failed-precondition", "sos-active-exists");
    // 'accepted' is still active: a driver cannot start a second request
    // while a mechanic is on the job.
    const u2 = uid();
    const first = await createSosRequestForUser(u2, validInput());
    await db.doc(`sos_requests/${first.requestId}`).update({ status: "accepted", mechanicId: "mech1" });
    await expectHttps(createSosRequestForUser(u2, validInput()), "failed-precondition", "sos-active-exists");
  });

  it("idempotent retry: same requestId returns the existing request and does NOT double-count the quota", async () => {
    const u = uid();
    const input = validInput();
    await createSosRequestForUser(u, input);
    const again = await createSosRequestForUser(u, input);
    expect(again).toEqual({ requestId: input.requestId, deduped: true });
    const quota = await db.doc(`sos_quota/${u}`).get();
    expect(quota.get("count")).toBe(1);
    const all = await db.collection("sos_requests").where("driverId", "==", u).get();
    expect(all.size).toBe(1);
  });

  it("after closure (marker cleared), the driver can create the next SOS", async () => {
    const u = uid();
    const first = await createSosRequestForUser(u, validInput());
    await db.doc(`sos_requests/${first.requestId}`).update({ status: "cancelled" });
    await clearActiveMarker(u, first.requestId);
    const second = await createSosRequestForUser(u, validInput());
    expect(second.deduped).toBe(false);
    const marker = await db.doc(`sos_active/${u}`).get();
    expect(marker.get("requestId")).toBe(second.requestId);
  });

  it("self-heals a stale marker (request already closed, cleanup trigger still lagging)", async () => {
    const u = uid();
    const first = await createSosRequestForUser(u, validInput());
    await db.doc(`sos_requests/${first.requestId}`).update({ status: "completed" });
    // Marker deliberately NOT cleared: the create must heal it.
    const second = await createSosRequestForUser(u, validInput());
    expect(second.deduped).toBe(false);
    const marker = await db.doc(`sos_active/${u}`).get();
    expect(marker.get("requestId")).toBe(second.requestId);
  });

  it(`denies the ${MAX_SOS_PER_DAY + 1}th SOS of the IST day`, async () => {
    const u = uid();
    await db.doc(`sos_quota/${u}`).set({ day: istDayIso(new Date()), count: MAX_SOS_PER_DAY });
    await expectHttps(createSosRequestForUser(u, validInput()), "resource-exhausted", "sos-daily-limit");
    // Denied attempts must not consume quota.
    const quota = await db.doc(`sos_quota/${u}`).get();
    expect(quota.get("count")).toBe(MAX_SOS_PER_DAY);
  });

  it("a full counter from a PREVIOUS IST day does not block today", async () => {
    const u = uid();
    await db.doc(`sos_quota/${u}`).set({ day: "2000-01-01", count: MAX_SOS_PER_DAY });
    const res = await createSosRequestForUser(u, validInput());
    expect(res.deduped).toBe(false);
    const quota = await db.doc(`sos_quota/${u}`).get();
    expect(quota.get("day")).toBe(istDayIso(new Date()));
    expect(quota.get("count")).toBe(1);
  });

  it("blocked accounts cannot create an SOS", async () => {
    const u = uid();
    await db.doc(`users/${u}`).set({ user_id: u, is_blocked: true });
    await expectHttps(createSosRequestForUser(u, validInput()), "permission-denied");
  });

  it("two simultaneous creates: exactly one wins, one active request exists, quota counts 1", async () => {
    const u = uid();
    const a = validInput();
    const b = validInput();
    const results = await Promise.allSettled([
      createSosRequestForUser(u, a),
      createSosRequestForUser(u, b),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const denied = results.filter(
      (r) => r.status === "rejected" && (r.reason as HttpsError).code === "failed-precondition",
    );
    expect(ok.length).toBe(1);
    expect(denied.length).toBe(1);
    const all = await db.collection("sos_requests").where("driverId", "==", u).get();
    expect(all.size).toBe(1);
    const quota = await db.doc(`sos_quota/${u}`).get();
    expect(quota.get("count")).toBe(1);
  });

  it("a different driverId in the input never spoofs ownership", async () => {
    const u = uid();
    const input = validInput();
    await createSosRequestForUser(u, input);
    const req = await db.doc(`sos_requests/${input.requestId}`).get();
    expect(req.get("driverId")).toBe(u);
  });
});

describe("clearActiveMarker", () => {
  it("deletes the marker only when it points at the closing request", async () => {
    const u = uid();
    const first = await createSosRequestForUser(u, validInput());
    await clearActiveMarker(u, "some-other-request");
    expect((await db.doc(`sos_active/${u}`).get()).exists).toBe(true);
    await clearActiveMarker(u, first.requestId);
    expect((await db.doc(`sos_active/${u}`).get()).exists).toBe(false);
  });
});

describe("createSosRequest callable auth guard", () => {
  const run = (auth: unknown) =>
    (createSosRequest as unknown as { run: (r: unknown) => Promise<unknown> }).run({
      auth,
      data: validInput(),
    });
  it("unauthenticated: rejected", async () => {
    await expectHttps(run(null), "unauthenticated");
  });
  it("unverified email: rejected (matches requireVerifiedDriver)", async () => {
    await expectHttps(run({ uid: uid(), token: { email_verified: false } }), "permission-denied");
  });
});
