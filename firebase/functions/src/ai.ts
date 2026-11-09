import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { z } from "zod";
import { db, requireVerifiedDriver, consumeQuota, getAiLimits } from "./shared";
import { detectLang, languageHint, istNow, istContextLine, REMINDER_RULES, REMINDER_TOOL, resolveReminder, finalizeReply, type UserLang } from "./aiLogic";

const GROQ_API_KEY = defineSecret("GROQ_API_KEY");
const Msgs = z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
  .min(1).max(20).refine((m) => m.reduce((s, x) => s + x.content.length, 0) <= 20000, "Conversation too long");

async function groq(system: string, messages: z.infer<typeof Msgs>, key: string, tools?: unknown[], maxTokens = 768) {
  const delays = [3000, 10000];
  for (let attempt = 1; attempt <= 3; attempt++) {
    let r;
    try {
      r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "openai/gpt-oss-120b", max_tokens: maxTokens,
                              messages: [{ role: "system", content: system }, ...messages], ...(tools ? { tools } : {}) }),
        signal: AbortSignal.timeout(25000),
      });
    } catch {
      if (attempt < 3) {
        console.log(`groq retry ${attempt + 1} timeout`);
        await new Promise((resolve) => setTimeout(resolve, delays[attempt - 1]));
        continue;
      }
      throw new HttpsError("internal", "AI provider error");
    }
    if (r.ok) return r.json() as Promise<any>;
    if ((r.status === 429 || r.status === 503) && attempt < 3) {
      console.log(`groq retry ${attempt + 1} status ${r.status}`);
      await new Promise((resolve) => setTimeout(resolve, delays[attempt - 1]));
      continue;
    }
    console.error("groq upstream status", r.status);
    throw new HttpsError("internal", "AI provider error");
  }
  throw new HttpsError("internal", "AI provider error");
}

// Language hint (2026-11-01): each call carries an explicit first-line hint
// computed from the user's messages. detectLang / LANG_HINT now live in
// aiLogic.ts (v8: scored Roman-Hindi/Marathi/Bengali/Kannada detection with
// a sticky last language) so they are unit-tested.

// Saved-confirmation lines are built server-side (the model never sees a tool
// result), so they must be localized here, not left as English templates.
function savedTxText(type: string, amount: number, lang: UserLang): string {
  const r = "\u20B9" + amount;
  switch (lang) {
    case "hi-roman": return type === "income" ? `${r} kamai save ho gayi` : `${r} kharcha save ho gaya`;
    case "hi-dev": return type === "income" ? `${r} \u0915\u092e\u093e\u0908 \u0938\u0947\u0935 \u0939\u094b \u0917\u0908` : `${r} \u0916\u0930\u094d\u091a \u0938\u0947\u0935 \u0939\u094b \u0917\u092f\u093e`;
    case "mr": return type === "income" ? `${r} \u0915\u092e\u093e\u0908 \u091c\u0924\u0928 \u091d\u093e\u0932\u0940` : `${r} \u0916\u0930\u094d\u091a \u091c\u0924\u0928 \u091d\u093e\u0932\u093e`;
    case "mr-roman": return type === "income" ? `${r} kamai save zali` : `${r} kharcha save zala`;
    case "bn": return type === "income" ? `${r} \u0986\u09df \u09b8\u0982\u09b0\u0995\u09cd\u09b7\u09bf\u09a4 \u09b9\u09af\u09bc\u09c7\u099b\u09c7` : `${r} \u0996\u09b0\u099a \u09b8\u0982\u09b0\u0995\u09cd\u09b7\u09bf\u09a4 \u09b9\u09af\u09bc\u09c7\u099b\u09c7`;
    case "kn": return type === "income" ? `${r} \u0c86\u0ca6\u0cbe\u0caf \u0c89\u0cb3\u0cbf\u0cb8\u0cb2\u0cbe\u0c97\u0cbf\u0ca6\u0cc6` : `${r} \u0c96\u0cb0\u0ccd\u0c9a\u0cc1 \u0c89\u0cb3\u0cbf\u0cb8\u0cb2\u0cbe\u0c97\u0cbf\u0ca6\u0cc6`;
    case "bn-roman": return type === "income" ? `${r} aay save holo` : `${r} khoroch save holo`;
    case "kn-roman": return type === "income" ? `${r} aadaya ulisalaagide` : `${r} kharchu ulisalaagide`;
    default: return `${r} ${type} saved`;
  }
}

