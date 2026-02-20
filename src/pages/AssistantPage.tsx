import { useState, useRef, useEffect, useCallback, lazy, Suspense } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Send, Bot, User, Trash2, Mic, Square, Volume2, VolumeX, Headphones, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";

const FinanceAIPage = lazy(() => import("./FinanceAIPage"));

type Msg = { role: "user" | "assistant"; content: string };

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
    const hindiChars = (cleanText.match(/[\u0900-\u097F]/g) || []).length;
    const isHindi = hindiChars > cleanText.length * 0.2;
    utterance.lang = isHindi ? "hi-IN" : "en-IN";
    utterance.rate = 1.05;
    utterance.pitch = 1;

    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => v.lang === utterance.lang) || voices.find(v => v.lang.startsWith(isHindi ? "hi" : "en"));
    if (preferred) utterance.voice = preferred;

    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

export default function AssistantPage() {
  const { t } = useI18n();
  const { session } = useAuth();
  const [activeTab, setActiveTab] = useState<"assistant" | "finance">("assistant");
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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

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

    return t;
  }, []);

  const send = useCallback(async (text?: string) => {
    const msgText = text || input.trim();
    if (!msgText || isLoading) return;
    const userMsg: Msg = { role: "user", content: msgText };
    if (!text) setInput("");
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    let assistantSoFar = "";
    const allMessages = [...messages, userMsg];

    try {
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: allMessages }),
      });

      if (!resp.ok) {
        if (resp.status === 429) { toast.error("Rate limit exceeded, try again later."); return; }
        if (resp.status === 402) { toast.error("Usage limit reached."); return; }
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
      toast.error("Failed to get response");
    } finally {
      setIsLoading(false);
      // Speak response, then auto-restart mic in driving mode
      if (speakEnabledRef.current && assistantSoFar) {
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
      toast.error("Speech recognition not supported on this browser");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "hi-IN";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 5;

    let finalTranscript = "";
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
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

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error("Speech error:", event.error);
      if (silenceTimer) clearTimeout(silenceTimer);
      setIsListening(false);
      if (event.error !== "no-speech" && event.error !== "aborted") {
        toast.error(`Voice error: ${event.error}`);
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
      toast("🚗 Driving mode off");
    } else {
      // Turn on driving mode
      setDrivingMode(true);
      setSpeakEnabled(true);
      toast("🚗 Driving mode ON — just talk, I'm listening!");
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
              <Bot className="h-4 w-4" /> Assistant
            </button>
            <button
              onClick={() => setActiveTab("finance")}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-extrabold transition-all bg-primary text-primary-foreground shadow-md"
            >
              <TrendingUp className="h-4 w-4" /> Finance AI
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
                <h2 className="text-xl font-bold">Driving Mode</h2>
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
                    <p className="text-muted-foreground text-xs mb-1">Heard:</p>
                    <p className="font-medium">{input}</p>
                  </CardContent>
                </Card>
              )}

              {/* Last assistant response */}
              {messages.length > 0 && messages[messages.length - 1].role === "assistant" && (
                <Card className="w-full">
                  <CardContent className="p-3">
                    <p className="text-muted-foreground text-xs mb-1">Response:</p>
                    <p className="whitespace-pre-wrap">{messages[messages.length - 1].content}</p>
                  </CardContent>
                </Card>
              )}

              <Button
                variant="outline"
                className="w-full gap-2 mt-4"
                onClick={toggleDrivingMode}
              >
                <Square className="h-4 w-4" /> Exit Driving Mode
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
              <Bot className="h-4 w-4" /> Assistant
            </button>
            <button
              onClick={() => setActiveTab("finance")}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-extrabold transition-all text-muted-foreground"
            >
              <TrendingUp className="h-4 w-4" /> Finance AI
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
              title="Driving Mode — hands-free voice control"
            >
              <Headphones className="h-4 w-4" />
              <span className="hidden sm:inline">Drive</span>
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

      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 pb-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
            <Bot className="h-12 w-12 mb-3 opacity-50" />
            <p className="font-medium">Hi! I'm your driving assistant 🚗</p>
            <p className="text-muted-foreground mt-1">Mic dabao ya Driving Mode on karo — Hindi, Hinglish, English sab samjhta hoon!</p>
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
                <CardContent className="p-3 whitespace-pre-wrap">{msg.content}</CardContent>
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
              <CardContent className="p-3 text-muted-foreground">Thinking...</CardContent>
            </Card>
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-2">
        <Button
          size="icon"
          variant={isListening ? "destructive" : "outline"}
          onClick={toggleVoice}
          disabled={isLoading}
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
        <Button size="icon" onClick={() => send()} disabled={!input.trim() || isLoading}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
