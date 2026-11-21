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

// Audit item 5 (owner decision 2026-11-21): SOS creation is callable-only
// so the 1-active + 5-per-IST-day quota cannot be bypassed by direct
// client writes. Quota state (sos_active/sos_quota) is server-only.
describe("SOS quota rules (audit item 5)", () => {
  const sosPayload = {
    id: "r1", driverId: "alice", category: "car", description: null,
    approxLat: 18.5, approxLng: 73.8, geohash: "tejvx", areaText: "Pune",
    status: "pending", mechanicId: null, mechanicName: null,
    mechanicPhone: null, chargesAgreed: null, rating: null,
  };
  it("driver CANNOT create sos_requests directly (must use createSosRequest callable)", async () => {
    await assertFails(setDoc(doc(env.authenticatedContext("alice").firestore(), "sos_requests/r1"), sosPayload));
  });
  it("driver CANNOT create sos_request_details directly", async () => {
    await assertFails(setDoc(doc(env.authenticatedContext("alice").firestore(), "sos_request_details/r1"),
      { id: "r1", requestId: "r1", driverId: "alice", driverPhone: "9876543210" }));
  });
  it("driver CAN still cancel their own request (closure path kept)", async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "sos_requests/r1"), sosPayload));
    await assertSucceeds(updateDoc(doc(env.authenticatedContext("alice").firestore(), "sos_requests/r1"),
      { status: "cancelled", updated_at: "2026-11-21T00:00:00.000Z" }));
  });
  it("registered mechanic CAN still accept a pending request", async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "sos_requests/r1"), sosPayload));
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "mechanics/mech1"), { name: "M", categories: ["car"], phoneVerified: true }));
    await assertSucceeds(updateDoc(doc(env.authenticatedContext("mech1").firestore(), "sos_requests/r1"),
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
