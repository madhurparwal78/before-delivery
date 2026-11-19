import { createHash } from 'node:crypto';

/** Unicode NFC normalisation, then lower-case: the one comparison for emails. */
export function normalizeEmail(email: string): string {
  return email.normalize('NFC').toLowerCase();
}

export function sha256Hex(bytes: Buffer | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Opaque ids, like the brief requires for claims, measurements, pairs and audit rows. */
export function opaqueId(prefix: string): string {
  const bytes = Buffer.alloc(12);
  crypto.getRandomValues(bytes);
  return `${prefix}_${bytes.toString('base64url')}`;
}

import { webcrypto as crypto } from 'node:crypto';

/** Api timestamps: UTC YYYY-MM-DDTHH:MM:SSZ. */
export function apiInstant(date: Date): string {
  return date.toISOString().replace(/\.\d+Z$/, 'Z');
}

export function apiDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The cursor token: opaque, and carrying the filter it was issued for. */
export function cursorToken(filter: Record<string, unknown>): string {
  const json = JSON.stringify(filter);
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function cursorFilter(token: string): Record<string, unknown> | null {
  try {
    const json = Buffer.from(token, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseInstant(text: string): Date | null {
  if (!ISO_INSTANT.test(text)) return null;
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseDate(text: string): Date | null {
  if (!ISO_DATE.test(text)) return null;
  const d = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Count code points, as the member bounds require. */
export function countChars(text: string): number {
  return [...text].length;
}

/** A lot is 1 to 20 printable characters. */
export function validLot(lot: string): boolean {
  if (countChars(lot) < 1 || countChars(lot) > 20) return false;
  return [...lot].every((ch) => {
    const c = ch.codePointAt(0)!;
    return c > 0x20 && c !== 0x7f;
  });
}

/** The email member bound. */
export function validEmailShape(email: string): boolean {
  if (countChars(email) < 3 || countChars(email) > 254) return false;
  const at = email.indexOf('@');
  if (at <= 0 || email.indexOf('@', at + 1) !== -1) return false;
  const domain = email.slice(at + 1);
  const dot = domain.indexOf('.');
  return dot > 0 && dot < domain.length - 1;
}
