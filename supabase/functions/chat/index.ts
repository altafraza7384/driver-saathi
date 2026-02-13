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
          category: { type: "string", description: "Category like 'ride_fare', 'fuel', 'food', 'maintenance', 'toll', 'insurance', 'emi', 'other'" },
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
      description: "Create a reminder for the user. Use when user wants to be reminded of something.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Reminder title" },
          description: { type: "string", description: "Reminder details" },
          reminder_date: { type: "string", description: "Date in YYYY-MM-DD format" },
          category: { type: "string", description: "Category like 'general', 'vehicle', 'finance', 'health'" },
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
          check_type: { type: "string", description: "Type like 'oil_change', 'tyre_check', 'service', 'wash', 'battery', 'brake', 'other'" },
          description: { type: "string", description: "Details about the check" },
          cost: { type: "number", description: "Cost in INR if mentioned" },
          odometer_reading: { type: "number", description: "Odometer reading in km if mentioned" },
          next_due_date: { type: "string", description: "Next due date in YYYY-MM-DD format if mentioned" },
        },
        required: ["check_type"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_health_log",
      description: "Log health data for the user. Use when user mentions sleep, water intake, steps, or breaks.",
      parameters: {
        type: "object",
        properties: {
          sleep_hours: { type: "number", description: "Hours of sleep" },
          water_glasses: { type: "integer", description: "Number of water glasses" },
          steps: { type: "integer", description: "Step count" },
          breaks_taken: { type: "integer", description: "Number of breaks taken" },
          notes: { type: "string", description: "Any health notes" },
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
        },
        required: ["title", "target_amount"],
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
        },
        required: ["name", "principal"],
        additionalProperties: false,
      },
    },
  },
];

const systemPrompt = `You are a helpful AI assistant for Indian ride-hailing and gig drivers. You help them with:
- Tracking income and expenses
- Managing vehicle maintenance
- Health and wellness tips for long drives
- Financial advice and debt management
- Emergency situations
- General driving tips for Indian roads

IMPORTANT: When a user tells you about their earnings, expenses, notes, reminders, car maintenance, health data, savings goals, or debts, you MUST use the appropriate tool to save the data. After saving, confirm what was saved.

Always be friendly, concise, and practical. Use ₹ for currency. Support Hindi and English naturally.
Today's date is ${new Date().toISOString().split("T")[0]}.`;

async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  userId: string,
  supabaseAdmin: ReturnType<typeof createClient>
): Promise<string> {
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
        return `✅ ${args.type === "income" ? "Income" : "Expense"} of ₹${args.amount} (${args.category}) saved successfully.`;
      }
      case "add_note": {
        const { error } = await supabaseAdmin.from("notes").insert({
          user_id: userId,
          title: args.title,
          content: args.content,
        });
        if (error) throw error;
        return `✅ Note "${args.title}" saved successfully.`;
      }
      case "add_reminder": {
        const { error } = await supabaseAdmin.from("reminders").insert({
          user_id: userId,
          title: args.title,
          description: (args.description as string) || null,
          reminder_date: args.reminder_date,
          category: (args.category as string) || "general",
        });
        if (error) throw error;
        return `✅ Reminder "${args.title}" set for ${args.reminder_date}.`;
      }
      case "add_car_check": {
        const { error } = await supabaseAdmin.from("car_checks").insert({
          user_id: userId,
          check_type: args.check_type,
          description: (args.description as string) || null,
          cost: (args.cost as number) || null,
          odometer_reading: (args.odometer_reading as number) || null,
          next_due_date: (args.next_due_date as string) || null,
        });
        if (error) throw error;
        return `✅ Car check "${args.check_type}" logged successfully.`;
      }
      case "add_health_log": {
        const { error } = await supabaseAdmin.from("health_logs").insert({
          user_id: userId,
          sleep_hours: (args.sleep_hours as number) || null,
          water_glasses: (args.water_glasses as number) || null,
          steps: (args.steps as number) || null,
          breaks_taken: (args.breaks_taken as number) || null,
          notes: (args.notes as string) || null,
        });
        if (error) throw error;
        return `✅ Health log saved successfully.`;
      }
      case "add_goal": {
        const { error } = await supabaseAdmin.from("goals").insert({
          user_id: userId,
          title: args.title,
          target_amount: args.target_amount,
          deadline: (args.deadline as string) || null,
        });
        if (error) throw error;
        return `✅ Goal "${args.title}" (₹${args.target_amount}) created.`;
      }
      case "add_debt": {
        const { error } = await supabaseAdmin.from("debts").insert({
          user_id: userId,
          name: args.name,
          principal: args.principal,
          interest_rate: (args.interest_rate as number) || 0,
          tenure_months: (args.tenure_months as number) || 12,
          emi_amount: (args.emi_amount as number) || null,
        });
        if (error) throw error;
        return `✅ Debt "${args.name}" (₹${args.principal}) recorded.`;
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

    // Extract user ID from auth header
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from token
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

    // Check if the AI wants to call tools
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

      // Second call: stream the final response with tool results
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
        // Fallback: return tool results directly
        const summary = toolResults.map((r) => r.content).join("\n");
        return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: summary } }] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(secondResponse.body, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    // No tool calls: stream directly
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
      // Fallback to non-streamed result
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
