// Pure helpers for the AI callables (ai.ts), kept free of Firebase imports so
// they can be unit-tested directly (test/aiLogic.test.ts) and exercised
// against the real model from a script.
// Script ranges and Indic words are \u escapes (ASCII-safe source).

export type ChatMsg = { role: "user" | "assistant"; content: string };
export type UserLang = "en" | "hi-roman" | "hi-dev" | "mr" | "mr-roman" | "bn" | "bn-roman" | "kn" | "kn-roman";

// ---------------------------------------------------------------------------
// Language detection (v8, 2026-11-01)
//
// Before: a single regex hit decided Roman Hindi, and its list had no "kya",
// "haal", "subah", "lagao" — so "hi kya haal hai" and "reminder lagao Subah
// ka" were classed English and got English replies. Now every Roman message
// is SCORED against word lists (Hindi, Marathi, Bengali, Kannada, English);
// the highest score wins, and a message with no clear signal (a bare "ok",
// a time like "7:00", a tie) keeps the language of the user's previous
// message (sticky), so a short reply never flips the conversation.
// ---------------------------------------------------------------------------

const words = (s: string) => new Set(s.trim().split(/\s+/));

// Words shared by Hindi and the other Roman-written Indian languages (count
// for all of them, so they never tip the choice between Indian languages).
const SHARED_INDIC = words(`aaj aj kal rupaye rupay rupees paise paisa petrol diesel cng gaadi gadi ola uber rapido`);

const HI_ROMAN = words(`
kya kyaa kaise kaisa kaisi kaisey haal hal hai hain he hoon hu hun ho tha thi
mai main mein me mujhe mujhko mera meri mere maine hum humne hamara hamari humara tum tumhara tumhari tera teri aap aapka aapki aapko apna apni apne
kuch kuchh sab sabhi bhi nahi nahin nhi haan haa han ji accha acha achha theek thik thick sahi galat
karo kar kardo kar_do karna karni karke kiya kiye kiyi diya diye dena dedo lo lena lelo
lagao lagado laga lagana lagaa lagaya lagayi lagaye lagaana lagwa
batao bata batana bolo bol suno sun dekho dekh samjho chahiye chahie chaiye
kitna kitne kitni kab kahan kaha kidhar idhar udhar kyun kyon kaun kisne kisko
parso parson subah subha sube savere savera dopahar dupahar dopehar shaam sham raat rat
baje bje baja bajey saade sade sadhe sava savva paune pone dhai dedh
din hafta mahina mahine saal kamai kamaya kamaye kamaayi kharcha kharche kharchaa
sawari savari chalaya chalayi chala gaya gayi gaye hua hui huye raha rahi rahe sakta sakti sakte
wala wali wale abhi phir fir ab aur lekin magar par se ko ka ke ki ek teen char chaar paanch panch sau hazaar hazar
yaad dilana dilao dila namaste shukriya dhanyavad dhanyawad bhai bhaiya yaar kaam khana paani pani
achha bahut bohot zyada jyada kam thoda bilkul matlab samajh pata jaldi
`);

const MR_ROMAN = words(`
mala mla mi aahe ahe aahet ahet aahes ahes aahat ahat hota hoti pahije pahijet tumhi tumhala tula tujha tuza majha maza majhi mazi mazhe majhe aamhi amhi aapan
kuthe kasa kashi kase kay kai kiti kevha zala zali zale jhala jhali kela keli kele karaycha karaychi karayche karu kara sang sanga bagh baga
ata aata atta udya parva sakali sakaali dupari sandhyakali ratri vajta vajata
milale milala milali kamavle kamavla kharch nako hoy barabar ani aani pan
`);

const BN_ROMAN = words(`
ami amar amake amra tumi tomar tomake apni apnar aajke ajke kalke porshu porshu
koto kemon acho achen achi achhi ache korlam korechi korechhi korbo korun koro holo hoyeche hobe bhalo valo
taka khoroch khorcha aay ay kichu ekta din dao debo nebo shokal sokal dupur bikel sondhya raate
ki_ ar aar kintu ei oi eta ota keno kothay
`);

