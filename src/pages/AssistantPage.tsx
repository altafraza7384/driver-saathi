import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Send, Bot, User, Trash2, Mic, Square, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";

type Msg = { role: "user" | "assistant"; content: string };

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

// Speak text aloud using browser TTS
function speakText(text: string) {
  if (!("speechSynthesis" in window)) return;
  // Cancel any ongoing speech
  window.speechSynthesis.cancel();
  
  // Clean text: remove emojis, markdown symbols for cleaner speech
  const cleanText = text
    .replace(/[\u{1F600}-\u{1F9FF}|\u{2600}-\u{26FF}|\u{2700}-\u{27BF}|\u{1F300}-\u{1F5FF}|\u{1F680}-\u{1F6FF}|\u{1F1E0}-\u{1F1FF}|\u{2702}-\u{27B0}|\u{FE0F}|\u{200D}]/gu, "")
    .replace(/[*#_~`]/g, "")
    .replace(/\n+/g, ". ")
    .trim();
  
  if (!cleanText) return;
  
  const utterance = new SpeechSynthesisUtterance(cleanText);
  
  // Detect language: if mostly Devanagari/Hindi chars, use Hindi voice
  const hindiChars = (cleanText.match(/[\u0900-\u097F]/g) || []).length;
  const isHindi = hindiChars > cleanText.length * 0.2;
  utterance.lang = isHindi ? "hi-IN" : "en-IN";
  utterance.rate = 1.05;
  utterance.pitch = 1;
  
  // Try to find a good voice
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v => v.lang === utterance.lang) || voices.find(v => v.lang.startsWith(isHindi ? "hi" : "en"));
  if (preferred) utterance.voice = preferred;
  
  window.speechSynthesis.speak(utterance);
}

export default function AssistantPage() {
  const { t } = useI18n();
  const { session } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speakEnabled, setSpeakEnabled] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Use ref for speakEnabled to avoid stale closures in async callbacks
  const speakEnabledRef = useRef(speakEnabled);
  useEffect(() => { speakEnabledRef.current = speakEnabled; }, [speakEnabled]);

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
        // Try parsing non-streamed response
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

      // Handle non-streamed JSON response (tool call fallback)
      if (contentType.includes("application/json")) {
        const json = await resp.json();
        const content = json.choices?.[0]?.message?.content || "Done!";
        assistantSoFar = content;
        setMessages((prev) => [...prev, { role: "assistant", content }]);
        return;
      }

      // Streamed SSE response
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
      // Speak the final assistant message using ref to avoid stale closure
      if (speakEnabledRef.current && assistantSoFar) {
        speakText(assistantSoFar);
      }
    }
  }, [input, isLoading, messages, session]);

  const toggleVoice = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Speech recognition not supported on this browser");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "hi-IN"; // Hindi + Hinglish recognition (also picks up English naturally)
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 3; // Better accuracy for mixed languages

    let finalTranscript = "";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interim += transcript;
        }
      }
      setInput(finalTranscript + interim);
    };

    recognition.onend = () => {
      setIsListening(false);
      if (finalTranscript.trim()) {
        // Auto-send voice message
        setInput("");
        send(finalTranscript.trim());
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error("Speech error:", event.error);
      setIsListening(false);
      if (event.error !== "no-speech") {
        toast.error(`Voice error: ${event.error}`);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [isListening, send]);

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col p-4 pt-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">{t("nav.assistant")}</h1>
        <div className="flex items-center gap-1">
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

      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 pb-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
            <Bot className="h-12 w-12 mb-3 opacity-50" />
            <p className="text-sm font-medium">Hi! I'm your driving assistant 🚗</p>
            <p className="text-xs mt-1">Mic dabao aur bolo — Hindi, Hinglish, English sab samjhta hoon!</p>
            <div className="mt-4 grid grid-cols-1 gap-2 text-xs w-full max-w-sm">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">💾 Save Data</p>
              <button onClick={() => send("I earned ₹1500 from Uber today")} className="rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-accent transition-colors">
                💰 "I earned ₹1500 from Uber today"
              </button>
              <button onClick={() => send("Spent ₹500 on fuel")} className="rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-accent transition-colors">
                ⛽ "Spent ₹500 on fuel"
              </button>
              <button onClick={() => send("I drank a glass of water")} className="rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-accent transition-colors">
                💧 "I drank a glass of water"
              </button>
              <button onClick={() => send("Got car oil changed for ₹800")} className="rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-accent transition-colors">
                🔧 "Oil changed for ₹800"
              </button>
              <button onClick={() => send("Note: Passenger left phone in car")} className="rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-accent transition-colors">
                📝 "Note: Passenger left phone in car"
              </button>
              <button onClick={() => send("Remind me car insurance renewal March 15")} className="rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-accent transition-colors">
                🔔 "Remind me insurance renewal March 15"
              </button>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-2">📊 Ask About Data</p>
              <button onClick={() => send("How much did I earn today?")} className="rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-accent transition-colors">
                📊 "How much did I earn today?"
              </button>
              <button onClick={() => send("Show my notes")} className="rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-accent transition-colors">
                📝 "Show my notes"
              </button>
              <button onClick={() => send("What are my upcoming reminders?")} className="rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-accent transition-colors">
                🔔 "What are my upcoming reminders?"
              </button>
              <button onClick={() => send("Show my car service history")} className="rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-accent transition-colors">
                🔧 "Show my car service history"
              </button>
              <button onClick={() => send("What's my health stats today?")} className="rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-accent transition-colors">
                🏥 "What's my health stats today?"
              </button>
              <button onClick={() => send("Show my savings goals")} className="rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-accent transition-colors">
                🎯 "Show my savings goals"
              </button>
            </div>
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
                <CardContent className="p-3 text-sm whitespace-pre-wrap">{msg.content}</CardContent>
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
              <CardContent className="p-3 text-sm text-muted-foreground">Thinking...</CardContent>
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
          placeholder={isListening ? "Listening..." : "Ask me anything..."}
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
