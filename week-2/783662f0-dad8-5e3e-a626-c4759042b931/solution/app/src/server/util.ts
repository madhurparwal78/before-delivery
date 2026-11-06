import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

export const newId = (): string => randomBytes(16).toString('hex');
export const newToken = (): string => randomBytes(24).toString('base64url');

export const sha256Hex = (data: Buffer | string): string =>
  createHash('sha256').update(data).digest('hex');

export function hashPasscode(passcode: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(passcode, salt, 32);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPasscode(passcode: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const derived = scryptSync(passcode, salt, expected.length);
  return timingSafeEqual(derived, expected);
}

/** Every time the API sends is a UTC instant with milliseconds. */
export const instant = (value: Date | string | number): string => new Date(value).toISOString();

/** Money is a string with two decimals. */
export const money = (value: number | string): string => {
  const n = typeof value === 'string' ? Number(value) : value;
  return (Math.round(n * 100) / 100).toFixed(2);
};

export const signed = (amount: number): string =>
  amount === 0 ? '0' : amount > 0 ? `+${amount}` : `-${Math.abs(amount)}`;

const ZONE_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let found = ZONE_FORMATTERS.get(timeZone);
  if (found === undefined) {
    found = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    });
    ZONE_FORMATTERS.set(timeZone, found);
  }
  return found;
}

/** `YYYY-MM-DD HH:MM <time zone>` in the server's own zone. */
export function zoneLabel(at: Date | string, timeZone: string): string {
  const parts = zoneFormatter(timeZone).formatToParts(new Date(at));
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  const hour = pick('hour') === '24' ? '00' : pick('hour');
  return `${pick('year')}-${pick('month')}-${pick('day')} ${hour}:${pick('minute')} ${pick(
    'timeZoneName',
  )}`;
}

/** `YYYY-MM-DD` in the given zone. */
export function zoneDate(at: Date | string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(at));
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

/** Whole seconds from `at` until the next midnight in the given zone. */
export function secondsUntilMidnight(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const pick = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const hour = pick('hour') % 24;
  const elapsed = hour * 3600 + pick('minute') * 60 + pick('second');
  const remaining = 86400 - elapsed;
  return remaining <= 0 ? 86400 : remaining;
}

export const slugify = (name: string): string => name.toLowerCase().split(' ').join('-');

/** Deterministic shuffle from a stored seed. */
export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed >>> 0;
  const next = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const a = out[i];
    const b = out[j];
    out[i] = b;
    out[j] = a;
  }
  return out;
}

export const randomSeed = (): number => randomInt(1, 2 ** 31);

