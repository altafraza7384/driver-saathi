import type { Language } from "@/lib/i18n";

// Native (Android app) speech-to-text through the
// @capacitor-community/speech-recognition plugin. Inside the APK the
// WebView's web Speech API fails with "not-allowed" even when the phone has
// granted the Microphone permission (2026-11-01), so the app asks for
// RECORD_AUDIO through the plugin and listens natively — the same way voice
// replies use the native text-to-speech plugin. The browser (web.app) keeps
// using the web Speech API.

// Recognizer language for the app language. The assistant can replace this
// after the first useful transcript with inferSpeechLangFromText(), so the UI
// language and the user's spoken language do not have to be the same.
export function speechLangFor(language: Language): string {
  switch (language) {
    case "hi": return "hi-IN";
    case "mr": return "mr-IN";
    case "bn": return "bn-IN";
    case "kn": return "kn-IN";
    default: return "en-IN";
  }
}

/**
 * Infer a useful next Android recognizer locale from a transcript. This is a
 * lightweight feedback loop, not a claim of perfect language identification:
 * Android's recognizer still needs one locale per session. It lets an English
 * UI user who speaks Hinglish/Marathi stay on that voice locale after the
 * first utterance, without adding a cloud speech service or microphone loop.
 */
export function inferSpeechLangFromText(text: string, fallback: string): string {
  const s = text.trim();
  if (!s) return fallback;
  if (/[\u0C80-\u0CFF]/.test(s)) return "kn-IN";
  if (/[\u0980-\u09FF]/.test(s)) return "bn-IN";
  if (/[\u0900-\u097F]/.test(s)) {
    return /(मी|मला|तुम्ही|तुला|माझा|माझे|पाहिजे|कुठे|काय|झाले|होय)/.test(s) ? "mr-IN" : "hi-IN";
  }
  const words = s.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  const romanMarathi = new Set(["mala", "mi", "ahe", "aahe", "aahet", "tumhi", "tula", "majha", "maza", "kiti", "kevha", "zala", "zali", "zale", "udya", "sakali", "dupari", "sanga", "kharchu", "nako"]);
  const romanHindi = new Set(["aaj", "kya", "kaise", "hai", "mujhe", "mera", "meri", "aapko", "karo", "karna", "kitna", "kharcha", "kamai", "kamaya", "batao", "kal", "subah", "rupaye", "paisa", "petrol", "gaadi", "yaad", "dilana"]);
  const mr = words.filter((w) => romanMarathi.has(w)).length;
  const hi = words.filter((w) => romanHindi.has(w)).length;
  if (mr >= 2 && mr > hi) return "mr-IN";
  if (hi >= 2 && hi > mr) return "hi-IN";
  return fallback;
}

export type NativeSpeechError = "permission-denied" | "unavailable" | string;

export type NativeListenOptions = {
  lang: string;
  /** Live text while the user speaks. */
  onPartial?: (text: string) => void;
  /** Listening finished (silence, stop, timeout or no speech); "" = nothing heard. */
  onEnd: (text: string) => void;
  /** Could not listen at all (permission, no recognizer, plugin error). */
  onError: (error: NativeSpeechError) => void;
};

export type NativeListenSession = {
  /** Stop listening and deliver what was heard through onEnd. */
  stop: () => void;
  /** Abandon this listen: no onEnd/onError, nothing is delivered. */
  cancel: () => void;
};

// The plugin has ONE recognizer, so only one listen can be live. Starting a
// new one silently abandons the previous (Driving Mode hands over from the
// barge-in listener to a normal listen this way), so a stale session's timers
// can never stop or remove the listeners of the new one.
let current: { cancel: () => void } | null = null;

/** Abandon whatever native listen is running (nothing is delivered). */
export function cancelNativeListening(): void {
  current?.cancel();
  current = null;
}

// Android can pause briefly between Hinglish words or while the driver is
// speaking over road noise. A longer debounce prevents mid-sentence cuts.
const SILENCE_STOP_MS = 3500; // stop this long after the last words heard
const NO_SPEECH_MS = 8000; // give up if nothing is heard at all
const MAX_LISTEN_MS = 60000; // hard cap for one listen
const POLL_MS = 700;
const FINAL_GRACE_MS = 1000; // wait for the recognizer's final result after it stops

/** Ask for RECORD_AUDIO through the plugin. true = granted. */
export async function ensureMicPermission(): Promise<boolean> {
  const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");
  let status = await SpeechRecognition.checkPermissions();
  if (status.speechRecognition !== "granted") {
    status = await SpeechRecognition.requestPermissions();
  }
  return status.speechRecognition === "granted";
}

