import { randomBytes, randomUUID } from 'node:crypto';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function code(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function bookingRef(): string {
  return `HB-${code(6)}`;
}

export function giftRef(): string {
  return `HG-${code(6)}`;
}

export function enquiryRef(): string {
  return `EQ-${code(6)}`;
}

export function ticketCode(): string {
  return `T-${code(8)}`;
}

export function holdId(): string {
  return randomUUID();
}

export function capabilityToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sixDigitCode(): string {
  const bytes = randomBytes(4).readUInt32BE(0);
  return String(bytes % 1000000).padStart(6, '0');
}
