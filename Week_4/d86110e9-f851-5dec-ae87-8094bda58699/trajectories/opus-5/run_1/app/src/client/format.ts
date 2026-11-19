import { settings } from './settings';

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: settings.time_zone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'short',
});

/** Server instants shown in the workspace time zone; the browser clock is never read. */
export function formatInstant(value: string | null): string {
  if (value === null || value === '') return '';
  const parts = formatter.formatToParts(new Date(value));
  const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}:${pick('second')} ${pick('timeZoneName')}`;
}
