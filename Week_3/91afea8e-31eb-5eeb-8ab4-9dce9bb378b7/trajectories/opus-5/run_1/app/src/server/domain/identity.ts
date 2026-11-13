/** Ids, password hashing, code hashing, card checks and identifier normalising. */

import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

const ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newId(prefix: string, length = 10): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const byte of bytes) out += ID_ALPHABET[byte % ID_ALPHABET.length];
  return `${prefix}${out}`;
}

export function newToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 32).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function passwordMatches(password: string, stored: string): boolean {
  const [scheme, salt, expected] = stored.split('$');
  if (scheme !== 'scrypt' || salt === undefined || expected === undefined) return false;
  const derived = scryptSync(password, salt, 32).toString('hex');
  const left = Buffer.from(derived, 'hex');
  const right = Buffer.from(expected, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}

export function hashBody(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const PHONE_PATTERN = /^\+91[6-9][0-9]{9}$/;
export const PINCODE_PATTERN = /^[1-9][0-9]{5}$/;

export type Identifier = { kind: 'email' | 'phone'; value: string } | null;

export function normaliseIdentifier(raw: string): Identifier {
  const trimmed = raw.trim();
  if (EMAIL_PATTERN.test(trimmed)) return { kind: 'email', value: trimmed.toLowerCase() };
  const digits = trimmed.replace(/[\s-]/g, '');
  if (PHONE_PATTERN.test(digits)) return { kind: 'phone', value: digits };
  return null;
}

export type CardNetwork = 'Visa' | 'Mastercard' | 'RuPay';

export function cardNetwork(number: string): CardNetwork | null {
  if (/^4/.test(number)) return 'Visa';
  const two = Number(number.slice(0, 2));
  const four = Number(number.slice(0, 4));
  if ((two >= 51 && two <= 55) || (four >= 2221 && four <= 2720)) return 'Mastercard';
  if (two === 60 || two === 65 || two === 81 || two === 82) return 'RuPay';
  if (number.startsWith('508')) return 'RuPay';
  return null;
}

export function luhnValid(number: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = number.length - 1; index >= 0; index -= 1) {
    let digit = number.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) return false;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

export function countCodePoints(text: string): number {
  return [...text].length;
}

export function firstName(fullName: string): string {
  const [first] = fullName.trim().split(/\s+/);
  return first ?? fullName;
}
