// The text-limit rule: NFC, then trim Unicode White_Space, then count code points. Words are the runs between White_Space.

const EDGES = /^\p{White_Space}+|\p{White_Space}+$/gu;

/** The stored form of a text value: NFC with leading and trailing Unicode whitespace removed. */
export function clean(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFC").replace(EDGES, "") : "";
}

export const codePoints = (value: string): number => [...value].length;

/** The cleaned value when its code-point count is within min..max (both allowed), else null. */
export function limited(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const stored = clean(value);
  const count = codePoints(stored);
  return count >= min && count <= max ? stored : null;
}

/** The folded form two project names are compared by: the stored form, Unicode lower-cased. */
export const nameKey = (value: string): string => clean(value).toLowerCase();

export const words = (value: string): string[] => value.split(/\p{White_Space}+/u).filter(Boolean);

/** Trial and invitation emails: up to 200 code points with exactly one `@` and text on both sides. */
export function email(value: unknown): string | null {
  const stored = limited(value, 3, 200);
  return stored !== null && /^[^@]+@[^@]+$/.test(stored) ? stored : null;
}
