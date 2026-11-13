import { randomBytes, randomInt, createHash } from 'node:crypto';

export function id(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString('base64url')}`;
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

const FRIEND_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function friendCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) code += FRIEND_CODE_ALPHABET[randomInt(FRIEND_CODE_ALPHABET.length)];
  return code;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function utcDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function weekStart(now = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay(); // 0 Sunday
  const diff = (dow + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}
