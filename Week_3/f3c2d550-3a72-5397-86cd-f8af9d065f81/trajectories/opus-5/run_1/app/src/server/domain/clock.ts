const fixedNow = readFixedNow();

function readFixedNow(): number | null {
  const raw = process.env.STOWDECK_NOW;
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`STOWDECK_NOW is not an ISO 8601 instant: ${raw}`);
  }
  return parsed;
}

/** The server clock. Every time-dependent value is read from here. */
export function nowMs(): number {
  return fixedNow ?? Date.now();
}

export function nowIso(): string {
  return toIso(nowMs());
}

/**
 * Real elapsed time, used only for scheduling background work. Every value the API
 * publishes comes from `nowMs` instead.
 */
export function realNowIso(offsetMs = 0): string {
  return toIso(Date.now() + offsetMs);
}

/** ISO 8601 UTC with second precision and a trailing `Z`. */
export function toIso(instantMs: number): string {
  return `${new Date(Math.floor(instantMs / 1000) * 1000).toISOString().slice(0, 19)}Z`;
}
