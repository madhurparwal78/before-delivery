/**
 * The one place the bare-address rule lives. An address must be `local@domain`,
 * at most 254 characters, with no display name, angle bracket, whitespace,
 * comma, semicolon or control character.
 */

const FORBIDDEN = /[<>,;\s\u0000-\u001f\u007f]/;

function isBareAddress(value: string): boolean {
  if (value.length === 0 || value.length > 254) return false;
  if (FORBIDDEN.test(value)) return false;
  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@')) return false;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length === 0 || domain.length === 0) return false;
  if (!domain.includes('.')) return false;
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return false;
  if (domain.startsWith('-') || domain.endsWith('-')) return false;
  return true;
}

/** Trim surrounding whitespace, then apply the bare-address rule. */
export function readAddress(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return isBareAddress(trimmed) ? trimmed : null;
}

/**
 * Distinct addresses of a batch, lower-cased, in first-seen order.
 * Addresses that differ only in letter case are one address.
 */
export function distinctAddresses(addresses: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const address of addresses) {
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}

/** Characters a workshop title may never contain. */
const TITLE_CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/;

export function hasControlCharacters(value: string): boolean {
  return TITLE_CONTROL.test(value);
}
