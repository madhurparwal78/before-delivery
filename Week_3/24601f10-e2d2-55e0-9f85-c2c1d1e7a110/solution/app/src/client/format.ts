import type { Format } from '../shared/api.js';

export const FORMAT_NAMES: Record<Format, string> = {
  single_elimination: 'Single elimination',
  double_elimination: 'Double elimination',
  round_robin: 'Round robin',
  swiss: 'Swiss',
};

export const FORMAT_OBJECT_NAMES: Record<Format, string> = {
  single_elimination: 'Single elimination cup',
  double_elimination: 'Double elimination loving cup',
  round_robin: 'Round robin medal',
  swiss: 'Swiss counters',
};

export const ORDERED_FORMATS: Format[] = ['single_elimination', 'double_elimination', 'round_robin', 'swiss'];

// The clock time of an instant in a zone, as HH:MM on the 24-hour clock.
export function timeInZone(iso: string, zone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date(iso));
}

function zoneOffsetMs(ms: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - Math.floor(ms / 1000) * 1000;
}

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/;

// `YYYY-MM-DD HH:MM[:SS]` in a zone, converted to a UTC ISO string; null when the text is not in that form.
export function zonedTextToIso(text: string, zone: string): string | null {
  const match = LOCAL_TIME.exec(text.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s = '00'] = match;
  const local = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  let utc = local - zoneOffsetMs(local, zone);
  utc = local - zoneOffsetMs(utc, zone);
  return Number.isNaN(utc) ? null : new Date(utc).toISOString();
}

export const timeZones = (): string[] => ['UTC', ...Intl.supportedValuesOf('timeZone').filter((zone) => zone !== 'UTC')];

export function formatFigure(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export const signed = (value: number): string => (value > 0 ? `+${value}` : String(value));
