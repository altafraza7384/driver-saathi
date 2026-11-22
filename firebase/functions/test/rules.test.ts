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

// Owner decision 2026-11-21: an email/password account with an unverified
// email cannot read or write its own data until verified. Google sign-in is
// verified by Google; phone sign-in (mechanics) has no email and stays
// exempt; admin paths are unaffected.
const PW_UNVERIFIED = { email_verified: false, firebase: { sign_in_provider: "password" } };
const PW_VERIFIED = { email_verified: true, firebase: { sign_in_provider: "password" } };
const GOOGLE = { email_verified: true, firebase: { sign_in_provider: "google.com" } };
const PHONE = { firebase: { sign_in_provider: "phone" } };

describe("email verification gate (owner decision 2026-11-21)", () => {
  it("unverified password user cannot READ their own profile doc", async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "users/alice"), { user_id: "alice", full_name: "A" }));
    await assertFails(getDoc(doc(env.authenticatedContext("alice", PW_UNVERIFIED).firestore(), "users/alice")));
  });
  it("unverified password user cannot WRITE their own profile doc", async () => {
    await assertFails(setDoc(doc(env.authenticatedContext("alice", PW_UNVERIFIED).firestore(), "users/alice"), { user_id: "alice", full_name: "A" }));
  });
  it("unverified password user cannot READ their own collection data", async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "users/alice/transactions/t1"), { user_id: "alice", amount: 100 }));
    await assertFails(getDoc(doc(env.authenticatedContext("alice", PW_UNVERIFIED).firestore(), "users/alice/transactions/t1")));
  });
  it("unverified password user cannot WRITE their own collection data", async () => {
    await assertFails(setDoc(doc(env.authenticatedContext("alice", PW_UNVERIFIED).firestore(), "users/alice/transactions/t1"), { user_id: "alice", amount: 100 }));
  });
  it("unverified password user cannot create their own insurance lead", async () => {
    await assertFails(setDoc(doc(env.authenticatedContext("alice", PW_UNVERIFIED).firestore(), "insurance_leads/l1"), { user_id: "alice", consent: true, status: "new", name: "D" }));
  });
  it("unverified password user cannot create an SOS request", async () => {
    await assertFails(setDoc(doc(env.authenticatedContext("alice", PW_UNVERIFIED).firestore(), "sos_requests/r1"), { driverId: "alice", status: "pending", category: "car" }));
  });
  it("unverified password user cannot create SOS details even for their own existing request (gate applies before ownership)", async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "sos_requests/r2"),
      { driverId: "alice", status: "pending", category: "car", approxLat: 18.5, approxLng: 73.8 }));
    await assertFails(setDoc(doc(env.authenticatedContext("alice", PW_UNVERIFIED).firestore(), "sos_request_details/r2"),
      { id: "r2", requestId: "r2", driverId: "alice", driverPhone: "9876543210" }));
  });
  it("unverified password user CAN cancel their own existing SOS (narrow closure: status to cancelled only)", async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "sos_requests/r3"),
      { driverId: "alice", status: "pending", category: "car", approxLat: 18.5, approxLng: 73.8 }));
    await assertSucceeds(updateDoc(doc(env.authenticatedContext("alice", PW_UNVERIFIED).firestore(), "sos_requests/r3"),
      { status: "cancelled", updated_at: "2026-11-22T00:00:00.000Z" }));
  });
  it("unverified password user CANNOT mark their own SOS completed (completion + rating need a verified email)", async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "sos_requests/r4"),
      { driverId: "alice", status: "accepted", category: "car", approxLat: 18.5, approxLng: 73.8 }));
    await assertFails(updateDoc(doc(env.authenticatedContext("alice", PW_UNVERIFIED).firestore(), "sos_requests/r4"),
      { status: "completed", updated_at: "2026-11-22T00:00:00.000Z" }));
  });
  it("unverified password user CANNOT change any other field while cancelling (narrow closure is not an open update)", async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "sos_requests/r5"),
      { driverId: "alice", status: "pending", category: "car", approxLat: 18.5, approxLng: 73.8 }));
    await assertFails(updateDoc(doc(env.authenticatedContext("alice", PW_UNVERIFIED).firestore(), "sos_requests/r5"),
      { status: "cancelled", rating: 1, updated_at: "2026-11-22T00:00:00.000Z" }));
  });
  it("unverified password user CANNOT cancel someone else's SOS", async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "sos_requests/r6"),
      { driverId: "bob", status: "pending", category: "car", approxLat: 18.5, approxLng: 73.8 }));
    await assertFails(updateDoc(doc(env.authenticatedContext("alice", PW_UNVERIFIED).firestore(), "sos_requests/r6"),
      { status: "cancelled", updated_at: "2026-11-22T00:00:00.000Z" }));
  });
  it("verified password user CAN read and write their own profile and data", async () => {
    const db = env.authenticatedContext("alice", PW_VERIFIED).firestore();
    await assertSucceeds(setDoc(doc(db, "users/alice"), { user_id: "alice", full_name: "A" }));
    await assertSucceeds(getDoc(doc(db, "users/alice")));
    await assertSucceeds(setDoc(doc(db, "users/alice/transactions/t1"), { user_id: "alice", amount: 100 }));
    await assertSucceeds(getDoc(doc(db, "users/alice/transactions/t1")));
  });
  it("Google sign-in user CAN read and write their own data (Google verifies the email)", async () => {
    const db = env.authenticatedContext("alice", GOOGLE).firestore();
    await assertSucceeds(setDoc(doc(db, "users/alice"), { user_id: "alice", full_name: "A" }));
    await assertSucceeds(setDoc(doc(db, "users/alice/transactions/t1"), { user_id: "alice", amount: 100 }));
  });
  it("phone sign-in user (mechanic flow) stays exempt: can create own mechanic profile", async () => {
    await assertSucceeds(setDoc(doc(env.authenticatedContext("mech1", PHONE).firestore(), "mechanics/mech1"), { name: "M", categories: ["car"] }));
  });
  it("verified user still CANNOT read another user's data (non-owner denied)", async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "users/alice/transactions/t1"), { user_id: "alice", amount: 100 }));
    await assertFails(getDoc(doc(env.authenticatedContext("bob", PW_VERIFIED).firestore(), "users/alice/transactions/t1")));
  });
  it("admin CAN still read an unverified user's profile (admin paths unaffected)", async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "users/alice"), { user_id: "alice", full_name: "A" }));
    await assertSucceeds(getDoc(doc(env.authenticatedContext("adm", { admin: true }).firestore(), "users/alice")));
  });
  it("unverified user cannot read their own insurance lead, admin can", async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "insurance_leads/l1"), { user_id: "alice", consent: true, status: "new", name: "D" }));
    await assertFails(getDoc(doc(env.authenticatedContext("alice", PW_UNVERIFIED).firestore(), "insurance_leads/l1")));
    await assertSucceeds(getDoc(doc(env.authenticatedContext("adm", { admin: true }).firestore(), "insurance_leads/l1")));
  });
});

