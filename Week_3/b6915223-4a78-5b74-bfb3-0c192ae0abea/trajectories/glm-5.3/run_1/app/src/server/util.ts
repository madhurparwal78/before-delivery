import * as crypto from 'node:crypto';

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomId(length = 12): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return out;
}

export function randomJoinCode(): string {
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

const LEAGUE_TIME_ZONE_OFFSET_MINUTES: Record<number, number> = {
  0: 0,
  1: 60,
  2: 60,
  3: 60,
  4: 60,
  5: 60,
  6: 60,
  7: 60,
  8: 60,
  9: 60,
  10: 60,
  11: 0,
};

export function leagueOffsetMinutes(date: Date): number {
  const utcHour = date.getUTCHours();
  const month = date.getUTCMonth() + 1;
  if (month > 3 && month < 11) return 60;
  if (month < 3 || month > 10) return 0;
  if (month === 3) {
    const lastSunday = lastSundayOfMonth(date.getUTCFullYear(), 2);
    if (date.getTime() < lastSunday || (date.getTime() === lastSunday && utcHour < 1)) return 0;
    return 60;
  }
  const lastSunday = lastSundayOfMonth(date.getUTCFullYear(), 9);
  if (date.getTime() < lastSunday || (date.getTime() === lastSunday && utcHour < 1)) return 60;
  return 0;
}

function lastSundayOfMonth(year: number, monthIndex: number): number {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0, 0, 0, 0, 0));
  const weekday = lastDay.getUTCDay();
  lastDay.setUTCDate(lastDay.getUTCDate() - weekday);
  return lastDay.getTime();
}

export function toLeagueTime(date: Date): Date {
  return new Date(date.getTime() + leagueOffsetMinutes(date) * 60000);
}

export function isoOrNull(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}

export function nowUtc(): Date {
  return new Date();
}
