import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!GOOGLE_AI_API_KEY) throw new Error("GOOGLE_AI_API_KEY not configured");

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabaseUser = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser(token);
    if (authError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const userId = user.id;
    const body = await req.json();
    const messages = body?.messages;
    
    // Validate messages input
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 50) {
      return new Response(JSON.stringify({ error: "Invalid messages format" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    
    // Validate each message has required fields and reasonable length
    for (const msg of messages) {
      if (!msg || typeof msg.role !== "string" || typeof msg.content !== "string") {
        return new Response(JSON.stringify({ error: "Invalid message format" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (msg.content.length > 10000) {
        return new Response(JSON.stringify({ error: "Message too long" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Fetch all financial data for personalized advice
    const today = new Date().toISOString().split("T")[0];
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];

    const [txRes, debtRes, goalRes, healthRes] = await Promise.all([
      supabaseUser.from("transactions").select("*").eq("user_id", userId).gte("transaction_date", monthStart).order("transaction_date", { ascending: false }),
      supabaseUser.from("debts").select("*").eq("user_id", userId).eq("is_active", true),
      supabaseUser.from("goals").select("*").eq("user_id", userId),
      supabaseUser.from("health_logs").select("*").eq("user_id", userId).eq("log_date", today).maybeSingle(),
    ]);

    const transactions = txRes.data || [];
    const debts = debtRes.data || [];
    const goals = goalRes.data || [];

    // Calculate financial metrics
    const totalIncome = transactions.filter((t: any) => t.type === "income").reduce((s: number, t: any) => s + Number(t.amount), 0);
    const totalExpense = transactions.filter((t: any) => t.type === "expense").reduce((s: number, t: any) => s + Number(t.amount), 0);
    const netSavings = totalIncome - totalExpense;
    const totalDebt = debts.reduce((s: number, d: any) => s + Math.max(Number(d.principal) - Number(d.total_paid), 0), 0);
    const totalEMI = debts.reduce((s: number, d: any) => s + Number(d.emi_amount || 0), 0);
    const totalGoalTarget = goals.reduce((s: number, g: any) => s + Number(g.target_amount), 0);
    const totalGoalSaved = goals.reduce((s: number, g: any) => s + Number(g.saved_amount), 0);

    // Group expenses by category
    const expenseByCategory = transactions
      .filter((t: any) => t.type === "expense")
      .reduce((acc: Record<string, number>, t: any) => {
        acc[t.category] = (acc[t.category] || 0) + Number(t.amount);
        return acc;
      }, {});

    const systemPrompt = `You are an expert Personal Finance AI Agent for Indian gig/ride-hailing drivers. You are a trusted financial advisor who gives personalized, actionable advice.

USER'S CURRENT FINANCIAL DATA (This Month):
📊 Income: ₹${totalIncome.toFixed(0)}
💸 Expenses: ₹${totalExpense.toFixed(0)}
💰 Net Savings: ₹${netSavings.toFixed(0)}
📈 Savings Rate: ${totalIncome > 0 ? ((netSavings / totalIncome) * 100).toFixed(1) : 0}%

💳 ACTIVE DEBTS (${debts.length} loans):
${debts.map((d: any) => `  - ${d.name}: ₹${(Number(d.principal) - Number(d.total_paid)).toFixed(0)} remaining, EMI: ₹${d.emi_amount || "N/A"}, Rate: ${d.interest_rate}%`).join("\n") || "  No active debts"}
Total Outstanding: ₹${totalDebt.toFixed(0)}
Total Monthly EMI: ₹${totalEMI.toFixed(0)}

🎯 SAVINGS GOALS (${goals.length} goals):
${goals.map((g: any) => `  - ${g.title}: ₹${g.saved_amount}/₹${g.target_amount} (${Number(g.target_amount) > 0 ? ((Number(g.saved_amount)/Number(g.target_amount))*100).toFixed(0) : 0}%)${g.deadline ? `, deadline: ${g.deadline}` : ""}`).join("\n") || "  No goals set"}

📦 EXPENSE BREAKDOWN (Top categories):
${Object.entries(expenseByCategory).sort(([,a], [,b]) => (b as number) - (a as number)).slice(0, 5).map(([cat, amt]) => `  - ${cat}: ₹${(amt as number).toFixed(0)}`).join("\n") || "  No expenses this month"}

Today's date: ${today}

YOUR ROLE & BEHAVIOR:
1. Give PERSONALIZED advice based on the actual data above
2. Be like a trusted Indian financial advisor — practical, empathetic, culturally aware
3. Speak in a warm, encouraging tone. Mix Hindi/English naturally if user does
4. Use ₹ for currency. Reference their actual numbers in advice
5. Provide SPECIFIC, ACTIONABLE steps — not generic advice
6. Key areas: Debt management, Goal planning, Investment tips for gig workers, Tax tips, Emergency fund, Insurance
7. Flag RISKS: high EMI-to-income ratio (>40% is risky), no emergency fund, single income source
8. Celebrate wins! If they're doing well, acknowledge it
9. Keep responses concise but complete — use bullet points and emojis for readability
10. For investments, focus on: PPF, NPS, SIP in mutual funds, gold, FD — appropriate for gig workers
11. Always recommend an emergency fund of 3-6 months expenses first

IMPORTANT: Always refer to their ACTUAL data. Do NOT give generic advice when you have their specific numbers.`;

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GOOGLE_AI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (response.status === 402) return new Response(JSON.stringify({ error: "Payment required" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`AI gateway error: ${response.status}`);
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("finance-ai error:", e);
    return new Response(JSON.stringify({ error: "An internal error occurred. Please try again." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
