const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function partsInZone(instant: Date, zone: string): Record<string, number> {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts: Record<string, number> = {};
  for (const part of fmt.formatToParts(instant)) {
    if (part.type !== "literal") {
      parts[part.type] = Number(part.value);
    }
  }
  if (parts.hour === 24) {
    parts.hour = 0;
  }
  return parts;
}

/**
 * The exclusive cutoff boundary for a deadline date D in a program zone is
 * 00:00:00 local time on the day after D.
 */
export function deadlineBoundary(date: string, zone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  let nextYear = y;
  let nextMonth = m;
  let nextDay = d + 1;
  if (d + 1 > daysInMonth(y, m)) {
    nextDay = 1;
    nextMonth = m === 12 ? 1 : m + 1;
    nextYear = m === 12 ? y + 1 : y;
  }
  return localInstant(nextYear, nextMonth, nextDay, 0, 0, 0, zone);
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Finds the UTC instant whose local wall clock in `zone` reads the given time. */
function localInstant(year: number, month: number, day: number, hour: number, minute: number, second: number, zone: string): Date {
  let guess = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 4; i++) {
    const offset = zoneOffsetMs(new Date(guess), zone);
    const candidate = Date.UTC(year, month - 1, day, hour, minute, second) - offset;
    if (candidate === guess) {
      break;
    }
    guess = candidate;
  }
  const result = new Date(guess);
  const parts = partsInZone(result, zone);
  const matched =
    parts.year === year && parts.month === month && parts.day === day &&
    parts.hour === hour && parts.minute === minute && parts.second === second;
  if (matched) {
    return result;
  }
  // Ambiguous or skipped local time: search the nearest wall-clock match.
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  let best = guess;
  let bestDiff = Infinity;
  for (let t = guess - 36 * 60 * 60 * 1000; t <= guess + 36 * 60 * 60 * 1000; t += 60 * 1000) {
    const p = partsInZone(new Date(t), zone);
    const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const diff = Math.abs(wall - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = t;
    }
  }
  return new Date(best);
}

export function zoneOffsetMs(instant: Date, zone: string): number {
  const parts = partsInZone(instant, zone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - instant.getTime();
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** "23:59 Asia/Kolkata, 31 Dec 2026" */
export function deadlineLabel(date: string, zone: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `23:59 ${zone}, ${d} ${MONTHS[m - 1]} ${y}`;
}

/** An ISO instant written with the program's offset, e.g. 2027-01-01T00:00:00+05:30. */
export function instantWithZone(instant: Date, zone: string): string {
  const parts = partsInZone(instant, zone);
  const offsetMinutes = Math.round(zoneOffsetMs(instant, zone) / 60_000);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const offset = `${sign}${pad(Math.floor(abs / 60), 2)}:${pad(abs % 60, 2)}`;
  return `${parts.year}-${pad(parts.month, 2)}-${pad(parts.day, 2)}T${pad(parts.hour, 2)}:${pad(parts.minute, 2)}:${pad(parts.second, 2)}${offset}`;
}

/** The embargo label: "13:05 Europe/Lisbon, 14 Mar 2026". */
export function embargoLabel(instant: Date, zone: string): string {
  const parts = partsInZone(instant, zone);
  return `${pad(parts.hour, 2)}:${pad(parts.minute, 2)} ${zone}, ${parts.day} ${MONTHS[parts.month - 1]} ${parts.year}`;
}

/** True while the window for date D is open: every instant before 00:00 the day after D. */
export function windowOpen(date: string, zone: string, now = new Date()): boolean {
  return now.getTime() < deadlineBoundary(date, zone).getTime();
}

export function isoDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** The date N days after a date in a zone, counted in that zone. */
export function addDaysInZone(date: string, zone: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const instant = localInstant(y, m, d, 12, 0, 0, zone);
  const shifted = new Date(instant.getTime() + days * 24 * 60 * 60 * 1000);
  const parts = partsInZone(shifted, zone);
  return `${parts.year}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`;
}
