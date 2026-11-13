/** Claim references and the random tokens behind confirmation links and share links. */

import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

const REFERENCE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const REFERENCE_PATTERN = new RegExp(`^HG-[${REFERENCE_ALPHABET}]{6}$`);

export function newReference(): string {
  let tail = '';
  for (let position = 0; position < 6; position += 1) {
    tail += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  }
  return `HG-${tail}`;
}

/** Any string outside the published pattern is a malformed reference. */
export function isReference(value: string): boolean {
  return REFERENCE_PATTERN.test(value);
}

/** Lookups match references in any letter case; the stored form is capitals as issued. */
export function normaliseReference(value: string): string {
  return value.toUpperCase();
}

export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

export function sameEmail(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * The erase confirmation is the one comparison that takes the reference exactly as issued:
 * no trimming and no change of letter case.
 */
export function matchesExactly(typed: string, reference: string): boolean {
  const left = Buffer.from(typed, 'utf8');
  const right = Buffer.from(reference, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
