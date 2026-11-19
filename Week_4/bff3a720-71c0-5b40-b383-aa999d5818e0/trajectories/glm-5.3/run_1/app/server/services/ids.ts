import crypto from 'crypto';

export type OutboxKind =
  | 'sign_in_code'
  | 'booking_confirmed'
  | 'request_accepted'
  | 'request_declined'
  | 'request_expired'
  | 'time_change'
  | 'cancellation'
  | 'ratings_revealed'
  | 'id_review';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newId(): string {
  const bytes = crypto.randomBytes(20);
  let out = '';
  for (let i = 0; i < 20; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function newToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function newCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}
