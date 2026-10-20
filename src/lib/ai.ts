import { httpsCallable } from "firebase/functions";
import { firebaseFunctions } from "@/integrations/firebase/client";

export type AiMessage = { role: "user" | "assistant"; content: string };

/**
 * Firebase counterparts of the Supabase Edge Functions used by the AI pages.
 * The staged Cloud Functions (firebase/functions/src/ai.ts) expose:
 *   chat({ messages })      -> { content, actions }
 *   financeAi({ messages }) -> { content }
 * They are non-streaming callables, unlike the Supabase functions which
 * stream OpenAI-style chunks — so on the Firebase backend the assistant
 * renders the full reply at once. Functions deployment requires the Blaze
 * plan; until then these calls fail and the pages show their error toast.
 */
export async function callChatFunction(
  messages: AiMessage[],
): Promise<{ content: string; actions: string[] }> {
  const fn = httpsCallable(firebaseFunctions, "chat");
  const res = await fn({ messages });
  const data = (res.data ?? {}) as { content?: string; actions?: string[] };
  return { content: data.content ?? "", actions: data.actions ?? [] };
}

export async function callFinanceAiFunction(
  messages: AiMessage[],
): Promise<{ content: string }> {
  const fn = httpsCallable(firebaseFunctions, "financeAi");
  const res = await fn({ messages });
  const data = (res.data ?? {}) as { content?: string };
  return { content: data.content ?? "" };
}
