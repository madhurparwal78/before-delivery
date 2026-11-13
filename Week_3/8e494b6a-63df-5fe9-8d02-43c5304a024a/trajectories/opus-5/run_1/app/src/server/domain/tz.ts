export type WallParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

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
      weekday: 'short',
    });
    formatters.set(zone, formatter);
  }
  return formatter;
}

export function isKnownZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function partsInZone(zone: string, utcMs: number): WallParts & { weekday: string } {
  const parts = formatterFor(zone).formatToParts(new Date(utcMs));
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '0';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: get('weekday').toLowerCase().slice(0, 3),
  };
}

function wallAsUtcMs(parts: WallParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

export function zoneOffsetMs(zone: string, utcMs: number): number {
  const parts = partsInZone(zone, utcMs);
  return wallAsUtcMs(parts) - Math.floor(utcMs / 1000) * 1000;
}

export function formatOffset(offsetMs: number): string {
  const sign = offsetMs < 0 ? '-' : '+';
  const total = Math.abs(Math.round(offsetMs / 60000));
  const hours = String(Math.floor(total / 60)).padStart(2, '0');
  const minutes = String(total % 60).padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}

export type WallResolution = { ms: number; exists: boolean; ambiguous: boolean };

/** A wall time in a zone becomes an instant; one that occurs twice takes the earlier. */
export function wallToInstant(zone: string, parts: WallParts): WallResolution {
  const wallUtc = wallAsUtcMs(parts);
  const offsets = new Set([
    zoneOffsetMs(zone, wallUtc - 86400000),
    zoneOffsetMs(zone, wallUtc),
    zoneOffsetMs(zone, wallUtc + 86400000),
  ]);
  const valid = [...offsets]
    .map((offset) => wallUtc - offset)
    .filter((candidate) => wallAsUtcMs(partsInZone(zone, candidate)) === wallUtc)
    .sort((left, right) => left - right);
  if (valid.length > 0) {
    return { ms: valid[0], exists: true, ambiguous: valid.length > 1 };
  }
  const beforeGap = zoneOffsetMs(zone, wallUtc - 86400000);
  return { ms: wallUtc - beforeGap, exists: false, ambiguous: false };
}

export function localMidnight(zone: string, utcMs: number): number {
  const parts = partsInZone(zone, utcMs);
  return wallToInstant(zone, { ...parts, hour: 0, minute: 0, second: 0 }).ms;
}

export function localMondayMidnight(zone: string, utcMs: number): number {
  const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  let midnight = localMidnight(zone, utcMs);
  for (let guard = 0; guard < 8; guard += 1) {
    const parts = partsInZone(zone, midnight + 3600000 * 6);
    if (order.indexOf(parts.weekday) === 0) return midnight;
    midnight = localMidnight(zone, midnight - 3600000 * 12);
  }
  return midnight;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** The one display time format: YYYY-MM-DD HH:MM:SS +HH:MM in the viewer's zone. */
export function displayTime(zone: string, utcMs: number): string {
  const parts = partsInZone(zone, utcMs);
  const offset = formatOffset(zoneOffsetMs(zone, utcMs));
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)} ${offset}`;
}

export function bucketLabel(zone: string, startMs: number, intervalMs: number, sameDay: boolean): string {
  const parts = partsInZone(zone, startMs);
  const offset = formatOffset(zoneOffsetMs(zone, startMs));
  if (!sameDay) {
    return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)} ${offset}`;
  }
  if (intervalMs < 60000) {
    return `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)} ${offset}`;
  }
  return `${pad(parts.hour)}:${pad(parts.minute)} ${offset}`;
}
