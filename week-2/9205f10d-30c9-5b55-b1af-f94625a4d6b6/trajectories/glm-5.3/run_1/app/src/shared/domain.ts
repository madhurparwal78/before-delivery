export type Role = "coordinator" | "interpreter" | "client_scheduler" | "billing_admin";
export type Setting = "medical" | "education" | "legal";
export type CredentialCode = "NIC" | "CDI" | "SC:L" | "EIPA";
export type RequestStatus =
  | "draft"
  | "submitted"
  | "half_staffed"
  | "staffed"
  | "completed"
  | "invoiced"
  | "cancelled_early"
  | "cancelled_late";

export const AGENCY_TZ = "America/New_York" as const;
export const SETTINGS: readonly Setting[] = ["medical", "education", "legal"] as const;
export const CREDENTIALS: readonly CredentialCode[] = ["NIC", "CDI", "SC:L", "EIPA"] as const;
export const DEFAULT_CREDENTIAL: Record<Setting, CredentialCode> = {
  medical: "NIC",
  education: "EIPA",
  legal: "SC:L",
};

export function isSetting(v: unknown): v is Setting {
  return typeof v === "string" && (SETTINGS as readonly string[]).includes(v);
}
export function isCredentialCode(v: unknown): v is CredentialCode {
  return typeof v === "string" && (CREDENTIALS as readonly string[]).includes(v);
}

/* ------------------------------------------------------------------ money */

export type Money = { dollars: string };

export function centsToMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}${whole}.${rem.toString().padStart(2, "0")}`;
}

export function parseDollars(s: string): number | null {
  if (!/^-?\d+\.\d{2}$/.test(s)) return null;
  const m = /^(-?)(\d+)\.(\d{2})$/.exec(s);
  if (!m) return null;
  const [, sign, whole, frac] = m;
  const cents = Number(whole) * 100 + Number(frac);
  return sign === "-" ? -cents : cents;
}

/** The charge rule, computed in integer cents, rounded once half-up. */
export function chargeCents(minutes: number, hourlyCents: number, seats: number): number {
  const billable = billableMinutes(minutes);
  const exact = BigInt(billable) * BigInt(hourlyCents) * BigInt(seats);
  // divide by 60 with half-up rounding on the final amount only
  const q = exact / 60n;
  const r = exact % 60n;
  const rounded = r * 2n >= 60n ? q + 1n : q;
  return Number(rounded);
}

export function billableMinutes(minutes: number): number {
  if (minutes <= 120) return 120;
  return Math.ceil(minutes / 15) * 15;
}

/* ------------------------------------------------------------ agency time */

export type Wall = { y: number; m: number; d: number; hh: number; mm: number };

/** Parse "YYYY-MM-DDTHH:MM" as an agency wall-clock time; reject skipped hours, pick first occurrence of repeated ones. */
export function wallToInstant(input: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(input);
  if (!m) return null;
  const [, ys, ms, ds, hs, mins] = m;
  const y = Number(ys), mo = Number(ms), d = Number(ds), hh = Number(hs), mi = Number(mins);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mi > 59) return null;
  const got = firstOccurrence(y, mo - 1, d, hh, mi);
  return got === "" ? null : got;
}

function offsetIso(dt: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: AGENCY_TZ, timeZoneName: "longOffset" })
    .formatToParts(dt);
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (m) {
    const [, sign, hh, mm] = m;
    const core = `${sign}${hh}:${mm}`;
    return core === "-00:00" ? "+00:00" : core;
  }
  return name;
}

export function instantInAgency(dt: Date): string {
  const shifted = new Date(dt.getTime() + tzOffsetMinutes(dt) * 60_000);
  const trimmed = shifted.toISOString().replace(/\.\d{3}Z$/, "").replace(/Z$/, "");
  return `${trimmed}${offsetIso(dt)}`;
}

export function tzOffsetMinutes(dt: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: AGENCY_TZ, timeZoneName: "longOffset" })
    .formatToParts(dt);
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-05:00";
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!m) return 0;
  const [, sign, hh, mm] = m;
  const v = Number(hh) * 60 + Number(mm);
  return sign === "-" ? -v : v;
}

export function agencyDateKey(dt: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: AGENCY_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(dt);
}

/** Free-cancellation cutoff: local start time on the calendar day two days before the start date, in agency time. */
export function cancellationCutoff(startInstant: string): string {
  const start = new Date(startInstant);
  const startDate = agencyDateKey(start);
  const [ys, ms, ds] = startDate.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  const [hh, mm] = agencyClock(start);
  return firstOccurrence(y, m - 1, d - 2, hh, mm);
}

/** The earliest UTC instant that reads as the given agency local wall-clock time, or "" when that time never happens. */
function firstOccurrence(y: number, mo0: number, d: number, hh: number, mi: number): string {
  // Iterate candidate UTC instants around the wall-clock time, pick the earliest one
  // that maps back to this local time. Local wall times sort by UTC offset, so the
  // first occurrence is the one with the smaller UTC instant.
  const approx = Date.UTC(y, mo0, d, hh, mi);
  let best: number | null = null;
  for (let delta = -6; delta <= 6; delta++) {
    const t = approx + delta * 3600_000;
    const dt = new Date(t);
    if (agencyDateKey(dt) !== dateKey(y, mo0, d)) continue;
    const [ch, cm] = agencyClock(dt);
    if (ch === hh && cm === mi && (best === null || t < best)) best = t;
  }
  if (best === null) return "";
  return instantInAgency(new Date(best));
}

function dateKey(y: number, mo0: number, d: number): string {
  return `${y}-${String(mo0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function agencyClock(dt: Date): [number, number] {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: AGENCY_TZ, hour12: false, hour: "2-digit", minute: "2-digit" }).formatToParts(dt);
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const mi = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return [hh, mi];
}

