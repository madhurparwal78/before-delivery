export const KITCHEN_TIME_ZONE = 'America/Chicago';
export const KITCHEN_NAME = 'Larder Row Kitchen';

const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: KITCHEN_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export interface KitchenNow {
  date: string;
  hour: number;
  minute: number;
  second: number;
}

export function kitchenNow(at: Date = new Date()): KitchenNow {
  const all = parts.formatToParts(at);
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    all.find((part) => part.type === type)?.value ?? '00';
  return {
    date: `${pick('year')}-${pick('month')}-${pick('day')}`,
    hour: Number.parseInt(pick('hour'), 10),
    minute: Number.parseInt(pick('minute'), 10),
    second: Number.parseInt(pick('second'), 10),
  };
}

export function kitchenToday(at: Date = new Date()): string {
  return kitchenNow(at).date;
}

export function kitchenMinuteOfDay(at: Date = new Date()): number {
  const now = kitchenNow(at);
  return now.hour * 60 + now.minute;
}

export function currentStep(at: Date = new Date()): number {
  return Math.floor(kitchenMinuteOfDay(at) / 15) * 15;
}

export function formatClock(at: Date = new Date()): string {
  const now = kitchenNow(at);
  return `${pad2(now.hour)}:${pad2(now.minute)}`;
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatMinuteOfDay(minute: number): string {
  if (minute >= 1440) return '24:00';
  return `${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`;
}

export function formatHoursMinutes(minutes: number): string {
  const sign = minutes < 0 ? '-' : '';
  const absolute = Math.abs(minutes);
  return `${sign}${Math.floor(absolute / 60)}:${pad2(absolute % 60)}`;
}

export function formatAmount(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  return `${sign}$${Math.floor(absolute / 100)}.${pad2(absolute % 100)}`;
}

export function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10));
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + days));
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

export function countdownText(remainingMs: number): string {
  const total = Math.max(0, Math.round(remainingMs / 1000));
  return `${Math.floor(total / 60)}:${pad2(total % 60)}`;
}
