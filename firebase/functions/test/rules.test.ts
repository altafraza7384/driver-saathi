import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import { initializeTestEnvironment, assertFails, assertSucceeds, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-driver-saathi",
    firestore: { rules: readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8"), host: "127.0.0.1", port: 8085 } });
});
afterAll(() => env.cleanup());

describe("per-user isolation", () => {
  it("owner can write own transaction", async () => {
    await assertSucceeds(setDoc(doc(env.authenticatedContext("alice").firestore(), "users/alice/transactions/t1"), { user_id: "alice", amount: 100 }));
  });
  it("other user cannot read it", async () => {
    await assertFails(getDoc(doc(env.authenticatedContext("bob").firestore(), "users/alice/transactions/t1")));
  });
  it("cannot spoof user_id", async () => {
    await assertFails(setDoc(doc(env.authenticatedContext("alice").firestore(), "users/alice/notes/n1"), { user_id: "bob" }));
  });
  it("client cannot touch AI quota", async () => {
    await assertFails(setDoc(doc(env.authenticatedContext("alice").firestore(), "users/alice/aiUsage/x"), { request_count: 0 }));
  });
  it("chat messages are append-only", async () => {
    const db = env.authenticatedContext("alice").firestore();
    await assertSucceeds(setDoc(doc(db, "users/alice/chat_messages/m1"), { user_id: "alice", content: "hi" }));
    await assertFails(updateDoc(doc(db, "users/alice/chat_messages/m1"), { content: "x" }));
  });
});

describe("admin & plans", () => {
  it("user cannot self-grant roles", async () => {
    await assertFails(setDoc(doc(env.authenticatedContext("alice").firestore(), "roles/alice"), { roles: ["admin"] }));
  });
  it("non-admin cannot write plans", async () => {
    await assertFails(setDoc(doc(env.authenticatedContext("alice").firestore(), "subscription_plans/p"), { billing_interval: "free", price_inr: 0, is_active: true }));
  });
  it("admin cannot create free plan with price", async () => {
    await assertFails(setDoc(doc(env.authenticatedContext("adm", { admin: true }).firestore(), "subscription_plans/p"), { billing_interval: "free", price_inr: 99, is_active: true }));
  });
  it("admin can create valid plan", async () => {
    await assertSucceeds(setDoc(doc(env.authenticatedContext("adm", { admin: true }).firestore(), "subscription_plans/p"), { billing_interval: "free", price_inr: 0, is_active: true }));
  });
});

