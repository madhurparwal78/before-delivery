// Narrowing helpers for data that arrives as `unknown` (JSON from the page config, the socket and error bodies).

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

let ticks = 0;
/** Monotonic counter used to order "this request started before that event" decisions. */
export function nextTick(): number {
  return ++ticks;
}
