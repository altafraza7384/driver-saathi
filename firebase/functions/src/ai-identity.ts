import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { z } from "zod";
import { db, requireUser, consumeQuota } from "./shared";

const GOOGLE_AI_API_KEY = defineSecret("GOOGLE_AI_API_KEY");
const GROQ_API_KEY = defineSecret("GROQ_API_KEY");
const Msgs = z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
  .min(1).max(20).refine((m) => m.reduce((s, x) => s + x.content.length, 0) <= 20000, "Conversation too long");

async function gemini(system: string, messages: z.infer<typeof Msgs>, key: string, tools?: unknown[]) {
  const delays = [3000, 10000];
  for (let attempt = 1; attempt <= 3; attempt++) {
    let r;
    try {
      r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "openai/gpt-oss-120b", max_tokens: 768,
                              messages: [{ role: "system", content: system }, ...messages], ...(tools ? { tools } : {}) }),
        signal: AbortSignal.timeout(25000),
      });
    } catch {
      if (attempt < 3) {
        console.log(`gemini retry ${attempt + 1} timeout`);
        await new Promise((resolve) => setTimeout(resolve, delays[attempt - 1]));
        continue;
      }
      throw new HttpsError("internal", "AI provider error");
    }
    if (r.ok) return r.json() as Promise<any>;
    if ((r.status === 429 || r.status === 503) && attempt < 3) {
      console.log(`gemini retry ${attempt + 1} status ${r.status}`);
      await new Promise((resolve) => setTimeout(resolve, delays[attempt - 1]));
      continue;
    }
    console.error("gemini upstream status", r.status);
    throw new HttpsError("internal", "AI provider error");
  }
  throw new HttpsError("internal", "AI provider error");
}

export const financeAi = onCall({ secrets: [GROQ_API_KEY], region: "asia-south1", timeoutSeconds: 300 }, async (req) => {
  const uid = requireUser(req);
  const parsed = Msgs.safeParse(req.data?.messages);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid messages");
  if (!(await consumeQuota(uid, "finance-ai", 20))) throw new HttpsError("resource-exhausted", "AI usage limit reached");

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const base = db.collection("users").doc(uid);
  const [tx, debts, goals] = await Promise.all([
    base.collection("transactions").where("transaction_date", ">=", monthStart).get(),
    base.collection("debts").where("is_active", "==", true).get(),
    base.collection("goals").get(),
  ]);
      console.log("financeAi data loaded", tx.size, debts.size, goals.size);
  const t = tx.docs.map((d) => d.data());
  const income = t.filter((x) => x.type === "income").reduce((s, x) => s + Number(x.amount), 0);
  const expense = t.filter((x) => x.type === "expense").reduce((s, x) => s + Number(x.amount), 0);
  const system = `You are a Personal Finance AI for Indian gig drivers. Use ₹, give specific advice from this data.
Income this month: ₹${income.toFixed(0)}; Expenses: ₹${expense.toFixed(0)}; Net: ₹${(income - expense).toFixed(0)}
Debts: ${debts.docs.map((d) => `${d.get("name")} ₹${Number(d.get("principal")) - Number(d.get("total_paid"))} @${d.get("interest_rate")}%`).join("; ") || "none"}
Goals: ${goals.docs.map((g) => `${g.get("title")} ₹${g.get("saved_amount")}/${g.get("target_amount")}`).join("; ") || "none"}
Recommend an emergency fund first; flag EMI > 40% of income.
Reply in plain text only: never use #, *, |, backticks, tables, or any markdown formatting, because the app shows your reply as plain text. Use ONLY the figures given above: never invent a monthly income, expense, or savings figure, and show every calculation from those figures.`;
      console.log("financeAi calling gemini");
  const json = await gemini(system, parsed.data, GROQ_API_KEY.value());
      console.log("financeAi gemini done");
  return { content: json.choices?.[0]?.message?.content ?? "" };
});

/**
 * Assistant chat. Core tools ported; remaining tools from supabase/functions/chat
 * (debts, health, car docs, goals updates, etc.) must be ported before cutover.
 */
const TOOLS = [
  { type: "function", function: { name: "add_transaction", description: "Record income or expense",
    parameters: { type: "object", required: ["type", "amount", "category"], properties: {
      type: { type: "string", enum: ["income", "expense"] }, amount: { type: "number" },
      category: { type: "string" }, description: { type: "string" } } } } },
  { type: "function", function: { name: "add_note", description: "Save a note",
    parameters: { type: "object", required: ["title", "content"], properties: { title: { type: "string" }, content: { type: "string" } } } } },
  { type: "function", function: { name: "add_reminder", description: "Create a reminder",
    parameters: { type: "object", required: ["title", "reminder_date"], properties: {
      title: { type: "string" }, reminder_date: { type: "string", description: "yyyy-MM-dd" }, category: { type: "string" } } } } },
];

export const chat = onCall({ secrets: [GROQ_API_KEY], region: "asia-south1" }, async (req) => {
  const uid = requireUser(req);
  const parsed = Msgs.safeParse(req.data?.messages);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid messages");
  if (!(await consumeQuota(uid, "chat", 30))) throw new HttpsError("resource-exhausted", "AI usage limit reached");

  const json = await gemini("You are Driver Saathi, a Hinglish assistant for Indian drivers. You are Driver Saathi's own assistant: if asked who made you or who your owner is, say you are Driver Saathi's assistant — never say you are OpenAI, ChatGPT, or any other company's product. Use tools to save data the user mentions. Reply in plain text only: never use #, *, |, backticks, tables, or any markdown formatting.",
    parsed.data, GROQ_API_KEY.value(), TOOLS);
  const msg = json.choices?.[0]?.message ?? {};
  const base = db.collection("users").doc(uid);
  const now = new Date().toISOString();
  const actions: string[] = [];
  for (const call of msg.tool_calls ?? []) {
    let a: any; try { a = JSON.parse(call.function.arguments); } catch { continue; }
    const today = now.slice(0, 10);
    if (call.function.name === "add_transaction" && Number(a.amount) > 0 && ["income", "expense"].includes(a.type)) {
      await base.collection("transactions").add({ user_id: uid, type: a.type, amount: Number(a.amount),
        category: String(a.category).slice(0, 100), description: a.description ?? null, transaction_date: today, created_at: now, updated_at: now });
      actions.push(`₹${a.amount} ${a.type} saved`);
    } else if (call.function.name === "add_note") {
      await base.collection("notes").add({ user_id: uid, title: String(a.title).slice(0, 200), content: String(a.content).slice(0, 5000),
        tags: [], is_voice_note: false, created_at: now, updated_at: now });
      actions.push("Note saved");
    } else if (call.function.name === "add_reminder" && /^\d{4}-\d{2}-\d{2}$/.test(a.reminder_date)) {
      await base.collection("reminders").add({ user_id: uid, title: String(a.title).slice(0, 200), reminder_date: a.reminder_date,
        category: a.category ?? "general", is_completed: false, created_at: now, updated_at: now });
      actions.push("Reminder saved");
    }
  }
  return { content: msg.content || actions.join("\n") || "Done!", actions };
});
