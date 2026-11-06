// Field patterns shared by several forms, and the header-safe rules (brief: Header-safe fields).
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const UNSAFE = /[\u0000-\u001f\u007f\u2028\u2029]/;
export const PHONE = { pattern: /^\+[1-9][0-9]{7,14}$/, message: "Enter your number in international format, like +14155550100." };

/** A header-safe field: a string with no control or line-separator character, trimmed; null otherwise. */
export function safeText(value: unknown): string | null {
  return typeof value === "string" && !UNSAFE.test(value) ? value.trim() : null;
}

/** Trimmed email as given when it is header-safe and looks like local@domain.tld within 254 characters. */
export function validEmail(value: unknown): string | null {
  const email = safeText(value);
  return email !== null && email.length <= 254 && EMAIL.test(email) ? email : null;
}

/** Trimmed, lower-cased valid email. */
export function normaliseEmail(value: unknown): string | null {
  return validEmail(value)?.toLowerCase() ?? null;
}

/** A message field: CRLF and a lone CR stored as LF. */
export function messageText(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

/** A JSON integer that can name a row (PostgreSQL integer keys). */
export function isRowId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 2_147_483_647;
}
