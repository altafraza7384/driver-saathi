import { useState, useRef, useEffect, useCallback, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Send, Bot, User, Trash2, Mic, Square, Volume2, VolumeX, TrendingUp, Car } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { BACKEND } from "@/lib/backend";
import { db } from "@/lib/backend";
import { getTrialState } from "@/lib/trial";
import { useSubscriptionNudges } from "@/lib/nudges";
import { callChatFunction } from "@/lib/ai";
import { normalizeTranscript } from "@/lib/transcript";
import { stripMarkdown } from "@/lib/plainText";
import { loadChatHistory, saveChatHistory, toApiMessages, type ChatMsg } from "@/lib/chatHistory";
import { useDrivingMode } from "@/lib/useDrivingMode";
import { stopSpeaking, speakText } from "@/lib/speechTts";
import { CHAT_SCREEN_CLASS, CHAT_SCREEN_STYLE } from "@/lib/chatScreen";
import NativeAdSlot from "@/components/NativeAdSlot";

const FinanceAIPage = lazy(() => import("./FinanceAIPage"));

type Msg = ChatMsg;

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

// Production-verified browser voice handling.
export default function AssistantPage() {
  const { t, language } = useI18n();
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
  const navigate = useNavigate();
  const { enabled: nudgesEnabled } = useSubscriptionNudges();
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
  // Latest values for the hands-free loop. Driving Mode calls send() and
  // startListening() from timers and plugin callbacks long after the render
  // that created them; through these refs the loop always uses the CURRENT
  // chat (a stale history made "haan" reach the server without the
  // "sahi hai?" proposal it confirms).
  const messagesRef = useRef<Msg[]>([]);
  const sendRef = useRef<(text?: string) => Promise<void>>(async () => undefined);
  const startListeningRef = useRef<() => void>(() => undefined);
  const exitDrivingRef = useRef<() => void>(() => undefined);
  const languageRef = useRef(language);
  languageRef.current = language;
  // UI language is not necessarily the spoken language. Start with the UI
  // locale, then learn a better locale from each useful transcript.
  const voiceLangRef = useRef(speechLangFor(language));
  const [isSpeaking, setIsSpeaking] = useState(false);
  const speakingRef = useRef(false);
  // What the user said last in Driving Mode (shown small under the mic).
  const [lastHeard, setLastHeard] = useState("");
  const listenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listenFailsRef = useRef(0);

  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Chat history lives in localStorage so it survives tab switches and app
  // restarts (the server does not store chat messages). It loads per-account
  // once the session is known, and the old shared key is deleted so a
  // previous account's chat can never reappear on this browser. Messages
  // older than 24 hours (or saved before timestamps existed) are pruned
  // silently on load and on save; the 50-message cap stays.
  useEffect(() => {
    try {
      localStorage.removeItem("ds-assistant-chat");
    } catch {
      // ignore
    }
    if (!chatKey) return;
    setMessages(loadChatHistory(chatKey));
  }, [chatKey]);

  // Trash clears history via the empty-state branch below.
  useEffect(() => {
    if (!chatKey) return;
    saveChatHistory(chatKey, messages);
  }, [messages, chatKey]);

  const speakEnabledRef = useRef(speakEnabled);
  useEffect(() => { speakEnabledRef.current = speakEnabled; }, [speakEnabled]);
  useEffect(() => { drivingModeRef.current = drivingMode; }, [drivingMode]);
  useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);
  useEffect(() => { voiceLangRef.current = speechLangFor(language); }, [language]);
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

  // Driving Mode: listen again after `delay` ms, unless the loop ended, a
  // reply is on its way, the AI is speaking, or a listen is already running.
  const scheduleListen = (delay: number) => {
    if (listenTimerRef.current) clearTimeout(listenTimerRef.current);
    listenTimerRef.current = setTimeout(() => {
      listenTimerRef.current = null;
      if (drivingModeRef.current && !isLoadingRef.current && !speakingRef.current && !recognitionRef.current) {
        startListeningRef.current();
      }
    }, delay);
  };

  // Speak a reply in full. Resolves when the voice finishes or is
  // interrupted (tap or exit). Never open a second microphone session while
  // TTS is playing: the phone speaker would be transcribed as user input.
  const speakReply = async (text: string) => {
    lastSpokenRef.current = text;
    speakingRef.current = true;
    setIsSpeaking(true);
    try {
      await speakText(text);
    } finally {
      speakingRef.current = false;
      setIsSpeaking(false);
    }
  };

  // Driving Mode only: the server sends "save ho gaya" lines in `actions`;
  // when the model's own words skip them, add them so the save is heard.
  const withSavedLines = (content: string, actions: string[]) => {
    const missing = actions.filter((a) => a && !content.includes(a));
    return missing.length ? `${content}\n${missing.join("\n")}` : content;
  };

  const send = useCallback(async (text?: string) => {
    const msgText = text || input.trim();
    if (!msgText || isLoadingRef.current) return;
    if (!session?.access_token) { toast.error(t("ai.signInAssistant")); return; }
    const userMsg: Msg = { role: "user", content: msgText, ts: Date.now() };
    if (!text) setInput("");
    const allMessages = [...messagesRef.current, userMsg];
    messagesRef.current = allMessages;
    setMessages((prev) => [...prev, userMsg]);
    isLoadingRef.current = true;
    setIsLoading(true);

    let assistantSoFar = "";

    try {
      if (BACKEND === "firebase") {
        const result = await callChatFunction(toApiMessages(allMessages));
        let content = result.content || result.actions.join("\n") || "Done!";
        if (drivingModeRef.current) content = withSavedLines(content, result.actions);
        assistantSoFar = content;
        setMessages((prev) => [...prev, { role: "assistant", content, ts: Date.now() }]);
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
        body: JSON.stringify({ messages: toApiMessages(allMessages) }),
      });

      if (!resp.ok) {
        if (resp.status === 429) { toast.error(t("ai.rateLimit")); return; }
        if (resp.status === 402) { toast.error(t("ai.usageLimit")); return; }
        try {
          const json = await resp.json();
          if (json.choices?.[0]?.message?.content) {
            const content = json.choices[0].message.content;
            assistantSoFar = content;
            setMessages((prev) => [...prev, { role: "assistant", content, ts: Date.now() }]);
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
      // Quota exhaustion must say so: a generic "failed" makes the user
      // retry, and every retry burns nothing but still frustrates. The
      // server throws resource-exhausted when the hourly AI limit is hit.
      const code = (e as { code?: string })?.code;
      toast.error(t(code === "resource-exhausted" ? "ai.quotaExceeded" : "ai.failedResponse"));
    } finally {
      isLoadingRef.current = false;
      setIsLoading(false);
      // Speak the whole response, then (Driving Mode) listen again at once:
      // the user never has to tap the mic. An error still continues the loop.
      if (speakEnabledRef.current && assistantSoFar) {
        await speakReply(assistantSoFar);
      }
      if (drivingModeRef.current) scheduleListen(assistantSoFar ? 300 : 1000);
    }
  }, [input, session, t, queryClient]);
  sendRef.current = send;

  const startListening = useCallback(() => {
    // Never listen while the AI is still speaking: the phone mic hears the
    // speaker, so the AI's own words would come back as user input (echo
    // loop). Mic dabane ka matlab hai "bolna band karo, meri suno".
    stopSpeaking();
    if (listenTimerRef.current) { clearTimeout(listenTimerRef.current); listenTimerRef.current = null; }
    const startedAt = Date.now();

    // What happens with the words once listening ends (web and native alike).
    // In Driving Mode the loop never stops here: nothing heard, an echo or an
    // error all lead to listening again (errors with a growing pause).
    const handleHeard = (trimmed: string, failed = false) => {
      const driving = drivingModeRef.current;
      if (driving && trimmed && isStopCommand(trimmed)) {
        setInput("");
        exitDrivingRef.current();
        return;
      }
      if (trimmed) {
        voiceLangRef.current = inferSpeechLangFromText(trimmed, voiceLangRef.current);
        const normalized = normalizeTranscript(trimmed);
        // Echo guard: a long verbatim chunk of the last spoken reply is the
        // AI's own voice leaking into the mic, not the user. Drop it instead
        // of sending it back (which would loop forever).
        const clean = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
        const cleanTx = clean(normalized);
        const cleanSpoken = clean(lastSpokenRef.current);
        if (cleanTx.length >= 40 && cleanSpoken.includes(cleanTx)) {
          setInput("");
          if (driving) scheduleListen(500);
          return;
        }
        setInput("");
        if (driving) {
          listenFailsRef.current = 0;
          setLastHeard(trimmed);
        }
        void sendRef.current(normalized);
      } else if (driving) {
        // Nothing heard. A listen that ended almost at once (recognizer
        // error, no network) counts as a failure and backs off; a normal
        // "no speech" timeout just listens again.
        if (failed || Date.now() - startedAt < 1500) listenFailsRef.current += 1;
        else listenFailsRef.current = 0;
        scheduleListen(listenRetryDelay(listenFailsRef.current));
      }
    };

    // Android app: the WebView's web Speech API fails with "not-allowed"
    // even when the phone allows the mic, so ask for the mic and listen
    // through the native speech-recognition plugin (like native TTS above).
    if (Capacitor.isNativePlatform()) {
      let session: NativeListenSession | null = null;
      let cancelled = false;
      let abandoned = false;
      const handle = {
        stop: () => { cancelled = true; session?.stop(); },
        cancel: () => { abandoned = true; session?.cancel(); },
      };
      recognitionRef.current = handle;
      setIsListening(true);
      void startNativeListening({
        lang: voiceLangRef.current,
        onPartial: (text) => setInput(text),
        onEnd: (text) => {
          if (recognitionRef.current === handle) recognitionRef.current = null;
          setIsListening(false);
          handleHeard(text);
        },
        onError: (error) => {
          if (recognitionRef.current === handle) recognitionRef.current = null;
          setIsListening(false);
          if (error === "permission-denied") {
            toast.error(t("ai.micPermissionDenied"), { duration: 10000 });
            // Without the mic the hands-free loop cannot run: end it rather
            // than re-asking for permission every few seconds while driving.
            if (drivingModeRef.current) exitDrivingRef.current();
            return;
          }
          if (error === "unavailable") {
            toast.error(t("ai.speechUnavailableApp"));
            if (drivingModeRef.current) exitDrivingRef.current();
            return;
          }
          if (drivingModeRef.current) {
            console.warn("Driving Mode listen error, retrying:", error);
            handleHeard("", true);
          } else {
            toast.error(t("ai.voiceError", { error }));
          }
        },
      }).then((s) => {
        session = s;
        if (s && abandoned) s.cancel();
        else if (s && cancelled) s.stop();
      });
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error(t("ai.speechUnsupported"));
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = voiceLangRef.current;
    recognition.interimResults = true;
    // A single utterance is easier to finalize reliably than a continuous
    // WebView recognizer that can restart or duplicate segments on Android.
    recognition.continuous = false;
    recognition.maxAlternatives = 5;

    let finalTranscript = "";
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    let errored = false;
    let abandoned = false;
    const handle = {
      stop: () => recognition.stop(),
      cancel: () => { abandoned = true; try { recognition.abort(); } catch { /* ignore */ } },
    };

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

    // onend always follows onerror, so the loop continues from here only.
    recognition.onend = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      if (recognitionRef.current === handle) recognitionRef.current = null;
      setIsListening(false);
      if (abandoned) return;
      handleHeard(finalTranscript.trim(), errored);
    };

    recognition.onerror = (event: Event & { error: string }) => {
      console.error("Speech error:", event.error);
      if (silenceTimer) clearTimeout(silenceTimer);
      setIsListening(false);
      if (event.error === "no-speech" || event.error === "aborted") return;
      errored = true;
      if (drivingModeRef.current && event.error !== "not-allowed") return; // loop retries quietly
      toast.error(t("ai.voiceError", { error: event.error }));
      if (drivingModeRef.current) { abandoned = true; exitDrivingRef.current(); }
    };

    recognitionRef.current = handle;
    recognition.start();
    setIsListening(true);
  }, [normalizeTranscript, language, t]);
  startListeningRef.current = startListening;

  const toggleVoice = useCallback(() => {
    if (drivingModeRef.current) {
      // Driving Mode mic: while the AI speaks, a tap stops the voice and the
      // loop listens; while listening, a tap ends this listen (what was heard
      // is sent); otherwise it listens right now.
      if (speakingRef.current) { stopSpeaking(); return; }
      if (isListening) { recognitionRef.current?.stop(); return; }
      if (!isLoadingRef.current) startListening();
      return;
    }
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    startListening();
  }, [isListening, startListening]);

  // End the hands-free loop (Exit button or "band karo"): nothing that was
  // half-heard is sent.
  const exitDriving = useCallback(() => {
    drivingModeRef.current = false;
    setDrivingMode(false);
    if (listenTimerRef.current) { clearTimeout(listenTimerRef.current); listenTimerRef.current = null; }
    const r = recognitionRef.current;
    recognitionRef.current = null;
    r?.cancel?.();
    cancelNativeListening();
    setIsListening(false);
    setInput("");
    stopSpeaking();
    toast(t("assistant.drivingOff"));
  }, [t]);
  exitDrivingRef.current = exitDriving;

  const toggleDrivingMode = useCallback(() => {
    if (drivingModeRef.current) {
      exitDriving();
    } else {
      // Turn on driving mode
      drivingModeRef.current = true;
      speakEnabledRef.current = true;
      listenFailsRef.current = 0;
      setLastHeard("");
      setDrivingMode(true);
      setSpeakEnabled(true);
      toast(t("assistant.drivingOn"));
      startListening();
    }
  }, [exitDriving, startListening, t]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      drivingModeRef.current = false;
      if (listenTimerRef.current) clearTimeout(listenTimerRef.current);
      const r = recognitionRef.current;
      recognitionRef.current = null;
      if (r?.cancel) r.cancel();
      else r?.stop?.();
      cancelNativeListening();
      stopSpeaking();
    };
  }, []);


  // If finance tab is active, render FinanceAIPage
  if (activeTab === "finance") {
    return (
      <div className={CHAT_SCREEN_CLASS} style={CHAT_SCREEN_STYLE}>
        {/* Toggle Header */}
        <div className="flex shrink-0 items-center justify-center mb-4">
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
        <div className="-mx-4 -mb-4 min-h-0 flex-1 overflow-hidden">
          <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>}>
            <FinanceAIPage embedded />
          </Suspense>
        </div>
      </div>
    );
  }

  return (
    <>
        {/* Driving Mode Full Screen Overlay. Layout (v7): title, status and the
            big mic never move; heard text and the reply are caption-size and
            the reply scrolls inside its own small box, so a long answer can
            never push the mic or the status off screen. Only the screen text
            is small — the reply is still spoken in full. While the AI speaks,
            a tap anywhere stops the voice and the loop listens. */}
        <AnimatePresence>
          {drivingMode && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] flex flex-col bg-background px-6"
              style={{
                paddingTop: "max(env(safe-area-inset-top, 0px), 1rem)",
                paddingBottom: "max(env(safe-area-inset-bottom, 0px), 1rem)",
              }}
              onClick={() => { if (speakingRef.current) stopSpeaking(); }}
            >
              <div className="mx-auto flex h-full w-full max-w-sm flex-col">
                <div className="flex shrink-0 items-center justify-center gap-2 pt-2">
                  <Car className="h-6 w-6 text-primary" />
                  <h2 className="text-xl font-bold">{t("assistant.drivingMode")}</h2>
                </div>

                <div className="flex h-[6rem] shrink-0 flex-col items-center justify-center overflow-hidden text-center">
                  <p className="text-lg text-foreground" aria-live="polite">
                    {isLoading
                      ? "Soch raha hoon... 🤔"
                      : isSpeaking
                        ? t("assistant.drivingSpeaking")
                        : isListening
                          ? "Sun raha hoon... bolo! 🎤"
                          : "Ready — bolo kuch bhi!"}
                  </p>
                  <p className="text-[12px] leading-snug text-muted-foreground">{t("assistant.drivingStopHint")}</p>
                </div>

                {/* Big mic, fixed in the centre of the free space */}
                <div className="flex min-h-0 flex-1 items-center justify-center py-4">
                  <motion.button
                    onClick={(e) => { e.stopPropagation(); toggleVoice(); }}
                    disabled={isLoading}
                    animate={isListening ? { scale: [1, 1.12, 1] } : { scale: 1 }}
                    transition={isListening ? { repeat: Infinity, duration: 1.2 } : {}}
                    className={`flex h-36 w-36 shrink-0 items-center justify-center rounded-full shadow-lg transition-colors ${
                      isListening || isSpeaking
                        ? "bg-destructive text-destructive-foreground"
                        : "bg-primary text-primary-foreground"
                    }`}
                  >
                    {isListening || isSpeaking ? <Square className="h-14 w-14" /> : <Mic className="h-14 w-14" />}
                  </motion.button>
                </div>

                {/* Fixed-height caption area: its content can never move the mic */}
                <div className="flex h-[36%] shrink-0 flex-col justify-end gap-2">
                  {/* Heard transcript (live while listening, else the last thing said) */}
                  {(input || lastHeard) && (
                    <div className="shrink-0 rounded-lg border bg-card px-3 py-1.5">
                      <p className="text-[11px] leading-tight text-muted-foreground">{t("assistant.heard")}</p>
                      <p className="line-clamp-2 text-[13px] leading-snug">{input || lastHeard}</p>
                    </div>
                  )}

                  {/* Last assistant response: caption size, scrolls inside */}
                  {messages.length > 0 && messages[messages.length - 1].role === "assistant" && (
                    <div className="flex min-h-0 flex-col rounded-lg border bg-card px-3 py-1.5">
                      <p className="shrink-0 text-[11px] leading-tight text-muted-foreground">{t("assistant.response")}</p>
                      <div className="min-h-0 overflow-y-auto overscroll-contain">
                        <p className="whitespace-pre-wrap text-[13px] leading-snug">{stripMarkdown(messages[messages.length - 1].content)}</p>
                      </div>
                    </div>
                  )}

                  <Button
                    variant="outline"
                    className="w-full shrink-0 gap-2"
                    onClick={(e) => { e.stopPropagation(); exitDriving(); }}
                  >
                    <Square className="h-4 w-4" /> {t("assistant.exitDrivingMode")}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

    <div className={CHAT_SCREEN_CLASS} style={CHAT_SCREEN_STYLE}>
      {trialState.kind === "expired" && nudgesEnabled && (
        <Card className="mb-4 border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
                        <p className="font-semibold">{t("trial.upgradeCardTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("trial.upgradeCardBody")}</p>
          <Button className="mt-3" onClick={() => navigate("/plans")}>
            {t("trial.viewPlans")}
          </Button>
        </Card>
      )}
      {/* Toggle + chat header */}
      <div className="flex shrink-0 flex-col gap-3 mb-4">
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
              <Car className="h-4 w-4" />
              <span className="hidden sm:inline">{t("assistant.drive")}</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setSpeakEnabled(!speakEnabled);
                if (speakEnabled) stopSpeaking();
              }}
              title={speakEnabled ? "Mute voice replies" : "Enable voice replies"}
            >
              {speakEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </Button>
            {messages.length > 0 && (
              <Button variant="ghost" size="icon" onClick={() => { setMessages([]); stopSpeaking(); }}>
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

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain space-y-3 pb-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
            <Bot className="h-8 w-8 mb-2 opacity-50" />
            <p className="font-medium text-sm">{t("assistant.intro")}</p>
            <p className="text-muted-foreground text-xs mt-1">{t("assistant.introHint")}</p>
            <div className="w-full max-w-sm mt-4">
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

      

      <div className="flex shrink-0 gap-2 pt-2">
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
    </>
  );
}
