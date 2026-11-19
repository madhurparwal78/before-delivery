export type DateKey = string;

const ZONE_AREAS = [
  'Africa',
  'America',
  'Antarctica',
  'Arctic',
  'Asia',
  'Atlantic',
  'Australia',
  'Europe',
  'Indian',
  'Pacific',
];

export const ETC_GMT_ZONES: readonly string[] = [
  ...Array.from({ length: 14 }, (_v, i) => `Etc/GMT-${14 - i}`),
  ...Array.from({ length: 12 }, (_v, i) => `Etc/GMT+${i + 1}`),
];

function runtimeKnowsZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function isAcceptedTimeZone(zone: string): boolean {
  if (zone === 'UTC') return true;
  if (ETC_GMT_ZONES.includes(zone)) return runtimeKnowsZone(zone);
  const area = zone.split('/')[0];
  if (area === undefined || !ZONE_AREAS.includes(area)) return false;
  return runtimeKnowsZone(zone);
}

export function acceptedTimeZones(): string[] {
  const named = Intl.supportedValuesOf('timeZone').filter((zone) => {
    const area = zone.split('/')[0];
    return area !== undefined && ZONE_AREAS.includes(area);
  });
  return [...new Set([...named, 'UTC', ...ETC_GMT_ZONES])].sort();
}

export interface LocalMoment {
  readonly dateKey: DateKey;
  readonly minutesOfDay: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  const cached = formatters.get(zone);
  if (cached !== undefined) return cached;
  const made = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  formatters.set(zone, made);
  return made;
}

export function localMoment(instant: Date, zone: string): LocalMoment {
  const parts = formatterFor(zone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((candidate) => candidate.type === type);
    if (part === undefined) throw new Error(`Missing ${type} for zone ${zone}`);
    return part.value;
  };
  return {
    dateKey: `${read('year')}-${read('month')}-${read('day')}`,
    minutesOfDay: Number(read('hour')) * 60 + Number(read('minute')),
  };
}

export function localDateKey(instant: Date, zone: string): DateKey {
  return localMoment(instant, zone).dateKey;
}

export function addDays(dateKey: DateKey, days: number): DateKey {
  const stamp = Date.parse(`${dateKey}T00:00:00Z`) + days * 86_400_000;
  return new Date(stamp).toISOString().slice(0, 10);
}

export function daysBetween(from: DateKey, to: DateKey): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function instantAtLocal(dateKey: DateKey, minutesOfDay: number, zone: string): Date {
  let guess = new Date(Date.parse(`${dateKey}T00:00:00Z`) + minutesOfDay * 60_000);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = localMoment(guess, zone);
    const drift = minutesOfDay - local.minutesOfDay + daysBetween(local.dateKey, dateKey) * 1440;
    if (drift === 0) break;
    guess = new Date(guess.getTime() + drift * 60_000);
  }
  return guess;
}

export function isDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function minutesOfTime(value: string): number {
  const [hours, minutes] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
}

export function timeOfMinutes(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  return `${String(hours).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

export function instantToUtcString(instant: Date): string {
  return `${instant.toISOString().slice(0, 19)}Z`;
}

export function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}
