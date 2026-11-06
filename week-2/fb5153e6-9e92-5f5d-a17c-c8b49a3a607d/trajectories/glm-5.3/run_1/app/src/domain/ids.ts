import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function randomRef(prefix: string, length: number): string {
  const raw = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[raw[i]! % ALPHABET.length];
  }
  return `${prefix}${out}`;
}

/** Order references: TS- plus 8 capital letters and digits (no ambiguous glyphs). */
export function orderRef(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const raw = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += alphabet[raw[i]! % alphabet.length];
  }
  return `TS-${out}`;
}

export function slugFromTitle(title: string, existing: (slug: string) => boolean, attempt: number): string {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  const stem = base === '' ? 'model' : base;
  let slug = stem;
  let n = 2;
  while (existing(slug)) {
    slug = `${stem.slice(0, 60 - String(n).length)}-${n}`;
    n += 1;
    if (n > 9999) break;
  }
  return slug;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (salt === undefined || hash === undefined) return false;
  const candidate = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** User-perceived character count (grapheme approximation via code points). */
export function charCount(value: string): number {
  return Array.from(value).length;
}

export function isLocaleValue(value: string): boolean {
  return value === 'en' || value === 'de';
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

export function isUrlSafeBase64(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}
