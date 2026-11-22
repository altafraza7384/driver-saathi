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

// sos_request_details privacy hardening: a details doc (exact coords +
// driver phone) may be created only against an existing sos_requests doc
// owned by the caller. NOTE: every test uses FRESH doc ids — the emulator
// persists state across tests, and setDoc on an existing doc is an
// update (denied), not a create.
describe("SOS request details hardening", () => {
  let n = 0;
  const fresh = () => `rq${++n}`;
  const sosPayload = (id: string, over: Record<string, unknown> = {}) => ({
    id, driverId: "alice", category: "car", description: null,
    approxLat: 18.5, approxLng: 73.8, geohash: "tejvx", areaText: "Pune",
    status: "pending", mechanicId: null, mechanicName: null,
    mechanicPhone: null, chargesAgreed: null, rating: null, ...over,
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
});