// Audit item 5 (owner decision 2026-11-21): new app versions create SOS
// through the createSosRequest callable; OLD app versions keep direct
// creates during the transition window, enforced against server quota
// state and bounded by the owner-chosen cutoff. sos_active/sos_quota
// stay server-only. NOTE: every test uses FRESH doc ids — the emulator
// persists state across tests, and setDoc on an existing doc is an
// update (denied), not a create.
describe("SOS quota rules (audit item 5) — legacy transition window", () => {
  let n = 0;
  const fresh = () => `rq${++n}`;
  const sosPayload = (id: string, over: Record<string, unknown> = {}) => ({
    id, driverId: "alice", category: "car", description: null,
    approxLat: 18.5, approxLng: 73.8, geohash: "tejvx", areaText: "Pune",
    status: "pending", mechanicId: null, mechanicName: null,
    mechanicPhone: null, chargesAgreed: null, rating: null, ...over,
  });
  it("old app versions CAN still create sos_requests directly inside the window (placeholder cutoff is far future)", async () => {
    await assertSucceeds(setDoc(doc(env.authenticatedContext("alice").firestore(), "sos_requests/r1"), sosPayload("r1")));
  });
  it("direct create is denied with a spoofed driverId", async () => {
    await assertFails(setDoc(doc(env.authenticatedContext("alice").firestore(), "sos_requests/r2"), sosPayload("r2", { driverId: "bob" })));
  });
  it("direct create is denied with a non-pending status", async () => {
    await assertFails(setDoc(doc(env.authenticatedContext("alice").firestore(), "sos_requests/r3"), sosPayload("r3", { status: "accepted" })));
  });
  it("direct create is denied while the driver's marker points at an ACTIVE request", async () => {
    const id = fresh();
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), `sos_requests/${id}a`), sosPayload(`${id}a`)));
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "sos_active/alice"), { requestId: `${id}a` }));
    await assertFails(setDoc(doc(env.authenticatedContext("alice").firestore(), `sos_requests/${id}b`), sosPayload(`${id}b`)));
  });
  it("direct create is ALLOWED when the marker points at a CLOSED request (stale-marker self-heal through the request status)", async () => {
    const id = fresh();
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), `sos_requests/${id}a`), sosPayload(`${id}a`, { status: "cancelled" })));
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "sos_active/alice"), { requestId: `${id}a` }));
    await assertSucceeds(setDoc(doc(env.authenticatedContext("alice").firestore(), `sos_requests/${id}b`), sosPayload(`${id}b`)));
  });
  it("direct create is denied when the counter already shows 5 on a day that has not ended", async () => {
    const id = fresh();
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "sos_quota/alice"),
      { day: "2026-11-21", count: 5, dayEnd: new Date(Date.now() + 86_400_000) }));
    await assertFails(setDoc(doc(env.authenticatedContext("alice").firestore(), `sos_requests/${id}`), sosPayload(id)));
  });
  it("direct create is ALLOWED when the full counter belongs to a day that has ended", async () => {
    const id = fresh();
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "sos_quota/alice"),
      { day: "2000-01-01", count: 5, dayEnd: new Date(Date.now() - 1_000) }));
    await assertSucceeds(setDoc(doc(env.authenticatedContext("alice").firestore(), `sos_requests/${id}`), sosPayload(id)));
  });
  it("ADVERSARIAL: a direct create carrying a forged counted:true accounting field is denied", async () => {
    const id = fresh();
    await assertFails(setDoc(doc(env.authenticatedContext("alice").firestore(), `sos_requests/${id}`), sosPayload(id, { counted: true })));
  });
  it("ADVERSARIAL: the driver update path cannot edit or remove the counted flag", async () => {
    const id = fresh();
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), `sos_requests/${id}`), { ...sosPayload(id), counted: true }));
    await assertFails(updateDoc(doc(env.authenticatedContext("alice").firestore(), `sos_requests/${id}`),
      { status: "cancelled", counted: false, updated_at: "2026-11-21T00:00:00.000Z" }));
    await assertFails(updateDoc(doc(env.authenticatedContext("alice").firestore(), `sos_requests/${id}`),
      { status: "cancelled", counted: null, updated_at: "2026-11-21T00:00:00.000Z" }));
    // And the allowed cancel leaves the flag untouched.
    await assertSucceeds(updateDoc(doc(env.authenticatedContext("alice").firestore(), `sos_requests/${id}`),
      { status: "cancelled", updated_at: "2026-11-21T00:00:00.000Z" }));
    await env.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore(), `sos_requests/${id}`));
      if (snap.data()?.counted !== true) throw new Error("counted flag was modified");
    });
  });
  it("old app versions CAN create sos_request_details for their own existing request", async () => {
    const id = fresh();
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), `sos_requests/${id}`), sosPayload(id)));
    await assertSucceeds(setDoc(doc(env.authenticatedContext("alice").firestore(), `sos_request_details/${id}`),
      { id, requestId: id, driverId: "alice", driverPhone: "9876543210" }));
  });
  it("details create is denied when the matching request is missing or someone else's", async () => {
    const id = fresh();
    await assertFails(setDoc(doc(env.authenticatedContext("alice").firestore(), `sos_request_details/${id}`),
      { id, requestId: id, driverId: "alice", driverPhone: "9876543210" }));
    const id2 = fresh();
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), `sos_requests/${id2}`), sosPayload(id2, { driverId: "bob" })));
    await assertFails(setDoc(doc(env.authenticatedContext("alice").firestore(), `sos_request_details/${id2}`),
      { id: id2, requestId: id2, driverId: "alice", driverPhone: "9876543210" }));
  });
  it("driver CAN still cancel their own request (closure path kept)", async () => {
    const id = fresh();
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), `sos_requests/${id}`), sosPayload(id)));
    await assertSucceeds(updateDoc(doc(env.authenticatedContext("alice").firestore(), `sos_requests/${id}`),
      { status: "cancelled", updated_at: "2026-11-21T00:00:00.000Z" }));
  });
  it("registered mechanic CAN still accept a pending request", async () => {
    const id = fresh();
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), `sos_requests/${id}`), sosPayload(id)));
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "mechanics/mech1"), { name: "M", categories: ["car"], phoneVerified: true }));
    await assertSucceeds(updateDoc(doc(env.authenticatedContext("mech1").firestore(), `sos_requests/${id}`),
      { status: "accepted", mechanicId: "mech1", mechanicName: "M", mechanicPhone: "9998887776" }));
  });
  it("sos_active and sos_quota are not client-readable or writable, even by their owner", async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "sos_active/alice"), { requestId: "r1" }));
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "sos_quota/alice"), { day: "2026-11-21", count: 1 }));
    const db = env.authenticatedContext("alice").firestore();
    await assertFails(getDoc(doc(db, "sos_active/alice")));
    await assertFails(setDoc(doc(db, "sos_active/alice"), { requestId: "r2" }));
    await assertFails(getDoc(doc(db, "sos_quota/alice")));
    await assertFails(setDoc(doc(db, "sos_quota/alice"), { day: "2026-11-21", count: 0 }));
  });
});

