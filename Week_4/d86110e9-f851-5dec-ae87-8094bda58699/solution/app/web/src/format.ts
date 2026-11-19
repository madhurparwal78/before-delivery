import { settings } from './settings';

const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: settings.timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'short',
});

/** `YYYY-MM-DD HH:mm:ss EDT` in the workspace zone, whatever zone the browser is in. */
export function formatTime(instant: string | null): string {
  if (instant === null) return '';
  const p = Object.fromEntries(parts.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} ${p.timeZoneName}`;
}

export function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? '';
}
