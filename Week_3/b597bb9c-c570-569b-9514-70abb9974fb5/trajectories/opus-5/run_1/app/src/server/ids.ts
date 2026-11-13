import { randomBytes, createHash, timingSafeEqual, scryptSync } from 'node:crypto';

export function randomId(prefix: string): string {
  return `${prefix}-${randomBytes(9).toString('hex')}`;
}

export function randomToken(prefix: string, hexDigits = 40): string {
  return `${prefix}${randomBytes(Math.ceil(hexDigits / 2)).toString('hex').slice(0, hexDigits)}`;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 32).toString('hex')}`;
}

export function passwordMatches(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3) return false;
  const expected = Buffer.from(parts[2], 'hex');
  const actual = scryptSync(password, parts[1], expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function sha256Hex(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A strong hash of an exact response body, used for the review ETag. */
export function strongEtag(body: string): string {
  return `"${sha256Hex(body)}"`;
}
