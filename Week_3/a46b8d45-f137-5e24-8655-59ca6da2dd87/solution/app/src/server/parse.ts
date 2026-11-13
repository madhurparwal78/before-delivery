/** Narrowing helpers for data that arrives from outside: request bodies, carrier and billing answers. */

export type JsonObject = Record<string, unknown>;

export const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

export const asText = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * A whole number written as a JSON number or as a string of digits, within a range.
 * "required" when it is absent or empty, "invalid" when it is present but not a whole number in range.
 */
export function integerIn(value: unknown, low: number, high: number): number | "required" | "invalid" {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) return "required";
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^-?\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= low && parsed <= high ? parsed : "invalid";
}

export function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** An amount of pounds as read from a billing answer, converted to pence without float rounding. */
export function poundsToMinor(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const fixed = value.toFixed(2);
  return Number(fixed.replace(".", ""));
}

export const minorToPounds = (minor: number): number => Number((minor / 100).toFixed(2));
