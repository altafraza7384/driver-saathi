// Pure helpers for Driving Mode's hands-free loop (no React, unit-tested).

const PUNCT = /[.,!?;:'"“”‘’()\-–—।॥|]/g;

function words(text: string): string[] {
  return text.toLowerCase().replace(PUNCT, " ").split(/\s+/).filter(Boolean);
}

// Words that may surround a stop command without changing its meaning
// ("please band karo", "driving mode band kar do", "ab bas band karo").
const FILLER = new Set([
  "please", "plz", "pls", "now", "it", "the", "driving", "mode", "ab", "abhi", "bhai", "yaar", "ji", "bas", "jaldi",
  "प्लीज़", "प्लीज", "अब", "अभी", "भाई", "जी", "ड्राइविंग", "मोड", "बस", "आता", "ड्रायव्हिंग",
  "এখন", "ড্রাইভিং", "মোড", "ಈಗ", "ಡ್ರೈವಿಂಗ್", "ಮೋಡ್",
]);

// Whole commands that end the Driving Mode loop, after fillers are removed.
const STOP_PHRASES = new Set([
  // Hinglish / English (the recognizer may also return them in Latin script)
  "band karo", "band kar do", "band kardo", "band kar", "band karna", "band kariye", "band kijiye", "band ho jao",
  "bandh karo", "bandh kar do", "bund karo", "band", "stop", "exit", "stop listening",
  // Hindi / Marathi (Devanagari)
  "बंद करो", "बंद कर दो", "बंद करदो", "बंद कर", "बंद करिए", "बंद कीजिए", "बंद करना", "बंद हो जाओ", "बन्द करो", "बन्द कर दो",
  "बंद करा", "बंद कर ना", "बंद", "बन्द", "स्टॉप", "स्टॉप करो",
  // Bengali
  "বন্ধ করো", "বন্ধ কর", "বন্ধ করে দাও", "বন্ধ করুন", "বন্ধ", "স্টপ",
  // Kannada
  "ಬಂದ್ ಮಾಡು", "ಬಂದ್ ಮಾಡಿ", "ನಿಲ್ಲಿಸು", "ನಿಲ್ಲಿಸಿ", "ಬಂದ್", "ಸ್ಟಾಪ್",
]);

/**
 * True when the whole utterance is a "stop Driving Mode" command such as
 * "band karo", "band kar do", "stop", "बंद करो". A sentence that merely
 * contains the words ("petrol pump band tha, 500 kharch") is NOT a command.
 */
export function isStopCommand(text: string): boolean {
  const all = words(text);
  if (all.length === 0 || all.length > 7) return false;
  const core = all.filter((w) => !FILLER.has(w)).join(" ");
  if (core === "") return false;
  return STOP_PHRASES.has(core);
}

// Words that ask the AI to stop talking (barge-in by keyword).
const INTERRUPT_WORDS = new Set([
  "ruko", "ruk", "rukiye", "rukko", "wait", "stop", "bas", "suno", "sunao", "hold",
  "रुको", "रुक", "रुकिए", "रुकिये", "बस", "सुनो", "स्टॉप", "थांबा", "थांब",
  "থামো", "থাম", "থামুন", "শোনো", "স্টপ",
  "ನಿಲ್ಲು", "ನಿಲ್ಲಿ", "ತಾಳು", "ಕೇಳು", "ಸ್ಟಾಪ್",
]);

function normalizeWord(w: string): string {
  // Spelling noise between the TTS text and what the recognizer hears.
  return w.replace(/[\u093c\u0901\u0902\u0981\u0982\u0c82\u200c\u200d]/g, "");
}

function editDistanceAtMost1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export type BargeIn = "exit" | "interrupt" | null;

/**
 * Decide, from a partial transcript heard WHILE the AI is speaking, whether
 * the user is talking over it. The phone mic also hears the speaker, so
 * anything that matches the reply being spoken is treated as the AI's own
 * voice (echo) and ignored:
 *   - "band karo" (whole command)            → "exit"
 *   - an interrupt word (ruko / stop / bas …) not in the reply → "interrupt"
 *   - 3+ words that are NOT in the reply, at least 60% of what was heard
 *     (numbers ignored, one-letter spelling slips forgiven) → "interrupt"
 */
export function detectBargeIn(partial: string, spokenText: string): BargeIn {
  const heard = words(partial);
  if (heard.length === 0) return null;
  if (isStopCommand(partial) && !words(spokenText).some((w) => w === heard[0])) return "exit";

  const spoken = words(spokenText).map(normalizeWord);
  const spokenSet = new Set(spoken);
  if (heard.some((w) => INTERRUPT_WORDS.has(w) && !spokenSet.has(normalizeWord(w)))) return "interrupt";

  const meaningful = heard.map(normalizeWord).filter((w) => !/^[\d₹,.]+$/.test(w));
  if (meaningful.length < 3) return null;
  const novel = meaningful.filter((w) => !spokenSet.has(w) && !(w.length >= 3 && spoken.some((s) => editDistanceAtMost1(w, s))));
  if (novel.length >= 3 && novel.length / meaningful.length >= 0.6) return "interrupt";
  return null;
}

/** Wait before listening again after a failed / instantly-ended listen: 0.5 s, 1 s, 2 s, 4 s, then 6 s. */
export function listenRetryDelay(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 300;
  return Math.min(500 * 2 ** (consecutiveFailures - 1), 6000);
}
