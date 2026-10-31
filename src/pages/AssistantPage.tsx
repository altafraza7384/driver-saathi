import { useState, useRef, useEffect, useCallback, lazy, Suspense } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Send, Bot, User, Trash2, Mic, Square, Volume2, VolumeX, Headphones, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { BACKEND } from "@/lib/backend";
import { db } from "@/lib/backend";
import { getTrialState } from "@/lib/trial";
import { callChatFunction } from "@/lib/ai";

const FinanceAIPage = lazy(() => import("./FinanceAIPage"));

type Msg = { role: "user" | "assistant"; content: string };

// Same display-time markdown strip as FinanceAIPage: the model emits
// markdown, this page renders plain text. User messages pass untouched.
function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\|/g, " ")
    .replace(/^[ :-]+$/gm, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

// Speak text aloud using browser TTS
function speakText(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) { resolve(); return; }
    window.speechSynthesis.cancel();

    const cleanText = text
      .replace(/[\u{1F600}-\u{1F9FF}|\u{2600}-\u{26FF}|\u{2700}-\u{27BF}|\u{1F300}-\u{1F5FF}|\u{1F680}-\u{1F6FF}|\u{1F1E0}-\u{1F1FF}|\u{2702}-\u{27B0}|\u{FE0F}|\u{200D}]/gu, "")
      .replace(/[*#_~`]/g, "")
      .replace(/\n+/g, ". ")
      .trim();

    if (!cleanText) { resolve(); return; }

    const utterance = new SpeechSynthesisUtterance(cleanText);
    // Speak in the reply's own language, so a Marathi user hears Marathi,
    // not Hindi or English. Script detects Bengali/Kannada; Hindi and
    // Marathi share Devanagari, so Marathi marker words decide mr-IN.
    const bengaliChars = (cleanText.match(/[\u0980-\u09ff]/g) || []).length;
    const kannadaChars = (cleanText.match(/[\u0c80-\u0cff]/g) || []).length;
    const hindiChars = (cleanText.match(/[\u0900-\u097f]/g) || []).length;
    const marathiMarkers = ["आहे", "आहेत", "मी", "मला", "तुला", "त्याला", "होतं", "पाहिजे", "नाही", "करतो", "जातो", "येतो", "काय", "कुठे"];
    const isMarathi = marathiMarkers.some((w) => new RegExp(`(^|[^\\p{L}])${w}([^\\p{L}]|$)`, "u").test(cleanText));
    let lang = "en-IN";
    if (bengaliChars > cleanText.length * 0.2) lang = "bn-IN";
    else if (kannadaChars > cleanText.length * 0.2) lang = "kn-IN";
    else if (isMarathi) lang = "mr-IN";
    else if (hindiChars > cleanText.length * 0.2) lang = "hi-IN";
    utterance.lang = lang;
    utterance.rate = 1.05;
    utterance.pitch = 1;

    const voices = window.speechSynthesis.getVoices();
    const langPrefix = lang.split("-")[0];
    const preferred = voices.find(v => v.lang === utterance.lang) || voices.find(v => v.lang.startsWith(langPrefix));
    if (preferred) utterance.voice = preferred;

    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

// Production-verified browser voice handling.
export default function AssistantPage() {
  const { t } = useI18n();
  const { session } = useAuth();
  const [activeTab, setActiveTab] = useState<"assistant" | "finance">("assistant");
  const queryClient = useQueryClient();
  // Trial status line under the header (never on Home — owner's rule).
  // Undefined while loading: render nothing until the profile arrives.
  const { data: trialProfile } = useQuery({
    queryKey: ["trial_profile_assistant"],
    queryFn: async () => {
      const { data } = await db.from("users").select("*").eq("id", session!.user.id);
      const row = Array.isArray(data) ? data[0] : data;
      return row as { subscription_plan_id?: string | null; trial_ends_at?: unknown } | null;
    },
    enabled: !!session?.user?.id,
  });
  const trialState = getTrialState(trialProfile ?? null);
  // Per-account chat key: history must never leak across accounts sharing
  // one browser. Null until the session loads; the load effect below fills
  // messages once the key is known.
  const chatKey = session?.user?.id ? `ds-assistant-chat:${session.user.id}` : null;
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speakEnabled, setSpeakEnabled] = useState(true);
  const [drivingMode, setDrivingMode] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const drivingModeRef = useRef(false);
  const isLoadingRef = useRef(false);
  // Last reply actually spoken aloud. The mic must never re-send the AI's
  // own voice: without headphones the phone mic hears the speaker, so a
  // verbatim replay of this text is an echo, not a user message.
  const lastSpokenRef = useRef("");

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Chat history lives in localStorage so it survives tab switches and app
  // restarts (the server does not store chat messages). It loads per-account
  // once the session is known, and the old shared key is deleted so a
  // previous account's chat can never reappear on this browser.
  useEffect(() => {
    try {
      localStorage.removeItem("ds-assistant-chat");
    } catch {
      // ignore
    }
    if (!chatKey) return;
    try {
      const raw = localStorage.getItem(chatKey);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return;
      setMessages(parsed.filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"));
    } catch {
      // Corrupt stored history: start fresh.
    }
  }, [chatKey]);

  // Trash clears history via the empty-state branch below.
  useEffect(() => {
    if (!chatKey) return;
    try {
      if (messages.length === 0) localStorage.removeItem(chatKey);
      else localStorage.setItem(chatKey, JSON.stringify(messages.slice(-50)));
    } catch {
      // Private mode / full storage: chat just stays in-memory this session.
    }
  }, [messages, chatKey]);

  const speakEnabledRef = useRef(speakEnabled);
  useEffect(() => { speakEnabledRef.current = speakEnabled; }, [speakEnabled]);
  useEffect(() => { drivingModeRef.current = drivingMode; }, [drivingMode]);
  useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);

  // Normalize Hinglish transcript
  const normalizeTranscript = useCallback((text: string): string => {
    let t = text;
    const numberMap: Record<string, string> = {
      "ek": "1", "do": "2", "teen": "3", "char": "4", "chaar": "4",
      "paanch": "5", "panch": "5", "chhah": "6", "chhe": "6", "saat": "7",
      "aath": "8", "nau": "9", "das": "10", "gyarah": "11", "barah": "12",
      "terah": "13", "chaudah": "14", "pandrah": "15", "solah": "16",
      "satrah": "17", "athaarah": "18", "unees": "19", "bees": "20",
      "pachees": "25", "tees": "30", "pachas": "50", "saath": "60",
      "sattar": "70", "assi": "80", "nabbe": "90",
      "sau": "100", "do sau": "200", "teen sau": "300", "paanch sau": "500",
      "hazaar": "1000", "hazar": "1000", "lakh": "100000", "lac": "100000",
    };
    t = t.replace(/dedh\s*sau/gi, "150");
    t = t.replace(/dhai\s*sau/gi, "250");
    t = t.replace(/dedh\s*hazaa?r/gi, "1500");
    t = t.replace(/dhai\s*hazaa?r/gi, "2500");

    const sorted = Object.entries(numberMap).sort((a, b) => b[0].length - a[0].length);
    for (const [word, num] of sorted) {
      const regex = new RegExp(`\\b${word}\\b`, "gi");
      t = t.replace(regex, num);
    }

    t = t.replace(/rupay[ae]?/gi, "rupees");
    t = t.replace(/\bkharcha\b/gi, "expense");
    t = t.replace(/\bkamaya\b|\bkamayi\b|\bkamaye\b|\bkamai\b/gi, "earned");
    t = t.replace(/\blagaye\b|\blagaya\b|\blage\b/gi, "spent");
    t = t.replace(/\bkhane\s*ka\b/gi, "food");
    t = t.replace(/\bpetrol\b/gi, "fuel");
    t = t.replace(/\bpaani\s*piya\b|\bpani\s*pi\s*liya\b|\bpani\s*piya\b/gi, "drank water");
    t = t.replace(/\badd\s*karo\b|\bjodo\b|\bdaalo\b|\bdaal\s*do\b/gi, "add");

    // Android's recognizer re-emits the same words as repeated final segments
    // ("₹500 ₹500 ₹500", "isko isko isko"). Drop any phrase that repeats the
    // phrase just emitted, so the model sees one clean instruction.
    const tokens = t.split(/\s+/).filter(Boolean);
    const deduped: string[] = [];
    let i = 0;
    while (i < tokens.length) {
      let skipped = false;
      for (let unit = 1; unit <= 4; unit++) {
        if (i + unit > tokens.length || deduped.length < unit) continue;
        const phrase = tokens.slice(i, i + unit).join(" ").toLowerCase();
        if (deduped.slice(deduped.length - unit).join(" ").toLowerCase() === phrase) {
          i += unit;
          skipped = true;
          break;
        }
      }
      if (!skipped) { deduped.push(tokens[i]); i++; }
    }
    t = deduped.join(" ");

    return t;
  }, []);

  const send = useCallback(async (text?: string) => {
    const msgText = text || input.trim();
    if (!msgText || isLoading) return;
    if (!session?.access_token) { toast.error(t("ai.signInAssistant")); return; }
    const userMsg: Msg = { role: "user", content: msgText };
    if (!text) setInput("");
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    let assistantSoFar = "";
    const allMessages = [...messages, userMsg];

    try {
      if (BACKEND === "firebase") {
        const result = await callChatFunction(allMessages);
        const content = result.content || result.actions.join("\n") || "Done!";
        assistantSoFar = content;
        setMessages((prev) => [...prev, { role: "assistant", content }]);
        // Tool writes happen server-side, so no write-page invalidation runs
        // for them: refresh Home, Transactions, Budgets and the bell
        // explicitly, or the just-saved entry stays invisible until a
        // manual refresh (a chat-made reminder used to miss the bell).
        queryClient.invalidateQueries({ queryKey: ["transactions_today"] });
        queryClient.invalidateQueries({ queryKey: ["transactions"] });
        queryClient.invalidateQueries({ queryKey: ["budgets_month"] });
        queryClient.invalidateQueries({ queryKey: ["budgets_month_tx"] });
        queryClient.invalidateQueries({ queryKey: ["reminders"] });
        queryClient.invalidateQueries({ queryKey: ["notifications_reminders"] });
        return;
      }

      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ messages: allMessages }),
      });

      if (!resp.ok) {
        if (resp.status === 429) { toast.error(t("ai.rateLimit")); return; }
        if (resp.status === 402) { toast.error(t("ai.usageLimit")); return; }
        try {
          const json = await resp.json();
          if (json.choices?.[0]?.message?.content) {
            const content = json.choices[0].message.content;
            assistantSoFar = content;
            setMessages((prev) => [...prev, { role: "assistant", content }]);
            return;
          }
        } catch {}
        throw new Error("Failed to get response");
      }

      const contentType = resp.headers.get("content-type") || "";

      if (contentType.includes("application/json")) {
        const json = await resp.json();
        const content = json.choices?.[0]?.message?.content || "Done!";
        assistantSoFar = content;
        setMessages((prev) => [...prev, { role: "assistant", content }]);
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
                return [...prev, { role: "assistant", content: assistantSoFar }];
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
      // Quota exhaustion must say so: a generic "failed" makes the user
      // retry, and every retry burns nothing but still frustrates. The
      // server throws resource-exhausted when the hourly AI limit is hit.
      const code = (e as { code?: string })?.code;
      toast.error(t(code === "resource-exhausted" ? "ai.quotaExceeded" : "ai.failedResponse"));
    } finally {
      setIsLoading(false);
      // Speak response, then auto-restart mic in driving mode
      if (speakEnabledRef.current && assistantSoFar) {
        lastSpokenRef.current = assistantSoFar;
        await speakText(assistantSoFar);
      }
      // Auto-restart listening in driving mode after response
      if (drivingModeRef.current) {
        setTimeout(() => {
          if (drivingModeRef.current && !isLoadingRef.current) {
            startListening();
          }
        }, 800);
      }
    }
  }, [input, isLoading, messages, session]);

  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error(t("ai.speechUnsupported"));
      return;
    }

    // Never listen while the AI is still speaking: the phone mic hears the
    // speaker, so the AI's own words would come back as user input (echo
    // loop). Mic dabane ka matlab hai "bolna band karo, meri suno".
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();

    const recognition = new SpeechRecognition();
    recognition.lang = "hi-IN";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 5;

    let finalTranscript = "";
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;

    recognition.onresult = (event: Event & { results: SpeechRecognitionResultList }) => {
      let interim = "";
      finalTranscript = "";
      for (let i = 0; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + " ";
        } else {
          interim += transcript;
        }
      }
      setInput((finalTranscript + interim).trim());

      if (finalTranscript.trim()) {
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
          recognition.stop();
        }, 2000);
      }
    };

    recognition.onend = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      setIsListening(false);
      const trimmed = finalTranscript.trim();
      if (trimmed) {
        const normalized = normalizeTranscript(trimmed);
        // Echo guard: a long verbatim chunk of the last spoken reply is the
        // AI's own voice leaking into the mic, not the user. Drop it instead
        // of sending it back (which would loop forever).
        const clean = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
        const cleanTx = clean(normalized);
        const cleanSpoken = clean(lastSpokenRef.current);
        if (cleanTx.length >= 40 && cleanSpoken.includes(cleanTx)) {
          setInput("");
          if (drivingModeRef.current) {
            setTimeout(() => {
              if (drivingModeRef.current && !isLoadingRef.current) {
                startListening();
              }
            }, 500);
          }
          return;
        }
        setInput("");
        send(normalized);
      } else if (drivingModeRef.current) {
        // No speech detected, restart listening in driving mode
        setTimeout(() => {
          if (drivingModeRef.current && !isLoadingRef.current) {
            startListening();
          }
        }, 500);
      }
    };

    recognition.onerror = (event: Event & { error: string }) => {
      console.error("Speech error:", event.error);
      if (silenceTimer) clearTimeout(silenceTimer);
      setIsListening(false);
      if (event.error !== "no-speech" && event.error !== "aborted") {
        toast.error(t("ai.voiceError", { error: event.error }));
      }
      // Retry in driving mode on no-speech
      if (drivingModeRef.current && (event.error === "no-speech" || event.error === "aborted")) {
        setTimeout(() => {
          if (drivingModeRef.current && !isLoadingRef.current) {
            startListening();
          }
        }, 500);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [send, normalizeTranscript]);

  const toggleVoice = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    startListening();
  }, [isListening, startListening]);

  const toggleDrivingMode = useCallback(() => {
    if (drivingMode) {
      // Turn off driving mode
      setDrivingMode(false);
      recognitionRef.current?.stop();
      setIsListening(false);
      window.speechSynthesis.cancel();
      toast(t("assistant.drivingOff"));
    } else {
      // Turn on driving mode
      setDrivingMode(true);
      setSpeakEnabled(true);
      toast(t("assistant.drivingOn"));
      startListening();
    }
  }, [drivingMode, startListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      window.speechSynthesis.cancel();
    };
  }, []);

  // If finance tab is active, render FinanceAIPage
  if (activeTab === "finance") {
    return (
      <div className="flex h-[calc(100vh-7rem)] flex-col p-4 pt-6">
        {/* Toggle Header */}
        <div className="flex items-center justify-center mb-4">
          <div className="flex items-center gap-0 rounded-xl bg-muted p-1 w-full max-w-xs">
            <button
              onClick={() => setActiveTab("assistant")}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-extrabold transition-all text-muted-foreground"
            >
              <Bot className="h-4 w-4" /> {t("nav.assistant")}
            </button>
            <button
              onClick={() => setActiveTab("finance")}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-extrabold transition-all bg-primary text-primary-foreground shadow-md"
            >
              <TrendingUp className="h-4 w-4" /> {t("home.financeAI")}
            </button>
          </div>
        </div>
        <div className="flex-1 -mx-4 -mb-4 overflow-hidden">
          <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>}>
            <FinanceAIPage />
          </Suspense>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col p-4 pt-6">
      {/* Driving Mode Full Screen Overlay */}
      <AnimatePresence>
        {drivingMode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background p-6"
          >
            <div className="flex flex-col items-center gap-6 w-full max-w-sm">
              <div className="flex items-center gap-2">
                <Headphones className="h-6 w-6 text-primary" />
                <h2 className="text-xl font-bold">{t("assistant.drivingMode")}</h2>
              </div>

              <p className="text-center text-muted-foreground">
                {isLoading
                  ? "Soch raha hoon... 🤔"
                  : isListening
                    ? "Sun raha hoon... bolo! 🎤"
                    : "Ready — bolo kuch bhi!"}
              </p>

              {/* Big pulsing mic */}
              <motion.button
                onClick={toggleVoice}
                disabled={isLoading}
                animate={isListening ? { scale: [1, 1.15, 1] } : {}}
                transition={isListening ? { repeat: Infinity, duration: 1.2 } : {}}
                className={`h-32 w-32 rounded-full flex items-center justify-center shadow-lg transition-colors ${
                  isListening
                    ? "bg-destructive text-destructive-foreground"
                    : "bg-primary text-primary-foreground"
                }`}
              >
                {isListening ? <Square className="h-12 w-12" /> : <Mic className="h-12 w-12" />}
              </motion.button>

              {/* Live transcript */}
              {input && (
                <Card className="w-full">
                  <CardContent className="p-3 text-center">
                    <p className="text-muted-foreground text-xs mb-1">{t("assistant.heard")}</p>
                    <p className="font-medium">{input}</p>
                  </CardContent>
                </Card>
              )}

              {/* Last assistant response */}
              {messages.length > 0 && messages[messages.length - 1].role === "assistant" && (
                <Card className="w-full">
                  <CardContent className="p-3">
                    <p className="text-muted-foreground text-xs mb-1">{t("assistant.response")}</p>
                    <p className="whitespace-pre-wrap">{stripMarkdown(messages[messages.length - 1].content)}</p>
                  </CardContent>
                </Card>
              )}

              <Button
                variant="outline"
                className="w-full gap-2 mt-4"
                onClick={toggleDrivingMode}
              >
                <Square className="h-4 w-4" /> {t("assistant.exitDrivingMode")}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toggle + chat header */}
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex items-center justify-center">
          <div className="flex items-center gap-0 rounded-xl bg-muted p-1 w-full max-w-xs">
            <button
              onClick={() => setActiveTab("assistant")}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-extrabold transition-all bg-primary text-primary-foreground shadow-md"
            >
              <Bot className="h-4 w-4" /> {t("nav.assistant")}
            </button>
            <button
              onClick={() => setActiveTab("finance")}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-extrabold transition-all text-muted-foreground"
            >
              <TrendingUp className="h-4 w-4" /> {t("home.financeAI")}
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">{t("nav.assistant")}</h1>
          <div className="flex items-center gap-1">
            <Button
              variant={drivingMode ? "default" : "outline"}
              size="sm"
              className="gap-1"
              onClick={toggleDrivingMode}
              title={t("assistant.drivingModeTip")}
            >
              <Headphones className="h-4 w-4" />
              <span className="hidden sm:inline">{t("assistant.drive")}</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setSpeakEnabled(!speakEnabled);
                if (speakEnabled) window.speechSynthesis.cancel();
              }}
              title={speakEnabled ? "Mute voice replies" : "Enable voice replies"}
            >
              {speakEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </Button>
            {messages.length > 0 && (
              <Button variant="ghost" size="icon" onClick={() => { setMessages([]); window.speechSynthesis.cancel(); }}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Trial status line (Assistant only; Home stays untouched). */}
      {trialProfile && trialState.kind === "trial" && (
        <p className="text-sm font-semibold text-primary mb-3">⏳ {t("trial.daysLeft", { days: trialState.daysLeft })}</p>
      )}
      {trialProfile && trialState.kind === "notStarted" && (
        <p className="text-sm text-muted-foreground mb-3">{t("trial.notStarted")}</p>
      )}
      {trialProfile && trialState.kind === "expired" && (
        <p className="text-sm font-semibold text-amber-700 mb-3">⚠️ {t("trial.limitedMode")}</p>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 pb-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
            <Bot className="h-12 w-12 mb-3 opacity-50" />
            <p className="font-medium">{t("assistant.intro")}</p>
            <p className="text-muted-foreground mt-1">{t("assistant.introHint")}</p>
          </div>
        )}
        <AnimatePresence>
          {messages.map((msg, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Bot className="h-4 w-4" />
                </div>
              )}
              <Card className={`max-w-[80%] ${msg.role === "user" ? "bg-primary text-primary-foreground" : ""}`}>
                <CardContent className="p-3 whitespace-pre-wrap">{msg.role === "assistant" ? stripMarkdown(msg.content) : msg.content}</CardContent>
              </Card>
              {msg.role === "user" && (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                  <User className="h-4 w-4" />
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Bot className="h-4 w-4" />
            </div>
            <Card>
              <CardContent className="p-3 text-muted-foreground">{t("assistant.thinking")}</CardContent>
            </Card>
          </div>
        )}
      </div>

      

      <div className="flex gap-2 pt-2">
        <Button
          size="icon"
          variant={isListening ? "destructive" : "outline"}
          onClick={toggleVoice}
          className="shrink-0"
        >
          {isListening ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </Button>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={isListening ? "Sun raha hoon..." : "Type ya mic dabao..."}
          onKeyDown={(e) => e.key === "Enter" && send()}
          disabled={isLoading || isListening}
        />
        <Button size="icon" onClick={() => send()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
