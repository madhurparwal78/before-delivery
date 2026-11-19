export type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export type Resolved = { instant: Date; offsetMinutes: number };

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function partFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = partFormatters.get(timezone);
  if (cached) return cached;
  const made = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  partFormatters.set(timezone, made);
  return made;
}

export function localParts(timezone: string, instant: Date): LocalParts {
  const map: Record<string, string> = {};
  for (const part of partFormatter(timezone).formatToParts(instant)) {
    map[part.type] = part.value;
  }
  return {
    year: Number(map['year']),
    month: Number(map['month']),
    day: Number(map['day']),
    hour: Number(map['hour']),
    minute: Number(map['minute']),
    second: Number(map['second']),
  };
}

/** Minutes that local wall-clock time runs ahead of UTC in this timezone at this instant. */
export function offsetMinutes(timezone: string, instant: Date): number {
  const p = localParts(timezone, instant);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const whole = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((asUtc - whole) / 60000);
}

export function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const total = Math.abs(minutes);
  return `${sign}${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

export function localDate(timezone: string, instant: Date): string {
  const p = localParts(timezone, instant);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

export function localTime(timezone: string, instant: Date): string {
  const p = localParts(timezone, instant);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/**
 * Every UTC instant whose local wall clock in `timezone` reads exactly `date` at `time`.
 * Empty when the local time is skipped by a clock change, two entries when it repeats
 * (earliest first, so the summer offset comes first).
 */
export function resolveLocal(timezone: string, date: string, time: string): Resolved[] {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  const found = new Map<number, Resolved>();
  for (const probeShift of [-172800000, -86400000, 0, 86400000, 172800000]) {
    const probeOffset = offsetMinutes(timezone, new Date(naive + probeShift));
    const candidate = naive - probeOffset * 60000;
    const p = localParts(timezone, new Date(candidate));
    if (
      p.year === year &&
      p.month === month &&
      p.day === day &&
      p.hour === hour &&
      p.minute === minute
    ) {
      found.set(candidate, { instant: new Date(candidate), offsetMinutes: probeOffset });
    }
  }
  return [...found.values()].sort((a, b) => a.instant.getTime() - b.instant.getTime());
}

export function addLocalDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return `${moved.getUTCFullYear()}-${pad2(moved.getUTCMonth() + 1)}-${pad2(moved.getUTCDate())}`;
}

export function localDaysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

/** ISO weekday of a local date: 1 is Monday through 7 for Sunday. */
export function weekdayOf(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

export function isValidLocalDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const made = new Date(Date.UTC(year, month - 1, day));
  return (
    made.getUTCFullYear() === year && made.getUTCMonth() + 1 === month && made.getUTCDate() === day
  );
}

export function isoMillis(instant: Date): string {
  return instant.toISOString();
}

export function minutesOfDay(time: string): number {
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  return hour * 60 + minute;
}

export function timeOfMinutes(minutes: number): string {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}
