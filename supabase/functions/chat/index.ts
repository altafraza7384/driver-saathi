import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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
  {
    type: "function",
    function: {
      name: "get_car_documents",
      description: "Get user's car/vehicle documents with expiry dates. Use when user asks about document expiry, insurance expiry, PUC validity, RC, permit, fitness certificate, or any vehicle document status.",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "Optional document name to search for" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_car_document",
      description: "Add or save a car/vehicle document with its expiry date. Use when user mentions insurance, PUC, RC, permit, fitness certificate, or any vehicle document and its expiry.",
      parameters: {
        type: "object",
        properties: {
          document_name: { type: "string", description: "Document name like 'Insurance', 'PUC', 'RC', 'Permit', 'Fitness Certificate'" },
          expiry_date: { type: "string", description: "Expiry date in YYYY-MM-DD format" },
          notify_at: { type: "string", description: "Notification date-time in ISO format. Set to 7 days before expiry at 09:00 if not specified." },
        },
        required: ["document_name", "expiry_date"],
        additionalProperties: false,
      },
    },
  },
];

const systemPrompt = `You are a helpful AI driving assistant for Indian ride-hailing and gig drivers. You help them manage everything hands-free while driving.

CRITICAL - LANGUAGE & VOICE UNDERSTANDING:
- Users speak via voice in Hinglish, Hindi, Marathi, Telugu, Kannada, or English.
- Voice recognition may transliterate Hindi to English letters imperfectly. You MUST be smart about understanding these.
- ALWAYS reply in the SAME language/style the user used.

HINGLISH COMMAND PARSING - You MUST understand ALL of these patterns:
  Financial:
  - "100 rupay add karo khane ka kharcha" = expense ₹100, category Food
  - "100 rupees expense food" = same (normalized voice input)  
  - "sau rupaye petrol mein lagaye" = expense ₹100 on Fuel
  - "aaj 1500 kamaye Uber se" = income ₹1500 from Uber
  - "dedh hazaar earned from Ola" = income ₹1500 from Ola
  - "pachas rupaye chai pe kharch kiya" = expense ₹50 on Food
  - "do hazaar ki kamai hui aaj" = income ₹2000 today
  - "500 spent on fuel" / "500 lagaye petrol mein" = expense ₹500 Fuel
  - "toll 50 rupay" / "toll pe 50 lage" = expense ₹50 Tolls
  - "EMI bhar di 5000" = debt payment ₹5000
  
  Health:
  - "paani piya" / "pani pi liya" / "drank water" / "ek glass paani" = add 1 water
  - "do glass paani piya" = add 2 water  
  - "break le raha hoon" / "break liya" / "rest kar raha" = add 1 break
  - "7 ghante soya" / "7 hours sleep" = sleep 7 hrs
  - "2000 kadam chala" / "2000 steps" = steps 2000

  Notes & Reminders:
  - "Note likh: passenger ne phone chhoda" = save note
  - "yaad dilana kal insurance renew karna" = reminder tomorrow
  - "remind karo 15 march ko service" = reminder for March 15

  Vehicle:
  - "oil change karwaya 800 mein" = car check Oil Change ₹800
  - "gaadi dhulwai 200 rupaye" = car check Wash ₹200
  - "PUC karwa liya" = car check PUC

  Documents:
  - "mera insurance kab expire ho raha hai" = get_car_documents (search insurance)
  - "PUC ki date kya hai" = get_car_documents (search PUC)
  - "documents dikha do" = get_car_documents
  - "insurance 2025-06-15 tak valid hai" = add_car_document Insurance 2025-06-15
  - "PUC expiry 2025-03-20" = add_car_document PUC 2025-03-20

  Goals & Debts:
  - "saving mein 2000 daalo" = add savings ₹2000
  - "loan liya 50000 ka" = add debt ₹50000

NUMBER PARSING (voice may send words or digits):
- ek/1, do/2, teen/3, chaar/4, paanch/5, das/10, bees/20, pachas/50, sau/100
- hazaar/hazar = 1000, lakh/lac = 100000
- dedh sau = 150, dhai sau = 250, dedh hazaar = 1500, dhai hazaar = 2500
- "earned 1500" and "1500 earned" both mean income ₹1500

CRITICAL RULES:
1. ALWAYS use the appropriate tool to save data when user gives a command
2. After saving, CONFIRM BACK exactly what you saved in the user's language with emoji
3. Example confirmations:
   - User: "100 rupay add karo khane ka kharcha" → Save expense ₹100 Food → Reply: "✅ ₹100 khane ka kharcha add kar diya! 🍔"
   - User: "paani piya" → Add 1 water → Reply: "✅ 1 glass paani add kiya! 💧 Aaj total: X glasses"
   - User: "Uber se 1500 kamaye" → Save income ₹1500 Uber → Reply: "✅ ₹1500 Uber income add kar diya! 💰"
   - User: "mera insurance kab expire hoga" → get_car_documents → Reply with expiry details
4. If amount or category is unclear, ASK the user to clarify - don't guess wrong
5. Be CONCISE - drivers are driving! Short 1-2 line responses only
6. Use ₹ for currency always
7. If user says "drank water" / "paani piya" without number, assume 1 glass
8. If user says "break liya" without number, assume 1 break
9. For reminders, always set notify_at so user gets notified
10. When querying data, use the right get_ tool and summarize clearly
11. For document queries, show expiry dates with days remaining and color-coded urgency

Today's date is ${new Date().toISOString().split("T")[0]}.`;