/**
 * Start one native listen. Resolves to a session (call stop() to end early)
 * or null when listening could not start (onError has been called).
 */
export async function startNativeListening(opts: NativeListenOptions): Promise<NativeListenSession | null> {
  cancelNativeListening();
  let abandoned = false;
  const claim = { cancel: () => { abandoned = true; } };
  current = claim;
  let SpeechRecognition: typeof import("@capacitor-community/speech-recognition").SpeechRecognition;
  try {
    ({ SpeechRecognition } = await import("@capacitor-community/speech-recognition"));
  } catch (e) {
    console.warn("Speech recognition plugin missing:", e);
    opts.onError("unavailable");
    return null;
  }

  try {
    const granted = await ensureMicPermission();
    if (!granted) { opts.onError("permission-denied"); return null; }
  } catch (e) {
    console.warn("Mic permission check failed:", e);
    opts.onError("permission-denied");
    return null;
  }

  try {
    const { available } = await SpeechRecognition.available();
    if (!available) { opts.onError("unavailable"); return null; }
  } catch (e) {
    console.warn("Speech recognition availability check failed:", e);
  }

  if (abandoned) return null;

  let text = "";
  let heard = false;
  let finished = false;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let noSpeechTimer: ReturnType<typeof setTimeout> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;

  const clearTimers = () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    if (graceTimer) clearTimeout(graceTimer);
    if (noSpeechTimer) clearTimeout(noSpeechTimer);
    if (maxTimer) clearTimeout(maxTimer);
    if (poll) clearInterval(poll);
    silenceTimer = graceTimer = noSpeechTimer = maxTimer = null;
    poll = null;
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimers();
    if (current === claim) current = null;
    SpeechRecognition.removeAllListeners().catch(() => undefined);
    SpeechRecognition.stop().catch(() => undefined);
    opts.onEnd(text.trim());
  };

  // Abandon: stop timers and callbacks. The recognizer itself is left to the
  // next start() (which cancels it) or stopped here when nothing replaced us.
  claim.cancel = () => {
    abandoned = true;
    if (finished) return;
    finished = true;
    clearTimers();
    if (current === claim) {
      current = null;
      SpeechRecognition.removeAllListeners().catch(() => undefined);
      SpeechRecognition.stop().catch(() => undefined);
    }
  };

  // The recognizer stopped (or was told to): give its final result a moment.
  const finishSoon = (ms = FINAL_GRACE_MS) => {
    if (finished || graceTimer) return;
    if (poll) { clearInterval(poll); poll = null; }
    graceTimer = setTimeout(finish, ms);
  };

  const requestStop = () => {
    if (finished) return;
    SpeechRecognition.stop().catch(() => undefined);
    finishSoon();
  };

  try {
    await SpeechRecognition.removeAllListeners().catch(() => undefined);
    await SpeechRecognition.addListener("partialResults", (data) => {
      const best = data?.matches?.[0];
      if (finished || !best) return;
      heard = true;
      text = best;
      opts.onPartial?.(best);
      if (!graceTimer) {
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(requestStop, SILENCE_STOP_MS);
      }
    });
    await SpeechRecognition.addListener("listeningState", (data) => {
      if (data?.status === "stopped") finishSoon();
    });

    if (finished) return null; // abandoned while starting
    await SpeechRecognition.start({
      language: opts.lang,
      maxResults: 5,
      partialResults: true,
      popup: false,
    });
  } catch (e) {
    clearTimers();
    if (finished) return null; // abandoned while starting
    finished = true;
    if (current === claim) current = null;
    SpeechRecognition.removeAllListeners().catch(() => undefined);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Native speech start failed:", msg);
    opts.onError(/permission/i.test(msg) ? "permission-denied" : msg || "start-failed");
    return null;
  }

  // Errors (no match, speech timeout, network…) end the recognizer without an
  // event in partialResults mode, so watch its state.
  poll = setInterval(() => {
    SpeechRecognition.isListening()
      .then(({ listening }) => { if (!listening) finishSoon(); })
      .catch(() => undefined);
  }, POLL_MS);
  noSpeechTimer = setTimeout(() => { if (!heard) requestStop(); }, NO_SPEECH_MS);
  maxTimer = setTimeout(requestStop, MAX_LISTEN_MS);

  if (finished) return null; // abandoned while starting
  return { stop: requestStop, cancel: () => claim.cancel() };
}
