import { scrypt, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

// scrypt at a cost of about 50ms per check on this machine.
const N = 16384, R = 8, P = 1, KEYLEN = 32;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 256 * 1024 * 1024 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const want = Buffer.from(parts[2], 'hex');
  const got = scryptSync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 256 * 1024 * 1024 });
  return want.length === got.length && timingSafeEqual(want, got);
}
