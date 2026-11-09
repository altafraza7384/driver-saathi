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

/** Wait before listening again after a failed / instantly-ended listen: 0.5 s, 1 s, 2 s, 4 s, then 6 s. */
export function listenRetryDelay(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 300;
  return Math.min(500 * 2 ** (consecutiveFailures - 1), 6000);
}
