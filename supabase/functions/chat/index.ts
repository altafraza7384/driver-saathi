import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const tools = [
  {
    type: "function",
    function: {
      name: "add_transaction",
      description: "Add an income or expense transaction for the user. Use when the user mentions earning, spending, paying, or any financial activity.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["income", "expense"], description: "Whether it's income or expense" },
          amount: { type: "number", description: "The amount in INR" },
          category: { type: "string", description: "Category like 'Ride Earnings', 'Tips', 'Incentives', 'Bonus', 'Fuel', 'Maintenance', 'Food', 'Tolls', 'Insurance', 'EMI', 'Phone', 'Other'" },
          platform: { type: "string", description: "Platform like 'Ola', 'Uber', 'Rapido', or null if not applicable" },
          description: { type: "string", description: "Brief description of the transaction" },
        },
        required: ["type", "amount", "category"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_note",
      description: "Save a note for the user. Use when user wants to remember something or make a note.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short title for the note" },
          content: { type: "string", description: "The note content" },
        },
        required: ["title", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_reminder",
      description: "Create a reminder for the user. Use when user wants to be reminded of something. Support notification scheduling.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Reminder title" },
          description: { type: "string", description: "Reminder details" },
          reminder_date: { type: "string", description: "Date in YYYY-MM-DD format" },
          category: { type: "string", description: "Category like 'general', 'vehicle', 'finance', 'health'" },
          notify_at: { type: "string", description: "Notification date-time in ISO format (YYYY-MM-DDTHH:MM:SS). Set to the reminder_date at 09:00 if not specified by user." },
        },
        required: ["title", "reminder_date"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_car_check",
      description: "Log a car/vehicle maintenance check. Use when user mentions vehicle servicing, oil change, tyre check, etc.",
      parameters: {
        type: "object",
        properties: {
          check_type: { type: "string", description: "Type like 'Oil Change', 'Tyre Check', 'Service', 'Wash', 'Battery', 'Brake', 'PUC', 'Insurance', 'Other'" },
          description: { type: "string", description: "Details about the check" },
          cost: { type: "number", description: "Cost in INR if mentioned" },
          odometer_reading: { type: "number", description: "Odometer reading in km if mentioned" },
          next_due_date: { type: "string", description: "Next due date in YYYY-MM-DD format if mentioned" },
          notify_at: { type: "string", description: "Notification date-time in ISO format for the next due date reminder" },
        },
        required: ["check_type"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_health_log",
      description: "Log or update today's health data for the user. Use when user mentions sleep, water intake, steps, breaks, or any health metric. This will update today's existing log or create a new one.",
      parameters: {
        type: "object",
        properties: {
          sleep_hours: { type: "number", description: "Hours of sleep" },
          water_glasses: { type: "integer", description: "Number of water glasses to SET (not add)" },
          steps: { type: "integer", description: "Step count to SET" },
          breaks_taken: { type: "integer", description: "Number of breaks to SET (not add)" },
          notes: { type: "string", description: "Any health notes" },
          add_water: { type: "integer", description: "Number of water glasses to ADD to current count" },
          add_breaks: { type: "integer", description: "Number of breaks to ADD to current count" },
          add_steps: { type: "integer", description: "Number of steps to ADD to current count" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_goal",
      description: "Create a savings goal. Use when user mentions saving for something or setting a financial target.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Goal title" },
          target_amount: { type: "number", description: "Target amount in INR" },
          deadline: { type: "string", description: "Deadline in YYYY-MM-DD format if mentioned" },
          notify_at: { type: "string", description: "Notification date-time in ISO format for goal deadline reminder" },
        },
        required: ["title", "target_amount"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_goal_savings",
      description: "Add savings to an existing goal. Use when user says they saved money towards a goal.",
      parameters: {
        type: "object",
        properties: {
          goal_title: { type: "string", description: "The goal title to add savings to (fuzzy match)" },
          amount: { type: "number", description: "Amount to add to savings in INR" },
        },
        required: ["goal_title", "amount"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_debt",
      description: "Record a debt or loan. Use when user mentions EMI, loan, or borrowed money.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Debt/loan name" },
          principal: { type: "number", description: "Principal amount in INR" },
          interest_rate: { type: "number", description: "Annual interest rate percentage" },
          tenure_months: { type: "integer", description: "Loan tenure in months" },
          emi_amount: { type: "number", description: "Monthly EMI amount if known" },
          notify_at: { type: "string", description: "Notification date-time in ISO format for EMI due date reminder" },
        },
        required: ["name", "principal"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_debt_payment",
      description: "Record an EMI or debt payment. Use when user says they paid an EMI or made a loan payment.",
      parameters: {
        type: "object",
        properties: {
          debt_name: { type: "string", description: "Name of the debt/loan (fuzzy match)" },
          amount: { type: "number", description: "Payment amount in INR" },
          note: { type: "string", description: "Payment note" },
        },
        required: ["debt_name", "amount"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_transactions_summary",
      description: "Get user's transaction summary. Use when user asks about earnings, spending, income, expenses, or financial summary for today/week/month.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: ["today", "week", "month", "all"], description: "Time period" },
        },
        required: ["period"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_notes",
      description: "Get user's saved notes. Use when user asks to show, list, or read their notes.",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "Optional search term" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_reminders",
      description: "Get user's reminders. Use when user asks about upcoming reminders.",
      parameters: {
        type: "object",
        properties: {
          show_completed: { type: "boolean", description: "Include completed reminders" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_car_checks",
      description: "Get vehicle maintenance history. Use when user asks about car service history or upcoming maintenance.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "Number of recent checks (default 5)" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_goals",
      description: "Get savings goals and progress. Use when user asks about goals or savings.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_debts",
      description: "Get debts/loans and EMI status. Use when user asks about loans, debts, or EMI.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_health_today",
      description: "Get today's health stats. Use when user asks about today's water, steps, breaks, or sleep.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
];

const systemPrompt = `You are a helpful AI driving assistant for Indian ride-hailing and gig drivers. You help them manage everything hands-free while driving.

LANGUAGE SUPPORT:
- You MUST understand and respond in the SAME language the user speaks.
- You fluently understand Hinglish (Hindi + English mix), pure Hindi, Marathi, Telugu, Kannada, and English.
- Common Hinglish examples you MUST understand:
  - "Aaj maine 1500 kamaye Uber se" = earned ₹1500 from Uber today
  - "Petrol mein 500 lagaye" = spent ₹500 on fuel
  - "Paani piya" / "pani pi liya" = drank water
  - "Gaadi ka oil change karwaya 800 mein" = car oil change for ₹800
  - "Kal insurance renew karna hai" = remind about insurance renewal tomorrow
  - "Aaj kitna kamaya?" = how much did I earn today?
  - "EMI bhar di 5000 ki" = paid ₹5000 EMI
  - "Thak gaya, break le raha hoon" = taking a break
  - "Note likh: passenger ne phone chhoda gaadi mein" = note: passenger left phone in car
  - "Saving mein 2000 daalo tyre wale goal mein" = add ₹2000 to tyre savings goal
- Hindi numbers: ek=1, do=2, teen=3, chaar=4, paanch=5, das=10, pachas=50, sau=100, hazaar=1000, lakh=100000
- Reply in the same language/mix the user used. If they speak Hinglish, reply in Hinglish.

CAPABILITIES - You can:
- Track income & expenses (Ola, Uber, Rapido etc)
- Log vehicle maintenance & schedule next service
- Track health (sleep, water, breaks, steps) - UPDATE today's log, don't create duplicates
- Set reminders with notification dates
- Manage savings goals & add savings
- Track debts/loans & record EMI payments
- QUERY any saved data: earnings summary, notes, reminders, car checks, goals, debts, health stats
- Provide driving tips, financial advice, and emergency help

RULES:
1. When user tells you data, ALWAYS use the appropriate tool to save it
2. When user ASKS about data, use the appropriate get_ tool to fetch it and summarize
3. For health: use "add_water", "add_breaks", "add_steps" fields to INCREMENT values. Use direct fields to SET values.
4. For reminders/debts/goals/car checks: always set notify_at so user gets notified
5. After saving, confirm briefly what was saved with emoji
6. Be concise - drivers are driving! Short responses.
7. Use ₹ for currency.
8. If user says "drank water" / "paani piya" or "took a break" / "break liya" without a number, assume 1 glass or 1 break.
9. ALWAYS respond in the same language the user used. Match their tone and style.

Today's date is ${new Date().toISOString().split("T")[0]}.`;

async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  userId: string,
  supabaseAdmin: ReturnType<typeof createClient>
): Promise<string> {
  const today = new Date().toISOString().split("T")[0];
  
  try {
    switch (toolName) {
      case "add_transaction": {
        const { error } = await supabaseAdmin.from("transactions").insert({
          user_id: userId,
          type: args.type,
          amount: args.amount,
          category: args.category as string,
          platform: (args.platform as string) || null,
          description: (args.description as string) || null,
        });
        if (error) throw error;
        return `✅ ${args.type === "income" ? "Income" : "Expense"} of ₹${args.amount} (${args.category}) saved.`;
      }
      case "add_note": {
        const { error } = await supabaseAdmin.from("notes").insert({
          user_id: userId,
          title: args.title,
          content: args.content,
        });
        if (error) throw error;
        return `✅ Note "${args.title}" saved.`;
      }
      case "add_reminder": {
        const notifyAt = args.notify_at || (args.reminder_date ? `${args.reminder_date}T09:00:00` : null);
        const { error } = await supabaseAdmin.from("reminders").insert({
          user_id: userId,
          title: args.title,
          description: (args.description as string) || null,
          reminder_date: args.reminder_date,
          category: (args.category as string) || "general",
          notify_at: notifyAt,
        });
        if (error) throw error;
        return `✅ Reminder "${args.title}" set for ${args.reminder_date} with notification.`;
      }
      case "add_car_check": {
        const { error } = await supabaseAdmin.from("car_checks").insert({
          user_id: userId,
          check_type: args.check_type,
          description: (args.description as string) || null,
          cost: (args.cost as number) || null,
          odometer_reading: (args.odometer_reading as number) || null,
          next_due_date: (args.next_due_date as string) || null,
          notify_at: (args.notify_at as string) || null,
        });
        if (error) throw error;
        return `✅ Car check "${args.check_type}" logged.${args.next_due_date ? ` Next due: ${args.next_due_date}` : ""}`;
      }
      case "update_health_log": {
        // Check for existing today's log
        const { data: existing } = await supabaseAdmin
          .from("health_logs")
          .select("*")
          .eq("user_id", userId)
          .eq("log_date", today)
          .maybeSingle();

        const currentSleep = existing?.sleep_hours || 0;
        const currentWater = existing?.water_glasses || 0;
        const currentSteps = existing?.steps || 0;
        const currentBreaks = existing?.breaks_taken || 0;

        const payload = {
          user_id: userId,
          log_date: today,
          sleep_hours: args.sleep_hours != null ? args.sleep_hours as number : currentSleep,
          water_glasses: args.water_glasses != null ? args.water_glasses as number 
            : args.add_water ? currentWater + (args.add_water as number) : currentWater,
          steps: args.steps != null ? args.steps as number
            : args.add_steps ? currentSteps + (args.add_steps as number) : currentSteps,
          breaks_taken: args.breaks_taken != null ? args.breaks_taken as number
            : args.add_breaks ? currentBreaks + (args.add_breaks as number) : currentBreaks,
          notes: (args.notes as string) || existing?.notes || null,
        };

        if (existing) {
          const { error } = await supabaseAdmin.from("health_logs").update(payload).eq("id", existing.id);
          if (error) throw error;
        } else {
          const { error } = await supabaseAdmin.from("health_logs").insert(payload);
          if (error) throw error;
        }

        const parts = [];
        if (args.sleep_hours != null) parts.push(`Sleep: ${payload.sleep_hours}hrs`);
        if (args.water_glasses != null || args.add_water) parts.push(`Water: ${payload.water_glasses} glasses`);
        if (args.steps != null || args.add_steps) parts.push(`Steps: ${payload.steps}`);
        if (args.breaks_taken != null || args.add_breaks) parts.push(`Breaks: ${payload.breaks_taken}`);
        return `✅ Health updated — ${parts.join(", ") || "saved"}`;
      }
      case "add_goal": {
        const { error } = await supabaseAdmin.from("goals").insert({
          user_id: userId,
          title: args.title,
          target_amount: args.target_amount,
          deadline: (args.deadline as string) || null,
          notify_at: (args.notify_at as string) || null,
        });
        if (error) throw error;
        return `✅ Goal "${args.title}" (₹${args.target_amount}) created.`;
      }
      case "add_goal_savings": {
        // Fuzzy match goal by title
        const { data: goals } = await supabaseAdmin
          .from("goals")
          .select("*")
          .eq("user_id", userId)
          .eq("is_completed", false);

        const goalTitle = (args.goal_title as string).toLowerCase();
        const goal = goals?.find(g => g.title.toLowerCase().includes(goalTitle) || goalTitle.includes(g.title.toLowerCase()));
        if (!goal) return `❌ No active goal found matching "${args.goal_title}". Create one first.`;

        const newSaved = Number(goal.saved_amount) + (args.amount as number);
        const isCompleted = newSaved >= Number(goal.target_amount);
        const { error } = await supabaseAdmin.from("goals").update({
          saved_amount: newSaved,
          is_completed: isCompleted,
        }).eq("id", goal.id);
        if (error) throw error;
        return isCompleted 
          ? `🎉 Goal "${goal.title}" COMPLETED! Saved ₹${newSaved}/₹${goal.target_amount}`
          : `✅ ₹${args.amount} added to "${goal.title}". Progress: ₹${newSaved}/₹${goal.target_amount}`;
      }
      case "add_debt": {
        const { error } = await supabaseAdmin.from("debts").insert({
          user_id: userId,
          name: args.name,
          principal: args.principal,
          interest_rate: (args.interest_rate as number) || 0,
          tenure_months: (args.tenure_months as number) || 12,
          emi_amount: (args.emi_amount as number) || null,
          notify_at: (args.notify_at as string) || null,
        });
        if (error) throw error;
        return `✅ Debt "${args.name}" (₹${args.principal}) recorded.`;
      }
      case "add_debt_payment": {
        // Fuzzy match debt by name
        const { data: debts } = await supabaseAdmin
          .from("debts")
          .select("*")
          .eq("user_id", userId)
          .eq("is_active", true);

        const debtName = (args.debt_name as string).toLowerCase();
        const debt = debts?.find(d => d.name.toLowerCase().includes(debtName) || debtName.includes(d.name.toLowerCase()));
        if (!debt) return `❌ No active debt found matching "${args.debt_name}".`;

        const { error: payErr } = await supabaseAdmin.from("debt_payments").insert({
          user_id: userId,
          debt_id: debt.id,
          amount: args.amount,
          note: (args.note as string) || null,
        });
        if (payErr) throw payErr;

        const newPaid = Number(debt.total_paid) + (args.amount as number);
        const isFullyPaid = newPaid >= Number(debt.principal);
        await supabaseAdmin.from("debts").update({
          total_paid: newPaid,
          is_active: !isFullyPaid,
        }).eq("id", debt.id);

        return isFullyPaid
          ? `🎉 "${debt.name}" FULLY PAID! Total paid: ₹${newPaid}`
          : `✅ ₹${args.amount} EMI paid for "${debt.name}". Remaining: ₹${Number(debt.principal) - newPaid}`;
      }
      case "get_transactions_summary": {
        const period = args.period as string;
        let query = supabaseAdmin.from("transactions").select("*").eq("user_id", userId);
        if (period === "today") query = query.eq("transaction_date", today);
        else if (period === "week") {
          const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
          query = query.gte("transaction_date", weekAgo.toISOString().split("T")[0]);
        } else if (period === "month") {
          const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 30);
          query = query.gte("transaction_date", monthAgo.toISOString().split("T")[0]);
        }
        const { data: txns } = await query.order("transaction_date", { ascending: false }).limit(50);
        if (!txns?.length) return `📊 No transactions found for ${period}.`;
        const income = txns.filter(t => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
        const expense = txns.filter(t => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
        const platforms = [...new Set(txns.filter(t => t.platform).map(t => t.platform))];
        return `📊 ${period.toUpperCase()} Summary:\n💰 Income: ₹${income}\n💸 Expenses: ₹${expense}\n📈 Net: ₹${income - expense}\n📝 ${txns.length} transactions${platforms.length ? `\n🚗 Platforms: ${platforms.join(", ")}` : ""}`;
      }
      case "get_notes": {
        let query = supabaseAdmin.from("notes").select("*").eq("user_id", userId);
        if (args.search) query = query.ilike("title", `%${args.search}%`);
        const { data: notes } = await query.order("created_at", { ascending: false }).limit(10);
        if (!notes?.length) return `📝 No notes found.`;
        return `📝 Your Notes (${notes.length}):\n` + notes.map((n, i) => `${i + 1}. **${n.title}** — ${n.content?.slice(0, 60) || ""}`).join("\n");
      }
      case "get_reminders": {
        let query = supabaseAdmin.from("reminders").select("*").eq("user_id", userId);
        if (!args.show_completed) query = query.eq("is_completed", false);
        const { data: rems } = await query.order("reminder_date", { ascending: true }).limit(10);
        if (!rems?.length) return `🔔 No upcoming reminders.`;
        return `🔔 Reminders (${rems.length}):\n` + rems.map((r, i) => `${i + 1}. ${r.title} — ${r.reminder_date}${r.category !== "general" ? ` [${r.category}]` : ""}`).join("\n");
      }
      case "get_car_checks": {
        const limit = (args.limit as number) || 5;
        const { data: checks } = await supabaseAdmin.from("car_checks").select("*").eq("user_id", userId)
          .order("check_date", { ascending: false }).limit(limit);
        if (!checks?.length) return `🔧 No car checks logged.`;
        return `🔧 Car Checks (${checks.length}):\n` + checks.map((c, i) =>
          `${i + 1}. ${c.check_type} — ${c.check_date}${c.cost ? ` (₹${c.cost})` : ""}${c.next_due_date ? ` | Next: ${c.next_due_date}` : ""}`
        ).join("\n");
      }
      case "get_goals": {
        const { data: goals } = await supabaseAdmin.from("goals").select("*").eq("user_id", userId)
          .order("created_at", { ascending: false });
        if (!goals?.length) return `🎯 No goals set.`;
        return `🎯 Goals (${goals.length}):\n` + goals.map((g, i) => {
          const pct = Math.round((Number(g.saved_amount) / Number(g.target_amount)) * 100);
          return `${i + 1}. ${g.title} — ₹${g.saved_amount}/₹${g.target_amount} (${pct}%)${g.is_completed ? " ✅" : ""}${g.deadline ? ` | Due: ${g.deadline}` : ""}`;
        }).join("\n");
      }
      case "get_debts": {
        const { data: debts } = await supabaseAdmin.from("debts").select("*").eq("user_id", userId)
          .order("created_at", { ascending: false });
        if (!debts?.length) return `💳 No debts recorded.`;
        return `💳 Debts (${debts.length}):\n` + debts.map((d, i) => {
          const remaining = Number(d.principal) - Number(d.total_paid);
          return `${i + 1}. ${d.name} — ₹${d.principal}${d.emi_amount ? ` | EMI: ₹${d.emi_amount}` : ""} | Paid: ₹${d.total_paid} | Left: ₹${remaining}${d.is_active ? "" : " ✅ PAID"}`;
        }).join("\n");
      }
      case "get_health_today": {
        const { data: log } = await supabaseAdmin.from("health_logs").select("*")
          .eq("user_id", userId).eq("log_date", today).maybeSingle();
        if (!log) return `🏥 No health data logged today yet.`;
        return `🏥 Today's Health:\n😴 Sleep: ${log.sleep_hours || 0}hrs\n💧 Water: ${log.water_glasses || 0} glasses\n🚶 Steps: ${log.steps || 0}\n☕ Breaks: ${log.breaks_taken || 0}${log.notes ? `\n📝 ${log.notes}` : ""}`;
      }
      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (err) {
    console.error(`Tool ${toolName} error:`, err);
    return `❌ Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    let userId = "";
    if (token && token !== Deno.env.get("SUPABASE_ANON_KEY")) {
      const { data: { user } } = await supabaseAdmin.auth.getUser(token);
      if (user) userId = user.id;
    }

    // First call: with tools enabled (non-streaming to handle tool calls)
    const firstResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        tools,
        stream: false,
      }),
    });

    if (!firstResponse.ok) {
      if (firstResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (firstResponse.status === 402) {
        return new Response(JSON.stringify({ error: "Usage limit reached." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await firstResponse.text();
      console.error("AI gateway error:", firstResponse.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const firstResult = await firstResponse.json();
    const choice = firstResult.choices?.[0];

    if (choice?.message?.tool_calls && choice.message.tool_calls.length > 0 && userId) {
      const toolResults: { role: string; tool_call_id: string; content: string }[] = [];

      for (const toolCall of choice.message.tool_calls) {
        const args = typeof toolCall.function.arguments === "string"
          ? JSON.parse(toolCall.function.arguments)
          : toolCall.function.arguments;
        const result = await executeToolCall(toolCall.function.name, args, userId, supabaseAdmin);
        toolResults.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }

      const secondResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            ...messages,
            choice.message,
            ...toolResults,
          ],
          stream: true,
        }),
      });

      if (!secondResponse.ok) {
        const t = await secondResponse.text();
        console.error("AI second call error:", secondResponse.status, t);
        const summary = toolResults.map((r) => r.content).join("\n");
        return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: summary } }] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(secondResponse.body, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    const streamResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        stream: true,
      }),
    });

    if (!streamResponse.ok) {
      const t = await streamResponse.text();
      console.error("AI stream error:", streamResponse.status, t);
      const content = choice?.message?.content || "Sorry, I couldn't process that.";
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(streamResponse.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});