// The one Europe/Zurich formatter (brief: Business rules › Dates and times). Every date and time a
// person sees, on any screen or in any email, is formatted here, whatever the device time zone.

export const HOUSE_TIME_ZONE = "Europe/Zurich";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: HOUSE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The Zurich wall-clock fields of an instant. */
export function zurichParts(instant: Date): LocalParts {
  const fields: Record<string, number> = {};
  for (const part of PARTS.formatToParts(instant)) {
    if (part.type !== "literal") fields[part.type] = Number(part.value);
  }
  return {
    year: fields.year ?? 0,
    month: fields.month ?? 0,
    day: fields.day ?? 0,
    hour: fields.hour ?? 0,
    minute: fields.minute ?? 0,
    second: fields.second ?? 0,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Weekday (0 = Sunday) of a calendar date, independent of any time zone. */
function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function dateLabel(year: number, month: number, day: number): string {
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

function slotLikeLabel(p: { year: number; month: number; day: number; hour: number; minute: number }): string {
  return `${WEEKDAYS[weekdayOf(p.year, p.month, p.day)]} ${dateLabel(p.year, p.month, p.day)}, ${pad(p.hour)}:${pad(p.minute)}`;
}

/** A date-only value ("2026-11-03") written as "3 Nov 2026", exactly the calendar day given. */
export function formatDay(day: string): string {
  const [year, month, date] = day.slice(0, 10).split("-").map(Number);
  return dateLabel(year ?? 0, month ?? 1, date ?? 1);
}

/** A timestamp's Zurich calendar date, written "3 Nov 2026". */
export function formatTimestampDay(timestamp: string | Date): string {
  const p = zurichParts(typeof timestamp === "string" ? new Date(timestamp) : timestamp);
  return dateLabel(p.year, p.month, p.day);
}

/** A timestamp's Zurich date and time, written "Tue 3 Nov 2026, 10:42" (the moment label). */
export function formatMoment(timestamp: string | Date): string {
  return slotLikeLabel(zurichParts(typeof timestamp === "string" ? new Date(timestamp) : timestamp));
}

/** A Zurich-local slot ("2026-11-03T10:30") written "Tue 3 Nov 2026, 10:30". */
export function formatSlot(slot: string): string {
  const [day, time] = slot.split("T");
  const [year, month, date] = (day ?? "").split("-").map(Number);
  const [hour, minute] = (time ?? "").split(":").map(Number);
  return slotLikeLabel({ year: year ?? 0, month: month ?? 1, day: date ?? 1, hour: hour ?? 0, minute: minute ?? 0 });
}

/** The Zurich calendar date of an instant as "YYYY-MM-DD". */
export function zurichDay(instant: Date): string {
  const p = zurichParts(instant);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** The instant at which the Zurich wall clock shows the given local date and time. */
export function zurichLocalToInstant(year: number, month: number, day: number, hour: number, minute: number): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let instant = wall;
  for (let i = 0; i < 3; i++) {
    const p = zurichParts(new Date(instant));
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const drift = shown - wall;
    if (drift === 0) break;
    instant -= drift;
  }
  return new Date(instant);
}

/** The Zurich-local slot string ("YYYY-MM-DDTHH:MM") of local fields. */
export function slotString(year: number, month: number, day: number, hour: number, minute: number): string {
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

/** Weekday (0 = Sunday) of a Zurich-local calendar date. */
export function localWeekday(year: number, month: number, day: number): number {
  return weekdayOf(year, month, day);
}