function savedOtherText(kind: "note" | "reminder", lang: UserLang): string {
  switch (lang) {
    case "hi-roman": return kind === "note" ? "Note save ho gaya" : "Reminder save ho gaya";
    case "hi-dev": return kind === "note" ? "\u0928\u094b\u091f \u0938\u0947\u0935 \u0939\u094b \u0917\u092f\u093e" : "\u0930\u093f\u092e\u093e\u0907\u0902\u0921\u0930 \u0938\u0947\u0935 \u0939\u094b \u0917\u092f\u093e";
    case "mr": return kind === "note" ? "\u0928\u094b\u0902\u0926 \u091c\u0924\u0928 \u091d\u093e\u0932\u0940" : "\u0938\u094d\u092e\u0930\u0923\u092a\u0924\u094d\u0930 \u091c\u0924\u0928 \u091d\u093e\u0932\u0947";
    case "mr-roman": return kind === "note" ? "Note save zali" : "Reminder save zala";
    case "bn": return kind === "note" ? "\u09a8\u09cb\u099f \u09b8\u0982\u09b0\u0995\u09cd\u09b7\u09bf\u09a4 \u09b9\u09af\u09bc\u09c7\u099b\u09c7" : "\u09b0\u09bf\u09ae\u09be\u0987\u09a8\u09cd\u09a1\u09be\u09b0 \u09b8\u0982\u09b0\u0995\u09cd\u09b7\u09bf\u09a4 \u09b9\u09af\u09bc\u09c7\u099b\u09c7";
    case "kn": return kind === "note" ? "\u0c9f\u0cbf\u0caa\u0ccd\u0caa\u0ca3\u0cbf \u0c89\u0cb3\u0cbf\u0cb8\u0cb2\u0cbe\u0c97\u0cbf\u0ca6\u0cc6" : "\u0c9c\u0ccd\u0c9e\u0cbe\u0caa\u0ca8\u0cc6 \u0c89\u0cb3\u0cbf\u0cb8\u0cb2\u0cbe\u0c97\u0cbf\u0ca6\u0cc6";
    case "bn-roman": return kind === "note" ? "Note save holo" : "Reminder save holo";
    case "kn-roman": return kind === "note" ? "Note ulisalaagide" : "Reminder ulisalaagide";
    default: return kind === "note" ? "Note saved" : "Reminder saved";
  }
}

function doneText(lang: UserLang): string {
  switch (lang) {
    case "hi-roman": return "Ho gaya!";
    case "hi-dev": return "\u0939\u094b \u0917\u092f\u093e!";
    case "mr": return "\u091d\u093e\u0932\u0947!";
    case "mr-roman": return "Zala!";
    case "bn": return "\u09b9\u09af\u09bc\u09c7 \u0997\u09c7\u099b\u09c7!";
    case "kn": return "\u0c86\u0caf\u0cbf\u0ca4\u0cc1!";
    case "bn-roman": return "Hoye geche!";
    case "kn-roman": return "Aaytu!";
    default: return "Done!";
  }
}

