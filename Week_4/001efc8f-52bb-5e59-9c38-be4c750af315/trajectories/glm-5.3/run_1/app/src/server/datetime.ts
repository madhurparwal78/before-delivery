/** Workspace-local format: `Mon 2 Nov, 06:30 CST`. */
export function formatLocalDateTime(zone: string, instant: Date): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  });
  const parts = fmt.formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = get('weekday');
  const day = get('day');
  const month = get('month');
  const hour = get('hour');
  const minute = get('minute');
  const tzAbbr = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  const hourFixed = hour === '24' ? '00' : hour;
  return `${weekday} ${day} ${month}, ${hourFixed}:${minute} ${tzAbbr}`;
}

/** Business date like `Wed 28 Oct`. */
export function formatBusinessDate(zone: string, instant: Date): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const parts = fmt.formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')}`;
}

/** Local ISO with offset, e.g. `2026-11-02T06:30:00-06:00`. */
export function toLocalIso(zone: string, instant: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const offset = offsetString(zone, instant);
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}:${get('second')}${offset}`;
}

export function offsetString(zone: string, instant: Date): string {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' });
  const name = fmt.formatToParts(instant).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  if (name === 'GMT') return 'Z';
  const m = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(name);
  if (!m) return 'Z';
  const sign = m[1];
  const hh = m[2].padStart(2, '0');
  const mm = m[3] ?? '00';
  return `${sign}${hh}:${mm}`;
}

export interface LocalDateTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Wall-clock fields in a zone. */
export function getLocalParts(zone: string, instant: Date): LocalDateTime {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '0';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(hour),
    minute: Number(get('minute')),
    second: Number(get('second')),
  };
}

export function offsetAt(zone: string, instant: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'longOffset',
  });
  const parts = dtf.formatToParts(instant);
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  const m = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(name);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}
