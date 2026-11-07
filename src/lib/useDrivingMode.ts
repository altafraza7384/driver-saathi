import { useState, useRef, useEffect, useCallback } from "react";
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import {
  startNativeListening,
  cancelNativeListening,
  speechLangFor,
  inferSpeechLangFromText,
  type NativeListenSession,
} from "./nativeSpeech";
import { isStopCommand, listenRetryDelay } from "./drivingVoice";
import type { Language } from "./i18n";
import { stopSpeaking, speakText } from "./speechTts";

// Shared Driving Mode voice loop (Assistant + Finance AI). One code path for
// both pages: listen -> send -> speak the reply -> listen again, hands-free
// while driving. The page owns its chat (messages/send); the hook owns the
// mic, the voice and the loop. Nothing here touches the page's chat state
// except through the `send` and `setInput` the page passes in.

export type UseDrivingModeOptions = {
  // The page's send (chat call). The hook calls it for every heard
  // utterance; it is kept in a ref so the loop always uses the current one.
  send: (text?: string) => Promise<void>;
  setInput: (value: string) => void;
  isLoading: boolean;
  language: Language;
  t: (key: string, vars?: Record<string, string | number>) => string;
  // Assistant has a voice-replies toggle; Finance AI has none and always
  // speaks in Driving Mode. Defaults to true.
  speakEnabled?: boolean;
  // Assistant speaks replies even outside Driving Mode (its toggle);
  // Finance AI speaks only while driving. Defaults to false.
  speakOutsideDriving?: boolean;
  // Assistant normalizes Hinglish number words in transcripts; other pages
  // pass nothing and the transcript is used as-is.
  normalize?: (text: string) => string;
  // Assistant forces its voice toggle on when Driving Mode starts.
  onDrivingStart?: () => void;
};

export type UseDrivingModeResult = {
  drivingMode: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  lastHeard: string;
  toggleVoice: () => void;
  exitDriving: () => void;
  toggleDrivingMode: () => void;
  // Call from the page's send() once the reply is known (finally block):
  // speaks it when allowed, then listens again while driving.
  handleReply: (assistantSoFar: string) => Promise<void>;
  // Current driving state for async callbacks (e.g. the page's send()).
  drivingModeRef: React.MutableRefObject<boolean>;
};

export function useDrivingMode(options: UseDrivingModeOptions): UseDrivingModeResult {
  const {
    send,
    setInput,
    isLoading,
    language,
    t,
    speakEnabled = true,
    speakOutsideDriving = false,
    normalize = (text: string) => text,
    onDrivingStart,
  } = options;

  const [drivingMode, setDrivingMode] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  // What the user said last in Driving Mode (shown small under the mic).
  const [lastHeard, setLastHeard] = useState("");

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
  // values.
  const sendRef = useRef<(text?: string) => Promise<void>>(async () => undefined);
  sendRef.current = send;
  const startListeningRef = useRef<() => void>(() => undefined);
  const exitDrivingRef = useRef<() => void>(() => undefined);
  // UI language is not necessarily the spoken language. Start with the UI
  // locale, then learn a better locale from each useful transcript.
  const voiceLangRef = useRef(speechLangFor(language));
  const speakingRef = useRef(false);
  const listenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listenFailsRef = useRef(0);

  const speakEnabledRef = useRef(speakEnabled);
  useEffect(() => { speakEnabledRef.current = speakEnabled; }, [speakEnabled]);
  useEffect(() => { drivingModeRef.current = drivingMode; }, [drivingMode]);
  useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);
  useEffect(() => { voiceLangRef.current = speechLangFor(language); }, [language]);

  // Listen again after `delay` — unless a reply is on its way, the AI is
  // speaking, or a listen is already running.
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

  const handleReply = async (assistantSoFar: string) => {
    const driving = drivingModeRef.current;
    if (speakEnabledRef.current && assistantSoFar && (driving || speakOutsideDriving)) {
      await speakReply(assistantSoFar);
    }
    if (driving) scheduleListen(assistantSoFar ? 300 : 1000);
  };

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
        const normalized = normalize(trimmed);
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
      toast.error(t("ai.voiceUnsupported"));
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
  }, [normalize, t]);
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
  }, [t, setInput]);
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
      onDrivingStart?.();
      toast(t("assistant.drivingOn"));
      startListening();
    }
  }, [exitDriving, startListening, t, onDrivingStart]);

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

  return {
    drivingMode,
    isListening,
    isSpeaking,
    lastHeard,
    toggleVoice,
    exitDriving,
    toggleDrivingMode,
    handleReply,
    drivingModeRef,
  };
}