export const financeAi = onCall({ secrets: [GROQ_API_KEY], region: "asia-south1", timeoutSeconds: 300 }, async (req) => {
  const uid = requireVerifiedDriver(req);
  const parsed = Msgs.safeParse(req.data?.messages);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid messages");
  if (!(await consumeQuota(uid, "finance-ai", (await getAiLimits(uid)).financeAi))) throw new HttpsError("resource-exhausted", "AI usage limit reached");

  const now = new Date();
  const monthStart = istNow(now).date.slice(0, 7) + "-01";
  const base = db.collection("users").doc(uid);
  const [tx, debts, goals] = await Promise.all([
    base.collection("transactions").where("transaction_date", ">=", monthStart).get(),
    base.collection("debts").where("is_active", "==", true).get(),
    base.collection("goals").get(),
  ]);
  const t = tx.docs.map((d) => d.data());
  const income = t.filter((x) => x.type === "income").reduce((s, x) => s + Number(x.amount), 0);
  const expense = t.filter((x) => x.type === "expense").reduce((s, x) => s + Number(x.amount), 0);
  const system = `${languageHint(parsed.data)}You are Driver Saathi's own Personal Finance AI for Indian gig drivers. If asked who made you or who your owner is, say you are Driver Saathi's assistant — never say you are OpenAI, ChatGPT, or any other company's product. Use ₹, give specific advice from this data.
Income this month: ₹${income.toFixed(0)}; Expenses: ₹${expense.toFixed(0)}; Net: ₹${(income - expense).toFixed(0)}
Debts: ${debts.docs.map((d) => `${d.get("name")} ₹${Number(d.get("principal")) - Number(d.get("total_paid"))} @${d.get("interest_rate")}%`).join("; ") || "none"}
Goals: ${goals.docs.map((g) => `${g.get("title")} ₹${g.get("saved_amount")}/${g.get("target_amount")}`).join("; ") || "none"}
Recommend an emergency fund first; flag EMI > 40% of income.
Reply in plain text only, because the app shows your reply as plain text: never use markdown of any kind: no ** or * (no bold or italics), no _, no #, no |, no backticks, no tables, no bullet symbols. For a list, write each point on its own line starting with "1)", "2)" and so on, with no symbols around words. Match the reply length to the question: a short question gets a short answer (1-3 lines); give detail only when the user asks for a summary, a plan, or a breakdown. Never write a long reply to a short question. Use ONLY the figures given above: never invent a monthly income, expense, or savings figure, and show every calculation from those figures. Reply in the same language and script as the user's message: Marathi in Marathi, Hindi in Hindi, English in English, Bengali in Bengali, Kannada in Kannada. Never answer a Marathi user in Hindi or English.`;
  // v8: 2048 tokens (was 768): this is a reasoning model and its reasoning
  // counts against the limit, so long Marathi/Devanagari replies were cut
  // mid-word ("3. **Bajat"). The reply is also cleaned server-side: markdown
  // stripped (closed or not) and a cut-off tail trimmed to the last sentence.
  const json = await groq(system, parsed.data, GROQ_API_KEY.value(), undefined, 2048);
  const choice = json.choices?.[0];
  return { content: finalizeReply(choice?.message?.content ?? "", choice?.finish_reason === "length") };
});

/**
 * Assistant chat. Core tools ported; remaining tools from supabase/functions/chat
 * (debts, health, car docs, goals updates, etc.) must be ported before cutover.
 */
const TOOLS = [
  { type: "function", function: { name: "add_transaction", description: "Record income or expense. Only call after the user confirms the exact details. Set force only after the user confirms a flagged duplicate is a separate entry.",
    parameters: { type: "object", required: ["type", "amount", "category"], properties: {
      type: { type: "string", enum: ["income", "expense"] }, amount: { type: "number" },
      category: { type: "string" }, description: { type: "string" },
      force: { type: "boolean", description: "True only after the user confirms a flagged duplicate is a separate entry." } } } } },
  { type: "function", function: { name: "add_note", description: "Save a note. Only call after the user confirms the exact details. Set force only after the user confirms a flagged duplicate is a separate entry.",
    parameters: { type: "object", required: ["title", "content"], properties: { title: { type: "string" }, content: { type: "string" },
      force: { type: "boolean", description: "True only after the user confirms a flagged duplicate is a separate entry." } } } } },
  // v8: reminder_time (HH:mm IST) added; see aiLogic.ts REMINDER_TOOL.
  REMINDER_TOOL,
];

