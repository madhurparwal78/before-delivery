// Field checks shared by every endpoint that validates a body.

/** The trimmed text when it is a string of min..max characters, else null. */
export function text(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return [...trimmed].length >= min && [...trimmed].length <= max ? trimmed : null;
}

export function wholeNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

export function email(value: unknown): string | null {
  const trimmed = text(value, 3, 254);
  return trimmed && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}
