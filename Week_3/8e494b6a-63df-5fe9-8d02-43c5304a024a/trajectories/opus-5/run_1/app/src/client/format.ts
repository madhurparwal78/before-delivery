const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(zone, formatter);
  }
  return formatter;
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function partsInZone(zone: string, utcMs: number): Parts {
  const parts = formatterFor(zone).formatToParts(new Date(utcMs));
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

function offsetOf(zone: string, utcMs: number): number {
  const parts = partsInZone(zone, utcMs);
  return (
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) -
    Math.floor(utcMs / 1000) * 1000
  );
}

export function formatOffset(offsetMs: number): string {
  const sign = offsetMs < 0 ? '-' : '+';
  const total = Math.abs(Math.round(offsetMs / 60000));
  return `${sign}${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** The one display time format: YYYY-MM-DD HH:MM:SS +HH:MM in the viewer's zone. */
export function displayTime(zone: string, utcMs: number): string {
  const parts = partsInZone(zone, utcMs);
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)} ${formatOffset(offsetOf(zone, utcMs))}`;
}

export function wallText(zone: string, utcMs: number): string {
  const parts = partsInZone(zone, utcMs);
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

type ZoneSource = { supportedValuesOf?: (key: string) => string[] };

/** Every IANA zone the browser knows, with UTC first. */
export const ZONES: string[] = (() => {
  const source = Intl as unknown as ZoneSource;
  const known = source.supportedValuesOf ? source.supportedValuesOf('timeZone') : [];
  return ['UTC', ...known.filter((zone) => zone !== 'UTC')];
})();
