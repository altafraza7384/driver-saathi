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
  it("unverified password user cannot cancel their own SOS via a direct write (verify-first; account deletion and Razorpay cancel run through callables)", async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "sos_requests/r3"),
      { driverId: "alice", status: "pending", category: "car", approxLat: 18.5, approxLng: 73.8 }));
    await assertFails(updateDoc(doc(env.authenticatedContext("alice", PW_UNVERIFIED).firestore(), "sos_requests/r3"),
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
