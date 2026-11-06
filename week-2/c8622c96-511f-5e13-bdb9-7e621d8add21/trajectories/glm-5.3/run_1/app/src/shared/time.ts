// Co-op time: wall times, display formats, window ends and hold deadlines.
// The co-op zone is America/Chicago; the browser zone and clock are never used.
import { Temporal } from "@js-temporal/polyfill";

export const COOP_ZONE = "America/Chicago";

export type LiftResolution = "exact" | "first_occurrence" | "shifted_after_gap";

export interface ResolvedLift {
  instant: string; // UTC ISO 8601 with Z, whole seconds
  resolution: LiftResolution;
}

// A wall time that occurs twice resolves to its first occurrence;
// one that does not exist resolves to the first valid minute after the gap.
export function resolveLiftLocal(local: string): ResolvedLift | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  try {
    const dt = new Temporal.PlainDateTime(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
    const earlier = dt.toZonedDateTime(COOP_ZONE, { disambiguation: "earlier" });
    const later = dt.toZonedDateTime(COOP_ZONE, { disambiguation: "later" });
    const compatible = dt.toZonedDateTime(COOP_ZONE, { disambiguation: "compatible" });
    if (compatible.toPlainDateTime().equals(dt)) {
      // The wall time exists: either once, or twice on the repeated hour.
      if (earlier.equals(later)) {
        return { instant: isoFromEpoch(Number(compatible.epochMilliseconds)), resolution: "exact" };
      }
      // The repeated hour: the first occurrence.
      return { instant: isoFromEpoch(Number(earlier.epochMilliseconds)), resolution: "first_occurrence" };
    }
    // The spring-forward gap: the first valid minute after the gap.
    for (let i = 1; i <= 180; i++) {
      const candidate = dt.add({ minutes: i });
      const candidateZoned = candidate.toZonedDateTime(COOP_ZONE, { disambiguation: "compatible" });
      if (candidateZoned.toPlainDateTime().equals(candidate)) {
        return { instant: isoFromEpoch(Number(candidateZoned.epochMilliseconds)), resolution: "shifted_after_gap" };
      }
    }
    return { instant: isoFromEpoch(Number(compatible.epochMilliseconds)), resolution: "shifted_after_gap" };
  } catch {
    return null;
  }
}

export function isoInstant(epochMs: number): string {
  return new Date(epochMs).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function isoFromEpoch(epochMs: number): string {
  return isoInstant(epochMs);
}

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: COOP_ZONE,
  weekday: "short",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZoneName: "shortOffset",
});

const fmtDate = new Intl.DateTimeFormat("en-US", {
  timeZone: COOP_ZONE,
  weekday: "short",
  year: "numeric",
  month: "short",
  day: "numeric",
});

