import { UI_COPY } from '../shared/copy.js';

const cache = new Map<string, Intl.DateTimeFormat>();

const formatter = (zone: string): Intl.DateTimeFormat => {
  const found = cache.get(zone);
  if (found) return found;
  const made = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  cache.set(zone, made);
  return made;
};

export const browserZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Absolute 24-hour stamps, always from a server instant and a named zone. */
export const stamp = (iso: string, zone: string): string => {
  const parts = formatter(zone).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
};

export const countdown = (secondsToHandIn: number): string => {
  const minutes = Math.floor(Math.max(0, secondsToHandIn) / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes - days * 1440) / 60);
  return UI_COPY.countdown(days, hours, minutes - days * 1440 - hours * 60);
};

/** Lengths print with up to two decimals and no trailing zeros. */
export const trim = (value: number, decimals = 2): string => {
  const fixed = value.toFixed(decimals);
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
};

export const fixed = (value: number, decimals: number): string => value.toFixed(decimals);

export const bytesLabel = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/** `Nickname (A–Z)`: case and accent insensitive, digit runs compared as numbers. */
export const nicknameOrder = (left: string, right: string): number => {
  const strip = (value: string): string =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  const a = strip(left);
  const b = strip(right);
  const parts = (value: string): (string | number)[] =>
    value.split(/(\d+)/).filter((part) => part !== '').map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  const leftParts = parts(a);
  const rightParts = parts(b);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const one = leftParts[index];
    const two = rightParts[index];
    if (one === undefined) return -1;
    if (two === undefined) return 1;
    if (typeof one === 'number' && typeof two === 'number') {
      if (one !== two) return one - two;
    } else {
      const text = String(one);
      const other = String(two);
      if (text !== other) return text < other ? -1 : 1;
    }
  }
  return 0;
};
