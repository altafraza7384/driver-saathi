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
  claimSosCreateDoc,
  countSosCreateIfUnclaimed,
  validateSosInput,
  istDayIso,
  istDayEndMs,
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
    // Callable-created docs are born claimed, so the legacy counter
    // trigger / backfill can never double-count them.
    expect(req.get("counted")).toBe(true);
    const det = await db.doc(`sos_request_details/${input.requestId}`).get();
    expect(det.get("driverPhone")).toBe("9876543210");
    expect(det.get("exactLat")).toBe(18.5204);
    const marker = await db.doc(`sos_active/${u}`).get();
    expect(marker.get("requestId")).toBe(input.requestId);
    const quota = await db.doc(`sos_quota/${u}`).get();
    expect(quota.get("day")).toBe(istDayIso(new Date()));
    expect(quota.get("count")).toBe(1);
    expect(quota.get("dayEnd").toMillis()).toBe(istDayEndMs(new Date()));
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

describe("pre-rollout migration (no marker exists yet)", () => {
  const legacyPayload = (u: string, status: string) => ({
    id: rid(), driverId: u, category: "car", description: null,
    approxLat: 18.5, approxLng: 73.8, geohash: "tejvx", areaText: "Pune",
    status, mechanicId: null, mechanicName: null, mechanicPhone: null,
    chargesAgreed: null, rating: null,
    created_at: "2026-11-21T01:00:00.000Z", updated_at: "2026-11-21T01:00:00.000Z",
  });

  it("a driver with a pre-rollout ACTIVE request (no marker) cannot create another", async () => {
    const u = uid();
    await db.collection("sos_requests").add(legacyPayload(u, "pending"));
    await expectHttps(createSosRequestForUser(u, validInput()), "failed-precondition", "sos-active-exists");
    const u2 = uid();
    await db.collection("sos_requests").add(legacyPayload(u2, "onway"));
    await expectHttps(createSosRequestForUser(u2, validInput()), "failed-precondition", "sos-active-exists");
  });

  it("a driver whose pre-rollout request is CLOSED can create (and gets a marker)", async () => {
    const u = uid();
    await db.collection("sos_requests").add(legacyPayload(u, "completed"));
    await db.collection("sos_requests").add(legacyPayload(u, "cancelled"));
    const res = await createSosRequestForUser(u, validInput());
    expect(res.deduped).toBe(false);
    expect((await db.doc(`sos_active/${u}`).get()).exists).toBe(true);
  });

  it("pre-rollout same-day requests do NOT consume the daily quota (documented rollout boundary)", async () => {
    const u = uid();
    for (let i = 0; i < MAX_SOS_PER_DAY; i++) {
      await db.collection("sos_requests").add(legacyPayload(u, "cancelled"));
    }
    const res = await createSosRequestForUser(u, validInput());
    expect(res.deduped).toBe(false);
    expect((await db.doc(`sos_quota/${u}`).get()).get("count")).toBe(1);
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

describe("countSosCreateIfUnclaimed (legacy claim protocol)", () => {
  const legacyDoc = (u: string, overrides: Record<string, unknown> = {}) => ({
    id: rid(),
    driverId: u,
    category: "car",
    description: null,
    approxLat: 18.5,
    approxLng: 73.8,
    geohash: "tejvx",
    areaText: "Pune",
    status: "pending",
    mechanicId: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  });

  it("claims an unclaimed legacy doc: counter increments on the doc's own IST day, marker set when active", async () => {
    const u = uid();
    const doc = legacyDoc(u);
    await db.doc(`sos_requests/${doc.id}`).set(doc);
    expect(await countSosCreateIfUnclaimed(doc.id)).toBe(true);
    const quota = await db.doc(`sos_quota/${u}`).get();
    expect(quota.get("count")).toBe(1);
    expect(quota.get("day")).toBe(istDayIso(new Date()));
    expect(quota.get("dayEnd").toMillis()).toBe(istDayEndMs(new Date()));
    expect((await db.doc(`sos_requests/${doc.id}`).get()).get("counted")).toBe(true);
    expect((await db.doc(`sos_active/${u}`).get()).get("requestId")).toBe(doc.id);
  });

  it("is idempotent: a second claim (trigger retry / backfill re-run) does not count twice", async () => {
    const u = uid();
    const doc = legacyDoc(u);
    await db.doc(`sos_requests/${doc.id}`).set(doc);
    expect(await countSosCreateIfUnclaimed(doc.id)).toBe(true);
    expect(await countSosCreateIfUnclaimed(doc.id)).toBe(false);
    expect((await db.doc(`sos_quota/${u}`).get()).get("count")).toBe(1);
  });

  it("skips callable-created docs (born counted:true) — no double count with the callable path", async () => {
    const u = uid();
    const input = validInput();
    await createSosRequestForUser(u, input);
    expect(await countSosCreateIfUnclaimed(input.requestId)).toBe(false);
    expect((await db.doc(`sos_quota/${u}`).get()).get("count")).toBe(1);
  });

  it("counts a closed legacy doc but sets NO marker (closure stays closed)", async () => {
    const u = uid();
    const doc = legacyDoc(u, { status: "cancelled" });
    await db.doc(`sos_requests/${doc.id}`).set(doc);
    expect(await countSosCreateIfUnclaimed(doc.id)).toBe(true);
    expect((await db.doc(`sos_quota/${u}`).get()).get("count")).toBe(1);
    expect((await db.doc(`sos_active/${u}`).get()).exists).toBe(false);
  });

  it("never clobbers a marker pointing at a genuinely active request", async () => {
    const u = uid();
    const first = legacyDoc(u);
    const second = legacyDoc(u);
    await db.doc(`sos_requests/${first.id}`).set(first);
    await db.doc(`sos_requests/${second.id}`).set(second);
    await db.doc(`sos_active/${u}`).set({ requestId: first.id, created_at: first.created_at });
    expect(await countSosCreateIfUnclaimed(second.id)).toBe(true);
    expect((await db.doc(`sos_active/${u}`).get()).get("requestId")).toBe(first.id);
    expect((await db.doc(`sos_quota/${u}`).get()).get("count")).toBe(1);
  });

  it("ADVERSARIAL: a backdated client-written created_at cannot move the count to a past day (server createTime is used)", async () => {
    const u = uid();
    const doc = legacyDoc(u, { created_at: "2020-01-01T00:00:00.000Z" });
    await db.doc(`sos_requests/${doc.id}`).set(doc);
    expect(await countSosCreateIfUnclaimed(doc.id)).toBe(true);
    const quota = await db.doc(`sos_quota/${u}`).get();
    expect(quota.get("day")).toBe(istDayIso(new Date()));
    expect(quota.get("dayEnd").toMillis()).toBe(istDayEndMs(new Date()));
    expect(quota.get("count")).toBe(1);
  });

  it("returns false for a missing doc and for a doc without driverId", async () => {
    expect(await countSosCreateIfUnclaimed(rid())).toBe(false);
    const bad = rid();
    await db.doc(`sos_requests/${bad}`).set({ status: "pending" });
    expect(await countSosCreateIfUnclaimed(bad)).toBe(false);
    expect((await db.doc(`sos_requests/${bad}`).get()).get("counted")).toBeUndefined();
  });

  it("ADVERSARIAL: legacy creates fired within trigger lag ALL pass rules; the counter converges exactly, and the NEXT create after convergence is denied", async () => {
    // Documents the transition boundary honestly: the legacy path is
    // eventually enforced, not synchronously enforced. A burst of direct
    // creates before the trigger claims them exceeds 5; every doc is
    // still counted exactly once, and enforcement resumes once the
    // counter has converged.
    const u = uid();
    const ids = Array.from({ length: MAX_SOS_PER_DAY + 2 }, () => rid());
    for (const id of ids) await db.doc(`sos_requests/${id}`).set(legacyDoc(u));
    const claims = await Promise.all(ids.map((id) => countSosCreateIfUnclaimed(id)));
    expect(claims.filter(Boolean)).toHaveLength(ids.length);
    const quota = await db.doc(`sos_quota/${u}`).get();
    expect(quota.get("day")).toBe(istDayIso(new Date()));
    expect(quota.get("count")).toBe(MAX_SOS_PER_DAY + 2);
    // The post-convergence denial itself (rules reading count >= 5) is
    // covered in rules.test.ts ("denied when the counter already shows 5").
  });
});

describe("cross-day claim races (explicit test times)", () => {
  const NOW = new Date();
  const YESTERDAY = new Date(Date.now() - 36 * 3600_000);
  const legacyDoc = (u: string, overrides: Record<string, unknown> = {}) => ({
    id: rid(),
    driverId: u,
    category: "car",
    status: "pending",
    created_at: new Date().toISOString(),
    ...overrides,
  });

  it("a yesterday-claim AFTER today's counter exists does NOT reset or overwrite today's count", async () => {
    const u = uid();
    const todayDoc = legacyDoc(u);
    const oldDoc = legacyDoc(u);
    await db.doc(`sos_requests/${todayDoc.id}`).set(todayDoc);
    await db.doc(`sos_requests/${oldDoc.id}`).set(oldDoc);
    expect(await claimSosCreateDoc(todayDoc.id, u, "pending", NOW)).toBe(true);
    expect((await db.doc(`sos_quota/${u}`).get()).get("count")).toBe(1);
    // Trigger retry/delayed claim for a doc from YESTERDAY arriving now:
    expect(await claimSosCreateDoc(oldDoc.id, u, "pending", YESTERDAY)).toBe(true);
    const quota = await db.doc(`sos_quota/${u}`).get();
    expect(quota.get("day")).toBe(istDayIso(NOW));
    expect(quota.get("count")).toBe(1);
    // ...but the stale doc is still stamped, so it is never retried forever.
    expect((await db.doc(`sos_requests/${oldDoc.id}`).get()).get("counted")).toBe(true);
  });

  it("reversed order: yesterday-claim first, then today-claim advances the counter to today with its own count", async () => {
    const u = uid();
    const oldDoc = legacyDoc(u);
    const todayDoc = legacyDoc(u);
    await db.doc(`sos_requests/${oldDoc.id}`).set(oldDoc);
    await db.doc(`sos_requests/${todayDoc.id}`).set(todayDoc);
    expect(await claimSosCreateDoc(oldDoc.id, u, "pending", YESTERDAY)).toBe(true);
    let quota = await db.doc(`sos_quota/${u}`).get();
    expect(quota.get("day")).toBe(istDayIso(YESTERDAY));
    expect(quota.get("count")).toBe(1);
    expect(await claimSosCreateDoc(todayDoc.id, u, "pending", NOW)).toBe(true);
    quota = await db.doc(`sos_quota/${u}`).get();
    expect(quota.get("day")).toBe(istDayIso(NOW));
    expect(quota.get("count")).toBe(1);
  });

  it("concurrent mixed-day claims serialise: today's counter survives with exactly its own count", async () => {
    const u = uid();
    const oldDoc = legacyDoc(u);
    const todayA = legacyDoc(u);
    const todayB = legacyDoc(u);
    await db.doc(`sos_requests/${oldDoc.id}`).set(oldDoc);
    await db.doc(`sos_requests/${todayA.id}`).set(todayA);
    await db.doc(`sos_requests/${todayB.id}`).set(todayB);
    const results = await Promise.all([
      claimSosCreateDoc(oldDoc.id, u, "pending", YESTERDAY),
      claimSosCreateDoc(todayA.id, u, "pending", NOW),
      claimSosCreateDoc(todayB.id, u, "pending", NOW),
    ]);
    expect(results).toEqual([true, true, true]);
    const quota = await db.doc(`sos_quota/${u}`).get();
    expect(quota.get("day")).toBe(istDayIso(NOW));
    expect(quota.get("count")).toBe(2);
    for (const d of [oldDoc, todayA, todayB]) {
      expect((await db.doc(`sos_requests/${d.id}`).get()).get("counted")).toBe(true);
    }
  });
});
