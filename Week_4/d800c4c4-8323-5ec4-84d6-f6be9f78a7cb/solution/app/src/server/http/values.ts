// Reading request values: ids are whole numbers, everything else is checked by its endpoint.

export function idFrom(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d{1,15}$/.test(value) && Number(value) > 0) return Number(value);
  return null;
}

export function pathId(value: string | undefined): number | null {
  return value !== undefined && /^\d{1,15}$/.test(value) ? idFrom(value) : null;
}

export function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function wholeIn(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && EMAIL.test(value.trim());
}
