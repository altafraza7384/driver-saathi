// Per-user notification language (reminders + daily-entry nudge).
// The server reads the user's saved `preferred_language` (en | hi | mr | bn | kn,
// written when the user saves their Settings profile). Missing or unknown -> English.
// Label words come from the app's own i18n dictionaries (notif.* / recurring.* keys),
// so the push uses the same words the in-app bell shows. Hindi/Marathi amount lines
// follow the dictionary's style (no possessive), so one template fits every label.

export type NotifLang = "en" | "hi" | "mr" | "bn" | "kn";

const LANGS: NotifLang[] = ["en", "hi", "mr", "bn", "kn"];

export function toNotifLang(pref: unknown): NotifLang {
  return typeof pref === "string" && (LANGS as string[]).includes(pref)
    ? (pref as NotifLang)
    : "en";
}

// Label word per source, per language. Keys are the English labels used in SOURCES.
const LABELS: Record<NotifLang, Record<string, string>> = {
  en: { reminder: "Reminder", EMI: "EMI", goal: "Goal", "car check": "Car Check", document: "Document", bill: "Bill" },
  hi: { reminder: "रिमाइंडर", EMI: "EMI", goal: "लक्ष्य", "car check": "कार जांच", document: "दस्तावेज़", bill: "बिल" },
  mr: { reminder: "स्मरणपत्र", EMI: "EMI", goal: "उद्दिष्ट", "car check": "कार तपासणी", document: "दस्तऐवज", bill: "बिल" },
  bn: { reminder: "রিমাইন্ডার", EMI: "EMI", goal: "লক্ষ্য", "car check": "গাড়ি পরীক্ষা", document: "নথি", bill: "বিল" },
  kn: { reminder: "ಜ್ಞಾಪನೆ", EMI: "EMI", goal: "ಗುರಿ", "car check": "ಕಾರ್ ಚೆಕ್", document: "ದಾಖಲೆ", bill: "ಬಿಲ್" },
};

export function labelWord(lang: NotifLang, label: string): string {
  return LABELS[lang][label] ?? LABELS.en[label] ?? label;
}

// "{name} Reminder" — or the type ("EMI Reminder") when the item has no name.
// A name that already ends with the reminder word stays as-is.
export function reminderTitle(lang: NotifLang, name: string, label: string): string {
  const word = LABELS[lang].reminder;
  if (!name) return label === "reminder" ? word : `${labelWord(lang, label)} ${word}`;
  const re = new RegExp(`${word}\\s*$`, "i");
  return re.test(name) ? name : `${name} ${word}`;
}

function inr(amount: number): string {
  return amount.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

// Amount first, like the Jio example's "pack of Rs.349".
const AMOUNT_BODY: Record<NotifLang, (label: string, item: string, amount: string) => string> = {
en: (label, item, amount) => item ? `your ${label} "${item}" of ₹${amount} is due.` : `your ${label} of ₹${amount} is due.`,
hi: (label, item, amount) => item ? `${label} "${item}" — ₹${amount} आज देय है।` : `${label} — ₹${amount} आज देय है।`,
mr: (label, item, amount) => item ? `${label} "${item}" — ₹${amount} आज देय आहे.` : `${label} — ₹${amount} आज देय आहे.`,
bn: (label, item, amount) => item ? `আপনার ${label} "${item}" — ₹${amount} আজ দেয়।` : `আপনার ${label} — ₹${amount} আজ দেয়।`,
kn: (label, item, amount) => item ? `ನಿಮ್ಮ ${label} "${item}" — ₹${amount} ಇಂದು ಪಾವತಿಸಬೇಕು.` : `ನಿಮ್ಮ ${label} — ₹${amount} ಇಂದು ಪಾವತಿಸಬೇಕು.`,
};

// Plain due line, when there is no amount and no saved description.
const PLAIN_DUE: Record<NotifLang, (item: string) => string> = {
  en: (item) => `"${item}" is due.`,
  hi: (item) => `"${item}" आज देय है।`,
  mr: (item) => `"${item}" आज देय आहे.`,
  bn: (item) => `"${item}" আজ দেয়।`,
  kn: (item) => `"${item}" ಇಂದು ಪಾವತಿಸಬೇಕು.`,
};

export function dueDetail(lang: NotifLang, label: string, item: string, amount: number | null, desc: string | null): string {
  const word = labelWord(lang, label);
  if (amount !== null) return AMOUNT_BODY[lang](word, item, inr(amount));
  if (desc) return desc;
  return PLAIN_DUE[lang](item);
}

export function nudgeTitle(lang: NotifLang): string {
  return {
    en: "Daily Entry Reminder",
    hi: "दैनिक एंट्री रिमाइंडर",
    mr: "दैनंदिन एंट्री रिमाइंडर",
    bn: "দৈনিক এন্ট্রি রিমাইন্ডার",
    kn: "ದೈನಂದಿನ ಎಂಟ್ರಿ ರಿಮೈಂಡರ್",
  }[lang];
}

export function nudgeBody(lang: NotifLang, when: "yesterday" | "today"): string {
  const bodies: Record<NotifLang, Record<"yesterday" | "today", string>> = {
    en: { yesterday: "Enter yesterday's earnings and stay tension-free.", today: "Enter today's earnings and stay tension-free." },
    hi: { yesterday: "कल की कमाई की एंट्री करें और टेंशन-फ्री रहें।", today: "आज की कमाई की एंट्री करें और टेंशन-फ्री रहें।" },
    mr: { yesterday: "कालच्या कमाईची नोंद करा आणि टेंशन-फ्री राहा.", today: "आजच्या कमाईची नोंद करा आणि टेंशन-फ्री राहा." },
    bn: { yesterday: "গতকালের আয়ের এন্ট্রি করুন আর টেনশন-মুক্ত থাকুন।", today: "আজকের আয়ের এন্ট্রি করুন আর টেনশন-মুক্ত থাকুন।" },
    kn: { yesterday: "ನಿನ್ನೆಯ ಗಳಿಕೆಯ ಎಂಟ್ರಿ ಮಾಡಿ ಮತ್ತು ಟೆನ್ಷನ್-ಫ್ರೀ ಆಗಿರಿ.", today: "ಇಂದಿನ ಗಳಿಕೆಯ ಎಂಟ್ರಿ ಮಾಡಿ ಮತ್ತು ಟೆನ್ಷನ್-ಫ್ರೀ ಆಗಿರಿ." },
  };
  return bodies[lang][when];
}
