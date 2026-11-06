// Kestrel Works business time: every day is a Europe/London date, every claimed time a London wall-clock time,
// every stored or answered instant UTC. This module is the only place those conversions are made.

export const TIME_ZONE = "Europe/London";

const DAY_MS = 86_400_000;
const wallClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function local(ms) {
  const p = Object.fromEntries(wallClock.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, clock: `${p.hour}:${p.minute}` };
}

function utcOf(day, clock = "00:00") {
  const [y, m, d] = day.split("-").map(Number);
  const [h, min] = clock.split(":").map(Number);
  return Date.UTC(y, m - 1, d, h, min);
}

function offsetMinutes(ms) {
  const { day, clock } = local(ms);
  return Math.round((utcOf(day, clock) - Math.floor(ms / 60_000) * 60_000) / 60_000);
}

/** The UTC instant (ms) of a London wall-clock time on a business date; the earlier one when it occurs twice,
 * null when the clocks skip it. */
export function instantOf(day, clock) {
  const naive = utcOf(day, clock);
  const candidates = [...new Set([offsetMinutes(naive - DAY_MS), offsetMinutes(naive + DAY_MS)])]
    .map((offset) => naive - offset * 60_000)
    .filter((ms) => {
      const seen = local(ms);
      return seen.day === day && seen.clock === clock;
    });
  return candidates.length ? Math.min(...candidates) : null;
}

/** The business date of an instant. */
export function businessDate(instant) {
  return local(new Date(instant).getTime()).day;
}

/** The London wall-clock `HH:MM` of an instant. */
export function clockOf(instant) {
  return local(new Date(instant).getTime()).clock;
}

/** Today's business date, never the server's own zone or the UTC date. */
export function businessToday() {
  return businessDate(Date.now());
}

/** A timestamp as the API writes it: UTC to the whole second, ending in Z. */
export function stamp(instant) {
  return instant == null ? null : new Date(instant).toISOString().slice(0, 19) + "Z";
}

export function addDays(day, count) {
  return new Date(utcOf(day) + count * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from, to) {
  return Math.round((utcOf(to) - utcOf(from)) / DAY_MS);
}

export function isRealDay(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && addDays(value, 0) === value;
}

export function isRealMonth(value) {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value) && isRealDay(`${value}-01`);
}

export function monthOf(day) {
  return day.slice(0, 7);
}

/** Every business date of a `YYYY-MM` month, in order. */
export function daysOfMonth(month) {
  const days = [];
  for (let day = `${month}-01`; monthOf(day) === month; day = addDays(day, 1)) days.push(day);
  return days;
}
