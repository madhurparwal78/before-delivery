// Workspace wall-clock time (brief: Business rules › Snooze time).

const HOUR = 3_600_000;

/** The zone's UTC offset in milliseconds at an instant. */
function offsetAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant of a local "YYYY-MM-DDTHH:MM" in `timeZone`. A time skipped by a daylight-saving jump moves
 * forward by the jump; a time that occurs twice uses the first occurrence. Null when the text is not a real time.
 */
export function localToInstant(local: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(wall);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59) {
    return null;
  }
  const before = offsetAt(wall - 24 * HOUR, timeZone);
  const after = offsetAt(wall + 24 * HOUR, timeZone);
  const candidates = [...new Set([before, after])]
    .map((offset) => wall - offset)
    .filter((instant) => offsetAt(instant, timeZone) === wall - instant)
    .sort((a, b) => a - b);
  return new Date(candidates[0] ?? wall - before);
}
