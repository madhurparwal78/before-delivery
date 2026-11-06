// UTC timestamps as whole epoch seconds, and their published text forms.

export const HALF_HOUR = 1800;
export const DAY = 86_400;

/** The server clock, truncated to whole seconds. */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

function parts(epoch: number) {
  const d = new Date(epoch * 1000);
  return {
    y: pad(d.getUTCFullYear(), 4), mo: pad(d.getUTCMonth() + 1), d: pad(d.getUTCDate()),
    h: pad(d.getUTCHours()), mi: pad(d.getUTCMinutes()), s: pad(d.getUTCSeconds()),
  };
}

/** `YYYY-MM-DDTHH:MM:SSZ`, the API and email form. */
export function isoTimestamp(epoch: number): string {
  const p = parts(epoch);
  return `${p.y}-${p.mo}-${p.d}T${p.h}:${p.mi}:${p.s}Z`;
}

/** `YYYYMMDDHHMM`, the canonical readings file form. */
export function compactStamp(epoch: number): string {
  const p = parts(epoch);
  return `${p.y}${p.mo}${p.d}${p.h}${p.mi}`;
}

/** `YYYY-MM-DD` of the UTC day holding the instant. */
export function utcDate(epoch: number): string {
  return isoTimestamp(epoch).slice(0, 10);
}

/** Parses exactly `YYYY-MM-DDTHH:MM:SSZ` naming a real instant; anything else is null. */
export function parseTimestamp(text: unknown): number | null {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(text)) return null;
  const epoch = Date.parse(text) / 1000;
  return Number.isInteger(epoch) && isoTimestamp(epoch) === text ? epoch : null;
}

/** Parses exactly `YYYY-MM-DD` naming a real day; returns its 00:00 UTC instant. */
export function parseDate(text: unknown): number | null {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return parseTimestamp(`${text}T00:00:00Z`);
}

export function isHalfHour(epoch: number): boolean {
  return epoch % HALF_HOUR === 0;
}