const KN_ROMAN = words(`
naanu nanu nanna nange neenu ninna ninage nimma nimage naavu namma
eshtu yeshtu hege hegiddira hegidiya idiya idira illa beku bekagide ivattu indu naale nale naadidu
maadi maadu maadide maadidini maadiddene kharchu aadaya sampadane sampaadane sampadisidde hogi banni chennagi chennagide
enu yenu hosa ide aaytu aayitu hana duddu rupayi beligge madhyahna sanje raatri gante
`);

const EN = words(`
the a an is are am was were be been i you he she we they it my your our their this that these those
what how when where why who which please can could would will shall should do does did done
to for of and or with at on in from about into have has had want need help tell show give get
set add save record remind today tomorrow yesterday morning evening night afternoon
much many money spent spend earned earn income expense hello hi hey thanks thank yes no okay
`);

const ROMAN_LISTS: Array<[UserLang, Set<string>]> = [
  ["hi-roman", HI_ROMAN], ["mr-roman", MR_ROMAN], ["bn-roman", BN_ROMAN], ["kn-roman", KN_ROMAN],
];

// Bare confirmations carry no language signal ("Yes" after a Hindi chat must
// not flip it to English); they defer to the previous message.
const BARE = /^(yes|yeah|yep|haan|haa|han|ha|ho|hoy|ji|ji haan|ok|okay|ok ji|okk|theek hai|thik hai|sahi hai|save karo|save kar do|barabar|done|no|nahi|nahin|na|nako|illa|hya|howdu|houdu|hmm|hm)[.!]*$/i;

const MR_DEV = /(\u092e\u0940|\u0906\u0939\u0947|\u0924\u0941\u092e\u094d\u0939\u0940|\u0924\u0941\u0932\u093e|\u092e\u0932\u093e|\u092e\u093e\u091d\u093e|\u092e\u093e\u091d\u0947|\u092a\u093e\u0939\u093f\u091c\u0947|\u0915\u0941\u0920\u0947|\u0915\u0938\u093e|\u0915\u0936\u0940|\u0915\u0938\u0947|\u0915\u0947\u0932\u0947|\u091d\u093e\u0932\u0947|\u0939\u094b\u092f|\u0928\u093e\u0939\u0940)/;

/** Language of ONE message, or null when it carries no clear signal. */
export function classifyText(text: string): UserLang | null {
  const t = text.trim();
  if (!t) return null;
  if (/[\u0980-\u09FF]/.test(t)) return "bn";
  if (/[\u0C80-\u0CFF]/.test(t)) return "kn";
  if (/[\u0900-\u097F]/.test(t)) return MR_DEV.test(t) ? "mr" : "hi-dev";
  if (BARE.test(t)) return null;
  const toks = t.toLowerCase().replace(/[^a-z\s']/g, " ").split(/\s+/).filter(Boolean);
  if (!toks.length) return null;
  let en = 0;
  const score = new Map<UserLang, number>();
  for (const [lang] of ROMAN_LISTS) score.set(lang, 0);
  for (const w of toks) {
    if (EN.has(w)) en++;
    const shared = SHARED_INDIC.has(w);
    for (const [lang, list] of ROMAN_LISTS) {
      if (shared || list.has(w)) score.set(lang, score.get(lang)! + 1);
    }
  }
  // Best Indian language: Hindi wins only a strict majority over the others;
  // on a tie the more specific language (Marathi/Bengali/Kannada) wins,
  // because their lists hold only words that mark that language.
  let best: UserLang = "hi-roman";
  let bestScore = score.get("hi-roman")!;
  for (const [lang, list] of ROMAN_LISTS) {
    if (lang === "hi-roman") continue;
    const s = score.get(lang)!;
    // Marathi/Bengali/Kannada need at least one word of their own, not only shared ones.
    if (s >= bestScore && toks.some((w) => list.has(w))) { best = lang; bestScore = s; }
  }
  if (bestScore > en) return best;
  if (en > bestScore) return "en";
  return null; // tie (incl. 0:0) -> no clear signal
}

/** Language for the reply: the user's latest message with a clear signal. */
export function detectLang(messages: ChatMsg[]): UserLang {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "user") continue;
    const lang = classifyText(messages[i].content);
    if (lang) return lang;
  }
  return "en";
}