describe("malformed-data hardening", () => {
  it("owner cannot create a profile with an object-valued full_name", async () => {
    await assertFails(setDoc(doc(env.authenticatedContext("alice").firestore(), "users/alice"), { full_name: { bad: true } }));
  });
  it("owner can create a normal profile", async () => {
    await assertSucceeds(setDoc(doc(env.authenticatedContext("alice").firestore(), "users/alice"), { full_name: "Test Driver", phone: "+919999999999" }));
  });
  it("owner cannot update full_name to an object", async () => {
    const db = env.authenticatedContext("alice").firestore();
    await assertSucceeds(setDoc(doc(db, "users/alice"), { full_name: "A" }));
    await assertFails(updateDoc(doc(db, "users/alice"), { full_name: { bad: true } }));
  });
  it("owner can still update a normal profile field", async () => {
    const db = env.authenticatedContext("alice").firestore();
    await assertSucceeds(setDoc(doc(db, "users/alice"), { full_name: "A" }));
    await assertSucceeds(updateDoc(doc(db, "users/alice"), { full_name: "B", vehicle_number: "MH12AB1234" }));
  });
  it("lead with an object-valued name is rejected", async () => {
    await assertFails(setDoc(doc(env.authenticatedContext("alice").firestore(), "insurance_leads/ml1"), { user_id: "alice", consent: true, status: "new", name: { bad: true } }));
  });
  it("normal lead is accepted", async () => {
    await assertSucceeds(setDoc(doc(env.authenticatedContext("alice").firestore(), "insurance_leads/ml1"), { user_id: "alice", consent: true, status: "new", name: "Driver", phone: "+919999999999" }));
  });
  it("admin cannot update a lead text field to an object", async () => {
    const adb = env.authenticatedContext("adm", { admin: true }).firestore();
    await assertSucceeds(setDoc(doc(env.authenticatedContext("alice").firestore(), "insurance_leads/l2"), { user_id: "alice", consent: true, status: "new", name: "Driver" }));
    await assertFails(updateDoc(doc(adb, "insurance_leads/l2"), { name: { bad: true } }));
  });
  it("admin can still update lead status and commission", async () => {
    const adb = env.authenticatedContext("adm", { admin: true }).firestore();
    await assertSucceeds(setDoc(doc(env.authenticatedContext("alice").firestore(), "insurance_leads/l3"), { user_id: "alice", consent: true, status: "new", name: "Driver" }));
    await assertSucceeds(updateDoc(doc(adb, "insurance_leads/l3"), { status: "contacted", commission_amount: 500, commission_note: "ok" }));
  });
});

