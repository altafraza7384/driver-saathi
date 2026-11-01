// Chat history for the Assistant and Finance AI tabs lives in localStorage
// (the server stores no chat). Every message carries the time it was added
// (ts, ms since epoch); anything older than 24 hours is deleted silently on
// load and on save. Messages saved before timestamps existed have no age, so
// the first load after this change deletes them (one-time cleanup). The
// 50-message cap is unchanged.

export type ChatRole = "user" | "assistant";
export type ChatMsg = { role: ChatRole; content: string; ts?: number };

export const CHAT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const CHAT_MAX_MESSAGES = 50;

function isChatMsg(m: unknown): m is ChatMsg {
  if (!m || typeof m !== "object") return false;
  const r = m as { role?: unknown; content?: unknown };
  return (r.role === "user" || r.role === "assistant") && typeof r.content === "string";
}

/** Keep only well-formed messages younger than 24 h (by ts), newest 50. */
export function pruneChatHistory<T extends ChatMsg>(msgs: readonly T[], now: number = Date.now()): T[] {
  const fresh = msgs.filter(
    (m) => isChatMsg(m) && typeof m.ts === "number" && Number.isFinite(m.ts) && now - m.ts < CHAT_MAX_AGE_MS,
  );
  return fresh.slice(-CHAT_MAX_MESSAGES);
}

/** Parse what localStorage holds into a pruned message list. */
export function parseChatHistory(raw: string | null, now: number = Date.now()): ChatMsg[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return pruneChatHistory(parsed.filter(isChatMsg), now);
  } catch {
    return []; // corrupt stored history: start fresh
  }
}

/** Load + prune; the pruned list is written straight back so old messages leave storage now. */
export function loadChatHistory(key: string, now: number = Date.now()): ChatMsg[] {
  try {
    const raw = localStorage.getItem(key);
    const msgs = parseChatHistory(raw, now);
    if (raw !== null) {
      if (msgs.length === 0) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(msgs));
    }
    return msgs;
  } catch {
    return [];
  }
}

/** Prune + save (an empty list removes the key). */
export function saveChatHistory(key: string, msgs: readonly ChatMsg[], now: number = Date.now()): void {
  try {
    const kept = pruneChatHistory(msgs, now);
    if (kept.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(kept));
  } catch {
    // Private mode / full storage: chat just stays in-memory this session.
  }
}

// What the AI functions accept (firebase/functions/src/ai.ts `Msgs`, and the
// Supabase chat function): at most 20 messages, each at most 4000 chars, at
// most 20000 chars in total — anything more is refused as "Invalid messages".
export const AI_MAX_MESSAGES = 20;
export const AI_MAX_MESSAGE_CHARS = 4000;
export const AI_MAX_TOTAL_CHARS = 20000;

/**
 * The newest part of the chat that the AI functions accept, as {role,
 * content} only. The stored history keeps up to 50 messages, so sending all
 * of it made every request fail once a chat passed 20 messages (a Driving
 * Mode conversation gets there in ten exchanges).
 */
export function toApiMessages(msgs: readonly ChatMsg[]): { role: ChatRole; content: string }[] {
  const out: { role: ChatRole; content: string }[] = [];
  let total = 0;
  for (let i = msgs.length - 1; i >= 0 && out.length < AI_MAX_MESSAGES; i--) {
    const content = msgs[i].content.slice(0, AI_MAX_MESSAGE_CHARS);
    if (out.length > 0 && total + content.length > AI_MAX_TOTAL_CHARS) break;
    total += content.length;
    out.unshift({ role: msgs[i].role, content });
  }
  return out;
}