export const LANG_HINT: Record<UserLang, string> = {
  en: "Language rule (highest priority): the user's message is in English. Reply ONLY in English. ",
  "hi-roman": "Language rule (highest priority): the user's message is in Hindi written in Roman (Latin) script. Reply ONLY in Roman Hindi using Latin letters, for example: 'aapne 500 rupaye kamaye hain'. Do NOT reply in English and do NOT use Devanagari script. ",
  "hi-dev": "Language rule (highest priority): the user's message is in Hindi written in Devanagari script. Reply ONLY in Hindi using Devanagari script. Do NOT reply in English or Marathi. ",
  mr: "Language rule (highest priority): the user's message is in Marathi written in Devanagari script. Reply ONLY in Marathi using Devanagari script. Do NOT reply in Hindi or English. ",
  "mr-roman": "Language rule (highest priority): the user's message is in Marathi written in Roman (Latin) script. Reply ONLY in Roman Marathi using Latin letters, for example: 'tumhi 300 rupaye kharch kele'. Do NOT reply in English and do NOT use Devanagari script. ",
  bn: "Language rule (highest priority): the user's message is in Bengali written in Bengali script. Reply ONLY in Bengali using Bengali script. Do NOT reply in English or Hindi. ",
  "bn-roman": "Language rule (highest priority): the user's message is in Bengali written in Roman (Latin) script. Reply ONLY in Roman Bengali using Latin letters, for example: 'apni 500 taka aay korechen'. Do NOT reply in English or Hindi and do NOT use Bengali script. ",
  kn: "Language rule (highest priority): the user's message is in Kannada written in Kannada script. Reply ONLY in Kannada using Kannada script. Do NOT reply in English or Hindi. ",
  "kn-roman": "Language rule (highest priority): the user's message is in Kannada written in Roman (Latin) script. Reply ONLY in Roman Kannada using Latin letters, for example: 'neevu 500 rupayi sampadisiddiri'. Do NOT reply in English or Hindi and do NOT use Kannada script. ",
};

export function languageHint(messages: ChatMsg[]): string {
  return LANG_HINT[detectLang(messages)];
}

// ---------------------------------------------------------------------------
// Reminder date/time (v8)
//
// Before: add_reminder took onlydate "yyyy-MM-dd", had no time, and
// notify_at was fixed at 09:00 IST; the model was never told today's date, so
// it asked drivers for yyyy-mm-dd and looped on "kal 7 baje". Now the model
// gets today's date/time in IST and passesdate +time, and
// the server ALSO accepts relative words ("kal", "cal", "parso", "subah 7
// baje", "saade 7") defensively. notify_at is stored as a UTC ISO string
// ("...Z") because the scheduler compares it with new Date().toISOString().
// ---------------------------------------------------------------------------