export const chat = onCall({ secrets: [GROQ_API_KEY], region: "asia-south1" }, async (req) => {
  const uid = requireVerifiedDriver(req);
  const parsed = Msgs.safeParse(req.data?.messages);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid messages");
  if (!(await consumeQuota(uid, "chat", (await getAiLimits(uid)).chat))) throw new HttpsError("resource-exhausted", "AI usage limit reached");
  const userLang = detectLang(parsed.data);

  const nowDate = new Date();
  const json = await groq(languageHint(parsed.data) + istContextLine(nowDate) + "You are Driver Saathi, a Hinglish assistant for Indian drivers. You are Driver Saathi's own assistant: if asked who made you or who your owner is, say you are Driver Saathi's assistant — never say you are OpenAI, ChatGPT, or any other company's product. Use tools to save data the user mentions, but NEVER save on the first mention: before calling any save tool, first reply with exactly what you understood — amount, income or expense, category, and date — and ask the user to confirm it. If the user did not name a category, propose the most sensible one yourself in that reply (for driving income, 'Ride Earnings') so that a plain confirmation covers every field — never present a confirmation with the category missing. Call a save tool ONLY in a later message after the user confirms (for example 'haan' or 'save karo'). A plain 'yes', 'haan', or 'save karo' confirms ONLY the proposal in your immediately preceding message: if that message was not asking for confirmation (for example it already said an entry was saved), there is nothing to confirm — do NOT call any save tool, ask the user what they want to record instead. If you flagged an entry as already saved and the user confirms it is a separate entry, call the save tool again with force set to true. If the user's message is garbled, repetitive, or unclear, do NOT guess what they meant — ask them instead of saving. Never save a transaction, note, or reminder from a message the user has not confirmed. " + REMINDER_RULES + "Reply in plain text only: never use #, *, |, backticks, tables, or any markdown formatting. Always put a normal space before the \u20B9 sign (write 'an \u20B9100 income', never 'an\u20B9100'). Reply in the same language and script as the user's message: Marathi in Marathi, Hindi in Hindi, English in English, Bengali in Bengali, Kannada in Kannada. Never answer a Marathi user in Hindi or English. " + languageHint(parsed.data),
    parsed.data, GROQ_API_KEY.value(), TOOLS);
  const msg = json.choices?.[0]?.message ?? {};
  const base = db.collection("users").doc(uid);
  const now = nowDate.toISOString();
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const actions: string[] = [];
  let duplicateNote: string | null = null;
  let unclearReminder = false;
  // Duplicate guard (2026-11-01): a bare "Yes" after a completed save used to
  // re-save an old proposal from history. An identical entry saved within the
  // last 10 minutes is therefore NOT written again — the user is asked first,
  // and only an explicit "separate entry" confirmation (force=true) saves it.
  // The query uses a single created_at range only, so no composite index is
  // needed; the exact-match filtering happens in code below.
  const recentCache = new Map<string, any[]>();
  async function recent(coll: string) {
    if (!recentCache.has(coll)) {
      const snap = await base.collection(coll).where("created_at", ">=", tenMinAgo).get();
      recentCache.set(coll, snap.docs.map((d) => d.data()));
    }
    return recentCache.get(coll)!;
  }
  for (const call of msg.tool_calls ?? []) {
    let a: any; try { a = JSON.parse(call.function.arguments); } catch { continue; }
    const today = istNow(nowDate).date;
    if (call.function.name === "add_transaction" && Number(a.amount) > 0 && ["income", "expense"].includes(a.type)) {
      const amt = Number(a.amount);
      const cat = String(a.category).slice(0, 100);
      if (!a.force) {
        const dup = (await recent("transactions")).some((x) => x.type === a.type && Number(x.amount) === amt && x.category === cat && x.transaction_date === today);
        if (dup) { duplicateNote = `₹${amt} ${a.type} (${cat}) on ${today}`; continue; }
      }
      await base.collection("transactions").add({ user_id: uid, type: a.type, amount: amt,
        category: cat, description: a.description ?? null, transaction_date: today, created_at: now, updated_at: now });
      actions.push(savedTxText(a.type, amt, userLang));
    } else if (call.function.name === "add_note") {
      const title = String(a.title).slice(0, 200);
      const content = String(a.content).slice(0, 5000);
      if (!a.force) {
        const dup = (await recent("notes")).some((x) => x.title === title && x.content === content);
        if (dup) { duplicateNote = `note "${title}"`; continue; }
      }
      await base.collection("notes").add({ user_id: uid, title, content,
        tags: [], is_voice_note: false, created_at: now, updated_at: now });
      actions.push(savedOtherText("note", userLang));
    } else if (call.function.name === "add_reminder") {
      // v8: the day and time the user said (IST), not a fixed 09:00. The
      // model passes reminder_date (yyyy-MM-dd) + reminder_time (HH:mm), and
      // relative words ("kal", "cal", "subah 7 baje", "saade 7") are also
      // resolved here defensively. notify_at is a UTC ISO instant, which is
      // what the scheduler (sendNotifications) compares against.
      const r = resolveReminder(a, nowDate);
      if (!r) { unclearReminder = true; continue; }
      const title = (String(a.title ?? "").trim() || "Reminder").slice(0, 200);
      if (!a.force) {
        const dup = (await recent("reminders")).some((x) => x.title === title && x.reminder_date === r.date && (!x.notify_at || x.notify_at === r.notifyAt));
        if (dup) { duplicateNote = `reminder "${title}" on ${r.date} at ${r.time}`; continue; }
      }
      await base.collection("reminders").add({ user_id: uid, title, reminder_date: r.date,
        notify_at: r.notifyAt,
        category: a.category ?? "general", is_completed: false, created_at: now, updated_at: now });
      actions.push(savedOtherText("reminder", userLang));
    }
  }
  if (unclearReminder && !actions.length && !duplicateNote) {
    // The model called add_reminder without a day or time we could read.
    // Never claim "Done": ask once, in the user's language, in plain words.
    const follow = await groq(languageHint(parsed.data) + istContextLine(nowDate) + "You are Driver Saathi's own assistant. Reply in plain text only: never use #, *, |, backticks, tables, or any markdown formatting. Reply in the same language and script as the user's messages.",
      [...parsed.data, { role: "user" as const, content: "System note: the reminder was NOT saved because its day or time could not be understood. In one short sentence ask the user which day and time they want, giving an example in their language like 'kal subah 7 baje'. Never ask for a format like yyyy-mm-dd." }],
      GROQ_API_KEY.value());
    return { content: finalizeReply(follow.choices?.[0]?.message?.content ?? "", false), actions };
  }
  if (duplicateNote) {
    // The single-turn tool flow never shows the model a tool result, so ask
    // again through a second model call — it phrases the question in the
    // user's own language instead of leaking a hardcoded message.
    const follow = await groq(languageHint(parsed.data) + "You are Driver Saathi's own assistant. Reply in plain text only: never use #, *, |, backticks, tables, or any markdown formatting. Reply in the same language and script as the user's messages.",
      [...parsed.data, { role: "user" as const, content: `System note: the user just confirmed, but this was already saved a few minutes ago: ${duplicateNote}. Ask the user whether this is a separate new entry or the same one. Do not save anything yet.` }],
      GROQ_API_KEY.value());
    return { content: finalizeReply(follow.choices?.[0]?.message?.content ?? "", false) || actions.join("\n") || doneText(userLang), actions };
  }
  return { content: finalizeReply(msg.content ?? "", json.choices?.[0]?.finish_reason === "length") || actions.join("\n") || doneText(userLang), actions };
});