// Input validation helpers
function validateString(val: unknown, maxLen = 500): string | null {
  if (val == null) return null;
  const s = String(val).trim();
  return s.length > 0 && s.length <= maxLen ? s : null;
}

function validateNumber(val: unknown, min = 0, max = 100000000): number | null {
  if (val == null) return null;
  const n = Number(val);
  return !isNaN(n) && n >= min && n <= max ? n : null;
}

function validateDate(val: unknown): string | null {
  if (val == null) return null;
  const s = String(val);
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : s;
}

function validateEnum(val: unknown, allowed: string[]): string | null {
  if (val == null) return null;
  const s = String(val);
  return allowed.includes(s) ? s : null;
}

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
        const type = validateEnum(args.type, ["income", "expense"]);
        const amount = validateNumber(args.amount, 0.01);
        const category = validateString(args.category, 50);
        if (!type || !amount || !category) return "❌ Invalid transaction data. Please provide valid type, amount, and category.";
        const { error } = await supabaseAdmin.from("transactions").insert({
          user_id: userId,
          type: type,
          amount: amount,
          category: category,
          platform: validateString(args.platform, 50),
          description: validateString(args.description, 500),
        });
        if (error) throw error;
        return `✅ ${type === "income" ? "Income" : "Expense"} of ₹${amount} (${category}) saved.`;
      }
      case "add_note": {
        const title = validateString(args.title, 200);
        const content = validateString(args.content, 5000);
        if (!title || !content) return "❌ Invalid note data. Please provide a title and content.";
        const { error } = await supabaseAdmin.from("notes").insert({
          user_id: userId,
          title,
          content,
        });
        if (error) throw error;
        return `✅ Note "${title}" saved.`;
      }
      case "add_reminder": {
        const title = validateString(args.title, 200);
        const reminderDate = validateDate(args.reminder_date);
        if (!title || !reminderDate) return "❌ Invalid reminder data. Please provide a title and date.";
        const notifyAt = validateDate(args.notify_at) || `${reminderDate}T09:00:00`;
        const { error } = await supabaseAdmin.from("reminders").insert({
          user_id: userId,
          title,
          description: validateString(args.description, 500),
          reminder_date: reminderDate,
          category: validateEnum(args.category, ["general", "vehicle", "finance", "health"]) || "general",
          notify_at: notifyAt,
        });
        if (error) throw error;
        return `✅ Reminder "${title}" set for ${reminderDate} with notification.`;
      }
      case "add_car_check": {
        const checkType = validateString(args.check_type, 100);
        if (!checkType) return "❌ Invalid car check data. Please provide a check type.";
        const { error } = await supabaseAdmin.from("car_checks").insert({
          user_id: userId,
          check_type: checkType,
          description: validateString(args.description, 500),
          cost: validateNumber(args.cost, 0, 10000000),
          odometer_reading: validateNumber(args.odometer_reading, 0, 10000000),
          next_due_date: validateDate(args.next_due_date),
          notify_at: validateDate(args.notify_at),
        });
        if (error) throw error;
        return `✅ Car check "${checkType}" logged.${args.next_due_date ? ` Next due: ${args.next_due_date}` : ""}`;
      }
      case "update_health_log": {
        // Check for existing today's log
        const { data: existing } = await supabaseAdmin
          .from("health_logs")
          .select("*")
          .eq("user_id", userId)
          .eq("log_date", today)
          .maybeSingle();

        const currentSleep = Number(existing?.sleep_hours ?? 0);
        const currentWater = Number(existing?.water_glasses ?? 0);
        const currentSteps = Number(existing?.steps ?? 0);
        const currentBreaks = Number(existing?.breaks_taken ?? 0);

        const payload: Record<string, unknown> = {
          user_id: userId,
          log_date: today,
          sleep_hours: args.sleep_hours != null ? Number(args.sleep_hours) : currentSleep,
          water_glasses: args.water_glasses != null ? Number(args.water_glasses)
            : args.add_water ? currentWater + Number(args.add_water) : currentWater,
          steps: args.steps != null ? Number(args.steps)
            : args.add_steps ? currentSteps + Number(args.add_steps) : currentSteps,
          breaks_taken: args.breaks_taken != null ? Number(args.breaks_taken)
            : args.add_breaks ? currentBreaks + Number(args.add_breaks) : currentBreaks,
          notes: (args.notes as string) || existing?.notes || null,
        };

        if (existing) {
          const { error } = await supabaseAdmin.from("health_logs").update(payload as Record<string, unknown>).eq("id", existing.id as string);
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
        const title = validateString(args.title, 200);
        const targetAmount = validateNumber(args.target_amount, 1);
        if (!title || !targetAmount) return "❌ Invalid goal data. Please provide a title and target amount.";
        const { error } = await supabaseAdmin.from("goals").insert({
          user_id: userId,
          title,
          target_amount: targetAmount,
          deadline: validateDate(args.deadline),
          notify_at: validateDate(args.notify_at),
        });
        if (error) throw error;
        return `✅ Goal "${title}" (₹${targetAmount}) created.`;
      }
      case "add_goal_savings": {
        const goalTitle = validateString(args.goal_title, 200);
        const amount = validateNumber(args.amount, 0.01);
        if (!goalTitle || !amount) return "❌ Invalid data. Please provide a goal name and amount.";
        const { data: goals } = await supabaseAdmin
          .from("goals")
          .select("*")
          .eq("user_id", userId)
          .eq("is_completed", false);

        const goalTitleLower = goalTitle.toLowerCase();
        const goal = (goals as Array<{ id: string; title: string; saved_amount: number; target_amount: number }>)?.find(g => g.title.toLowerCase().includes(goalTitleLower) || goalTitleLower.includes(g.title.toLowerCase()));
        if (!goal) return `❌ No active goal found matching "${goalTitle}". Create one first.`;

        const newSaved = Number(goal.saved_amount) + amount;
        const isCompleted = newSaved >= Number(goal.target_amount);
        const { error } = await supabaseAdmin.from("goals").update({
          saved_amount: newSaved,
          is_completed: isCompleted,
        }).eq("id", goal.id as string);
        if (error) throw error;
        return isCompleted 
          ? `🎉 Goal "${goal.title}" COMPLETED! Saved ₹${newSaved}/₹${goal.target_amount}`
          : `✅ ₹${amount} added to "${goal.title}". Progress: ₹${newSaved}/₹${goal.target_amount}`;
      }
      case "add_debt": {
        const name = validateString(args.name, 200);
        const principal = validateNumber(args.principal, 1);
        if (!name || !principal) return "❌ Invalid debt data. Please provide a name and principal amount.";
        const { error } = await supabaseAdmin.from("debts").insert({
          user_id: userId,
          name,
          principal,
          interest_rate: validateNumber(args.interest_rate, 0, 100) || 0,
          tenure_months: validateNumber(args.tenure_months, 1, 600) || 12,
          emi_amount: validateNumber(args.emi_amount, 0),
          notify_at: validateDate(args.notify_at),
        });
        if (error) throw error;
        return `✅ Debt "${name}" (₹${principal}) recorded.`;
      }
      case "add_debt_payment": {
        const debtNameStr = validateString(args.debt_name, 200);
        const amount = validateNumber(args.amount, 0.01);
        if (!debtNameStr || !amount) return "❌ Invalid payment data. Please provide a debt name and amount.";
        const { data: debts } = await supabaseAdmin
          .from("debts")
          .select("*")
          .eq("user_id", userId)
          .eq("is_active", true);

        const debtNameLower = debtNameStr.toLowerCase();
        const debt = (debts as Array<{ id: string; name: string; total_paid: number; principal: number }>)?.find(d => d.name.toLowerCase().includes(debtNameLower) || debtNameLower.includes(d.name.toLowerCase()));
        if (!debt) return `❌ No active debt found matching "${debtNameStr}".`;

        const { error: payErr } = await supabaseAdmin.from("debt_payments").insert({
          user_id: userId,
          debt_id: debt.id,
          amount,
          note: validateString(args.note, 500),
        });
        if (payErr) throw payErr;

        const newPaid = Number(debt.total_paid) + amount;
        const isFullyPaid = newPaid >= Number(debt.principal);
        await supabaseAdmin.from("debts").update({
          total_paid: newPaid,
          is_active: !isFullyPaid,
        }).eq("id", debt.id as string);

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
       if (args.search) {
          const escaped = String(args.search).slice(0, 100).replace(/[%_\\]/g, '\\$&');
          query = query.or(`title.ilike.%${escaped}%,content.ilike.%${escaped}%`);
        }
        const { data: notes } = await query.order("created_at", { ascending: false }).limit(10);
        if (!notes?.length) return `📝 No notes found.`;
        return `📝 Your Notes (${notes.length}):\n` + (notes as Array<{ title: string; content: string }>).map((n, i) => `${i + 1}. **${n.title}** — ${(n.content || "").slice(0, 60)}`).join("\n");
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
      case "get_car_documents": {
        let query = supabaseAdmin.from("car_documents").select("*").eq("user_id", userId);
        if (args.search) {
          const escaped = String(args.search).slice(0, 100).replace(/[%_\\]/g, '\\$&');
          query = query.ilike("document_name", `%${escaped}%`);
        }
        const { data: docs } = await query.order("expiry_date", { ascending: true });
        if (!docs?.length) return `📄 No car documents found.${args.search ? ` Try without search filter.` : " Add documents from Car Checks > Documents tab."}`;
        const now = new Date();
        return `📄 Car Documents (${docs.length}):\n` + docs.map((d: any, i: number) => {
          const expiry = new Date(d.expiry_date);
          const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          const status = daysLeft < 0 ? "❌ EXPIRED" : daysLeft === 0 ? "⚠️ Expires TODAY" : daysLeft <= 7 ? `⚠️ ${daysLeft} days left` : daysLeft <= 30 ? `🟡 ${daysLeft} days left` : `✅ ${daysLeft} days left`;
          return `${i + 1}. **${d.document_name}** — Expiry: ${d.expiry_date} | ${status}`;
        }).join("\n");
      }
      case "add_car_document": {
        const docName = validateString(args.document_name, 200);
        const expiryDate = validateDate(args.expiry_date);
        if (!docName || !expiryDate) return "❌ Invalid data. Please provide document name and expiry date.";
        // Set notification to 7 days before expiry at 09:00 if not specified
        let notifyAt = validateDate(args.notify_at);
        if (!notifyAt) {
          const expDate = new Date(expiryDate);
          expDate.setDate(expDate.getDate() - 7);
          notifyAt = `${expDate.toISOString().split("T")[0]}T09:00:00`;
        }
        const { error } = await supabaseAdmin.from("car_documents").insert({
          user_id: userId,
          document_name: docName,
          expiry_date: expiryDate,
          notify_at: notifyAt,
        });
        if (error) throw error;
        return `✅ Document "${docName}" saved with expiry ${expiryDate}. You'll be notified before it expires.`;
      }
      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (err) {
    console.error(`Tool ${toolName} error:`, err);
    return `❌ Failed to save. Please try again.`;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages } = await req.json();
    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not configured");
    const AI_URL = "https://openrouter.ai/api/v1/chat/completions";
    const AI_MODEL = "google/gemini-2.5-flash";
    const aiHeaders = {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://driver-saathi.lovable.app",
      "X-Title": "Driver Saathi",
    };

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabaseAdmin: SupabaseClient<any> = createClient(supabaseUrl, supabaseServiceKey);

    if (!token || token === Deno.env.get("SUPABASE_ANON_KEY")) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const userId = user.id;

    // First call: with tools enabled (non-streaming to handle tool calls)
    const firstResponse = await fetch(AI_URL, {
      method: "POST",
      headers: aiHeaders,
      body: JSON.stringify({
        model: AI_MODEL,
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

      const secondResponse = await fetch(AI_URL, {
        method: "POST",
        headers: aiHeaders,
        body: JSON.stringify({
          model: AI_MODEL,
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
    return new Response(JSON.stringify({ error: "An internal error occurred. Please try again." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});