const IST_MIN = 330;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function istNow(now: Date = new Date()): { date: string; time: string; weekday: string; dow: number } {
  const s = new Date(now.getTime() + IST_MIN * 60000);
  const iso = s.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16), weekday: WEEKDAYS[s.getUTCDay()], dow: s.getUTCDay() };
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function validYmd(y: number, m: number, d: number): string | null {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DAY_WORDS: Array<[number, RegExp]> = [
  // order matters: "day after tomorrow" before "tomorrow"
  [2, /(^|[^a-z])(parso|parson|parsoo|parsun|parsu|parva|porshu|porshoo|naadidu|day after tomorrow)([^a-z]|$)|\u092a\u0930\u0938\u094b\u0902|\u092a\u0930\u0938\u094b|\u092a\u0930\u0935\u093e|\u09aa\u09b0\u09b6\u09c1|\u0ca8\u0cbe\u0ca1\u0cbf\u0ca6\u0cc1/],
  [1, /(^|[^a-z])(kal|kaal|cal|kl|kall|tomorrow|tmrw|tmr|udya|udyaa|kalke|naale|nale)([^a-z]|$)|\u0915\u0932|\u0909\u0926\u094d\u092f\u093e|\u0995\u09be\u09b2|\u0ca8\u0cbe\u0cb3\u0cc6/],
  [0, /(^|[^a-z])(aaj|aj|ajj|today|aajke|ajke|ivattu|indu|aaje)([^a-z]|$)|\u0906\u091c|\u0986\u099c|\u0c87\u0c82\u0ca6\u0cc1/],
];
const WEEKDAY_WORDS: Array<[number, RegExp]> = [
  [0, /\b(sunday|sun|ravivar|raviwar|itwar|itvaar|itvar|rabibar|bhanuvara)\b/],
  [1, /\b(monday|mon|somvar|somwar|sombar|somavara)\b/],
  [2, /\b(tuesday|tue|tues|mangalvar|mangalwar|mongolbar|mangalavara)\b/],
  [3, /\b(wednesday|wed|budhvar|budhwar|budhbar|budhavara)\b/],
  [4, /\b(thursday|thu|thurs|guruvar|guruwar|brihaspativar|brihospotibar|guruvara)\b/],
  [5, /\b(friday|fri|shukravar|shukrawar|sukrobar|shukravara)\b/],
  [6, /\b(saturday|sat|shanivar|shaniwar|shonibar|shanivara)\b/],
];

/**
 * Day for a reminder from what the model (or user) passed: "yyyy-MM-dd",
 * "dd-mm-yyyy", "dd/mm", "5 Nov", or a relative word ("aaj", "kal"/"cal",
 * "parso", "tomorrow", a weekday). "kal" in a reminder means tomorrow.
 * Returns yyyy-MM-dd or null when no day is recognisable.
 */
export function resolveReminderDate(raw: unknown, now: Date = new Date()): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const today = istNow(now);
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return validYmd(+m[1], +m[2], +m[3]);
  m = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (m) return validYmd(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  const thisYear = +today.date.slice(0, 4);
  const upcoming = (mo: number, d: number) => {
    const c = validYmd(thisYear, mo, d);
    if (!c) return null;
    return c < today.date ? validYmd(thisYear + 1, mo, d) : c;
  };
  m = s.match(/\b(\d{1,2})[/](\d{1,2})\b/);
  if (m) return upcoming(+m[2], +m[1]);
  m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/);
  if (m) return upcoming(MONTHS[m[2]], +m[1]);
  m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (m) return upcoming(MONTHS[m[1]], +m[2]);
  for (const [n, re] of DAY_WORDS) if (re.test(s)) return addDays(today.date, n);
  for (const [dow, re] of WEEKDAY_WORDS) {
    if (re.test(s)) return addDays(today.date, ((dow - today.dow + 7) % 7) || 7);
  }
  return null;
}

