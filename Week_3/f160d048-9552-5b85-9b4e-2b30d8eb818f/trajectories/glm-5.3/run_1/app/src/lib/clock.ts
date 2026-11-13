import crypto from 'node:crypto';

// Server clock including the grading offset, shared by every instance on the database.
let clockOffsetMs = 0;

export function setClockOffset(ms: number): void {
  clockOffsetMs = ms;
}

export function nowMs(): number {
  return Date.now() + clockOffsetMs;
}

export function now(): Date {
  return new Date(nowMs());
}

export function toIso(date: Date): string {
  return date.toISOString().replace('Z', '+00:00');
}

export function randomId(): string {
  return crypto.randomUUID();
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function randomCode(): string {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Slow salted password hashing: scrypt with a random salt.
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const derived = Buffer.from(crypto.scryptSync(password, parts[1], 32, { N: 16384, r: 8, p: 1 }));
  const expected = Buffer.from(parts[2], 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}
