import { randomBytes, randomUUID } from 'node:crypto';

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString('base64url')}`;
}

export function randomToken(length = 43): string {
  return randomBytes(32).toString('base64url').slice(0, length);
}

export function uuid(): string {
  return randomUUID();
}

/** NFC-normalise text and count its Unicode code points. */
export function normaliseText(text: string): string {
  return text.normalize('NFC');
}

export function codePoints(text: string): number {
  return [...text].length;
}

export function isValidBusinessName(name: string): boolean {
  for (const ch of name) {
    const c = ch.codePointAt(0)!;
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) return false;
    if (c === 0x2028 || c === 0x2029) return false;
  }
  return true;
}

export function isValidEmail(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) && text.length <= 254;
}

export function detectContentType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

export function sanitiseFileName(name: string): string {
  const base = name.split('/').pop() ?? 'document';
  const kept = base.replace(/[^A-Za-z0-9 .\-_]/g, '').replace(/^\.+/, '');
  return kept.slice(0, 100) || 'document';
}

/** Round half away from zero to whole cents. */
export function roundCents(value: number): number {
  return value >= 0 ? Math.round(value) : -Math.round(-value);
}

export function dollars(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

export function centsToDollarString(cents: number): string {
  const abs = Math.abs(cents);
  const sign = cents < 0 ? '-' : '';
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
