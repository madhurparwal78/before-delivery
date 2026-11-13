import { TIME_ZONE } from "../shared/format.js";

const wallClock = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** How far Pacific wall-clock time is from UTC at an instant, in ms. */
function offsetAt(instant: number): number {
  const parts = Object.fromEntries(wallClock.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** A typed "YYYY-MM-DD HH:MM" Pacific time as an ISO instant; null when it is not that shape. */
export function pacificToInstant(text: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const settled = wall - offsetAt(wall - offsetAt(wall));
  const probe = new Date(settled);
  return Number.isNaN(probe.getTime()) ? null : probe.toISOString();
}
