import * as crypto from 'node:crypto';

const refAlphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function randomFrom(alphabet: string, length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

/** Booking ref HB-xxxxxx, gift HG-, enquiry EQ-, ticket T-xxxxxxxx. */
export function bookingRef(): string {
  return `HB-${randomFrom(refAlphabet, 6)}`;
}

export function giftRef(): string {
  return `HG-${randomFrom(refAlphabet, 6)}`;
}

export function enquiryRef(): string {
  return `EQ-${randomFrom(refAlphabet, 6)}`;
}

export function ticketCode(): string {
  return `T-${randomFrom(refAlphabet, 8)}`;
}

/** Capability token: 43 base64url characters from 32 random bytes. */
export function capabilityToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** Hold id: a random UUID. */
export function holdId(): string {
  return crypto.randomUUID();
}

export function sixDigitCode(): string {
  const n = crypto.randomInt(0, 1000000);
  return String(n).padStart(6, '0');
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashPassword(password: string, salt?: string): string {
  const s = salt ?? crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, s, 32).toString('hex');
  return `${s}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const idx = stored.indexOf(':');
  if (idx <= 0) return false;
  const salt = stored.slice(0, idx);
  const hash = stored.slice(idx + 1);
  const candidate = crypto.scryptSync(password, salt, 32).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(candidate, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
