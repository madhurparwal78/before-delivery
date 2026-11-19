export type ShopTimezone = "Europe/Lisbon" | "Atlantic/Azores";

export interface DayEntry {
  weekday: number;
  open: boolean;
  opens: string | null;
  closes: string | null;
}

export interface HoursPlan {
  effective_from: string;
  days: DayEntry[];
}

export interface Slot {
  start_local: string;
  start_utc: string;
  utc_offset: string;
  remaining: number;
}

export interface LocalDayPlan {
  open: boolean;
  opens_local: string | null;
  closes_local: string | null;
  opens_utc: string | null;
  closes_utc: string | null;
}

function offsetMinutes(timezone: ShopTimezone, utcDate: Date): number {
  const parts = utcDate.toLocaleString("en-GB", { timeZone: timezone, hour12: false });
  const [datePart, timePart] = parts.split(", ");
  void datePart;
  const [hour, minute, second] = timePart.split(":");
  const utc = utcDate.toISOString();
  const utcMinutes = Number(utc.slice(11, 13)) * 60 + Number(utc.slice(14, 16)) + Number(utc.slice(17, 19)) / 60;
  const localMinutes = Number(hour) * 60 + Number(minute) + Number(second) / 60;
  let diff = localMinutes - utcMinutes;
  if (diff > 720) diff -= 1440;
  if (diff < -720) diff += 1440;
  return Math.round(diff);
}

export function offsetString(offset: number): string {
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

export function utcOffsetString(timezone: ShopTimezone, utcDate: Date): string {
  return offsetString(offsetMinutes(timezone, utcDate));
}

export function localDateInZone(timezone: ShopTimezone, at: Date): string {
  return at.toLocaleDateString("en-CA", { timeZone: timezone });
}

export function localTimeInZone(timezone: ShopTimezone, at: Date): string {
  return at.toLocaleTimeString("en-GB", { timeZone: timezone, hour12: false });
}

export function weekdayOfLocalDate(localDate: string): number {
  const [year, month, day] = localDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day, 12));
  const jsDay = utc.getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

export function addDaysToLocalDate(localDate: string, days: number): string {
  const [year, month, day] = localDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day, 12) + days * 86400000);
  return utc.toISOString().slice(0, 10);
}

export function compareLocalDates(a: string, b: string): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

function parseHHMM(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

export function formatHHMM(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function localToUtcWithOffset(localDate: string, hhmm: string, offset: number): Date {
  const [year, month, day] = localDate.split("-").map(Number);
  const [hour, minute] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - offset * 60000);
}

export function offsetCandidates(timezone: ShopTimezone, localDate: string, hhmm: string): { offset: number; utc: Date }[] {
  const result: { offset: number; utc: Date }[] = [];
  const offsets = [60, 0, -60];
  for (const offset of offsets) {
    const utc = localToUtcWithOffset(localDate, hhmm, offset);
    if (offsetMinutes(timezone, utc) === offset) {
      const shifted = new Date(utc.getTime() + offset * 60000);
      if (shifted.toISOString().slice(0, 10) === localDate && shifted.toISOString().slice(11, 16) === hhmm) {
        result.push({ offset, utc });
      }
    }
  }
  return result.sort((a, b) => a.utc.getTime() - b.utc.getTime());
}

export function firstOccurrenceUtc(timezone: ShopTimezone, localDate: string, hhmm: string): { offset: number; utc: Date } | null {
  const candidates = offsetCandidates(timezone, localDate, hhmm);
  return candidates.length > 0 ? candidates[0] : null;
}

export function slotStartsForPlan(opens: string, closes: string): number[] {
  const startMinutes = parseHHMM(opens);
  const closeMinutes = parseHHMM(closes);
  const result: number[] = [];
  for (let m = startMinutes; m + 30 <= closeMinutes; m += 30) {
    result.push(m);
  }
  return result;
}

export function localSlotsForDate(timezone: ShopTimezone, localDate: string, plan: DayEntry): { minute: number; utc: Date; offset: number }[] {
  if (!plan.open || plan.opens === null || plan.closes === null) return [];
  const slots: { minute: number; utc: Date; offset: number }[] = [];
  for (const minute of slotStartsForPlan(plan.opens, plan.closes)) {
    const hhmm = formatHHMM(minute);
    const candidate = firstOccurrenceUtc(timezone, localDate, hhmm);
    if (candidate) slots.push({ minute, utc: candidate.utc, offset: candidate.offset });
  }
  return slots;
}

export function dayPlanFrame(timezone: ShopTimezone, localDate: string, plan: DayEntry): LocalDayPlan {
  if (!plan.open || plan.opens === null || plan.closes === null) {
    return { open: false, opens_local: null, closes_local: null, opens_utc: null, closes_utc: null };
  }
  const opens = firstOccurrenceUtc(timezone, localDate, plan.opens);
  const closes = firstOccurrenceUtc(timezone, localDate, plan.closes);
  return {
    open: true,
    opens_local: plan.opens,
    closes_local: plan.closes,
    opens_utc: opens ? opens.utc.toISOString() : null,
    closes_utc: closes ? closes.utc.toISOString() : null,
  };
}

export function planForDate(current: HoursPlan | null, upcoming: HoursPlan | null, localDate: string): DayEntry | null {
  const weekday = weekdayOfLocalDate(localDate);
  if (upcoming && upcoming.effective_from <= localDate) {
    return upcoming.days.find((d) => d.weekday === weekday) ?? null;
  }
  if (current) {
    return current.days.find((d) => d.weekday === weekday) ?? null;
  }
  return null;
}

export function parseTimeOnHalfHour(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  const minute = Number(match[2]);
  if (minute !== 0 && minute !== 30) return null;
  return value;
}

export function minutesSinceMidnightLocal(timezone: ShopTimezone, now: Date): number {
  const time = localTimeInZone(timezone, now);
  const [hour, minute, second] = time.split(":").map(Number);
  return hour * 60 + minute + (second ?? 0) / 60;
}
