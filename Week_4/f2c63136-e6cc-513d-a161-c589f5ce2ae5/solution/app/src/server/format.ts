import { config } from './config.ts';

const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: config.timeZone,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short',
});

/** `<YYYY-MM-DD> <HH:mm:ss> <zone abbreviation>` in the workspace time zone (brief: Feedback states). */
export function workspaceTime(date: Date): string {
  const p = Object.fromEntries(parts.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} ${p.timeZoneName}`;
}