type DayPart = "am" | "pm" | "morning" | "noon" | "evening" | "night";
const DAYPART_WORDS: Array<[DayPart, RegExp]> = [
  ["morning", /(^|[^a-z])(subah|subha|subeh|sube|suba|savere|savera|sawere|morning|sakali|sakaali|sakal|shokal|sokal|beligge|belagge)([^a-z]|$)|\u0938\u0941\u092c\u0939|\u0938\u0915\u093e\u0933\u0940|\u09b8\u0995\u09be\u09b2|\u0cac\u0cc6\u0cb3\u0cbf\u0c97\u0ccd\u0c97\u0cc6/],
  ["noon", /(^|[^a-z])(dopahar|dopaher|dupahar|dopehar|dophar|afternoon|dupari|dupaari|dupur|madhyahna)([^a-z]|$)|\u0926\u094b\u092a\u0939\u0930|\u0926\u0941\u092a\u093e\u0930\u0940|\u09a6\u09c1\u09aa\u09c1\u09b0|\u0cae\u0ca7\u0ccd\u0caf\u0cbe\u0cb9\u0ccd\u0ca8/],
  ["evening", /(^|[^a-z])(shaam|sham|shyam|shaamko|evening|sandhyakali|sandhyakaali|sandhyakal|sondhya|sandhya|bikel|sanje)([^a-z]|$)|\u0936\u093e\u092e|\u0938\u0902\u0927\u094d\u092f\u093e\u0915\u093e\u0933\u0940|\u09b8\u09a8\u09cd\u09a7\u09cd\u09af\u09be|\u09ac\u09bf\u0995\u09c7\u09b2|\u0cb8\u0c82\u0c9c\u0cc6/],
  ["night", /(^|[^a-z])(raat|rat|raath|night|ratri|raatri|raate|raatre|tonight)([^a-z]|$)|\u0930\u093e\u0924|\u0930\u093e\u0924\u094d\u0930\u0940|\u09b0\u09be\u09a4|\u0cb0\u0cbe\u0ca4\u0ccd\u0cb0\u0cbf/],
  ["pm", /(\d|\s|^)(pm|p\.m\.?)([^a-z]|$)/],
  ["am", /(\d|\s|^)(am|a\.m\.?)([^a-z]|$)/],
];
const DAYPART_DEFAULT: Record<DayPart, string> = { morning: "08:00", noon: "13:00", evening: "18:00", night: "21:00", am: "09:00", pm: "18:00" };
export const DEFAULT_REMINDER_TIME = "09:00";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Time of day for a reminder: "07:00", "7:00 Baje", "7 baje", "subah 7",
 * "shaam 6:30", "7pm", "saade 7" (7:30), "sava 8" (8:15), "paune 9" (8:45),
 * "dedh" (1:30), "dhai" (2:30), or a part of day alone ("subah" -> 08:00).
 * Returns { time: "HH:mm", explicit } or null when no time is given.
 */
