import { Capacitor } from "@capacitor/core";

// Text-to-speech helpers shared by the Driving Mode voice loop. The
// spoken reply (and stopping it) lives here so both AI pages use one
// implementation; the loop itself lives in useDrivingMode.ts.

// Android's in-app WebView has NO window.speechSynthesis (it is undefined
// there, unlike desktop/mobile Chrome). Every unguarded
// window.speechSynthesis.cancel() threw "Cannot read properties of undefined
// (reading 'cancel')"; the one in the unmount cleanup crashed the whole app
// to the error screen whenever the user left this page in the APK
// (2026-11-01). Always go through these helpers.
function webTts(): SpeechSynthesis | null {
  try {
    const s = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    return s && typeof s.cancel === "function" ? s : null;
  } catch {
    return null;
  }
}

// Resolvers of speakText() calls still playing. The native TTS plugin never
// answers a speak() that was stopped, so stopSpeaking() settles them itself —
// otherwise an interrupted reply would leave Driving Mode waiting forever.
const pendingSpeech = new Set<() => void>();

function settlePendingSpeech(): void {
  const all = [...pendingSpeech];
  pendingSpeech.clear();
  all.forEach((done) => done());
}

export function stopSpeaking(): void {
  settlePendingSpeech();
  try { webTts()?.cancel(); } catch { /* ignore */ }
  if (Capacitor.isNativePlatform()) {
    import("@capacitor-community/text-to-speech")
      .then(({ TextToSpeech }) => TextToSpeech.stop())
      .catch(() => { /* plugin missing or nothing speaking */ });
  }
}

// Native app: the WebView has no browser TTS, so use the native
// text-to-speech plugin (already a dependency) for voice replies.
async function speakNative(text: string, lang: string): Promise<void> {
  try {
    const { TextToSpeech } = await import("@capacitor-community/text-to-speech");
    await TextToSpeech.stop().catch(() => undefined);
    await TextToSpeech.speak({ text, lang, rate: 1.0, pitch: 1.0, volume: 1.0 });
  } catch (e) {
    console.warn("Native TTS failed:", e);
  }
}

// Speak text aloud using browser TTS (or the native TTS plugin in the app)
export function speakText(text: string): Promise<void> {
  settlePendingSpeech(); // a new reply replaces any voice still playing
  return new Promise((resolveSpeech) => {
    let settled = false;
    const resolve = () => {
      if (settled) return;
      settled = true;
      pendingSpeech.delete(resolve);
      resolveSpeech();
    };
    pendingSpeech.add(resolve);
    const synth = webTts();
    if (!synth && !Capacitor.isNativePlatform()) { resolve(); return; }
    try { synth?.cancel(); } catch { /* ignore */ }

    const cleanText = text
      .replace(/[\u{1F600}-\u{1F9FF}|\u{2600}-\u{26FF}|\u{2700}-\u{27BF}|\u{1F300}-\u{1F5FF}|\u{1F680}-\u{1F6FF}|\u{1F1E0}-\u{1F1FF}|\u{2702}-\u{27B0}|\u{FE0F}|\u{200D}]/gu, "")
      .replace(/[*#_~`]/g, "")
      .replace(/\n+/g, ". ")
      .trim();

    if (!cleanText) { resolve(); return; }

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

    if (!synth) {
      void speakNative(cleanText, lang).then(() => resolve());
      return;
    }

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = lang;
    utterance.rate = 1.05;
    utterance.pitch = 1;

    const voices = synth.getVoices();
    const langPrefix = lang.split("-")[0];
    const preferred = voices.find(v => v.lang === utterance.lang) || voices.find(v => v.lang.startsWith(langPrefix));
    if (preferred) utterance.voice = preferred;

    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    synth.speak(utterance);
  });
}