// Same rules with the cutoff set in the PAST: every direct client create
// must be denied — this is the state after the owner's chosen cutoff date
// (the placeholder in firestore.rules is far-future, so the past date is
// injected here by string replacement).
describe("SOS quota rules (audit item 5) — after the cutoff", () => {
  let pastEnv: RulesTestEnvironment;
  beforeAll(async () => {
    const rules = readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8")
      .replace("timestamp.date(2027, 6, 1)", "timestamp.date(2020, 1, 1)");
    pastEnv = await initializeTestEnvironment({ projectId: "demo-driver-saathi",
      firestore: { rules, host: "127.0.0.1", port: 8085 } });
  });
  afterAll(() => pastEnv.cleanup());
  const sosPayload = {
    id: "pc1", driverId: "alice", category: "car", description: null,
    approxLat: 18.5, approxLng: 73.8, geohash: "tejvx", areaText: "Pune",
    status: "pending", mechanicId: null, mechanicName: null,
    mechanicPhone: null, chargesAgreed: null, rating: null,
  };
  it("direct sos_requests create is denied after the cutoff", async () => {
    await assertFails(setDoc(doc(pastEnv.authenticatedContext("alice").firestore(), "sos_requests/pc1"), sosPayload));
  });
  it("direct sos_request_details create is denied after the cutoff", async () => {
    await pastEnv.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "sos_requests/pc2"), { ...sosPayload, id: "pc2" }));
    await assertFails(setDoc(doc(pastEnv.authenticatedContext("alice").firestore(), "sos_request_details/pc2"),
      { id: "pc2", requestId: "pc2", driverId: "alice", driverPhone: "9876543210" }));
  });
  it("driver CAN still cancel their own request after the cutoff (closure never blocked)", async () => {
    await pastEnv.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "sos_requests/pc3"), { ...sosPayload, id: "pc3" }));
    await assertSucceeds(updateDoc(doc(pastEnv.authenticatedContext("alice").firestore(), "sos_requests/pc3"),
      { status: "cancelled", updated_at: "2026-11-21T00:00:00.000Z" }));
  });
});
