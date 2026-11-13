// ISO 8601 handling shared by both sides: parse, format, and the published relative dates.
const ISO_WITH_ZONE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;
const ISO_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const RELATIVE = /^now(?:-(\d+)([smhdw]))?$/;

export const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

function checkedUtc(year: number, month: number, day: number, hour: number, minute: number, second: number): number | null {
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const back = new Date(ms);
  return back.getUTCFullYear() === year && back.getUTCMonth() === month - 1 && back.getUTCDate() === day ? ms : null;
}

/** An ISO 8601 string with a time and a zone, as epoch milliseconds; null when it is anything else. */
export function parseIsoInstant(text: string): number | null {
  const match = ISO_WITH_ZONE.exec(text);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, fraction, zone] = match;
  const base = checkedUtc(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s));
  if (base === null || zone === undefined) return null;
  const ms = fraction ? Number(fraction.padEnd(3, "0").slice(0, 3)) : 0;
  let offset = 0;
  if (zone !== "Z") {
    const sign = zone.startsWith("-") ? -1 : 1;
    offset = sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6))) * 60_000;
  }
  return base + ms - offset;
}

/** An ISO date (with or without a time) or a relative date measured from `nowMs`. */
export function parseQueryDate(text: string, nowMs: number): number | null {
  const relative = RELATIVE.exec(text);
  if (relative) return relative[1] === undefined ? nowMs : nowMs - Number(relative[1]) * (UNIT_MS[relative[2] ?? "s"] ?? 0);
  const dateOnly = ISO_DATE_ONLY.exec(text);
  if (dateOnly) return checkedUtc(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]), 0, 0, 0);
  return parseIsoInstant(text);
}

export function formatIso(ms: number): string {
  return new Date(ms).toISOString();
}
