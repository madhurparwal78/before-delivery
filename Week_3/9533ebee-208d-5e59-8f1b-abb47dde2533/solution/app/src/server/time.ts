// The server clock, in whole seconds: every instant the server records or shows is rounded down to the second.

/** The server's now, rounded down to the whole second. */
export function serverNow(): Date {
  return new Date(Math.floor(Date.now() / 1000) * 1000);
}

/** The canonical UTC form of an instant: `YYYY-MM-DDTHH:MM:SSZ`, no fractional seconds. */
export function toInstant(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** An RFC 3339 instant with a mandatory `Z` or `±HH:MM` offset; fractional seconds are dropped. Null when malformed. */
export function parseInstant(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})[Tt](\d{2}:\d{2}:\d{2})(?:\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const [, date, time, offset] = match;
  const parsed = new Date(`${date}T${time}${offset?.toUpperCase()}`);
  if (Number.isNaN(parsed.getTime())) return null;
  // Reject rolled-over dates such as February 30th by reading the wall fields back.
  const wall = new Date(`${date}T${time}Z`);
  return wall.toISOString().slice(0, 19) === `${date}T${time}` ? parsed : null;
}