const fmtDateNumeric = new Intl.DateTimeFormat("en-CA", {
  timeZone: COOP_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function tzOffsetMinutes(epochMs: number): number {
  const parts = fmt.formatToParts(new Date(epochMs));
  const tz = parts.find((p) => p.type === "timeZoneName");
  const value = tz ? tz.value : "GMT-6";
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(value);
  if (!m) return -360;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

export function zoneAbbrev(epochMs: number): string {
  return tzOffsetMinutes(epochMs) === -360 ? "CST" : "CDT";
}

// <co-op time>: "Sun 1 Nov 2026 · 01:30 CDT"
export function formatCoopTime(epochMs: number): string {
  const parts = fmt.formatToParts(new Date(epochMs));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("weekday")} ${Number(get("day"))} ${get("month")} ${get("year")} · ${hour}:${get("minute")} ${zoneAbbrev(epochMs)}`;
}

// <co-op date>: "Mon 2 Nov 2026"
export function formatCoopDate(epochMs: number): string {
  const parts = fmtDate.formatToParts(new Date(epochMs));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")} ${Number(get("day"))} ${get("month")} ${get("year")}`;
}

const MONTHS_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// <month>: "November 2026"
export function formatMonthName(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  return `${MONTHS_FULL[Number(m[2]) - 1]} ${m[1]}`;
}

// UTC instant for a co-op wall date at midnight.
export function coopMidnight(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  try {
    const d = new Temporal.PlainDate(Number(m[1]), Number(m[2]), Number(m[3]));
    return Number(d.toZonedDateTime(COOP_ZONE).epochMilliseconds);
  } catch {
    return null;
  }
}

// The co-op date (YYYY-MM-DD) an instant falls on.
export function coopDateOf(epochMs: number): string {
  const parts = fmtDateNumeric.formatToParts(new Date(epochMs));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDays(date: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const d = new Temporal.PlainDate(Number(m[1]), Number(m[2]), Number(m[3])).add({ days });
  return `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

// The end instant of a licence window: it runs through date D and ends at
// co-op midnight on the day after D, where D is the co-op date of whichever is
// later, the confirmation or the embargo lift, plus (days - 1).
export function windowEnd(confirmedAtMs: number, liftAtMs: number, days: number): number {
  const baseDate = coopDateOf(Math.max(confirmedAtMs, liftAtMs));
  const throughDate = addDays(baseDate, days - 1);
  return coopMidnight(throughDate)! + 86400000;
}

// A pending licence's hold deadline: the earlier of confirmation plus 30
// minutes of server clock, or its window end.
export function holdDeadline(confirmedAtMs: number, windowEndMs: number): number {
  return Math.min(confirmedAtMs + 30 * 60 * 1000, windowEndMs);
}

// Statement month bounds: co-op midnights. Returns [startMs, endMs).
export function monthBounds(month: string): [number, number] | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const start = coopMidnight(`${y}-${String(mo).padStart(2, "0")}-01`);
  if (start === null) return null;
  const nextY = mo === 12 ? y + 1 : y;
  const nextM = mo === 12 ? 1 : mo + 1;
  const end = coopMidnight(`${nextY}-${String(nextM).padStart(2, "0")}-01`);
  if (end === null) return null;
  return [start, end];
}

// The rate in force at an instant: the latest rate whose effective_from date's
// 00:00 co-op time is at or before the instant.
export function rateEffectiveFromAt(
  rates: { effective_from: string; rate_bp: number }[],
  epochMs: number,
): { effective_from: string; rate_bp: number } | null {
  let best: { effective_from: string; rate_bp: number } | null = null;
  for (const r of rates) {
    const midnight = coopMidnight(r.effective_from);
    if (midnight !== null && midnight <= epochMs) {
      if (!best || r.effective_from > best.effective_from) best = r;
    }
  }
  return best;
}

// Exact royalty split: commission floor(A*r/10000); each contributor
// floor(P*split/10000); leftover cents go one each to the largest fractional
// remainders, ties broken by credit position.
export interface SplitShare {
  handle: string;
  position: number;
  split_bp: number;
  amount_minor: number;
}

export function royaltySplit(
  amountMinor: number,
  rateBp: number,
  credits: { handle: string; position: number; split_bp: number }[],
): { commission_minor: number; shares: SplitShare[] } {
  const commission = Math.floor((amountMinor * rateBp) / 10000);
  const pool = amountMinor - commission;
  const base = credits.map((c) => {
    const exact = (pool * c.split_bp) / 10000;
    return { ...c, amount_minor: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  const sum = base.reduce((acc, b) => acc + b.amount_minor, 0);
  let leftover = pool - sum;
  const byRemainder = [...base].sort((a, b) => b.remainder - a.remainder || a.position - b.position);
  let idx = 0;
  while (leftover > 0 && byRemainder.length > 0) {
    byRemainder[idx % byRemainder.length].amount_minor += 1;
    leftover -= 1;
    idx += 1;
  }
  return {
    commission_minor: commission,
    shares: base.map((b) => ({ handle: b.handle, position: b.position, split_bp: b.split_bp, amount_minor: b.amount_minor })),
  };
}

// Cents to a billing amount: exact, written with two decimals.
export function centsToDollars(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function dollarsWithCommas(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, "0");
  return `${sign}$${whole.toLocaleString("en-US")}.${cents}`;
}

export function bpToPercent(bp: number): string {
  const sign = bp < 0 ? "-" : "";
  const abs = Math.abs(bp);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

// Neutralise any export cell that begins with a formula character.
export function neutraliseCell(value: string): string {
  const first = value.charAt(0);
  if (first === "=" || first === "+" || first === "-" || first === "@" || first === "\t" || first === "\r") {
    return `'${value}`;
  }
  return value;
}

// RFC 4180 CSV quoting.
export function csvQuote(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function csvCell(value: string): string {
  return csvQuote(neutraliseCell(value));
}
