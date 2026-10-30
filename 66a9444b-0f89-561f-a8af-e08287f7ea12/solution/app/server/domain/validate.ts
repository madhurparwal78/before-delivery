// Small readers for request bodies. Shape problems become 422 field errors.
import { FieldErrors } from "../http.ts";

export function asObject(body: unknown): Record<string, unknown> {
  if (body === undefined || body === null) return {};
  if (typeof body !== "object" || Array.isArray(body)) throw new FieldErrors({ body: "invalid" });
  return body as Record<string, unknown>;
}

/** Trimmed text within the length bounds, or null. */
export function text(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= min && trimmed.length <= max ? trimmed : null;
}

export function intOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function email(value: unknown): string | null {
  const t = text(value, 3, 254);
  return t && EMAIL_RE.test(t) ? t.toLowerCase() : null;
}

export function check(errors: Record<string, string>): void {
  if (Object.keys(errors).length) throw new FieldErrors(errors);
}
