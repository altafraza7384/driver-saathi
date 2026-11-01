import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory stand-in for the Firestore calls sendNotifications makes, so the
// real handler runs end to end: query bounds, due check, claim, FCM send.
type Doc = { path: string; data: Record<string, any> };
const store = new Map<string, Record<string, any>>();
const sent: any[] = [];

function snapOf(path: string) {
  const data = store.get(path);
  return { id: path.split("/").pop()!, exists: !!data, get: (k: string) => data?.[k], data: () => data,
    ref: refOf(path) };
}
function refOf(path: string): any {
  const parts = path.split("/");
  return {
    id: parts[parts.length - 1], path,
    parent: { parent: parts.length >= 4 ? { id: parts[parts.length - 3] } : null },
    get: async () => snapOf(path),
    create: async (d: any) => { if (store.has(path)) throw new Error("ALREADY_EXISTS"); store.set(path, d); },
    update: async (d: any) => { store.set(path, { ...store.get(path), ...d }); },
    delete: async () => { store.delete(path); },
  };
}
function query(match: (p: string) => boolean, filters: Array<[string, string, any]> = []): any {
  return {
    where: (f: string, op: string, v: any) => query(match, [...filters, [f, op, v]]),
    get: async () => {
      const docs = [...store.keys()].filter(match).filter((p) => filters.every(([f, op, v]) => {
        const x = store.get(p)![f];
        if (x === undefined) return false;
        return op === ">=" ? x >= v : op === "<=" ? x <= v : x === v;
      })).map(snapOf);
      return { docs, size: docs.length };
    },
  };
}
const fakeDb = {
  collectionGroup: (col: string) => query((p) => { const s = p.split("/"); return s.length === 4 && s[2] === col; }),
  collection: (path: string) => query((p) => p.startsWith(path + "/") && p.split("/").length === path.split("/").length + 1),
  doc: (path: string) => refOf(path),
};

vi.mock("../src/shared", () => ({ db: fakeDb, auth: {}, requireUser: vi.fn(), requireAdmin: vi.fn(), deleteUserData: vi.fn() }));
vi.mock("../src/ai", () => ({ chat: {}, financeAi: {} }));
vi.mock("../src/leads", () => ({ dedupeInsuranceLead: {} }));
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() } }));
vi.mock("firebase-admin/messaging", () => ({ getMessaging: () => ({
  sendEach: async (msgs: any[]) => { sent.push(...msgs); return { responses: msgs.map(() => ({ success: true })) }; },
}) }));

process.env.VAPID_PUBLIC_KEY = "x"; process.env.VAPID_PRIVATE_KEY = "y";

const UID = "u1";
beforeEach(() => {
  store.clear(); sent.length = 0;
  store.set(`users/${UID}`, { full_name: "Content raza" });
  store.set(`users/${UID}/push_subscriptions/p1`, { endpoint: "fcm://tok123", p256dh: "native", auth: "native" });
});

async function runAt(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(iso));
  const { sendNotifications } = await import("../src/index");
  await (sendNotifications as any).run({});
  vi.useRealTimers();
}

describe("sendNotifications (in-memory Firestore)", () => {
  it("sends a chat reminder (UTC ISO) for 04:28 IST on the 04:30 IST run, once", async () => {
    store.set(`users/${UID}/reminders/r1`, { title: "General", notify_at: "2026-11-01T22:58:00.000Z", is_completed: false });
    await runAt("2026-11-01T22:55:00.000Z"); // 04:25 IST: not yet
    expect(sent.length).toBe(0);
    await runAt("2026-11-01T23:00:00.000Z"); // 04:30 IST
    expect(sent.length).toBe(1);
    expect(sent[0].token).toBe("tok123");
    expect(sent[0].android.notification.channelId).toBe("reminders");
    await runAt("2026-11-01T23:05:00.000Z"); // next run: no double send
    expect(sent.length).toBe(1);
    const claim = [...store.entries()].find(([k]) => k.includes("sentNotifications"));
    expect(claim?.[1].sent_at).toBeTruthy();
  });
  it("sends a page reminder (naive IST) on time, not 5h30m late", async () => {
    store.set(`users/${UID}/reminders/r2`, { title: "Page", notify_at: "2026-11-02T04:28:00", is_completed: false });
    await runAt("2026-11-01T23:00:00.000Z"); // 04:30 IST
    expect(sent.length).toBe(1);
  });
  it("skips completed reminders and keeps retrying when the user has no device", async () => {
    store.set(`users/${UID}/reminders/r3`, { title: "Done", notify_at: "2026-11-01T22:58:00.000Z", is_completed: true });
    store.delete(`users/${UID}/push_subscriptions/p1`);
    store.set(`users/${UID}/reminders/r4`, { title: "NoDev", notify_at: "2026-11-01T22:58:00.000Z", is_completed: false });
    await runAt("2026-11-01T23:00:00.000Z");
    expect(sent.length).toBe(0);
    expect([...store.keys()].some((k) => k.includes("sentNotifications"))).toBe(false); // claim released → retried
  });
});
