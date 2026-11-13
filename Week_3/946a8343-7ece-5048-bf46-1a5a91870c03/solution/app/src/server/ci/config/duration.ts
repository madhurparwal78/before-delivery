// Durations such as `90s`; `never` is returned as its own value for the places where expiry allows it.
export const NEVER = "never";

const UNIT_MS: Readonly<Record<string, number>> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };

export function parseDurationMs(text: string): number | typeof NEVER | null {
  const trimmed = text.trim();
  if (trimmed === NEVER) return NEVER;
  const match = /^(\d+)(ms|s|m|h)$/.exec(trimmed);
  if (!match) return null;
  return Number(match[1]) * UNIT_MS[match[2]];
}
