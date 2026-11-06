// Text-field rules: control characters, email form, length bounds.
export const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;

/** A single-line text field may not contain any control character. */
export function hasControlChars(value: string): boolean {
  return CONTROL_CHAR_RE.test(value);
}

/** Multi-line text may contain line feed and carriage return, and no other control character. */
export function hasDisallowedControlChars(value: string): boolean {
  return /[\u0000-\u0009\u000B-\u001F\u007F]/.test(value);
}

export function isValidEmail(value: string): boolean {
  if (value.length < 3 || value.length > 254) return false;
  const at = value.indexOf("@");
  if (at === -1) return false;
  if (value.indexOf("@", at + 1) !== -1) return false;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length === 0 || domain.length === 0) return false;
  if (!domain.includes(".")) return false;
  if (/[,\s<>";]/.test(value)) return false;
  if (hasControlChars(value)) return false;
  return true;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidCanadianPostalCode(value: string): boolean {
  return /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d$/.test(value.trim().toUpperCase());
}
