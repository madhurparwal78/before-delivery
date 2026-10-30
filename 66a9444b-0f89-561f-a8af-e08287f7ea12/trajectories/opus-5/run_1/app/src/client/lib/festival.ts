const TIME_ZONE = 'Europe/Brussels';

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const labelFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** "Ddd D Mon", without the separators en-GB would add. */
function dayLabel(instant: Date): string {
  const parts = labelFormatter.formatToParts(instant);
  const read = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('weekday')} ${read('day')} ${read('month')}`;
}

const offsetFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  timeZoneName: 'longOffset',
});

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function wall(instant: Date): Wall {
  const parts = partsFormatter.formatToParts(instant);
  const read = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
  };
}

function offsetMinutes(instant: Date): number {
  const name = offsetFormatter
    .formatToParts(instant)
    .find((part) => part.type === 'timeZoneName')?.value;
  if (name === undefined || name === 'GMT') return 0;
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  if (match === null) return 0;
  return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? '0'));
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** True inside the repeated hour of a clock change, where one wall time has two instants. */
function repeatedHour(instant: Date): boolean {
  const before = offsetMinutes(new Date(instant.getTime() - 3_600_000));
  const here = offsetMinutes(instant);
  const after = offsetMinutes(new Date(instant.getTime() + 3_600_000));
  return before !== here || (here !== after && here > after);
}

function zoneSuffix(instant: Date): string {
  if (!repeatedHour(instant)) return '';
  return offsetMinutes(instant) === 120 ? ' CEST' : ' CET';
}

export function formatTime(iso: string): string {
  const instant = new Date(iso);
  const clock = wall(instant);
  return `${pad2(clock.hour)}:${pad2(clock.minute)}${zoneSuffix(instant)}`;
}

/** "Ddd D Mon, HH:MM" in Brussels time. */
export function formatDeadline(iso: string): string {
  const instant = new Date(iso);
  const clock = wall(instant);
  return `${dayLabel(instant)}, ${pad2(clock.hour)}:${pad2(clock.minute)}${zoneSuffix(instant)}`;
}

/** "D Mon YYYY". */
export function formatDate(iso: string): string {
  const instant = new Date(iso);
  const clock = wall(instant);
  const month = dayLabel(instant).split(' ')[2] ?? '';
  return `${clock.day} ${month} ${clock.year}`;
}

export function formatDayLabel(iso: string): string {
  return dayLabel(new Date(iso));
}

/** Session times on schedule rows read "Ddd D Mon · HH:MM–HH:MM". */
export function formatSessionWhen(startsAt: string, endsAt: string): string {
  return `${dayLabel(new Date(startsAt))} \u00b7 ${formatTime(startsAt)}\u2013${formatTime(endsAt)}`;
}

export function formatEuros(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  return `${sign}\u20ac${Math.floor(absolute / 100)}.${pad2(absolute % 100)}`;
}

export function overlaps(a: { starts_at: string; ends_at: string }, b: { starts_at: string; ends_at: string }): boolean {
  return (
    new Date(a.starts_at).getTime() < new Date(b.ends_at).getTime() &&
    new Date(b.starts_at).getTime() < new Date(a.ends_at).getTime()
  );
}
