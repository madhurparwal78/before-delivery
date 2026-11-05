// Field checks shared by the handlers; each returns the cleaned value or null.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function fields(body: unknown): Record<string, unknown> {
  return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

export function text(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= min && trimmed.length <= max ? trimmed : null;
}

export function email(value: unknown): string | null {
  const found = text(value, 3, 254);
  return found && EMAIL.test(found) ? found : null;
}

export function integer(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}
