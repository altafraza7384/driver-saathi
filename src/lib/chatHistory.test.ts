import { describe, it, expect, beforeEach } from "vitest";
import {
  CHAT_MAX_AGE_MS,
  CHAT_MAX_MESSAGES,
  loadChatHistory,
  parseChatHistory,
  pruneChatHistory,
  saveChatHistory,
  toApiMessages,
  type ChatMsg,
} from "./chatHistory";

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

describe("pruneChatHistory", () => {
  it("keeps messages younger than 24 hours", () => {
    const msgs: ChatMsg[] = [
      { role: "user", content: "a", ts: NOW - 23 * HOUR },
      { role: "assistant", content: "b", ts: NOW - 1000 },
    ];
    expect(pruneChatHistory(msgs, NOW)).toEqual(msgs);
  });

  it("deletes messages 24 hours old or older", () => {
    const msgs: ChatMsg[] = [
      { role: "user", content: "old", ts: NOW - CHAT_MAX_AGE_MS },
      { role: "user", content: "older", ts: NOW - 3 * CHAT_MAX_AGE_MS },
      { role: "assistant", content: "new", ts: NOW - HOUR },
    ];
    expect(pruneChatHistory(msgs, NOW).map((m) => m.content)).toEqual(["new"]);
  });

  it("deletes messages without a timestamp (one-time cleanup of old history)", () => {
    const msgs = [
      { role: "user", content: "legacy" },
      { role: "assistant", content: "legacy reply" },
      { role: "user", content: "fresh", ts: NOW },
    ] as ChatMsg[];
    expect(pruneChatHistory(msgs, NOW).map((m) => m.content)).toEqual(["fresh"]);
  });

  it("drops a non-numeric timestamp", () => {
    const msgs = [{ role: "user", content: "x", ts: "yesterday" }] as unknown as ChatMsg[];
    expect(pruneChatHistory(msgs, NOW)).toEqual([]);
  });

  it("keeps the newest 50 messages", () => {
    const msgs: ChatMsg[] = Array.from({ length: 70 }, (_, i) => ({ role: "user", content: String(i), ts: NOW - 70 + i }));
    const kept = pruneChatHistory(msgs, NOW);
    expect(kept).toHaveLength(CHAT_MAX_MESSAGES);
    expect(kept[0].content).toBe("20");
    expect(kept[49].content).toBe("69");
  });
});

describe("parseChatHistory", () => {
  it("handles empty, corrupt and non-array storage", () => {
    expect(parseChatHistory(null, NOW)).toEqual([]);
    expect(parseChatHistory("{not json", NOW)).toEqual([]);
    expect(parseChatHistory('{"a":1}', NOW)).toEqual([]);
  });

  it("drops malformed entries and old ones", () => {
    const raw = JSON.stringify([
      null,
      { role: "system", content: "x", ts: NOW },
      { role: "user", content: 5, ts: NOW },
      { role: "user", content: "old", ts: NOW - 25 * HOUR },
      { role: "user", content: "ok", ts: NOW - HOUR },
    ]);
    expect(parseChatHistory(raw, NOW)).toEqual([{ role: "user", content: "ok", ts: NOW - HOUR }]);
  });
});

describe("load/save with localStorage", () => {
  const key = "ds-assistant-chat:test-uid";
  beforeEach(() => localStorage.clear());

  it("load writes the pruned list back, and removes the key when nothing is left", () => {
    localStorage.setItem(key, JSON.stringify([
      { role: "user", content: "legacy" },
      { role: "user", content: "keep", ts: NOW - HOUR },
    ]));
    expect(loadChatHistory(key, NOW).map((m) => m.content)).toEqual(["keep"]);
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual([{ role: "user", content: "keep", ts: NOW - HOUR }]);

    localStorage.setItem(key, JSON.stringify([{ role: "user", content: "legacy" }]));
    expect(loadChatHistory(key, NOW)).toEqual([]);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("save prunes old messages and removes the key for an empty list", () => {
    saveChatHistory(key, [
      { role: "user", content: "old", ts: NOW - 30 * HOUR },
      { role: "assistant", content: "new", ts: NOW },
    ], NOW);
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual([{ role: "assistant", content: "new", ts: NOW }]);
    saveChatHistory(key, [], NOW);
    expect(localStorage.getItem(key)).toBeNull();
  });
});

describe("toApiMessages", () => {
  it("sends only role and content", () => {
    expect(toApiMessages([{ role: "user", content: "hi", ts: NOW }])).toEqual([{ role: "user", content: "hi" }]);
  });

  it("sends at most the newest 20 messages (the AI functions refuse more)", () => {
    const msgs: ChatMsg[] = Array.from({ length: 45 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: String(i), ts: NOW }));
    const api = toApiMessages(msgs);
    expect(api).toHaveLength(20);
    expect(api[0].content).toBe("25");
    expect(api[19].content).toBe("44");
  });

  it("keeps the total under 20000 characters and each message under 4000", () => {
    const big = "x".repeat(5000);
    const msgs: ChatMsg[] = Array.from({ length: 8 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: big + i, ts: NOW }));
    const api = toApiMessages(msgs);
    expect(api.every((m) => m.content.length <= 4000)).toBe(true);
    expect(api.reduce((s, m) => s + m.content.length, 0)).toBeLessThanOrEqual(20000);
    expect(api).toHaveLength(5);
  });
});
