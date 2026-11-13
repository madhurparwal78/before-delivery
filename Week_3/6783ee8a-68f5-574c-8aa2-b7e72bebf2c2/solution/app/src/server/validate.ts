/** Small validators shared by the route modules. Every character count counts Unicode code points. */

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const length = (text: string): number => [...text].length;

export const inRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const SOURCE_MAX = 1_000_000;

export function field(body: unknown, key: string): unknown {
  return isObject(body) ? body[key] : undefined;
}

/** PostgreSQL cannot store a NUL character in text, so JSON that escapes one is refused before it is parsed. */
export function withoutNul(json: string): string {
  if (/\\u0000/i.test(json)) throw new SyntaxError("NUL character");
  return json;
}

/** A tab id is a random id the page makes for itself. */
export const validTab = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200;

/** The body's tab id; a missing or oversized one is recorded as a 422 entry. */
export function requireTab(body: unknown, problems: { add: (path: string, message: string) => void }): string {
  const tab = field(body, "tab_id");
  if (!validTab(tab)) problems.add("tab_id", "is required");
  return tab as string;
}
