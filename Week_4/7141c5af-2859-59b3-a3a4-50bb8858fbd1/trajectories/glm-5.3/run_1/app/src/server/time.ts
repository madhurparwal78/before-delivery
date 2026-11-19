export type Town = "Turin" | "London" | "New York" | "Kyoto" | "Dubai";

export const townZone: Record<Town, string> = {
  Turin: "Europe/Rome",
  London: "Europe/London",
  "New York": "America/New_York",
  Kyoto: "Asia/Tokyo",
  Dubai: "Asia/Dubai",
};
export const townCurrency: Record<Town, "EUR" | "GBP" | "USD" | "JPY" | "AED"> = {
  Turin: "EUR", London: "GBP", "New York": "USD", Kyoto: "JPY", Dubai: "AED",
};
export const townCountry: Record<Town, string> = {
  Turin: "IT", London: "GB", "New York": "US", Kyoto: "JP", Dubai: "AE",
};
export const townTaxPercent: Record<Town, number> = { Turin: 22, London: 20, "New York": 0, Kyoto: 0, Dubai: 0 };
export const townLanguage: Record<Town, "it" | "en" | "ja" | "ar"> = {
  Turin: "it", London: "en", "New York": "en", Kyoto: "ja", Dubai: "ar",
};
export const towns: Town[] = ["Turin", "London", "New York", "Kyoto", "Dubai"];

const OFFSETS_TURIN_2027 = { dstStart: "2027-03-28", dstEnd: "2027-10-31" };
void OFFSETS_TURIN_2027;

const longDayEn = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const shortDayEn = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const shortMonthEn = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDayIt = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
const shortMonthIt = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const dayJp = ["日", "月", "火", "水", "木", "金", "土"];
const dayAr = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const monthAr = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

export const pad2 = (n: number) => String(n).padStart(2, "0");


/** Format an instant as the local date in a zone. */
export function localDateParts(at: Date, zone: string): { y: number; m: number; d: number } {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = dtf.formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}
export const localDate = (at: Date, zone: string) => {
  const p = localDateParts(at, zone);
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
};
export const localTimeHM = (at: Date, zone: string) => {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour12: false, hour: "2-digit", minute: "2-digit" });
  const parts = dtf.formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return `${pad2(get("hour") % 24)}:${pad2(get("minute"))}`;
};
export const localWeekday = (at: Date, zone: string): number => {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short" });
  const w = dtf.format(at);
  return shortDayEn.findIndex((d) => d === w);
};

export const zoneOffset = (zone: string, ms: number): number => {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const parts = dtf.formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUTC - ms;
};

/** Turn a local wall date+time in a zone into a UTC instant; null when that wall time does not exist. */
export function wallTimeToInstant(zone: string, date: string, time: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!m || !t) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [h, mi] = [Number(t[1]), Number(t[2])];
  const sec = t[3] ? Number(t[3]) : 0;
  const wanted = `${pad2(h)}:${pad2(mi)}`;
  const naive = Date.UTC(y, mo - 1, d, h, mi, sec);
  // Candidate offsets from several sample points around that day.
  const samples = [-26 * 3600_000, -13 * 3600_000, 0, 13 * 3600_000, 26 * 3600_000].map((o) => zoneOffset(zone, naive + o));
  const candidates = new Set<number>();
  for (const off of samples) candidates.add(off);
  const found: Date[] = [];
  for (const off of candidates) {
    const at = new Date(naive - off);
    const backDate = localDate(at, zone);
    const backTime = localTimeHM(at, zone);
    if (backDate === date && backTime === wanted) found.push(at);
  }
  found.sort((a, b) => a.getTime() - b.getTime());
  return found.length ? found[0]! : null;
}
/** For a repeated wall time, the earlier instant. */
export const firstInstant = wallTimeToInstant;

export const dateOnly = (s: string | null | undefined): string | null => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
export const isoZ = (at: Date) => `${at.toISOString().slice(0, 19)}Z`;
export const isoDate = (d: string) => `${d}T00:00:00Z`;

/** Add n days to a YYYY-MM-DD (no zone arithmetic). */
export function addDaysISO(d: string, n: number): string {
  const [y, m, dd] = d.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, dd + n));
  return `${at.getUTCFullYear()}-${pad2(at.getUTCMonth() + 1)}-${pad2(at.getUTCDate())}`;
}
export const dayOfWeekISO = (d: string): number => new Date(`${d}T00:00:00Z`).getUTCDay();
export const mondayOfISO = (d: string): string => {
  const dow = dayOfWeekISO(d);
  return addDaysISO(d, dow === 0 ? -6 : 1 - dow);
};
/** The instant 23:59:59 Turin wall time on a date. */
export function endOfDayTurin(date: string): Date {
  const at = wallTimeToInstant("Europe/Rome", date, "23:59:59");
  return at ?? new Date(`${date}T22:59:59Z`);
}
/** Instant at Turin 00:00 on a date. */
export function startOfDayTurin(date: string): Date {
  return wallTimeToInstant("Europe/Rome", date, "00:00")!;
}
/** 09:00 Turin on a date (bench day start). */
export function benchDayStartTurin(date: string): Date {
  return wallTimeToInstant("Europe/Rome", date, "09:00")!;
}

export function fmtDateEn(at: Date | string, zone: string): string {
  const d = typeof at === "string" ? new Date(isoDate(dateOnly(at) ?? at)) : at;
  const p = localDateParts(d, zone);
  const wd = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return `${shortDayEn[wd]} ${p.d} ${shortMonthEn[p.m - 1]} ${p.y}`;
}
export function fmtDateIt(at: Date, zone: string): string {
  const p = localDateParts(at, zone);
  const wd = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return `${shortDayIt[wd]} ${p.d} ${shortMonthIt[p.m - 1]} ${p.y}`;
}
export function fmtDateJp(at: Date, zone: string): string {
  const p = localDateParts(at, zone);
  const wd = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return `${p.y}年${p.m}月${p.d}日(${dayJp[wd]})`;
}
export function fmtDateAr(at: Date, zone: string): string {
  const p = localDateParts(at, zone);
  const wd = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return `${dayAr[wd]} ${p.d} ${monthAr[p.m - 1]} ${p.y}`;
}
export const fmtDateByLang: Record<string, (at: Date, zone: string) => string> = {
  en: fmtDateEn, it: fmtDateIt, ja: fmtDateJp, ar: fmtDateAr,
};
export const fmtDateFromISOByLang: Record<string, (date: string, zone: string) => string> = {
  en: (date, zone) => fmtDateEn(new Date(isoDate(date)), zone),
  it: (date, zone) => fmtDateIt(new Date(isoDate(date)), zone),
  ja: (date, zone) => fmtDateJp(new Date(isoDate(date)), zone),
  ar: (date, zone) => fmtDateAr(new Date(isoDate(date)), zone),
};

export function fmtDateTimeTurin(at: Date): string {
  return `${fmtDateEn(at, "Europe/Rome")}, ${localTimeHM(at, "Europe/Rome")} Turin time`;
}
/** <minute> placeholder: whole minutes rounded up, Turin. */
export function fmtMinuteTurin(at: Date): string {
  const ms = at.getTime();
  const up = new Date(ms % 60000 === 0 ? ms : ms + (60000 - (ms % 60000)));
  return localTimeHM(up, "Europe/Rome");
}
