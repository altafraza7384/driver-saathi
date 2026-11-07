import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Send, Bot, User, Trash2, TrendingUp, Mic, Square, Car } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { BACKEND } from "@/lib/backend";
import { db } from "@/lib/backend";
import { getTrialState } from "@/lib/trial";
import { useSubscriptionNudges } from "@/lib/nudges";
import { callFinanceAiFunction } from "@/lib/ai";
import { stripMarkdown } from "@/lib/plainText";
import { loadChatHistory, saveChatHistory, toApiMessages, type ChatMsg } from "@/lib/chatHistory";
import { CHAT_SCREEN_CLASS, CHAT_SCREEN_STYLE } from "@/lib/chatScreen";
import { useDrivingMode } from "@/lib/useDrivingMode";
import { stopSpeaking } from "@/lib/speechTts";
import NativeAdSlot from "@/components/NativeAdSlot";

type Msg = ChatMsg;

const FINANCE_CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/finance-ai`;

const SUGGESTED_PROMPTS = [
  "📊 Show my financial summary",
  "💳 How are my loans progressing?",
  "🎯 What's my goal progress?",
  "💡 Give me investment tips",
  "📈 How can I save more money?",
  "⚠️ What are my biggest expenses?",
];

// embedded = shown inside the Assistant page's Finance AI tab, which already
// bounds the height; the standalone /finance-ai route bounds itself the same
// way (input row pinned above the bottom nav, only the list scrolls).
export default function FinanceAIPage({ embedded = false }: { embedded?: boolean }) {
  const { session } = useAuth();
  const { t, language } = useI18n();
  const navigate = useNavigate();
  const { data: trialProfile } = useQuery({
    queryKey: ["trial_profile_finance"],
    queryFn: async () => {
      const { data } = await db.from("users").select("*").eq("id", session!.user.id);
      const row = Array.isArray(data) ? data[0] : data;
      return row as { subscription_plan_id?: string | null; trial_ends_at?: unknown } | null;
    },
    enabled: !!session?.user?.id,
  });
  const trialState = getTrialState(trialProfile ?? null);
  const { enabled: nudgesEnabled } = useSubscriptionNudges();
  // Per-account chat key: history must never leak across accounts sharing
  // one browser. Null until the session loads; the load effect below fills
  // messages once the key is known.
  const chatKey = session?.user?.id ? `ds-finance-chat:${session.user.id}` : null;
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Same persistence as the Assistant tab: history survives tab switches and
  // app restarts. It loads per-account once the session is known, and the
  // old shared key is deleted so a previous account's chat can never
  // reappear on this browser.
  useEffect(() => {
    try {
      localStorage.removeItem("ds-finance-chat");
    } catch {
      // ignore
    }
    if (!chatKey) return;
    // Same 24-hour rule as the Assistant tab: older messages (and ones saved
    // before timestamps existed) are pruned silently; 50-message cap stays.
    setMessages(loadChatHistory(chatKey));
  }, [chatKey]);

  // Trash clears history via the empty-state branch below.
  useEffect(() => {
    if (!chatKey) return;
    saveChatHistory(chatKey, messages);
  }, [messages, chatKey]);

  const send = useCallback(async (text?: string) => {
    const msgText = text || input.trim();
    if (!msgText || isLoading) return;
    if (!session?.access_token) { toast.error(t("ai.signInFinance")); return; }
    const userMsg: Msg = { role: "user", content: msgText, ts: Date.now() };
    if (!text) setInput("");
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    let assistantSoFar = "";
    const allMessages = [...messages, userMsg];

    try {
      if (BACKEND === "firebase") {
        const result = await callFinanceAiFunction(toApiMessages(allMessages));
        const content = result.content || "Done!";
        assistantSoFar = content;
        setMessages((prev) => [...prev, { role: "assistant", content, ts: Date.now() }]);
        return;
      }

      const resp = await fetch(FINANCE_CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ messages: toApiMessages(allMessages) }),
      });

      if (!resp.ok) {
        if (resp.status === 429) { toast.error(t("ai.rateLimit")); return; }
        if (resp.status === 402) { toast.error(t("ai.usageLimit")); return; }
        throw new Error("Failed to get response");
      }

      const contentType = resp.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const json = await resp.json();
        const content = json.choices?.[0]?.message?.content || json.response || "Done!";
        assistantSoFar = content;
        setMessages((prev) => [...prev, { role: "assistant", content, ts: Date.now() }]);
        return;
      }

      if (!resp.body) throw new Error("No response body");
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              assistantSoFar += content;
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantSoFar } : m));
                }
                return [...prev, { role: "assistant", content: assistantSoFar, ts: Date.now() }];
              });
            }
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }
    } catch (e) {
      console.error(e);
      // Same quota distinction as AssistantPage: resource-exhausted means
      // the hourly AI limit, not a generic failure.
      const code = (e as { code?: string })?.code;
      toast.error(t(code === "resource-exhausted" ? "ai.quotaExceeded" : "ai.failedResponse"));
    } finally {
      setIsLoading(false);
      // Driving Mode: speak the reply, then listen again (no-op otherwise).
      await handleReply(assistantSoFar);
    }
  }, [input, isLoading, messages, session]);

  // Shared Driving Mode voice loop (same hook as the Assistant page).
  const {
    drivingMode,
    isListening,
    isSpeaking,
    lastHeard,
    toggleVoice,
    exitDriving,
    toggleDrivingMode,
    handleReply,
  } = useDrivingMode({
    send,
    setInput,
    isLoading,
    language,
    t,
  });

  return (
    <div
      className={embedded ? "flex h-full min-h-0 flex-col p-4 pt-2" : CHAT_SCREEN_CLASS}
      style={embedded ? undefined : CHAT_SCREEN_STYLE}
    >
      {trialState.kind === "expired" && nudgesEnabled && (
        <Card className="mb-4 border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
            <p className="font-semibold">{t("trial.upgradeCardTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("trial.upgradeCardBody")}</p>
          <Button className="mt-3" onClick={() => navigate("/plans")}>
            {t("trial.viewPlans")}
          </Button>
        </Card>
      )}
      <div className="flex shrink-0 items-center gap-3 mb-3">
        <div className="flex items-center gap-2 flex-1">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
            <TrendingUp className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold leading-tight">{t("financeAi.agent")}</h1>
            <p className="text-xs text-muted-foreground">{t("financeAi.tagline")}</p>
          </div>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="icon" onClick={() => setMessages([])}>
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant={drivingMode ? "default" : "outline"}
          size="sm"
          className="gap-1"
          onClick={toggleDrivingMode}
          title={t("assistant.drivingModeTip")}
      >
        <Car className="h-4 w-4" />
          <span className="hidden sm:inline">{t("assistant.drive")}</span>
        </Button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain space-y-3 pb-4">
        {messages.length === 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-col items-center justify-center py-3 text-center text-muted-foreground">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 mb-3">
                <TrendingUp className="h-6 w-6 text-primary" />
              </div>
              <p className="font-extrabold text-foreground text-sm">{t("financeAi.intro")}</p>
              <p className="text-xs mt-1 max-w-xs">{t("financeAi.askHint")}</p>
            </div>
            <div className="w-full max-w-sm mx-auto">
            <NativeAdSlot hidden={drivingMode} />
            </div>
          </div>
        )}
        <AnimatePresence>
          {messages.map((msg, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <TrendingUp className="h-4 w-4" />
                </div>
              )}
              <Card className={`max-w-[82%] ${msg.role === "user" ? "bg-primary text-primary-foreground" : ""}`}>
                <CardContent className="p-3 whitespace-pre-wrap text-sm">{msg.role === "assistant" ? stripMarkdown(msg.content) : msg.content}</CardContent>
              </Card>
              {msg.role === "user" && (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                  <User className="h-4 w-4" />
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        {isLoading && (
          <div className="flex gap-2 justify-start">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <TrendingUp className="h-4 w-4" />
            </div>
            <Card><CardContent className="p-3 flex gap-1">
              {[0, 1, 2].map((i) => (
                <motion.div key={i} className="h-2 w-2 rounded-full bg-primary"
                  animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.2 }} />
              ))}
            </CardContent></Card>
          </div>
        )}
      </div>

      

      {/* Input */}
      <div className="flex shrink-0 gap-2 pt-2 border-t">
        <button
          onClick={toggleVoice}
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors ${isListening ? "bg-destructive text-destructive-foreground" : "bg-muted text-muted-foreground"}`}
        >
          {isListening ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </button>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
          placeholder={t("financeAi.askPlaceholder")}
          className="flex-1 font-bold"
          disabled={isLoading}
        />
        <Button onClick={() => send()} size="icon" className="h-11 w-11 shrink-0">
          <Send className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}
