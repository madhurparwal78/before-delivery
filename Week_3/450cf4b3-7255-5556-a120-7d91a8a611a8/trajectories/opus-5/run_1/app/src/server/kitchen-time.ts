import { config } from './config';
import { CLOSES_AT, OPENS_AT } from '../shared/copy';
import { minutesOfHhmm } from '../shared/format';

const zone = config.kitchenTimeZone;

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: zone,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export interface KitchenParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function kitchenParts(at: Date): KitchenParts {
  const parts = partsFormat.formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    return found ? Number(found.value) : 0;
  };
  const hour = read('hour');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: hour === 24 ? 0 : hour,
    minute: read('minute'),
    second: read('second'),
  };
}

/** Minutes east of UTC for the kitchen zone at that instant. */
export function kitchenOffsetMinutes(at: Date): number {
  const parts = kitchenParts(at);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

export function kitchenDate(at: Date): string {
  const parts = kitchenParts(at);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

/** The instant of a kitchen-local wall clock time. */
export function instantOfKitchenLocal(date: string, minutesOfDay: number): Date {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const wall = Date.UTC(year, month - 1, day, 0, 0, 0) + minutesOfDay * 60000;
  let guess = new Date(wall - kitchenOffsetMinutes(new Date(wall)) * 60000);
  for (let round = 0; round < 2; round += 1) {
    const offset = kitchenOffsetMinutes(guess);
    const next = new Date(wall - offset * 60000);
    if (next.getTime() === guess.getTime()) break;
    guess = next;
  }
  return guess;
}

export function instantOfKitchenTime(date: string, hhmm: string): Date {
  return instantOfKitchenLocal(date, minutesOfHhmm(hhmm));
}

/** ISO 8601 with the kitchen's UTC offset, e.g. 2026-10-28T05:00:00-05:00 */
export function kitchenIso(at: Date): string {
  const parts = kitchenParts(at);
  const offset = kitchenOffsetMinutes(at);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const pad = (value: number, size = 2): string => String(value).padStart(size, '0');
  return (
    `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}` +
    `T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

export const openingMinutes = minutesOfHhmm(OPENS_AT);
export const closingMinutes = minutesOfHhmm(CLOSES_AT);

/** Kitchen-local minutes of day, or null when the instant falls on another date. */
export function kitchenMinutesOfDay(at: Date): number {
  const parts = kitchenParts(at);
  return parts.hour * 60 + parts.minute;
}

export function kitchenSeconds(at: Date): number {
  return kitchenParts(at).second;
}

export const kitchenTimeZone = zone;