export function parseReminderTime(raw: unknown): { time: string; explicit: boolean } | null {
  if (typeof raw !== "string") return null;
  let s = raw.toLowerCase().replace(/\d{4}-\d{1,2}-\d{1,2}/g, " ").replace(/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g, " ")
    .replace(/\b\d{1,2}\/\d{1,2}\b/g, " ")
    .replace(/\b\d{1,2}(st|nd|rd|th)?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/g, " ")
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*\d{1,2}(st|nd|rd|th)?\b/g, " ");
  const NUM: Record<string, number> = { ek: 1, do: 2, teen: 3, tin: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, che: 6, chhah: 6, saat: 7, sat: 7, aath: 8, ath: 8, nau: 9, no: 9, das: 10, dus: 10, gyarah: 11, gyara: 11, barah: 12, bara: 12 };
  const nw = Object.keys(NUM).join("|");
  s = s.replace(new RegExp(`\\b(${nw})\\s*(baje|bje|baja|bajey|bajay)`, "g"), (_x, w, b) => `${NUM[w]} ${b}`)
    .replace(new RegExp(`\\b(saade|sade|sadhe|saadhe|sava|savva|sawa|paune|pone|subah|subha|savere|dopahar|dupahar|shaam|sham|raat|rat)\\s+(${nw})\\b`, "g"), (_x, a, w) => `${a} ${NUM[w]}`);
  let part: DayPart | null = null;
  for (const [p, re] of DAYPART_WORDS) if (re.test(s)) { part = p; break; }
  let h: number | null = null;
  let min = 0;
  let m = s.match(/\b(saade|sade|sadhe|saadhe|sare|saare)\s*(\d{1,2})\b/);
  if (m) { h = +m[2]; min = 30; }
  if (h === null && (m = s.match(/\b(sava|savva|sawa|sawaa)\s*(\d{1,2})\b/))) { h = +m[2]; min = 15; }
  if (h === null && (m = s.match(/\b(paune|pone|pauney|paone)\s*(\d{1,2})\b/))) { h = (+m[2] + 11) % 12 || 12; min = 45; }
  if (h === null && /\b(dedh|derh)\b/.test(s)) { h = 1; min = 30; }
  if (h === null && /\b(dhai|adhai|dhaai|adhaai)\b/.test(s)) { h = 2; min = 30; }
  if (h === null && (m = s.match(/\b(\d{1,2})\s*[:.]\s*(\d{2})\b/))) { h = +m[1]; min = +m[2]; }
  if (h === null && (m = s.match(/\b(\d{1,2})\s*(baje|bje|baja|bajey|bajay|baj|vajta|vajata|vajle|gante|o'?clock|am|pm|a\.m|p\.m)(?![a-z])/))) { h = +m[1]; }
  if (h === null && part && (m = s.match(/\b(\d{1,2})\b/))) { h = +m[1]; }
  if (h === null && (m = s.trim().match(/^(\d{1,2})$/))) { h = +m[1]; }
  if (h === null) return part ? { time: DAYPART_DEFAULT[part], explicit: false } : null;
  if (part && h <= 12) {
    if (part === "am" || part === "morning") { if (h === 12) h = 0; }
    else if (part === "pm" || part === "evening") { if (h < 12) h += 12; }
    else if (part === "noon") { if (h < 6) h += 12; }
    else if (part === "night") { if (h === 12) h = 0; else if (h >= 5) h += 12; }
  }
  if (h > 23 || min > 59) return null;
  return { time: `${pad(h)}:${pad(min)}`, explicit: true };
}

/** UTC ISO instant ("...Z") for a wall-clock date + time in IST. */
export function notifyAtUtc(ymd: string, hhmm: string): string {
  const [y, mo, d] = ymd.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - IST_MIN * 60000).toISOString();
}

/**
 * Everything the server needs from add_reminder's arguments. Day and time
 * may each arrive in either field (the model sometimes puts "kal subah 7
 * baje" in one). Time given but no day: today if still ahead, else tomorrow.
 * Day but no time: 09:00 (or the part of day's default).
 */
export function resolveReminder(args: { reminder_date?: unknown; reminder_time?: unknown }, now: Date = new Date()):
  { date: string; time: string; notifyAt: string } | null {
  const both = `${typeof args.reminder_date === "string" ? args.reminder_date : ""} ${typeof args.reminder_time === "string" ? args.reminder_time : ""}`;
  const t = parseReminderTime(args.reminder_time) ?? parseReminderTime(both);
  let date = resolveReminderDate(args.reminder_date, now) ?? resolveReminderDate(args.reminder_time, now);
  if (!date) {
    if (!t) return null;
    const n = istNow(now);
    date = t.time > n.time ? n.date : addDays(n.date, 1);
  }
  const time = t?.time ?? DEFAULT_REMINDER_TIME;
  return { date, time, notifyAt: notifyAtUtc(date, time) };
}

/** System-prompt line: today in IST, so the model resolves aaj/kal/parso itself. */
export function istContextLine(now: Date = new Date()): string {
  const n = istNow(now);
  return `Current date and time in India (IST): ${n.weekday}, ${n.date}, ${n.time}. Tomorrow (kal) is ${addDays(n.date, 1)}; day after tomorrow (parso) is ${addDays(n.date, 2)}. A reminder time with no day that is earlier than ${n.time} has already passed today, so it means tomorrow (kal), never today. `;
}

export const REMINDER_RULES = "Reminders: understand the driver's natural words for the day and time: aaj/today, kal (also misspelt 'cal'; for a reminder it means tomorrow), parso (day after tomorrow), weekday names, dates like '5 Nov'; subah/savere (morning), dopahar (afternoon), shaam (evening), raat (night); times like '7 baje', '7:00 Baje', '7 pm', 'saade 7' (7:30), 'sava 7' (7:15), 'paune 7' (6:45). Work out the exact date yourself from the current date above. NEVER ask the user to type a date in a format like yyyy-mm-dd or dd-mm-yyyy, and never show such a format to the user. If the user gave a day but no time, use 9 AM (or subah 8, dopahar 1, shaam 6, raat 9 when only the part of day was said) and say that time in your confirmation. If the user gave a time but no day, use today when that time is still ahead, otherwise tomorrow. If no title was given, use a short title from their words (for example 'Gaadi service') or simply 'Reminder'. Ask for something only if it is truly missing, and never ask the same question twice: if the reply is still unclear, pick the sensible default and confirm it. Confirm in natural words in the user's language, for example 'Kal subah 7 baje ka reminder lagau?' (Roman Hindi) or 'Set a reminder for tomorrow at 7 AM?' (English). After the user confirms, call add_reminder with reminder_date as yyyy-MM-dd and reminder_time as HH:mm in 24-hour IST time (7 in the evening is 19:00). ";

export const REMINDER_TOOL = {
  type: "function",
  function: {
    name: "add_reminder",
    description: "Create a reminder. Only call after the user confirms the day and time in natural words. Set force only after the user confirms a flagged duplicate is a separate entry.",
    parameters: { type: "object", required: ["title", "reminder_date"], properties: {
      title: { type: "string" },
      reminder_date: { type: "string", description: "Day of the reminder as yyyy-MM-dd, worked out from the current IST date in the instructions (kal = tomorrow). Never ask the user for this format." },
      reminder_time: { type: "string", description: "Time of day as HH:mm, 24-hour, IST (for example 07:00, 19:30). Use 09:00 if the user gave no time." },
      category: { type: "string" },
      force: { type: "boolean", description: "True only after the user confirms a flagged duplicate is a separate entry." } } },
  },
};

// ---------------------------------------------------------------------------
// Plain text (v8): both AI pages render plain text. The old client strip
// removed only CLOSED **...** pairs, so a cut-off reply ending "3. **Bajat"
// leaked raw ** to the screen. This strips every markdown marker, closed or
// not, and normalises the odd spaces some models emit (a narrow no-break
// space before the rupee sign rendered as "an\u20b9100" on the phone).
// The same function lives in src/lib/plainText.ts for the app.
// ---------------------------------------------------------------------------

export function stripMarkdown(text: string): string {
  return text
    .replace(/[\u00A0\u2007\u2009\u200A\u202F]/g, " ")
    .replace(/[\u2010\u2011]/g, "-")
    .replace(/[\u200B\uFEFF]/g, "")
    .replace(/^\s*```[^\n]*$/gm, "")
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*([-*_])(\s*\1){2,}\s*$/gm, "")
    .replace(/^(\s*)[*+\-\u2022]\s+/gm, "$1")
    .replace(/\*\*|__/g, "")
    .replace(/(^|[\s(])\*(?=\S)/gm, "$1")
    .replace(/(\S)\*(?=[\s.,!?:;)]|$)/gm, "$1")
    .replace(/(^|[\s(])_(?=\S)([^_\n]*\S)_(?=[\s.,!?:;)]|$)/gm, "$1$2")
    .replace(/`/g, "")
    .replace(/\|/g, " ")
    .replace(/^[ \t:-]+$/gm, "")
    .replace(/([\p{L}\p{M}])\u20B9/gu, "$1 \u20B9")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Final text of a reply. When the model ran out of tokens (finish_reason
 * "length") the text stops mid-word ("3. **Bajat"): cut back to the last
 * complete sentence or line when that keeps most of the reply.
 */
export function finalizeReply(content: string, truncated: boolean): string {
  let t = content;
  if (truncated) {
    // Drop the unfinished last line; with no usable line break, cut after
    // the last sentence end (a "3." list number is not a sentence end).
    const nl = t.lastIndexOf("\n");
    if (nl > t.length * 0.4) t = t.slice(0, nl);
    else {
      let cut = -1;
      for (const m of t.matchAll(/[!?\u0964\u0965]|(?<!\d)\./g)) cut = (m.index ?? -1) + 1;
      if (cut > t.length * 0.4) t = t.slice(0, cut);
    }
  }
  return stripMarkdown(t);
}