// Car SOS request rules: no quotas (owner decision 2026-11-22 — no new
// limits on any SOS, existing behaviour preserved). Covers the preserved
// pre-existing behaviour plus the sos_request_details privacy hardening:
// a details doc (exact coords + driver phone) may be created only against
// an existing sos_requests doc owned by the caller. NOTE: every test uses
// FRESH doc ids — the emulator persists state across tests, and setDoc on
// an existing doc is an update (denied), not a create.
describe("Car SOS request rules (no quotas)", () => {
  let n = 0;
  const fresh = () => `rq${++n}`;
  const sosPayload = (id: string, over: Record<string, unknown> = {}) => ({
    id, driverId: "alice", category: "car", description: null,
    approxLat: 18.5, approxLng: 73.8, geohash: "tejvx", areaText: "Pune",
    status: "pending", mechanicId: null, mechanicName: null,
    mechanicPhone: null, chargesAgreed: null, rating: null, ...over,
  });
  it("signed-in driver CAN create an SOS request (behaviour unchanged)", async () => {
    const id = fresh();
    await assertSucceeds(setDoc(doc(env.authenticatedContext("alice").firestore(), `sos_requests/${id}`), sosPayload(id)));
  });
  it("direct create is denied with a spoofed driverId", async () => {
    const id = fresh();
    await assertFails(setDoc(doc(env.authenticatedContext("alice").firestore(), `sos_requests/${id}`), sosPayload(id, { driverId: "bob" })));
  });
  it("direct create is denied with a non-pending status", async () => {
    const id = fresh();
    await assertFails(setDoc(doc(env.authenticatedContext("alice").firestore(), `sos_requests/${id}`), sosPayload(id, { status: "accepted" })));
  });
  it("REGRESSION: a create carrying a phone number or exact coords is denied (2026-10-24 privacy hardening kept)", async () => {
    const id = fresh();
    await assertFails(setDoc(doc(env.authenticatedContext("alice").firestore(), `sos_requests/${id}a`), sosPayload(`${id}a`, { driverPhone: "9876543210" })));
    await assertFails(setDoc(doc(env.authenticatedContext("alice").firestore(), `sos_requests/${id}b`), sosPayload(`${id}b`, { phone: "9876543210" })));
    await assertFails(setDoc(doc(env.authenticatedContext("alice").firestore(), `sos_requests/${id}c`), sosPayload(`${id}c`, { exactLat: 18.5204, exactLng: 73.8567 })));
  });
  it("REGRESSION: a create with a bad category or invalid approx coords is denied", async () => {
    const id = fresh();
    await assertFails(setDoc(doc(env.authenticatedContext("alice").firestore(), `sos_requests/${id}a`), sosPayload(`${id}a`, { category: "boat" })));
    await assertFails(setDoc(doc(env.authenticatedContext("alice").firestore(), `sos_requests/${id}b`), sosPayload(`${id}b`, { approxLat: 999 })));
    await assertFails(setDoc(doc(env.authenticatedContext("alice").firestore(), `sos_requests/${id}c`), sosPayload(`${id}c`, { approxLng: "east" })));
  });
  it("details create is denied when the requestId field does not match the doc id", async () => {
    const id = fresh();
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), `sos_requests/${id}`), sosPayload(id)));
    await assertFails(setDoc(doc(env.authenticatedContext("alice").firestore(), `sos_request_details/${id}`),
      { id, requestId: "other", driverId: "alice", driverPhone: "9876543210" }));
  });
  it("details create is allowed for the driver's own existing request (normal Car SOS flow unchanged)", async () => {
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
      { status: "accepted", mechanicId: "mech1", mechanicName: "M", mechanicPhone: "9876543210" }));
  });
});
