export function trim(s: string): string {
  // Trim ASCII whitespace plus the common Unicode whitespace characters.
  return s.replace(/^[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+|[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+$/g, '');
}

export function codePoints(s: string): number {
  let count = 0;
  for (const _ of s) count += 1;
  return count;
}

export function limitText(value: string, max: number): string | null {
  const trimmed = trim(value);
  if (codePoints(trimmed) > max) return null;
  return trimmed;
}

const CONTROL_CHARS = /[\u0000-\u001F\u007F\u2028\u2029]/;

export function hasControlChars(value: string): boolean {
  return CONTROL_CHARS.test(value);
}

const EMAIL_FORBIDDEN = /[\r\n,;"<> \u0000-\u001F\u007F\u2028\u2029]/;

export function isValidCandidateEmail(email: string): boolean {
  if (email.length > 254) return false;
  if (EMAIL_FORBIDDEN.test(email)) return false;
  const at = email.indexOf('@');
  if (at <= 0) return false;
  if (email.indexOf('@', at + 1) !== -1) return false;
  const domain = email.slice(at + 1);
  if (domain.length === 0) return false;
  if (!domain.includes('.')) return false;
  return true;
}

export function isValidCandidateName(name: string): boolean {
  const t = trim(name);
  if (t.length === 0) return false;
  if (codePoints(t) > 120) return false;
  return !hasControlChars(t);
}

export function normalizeEmail(email: string): string {
  return trim(email).toLowerCase();
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 80;
}

export function isValidScore(score: string): boolean {
  if (!/^\d+(\.\d{1,2})?$/.test(score)) return false;
  const n = Number.parseFloat(score);
  return n >= 0 && n <= 100;
}

export function isValidStatedDelta(value: string): boolean {
  if (!/^[+-]?\d+(\.\d{1,2})?$/.test(value)) return false;
  return true;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(text: string): string {
  return escapeHtml(text);
}
