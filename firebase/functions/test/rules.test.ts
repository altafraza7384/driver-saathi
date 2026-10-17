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