export function weekMonday(instant: string): string {
  const dt = new Date(instant);
  const dateKey = agencyDateKey(dt);
  const [ys, ms, ds] = dateKey.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  const utc = Date.UTC(y, m - 1, d) + 12 * 3600_000;
  const wd = new Date(utc).getUTCDay(); // 0 Sun..6 Sat
  const back = wd === 0 ? 6 : wd - 1;
  const monday = new Date(utc - back * 86_400_000);
  return agencyDateKey(new Date(monday.getTime() + 12 * 3600_000));
}

export function isCredentialValidOn(expiresOn: string, dayKey: string): boolean {
  return expiresOn >= dayKey;
}

/* ------------------------------------------------------- rotation segments */

export type Segment = { index: number; start: number; end: number; active: "A" | "B" };

export function segments(lengthMinutes: number, rotationMinutes: number, seats: 1 | 2): Segment[] {
  const count = Math.ceil(lengthMinutes / rotationMinutes);
  const out: Segment[] = [];
  for (let k = 0; k < count; k++) {
    const start = k * rotationMinutes;
    const end = Math.min((k + 1) * rotationMinutes, lengthMinutes);
    const active = seats === 2 ? (k % 2 === 0 ? "A" : "B") : "A";
    out.push({ index: k, start, end, active });
  }
  return out;
}

export function segmentIndexAt(minute: number, lengthMinutes: number, rotationMinutes: number): number {
  const last = Math.max(0, Math.ceil(lengthMinutes / rotationMinutes) - 1);
  return Math.min(Math.floor(minute / rotationMinutes), last);
}

/* ---------------------------------------------------------- team size rule */

export function defaultTeamSize(durationMinutes: number): 1 | 2 {
  return durationMinutes > 60 ? 2 : 1;
}

export function derivedStatus(confirmed: number, seats: number): RequestStatus {
  if (seats === 0) return "submitted";
  if (confirmed === 0) return "submitted";
  if (confirmed < seats) return "half_staffed";
  return "staffed";
}

export function windowsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}
