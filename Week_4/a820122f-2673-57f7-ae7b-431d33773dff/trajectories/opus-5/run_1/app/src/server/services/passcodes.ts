import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 32;

export function hashPasscode(passcode: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(passcode, salt, KEY_LENGTH).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function passcodeMatches(passcode: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || salt === undefined || hash === undefined) return false;
  const candidate = scryptSync(passcode, salt, KEY_LENGTH);
  const expected = Buffer.from(hash, 'hex');
  return candidate.byteLength === expected.byteLength && timingSafeEqual(candidate, expected);
}
