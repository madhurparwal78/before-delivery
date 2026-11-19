const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const LABEL_MAX = 60;
const MARKER_NAME = "[\\p{L}\\p{N}_-]+";
const TAG_PATTERN = new RegExp(`(?:^|\\s)#(${MARKER_NAME})`, "gu");
const MENTION_PATTERN = new RegExp(`(?:^|\\s)@(${MARKER_NAME})`, "gu");
const DATE_TOKEN = /!\(([^()]*)\)/g;

export function bulletLabel(text: string): string {
  const trimmed = text.trim();
  return trimmed === "" ? "Untitled" : Array.from(trimmed).slice(0, LABEL_MAX).join("");
}

function markers(text: string, pattern: RegExp): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const name = (match[1] ?? "").toLowerCase();
    if (!found.includes(name)) found.push(name);
  }
  return found;
}

export const tagsOf = (text: string): string[] => markers(text, TAG_PATTERN);
export const mentionsOf = (text: string): string[] => markers(text, MENTION_PATTERN);

function isoOf(year: number, month: number, day: number): string | null {
  const stamp = new Date(Date.UTC(year, month - 1, day));
  const real = stamp.getUTCFullYear() === year && stamp.getUTCMonth() === month - 1 && stamp.getUTCDate() === day;
  if (!real || year < 1 || year > 9999) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(iso: string, days: number): string {
  const stamp = new Date(`${iso}T00:00:00Z`);
  stamp.setUTCDate(stamp.getUTCDate() + days);
  return stamp.toISOString().slice(0, 10);
}

function nextOccurrence(month: number, day: number, today: string): string | null {
  const thisYear = Number(today.slice(0, 4));
  for (let year = thisYear; year <= thisYear + 8; year += 1) {
    const candidate = isoOf(year, month, day);
    if (candidate !== null && candidate >= today) return candidate;
  }
  return null;
}

function parseDateWords(words: string, today: string): string | null {
  const lowered = words.trim().toLowerCase();
  if (lowered === "today") return today;
  if (lowered === "tomorrow") return addDays(today, 1);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(lowered);
  if (iso) return isoOf(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const full = /^(\d{1,2}) ([a-z]{3}) (\d{4})$/.exec(lowered);
  if (full) {
    const month = MONTHS.indexOf(full[2] as (typeof MONTHS)[number]);
    return month < 0 ? null : isoOf(Number(full[3]), month + 1, Number(full[1]));
  }
  const short = /^([a-z]{3}) (\d{1,2})$/.exec(lowered);
  if (short) {
    const month = MONTHS.indexOf(short[1] as (typeof MONTHS)[number]);
    return month < 0 ? null : nextOccurrence(month + 1, Number(short[2]), today);
  }
  return null;
}

interface RecognizedDate {
  text: string;
  date: string | null;
}

/** The one place a date token is recognised: the first recognised `!(…)` becomes `!(YYYY-MM-DD)`. */
export function recognizeDate(text: string, today: string): RecognizedDate {
  for (const token of text.matchAll(DATE_TOKEN)) {
    const date = parseDateWords(token[1] ?? "", today);
    if (date !== null && token.index !== undefined) {
      const rewritten = text.slice(0, token.index) + `!(${date})` + text.slice(token.index + token[0].length);
      return { text: rewritten, date };
    }
  }
  return { text, date: null };
}

export function displayDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTH_LABELS[(month ?? 1) - 1]} ${year}`;
}

export function todayIn(zone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

export function characterCount(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}
