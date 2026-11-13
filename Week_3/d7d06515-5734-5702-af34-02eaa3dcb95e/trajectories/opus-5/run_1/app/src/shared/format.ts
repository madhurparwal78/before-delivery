export type Units = 'mm' | 'm';

const LENGTH_DECIMALS: Record<Units, number> = { mm: 2, m: 3 };

/** Rounds half away from zero. The epsilon nudge repairs binary representations such as 2.675. */
export function roundHalfAway(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const scaled = Math.abs(value) * factor;
  const rounded = Math.round(scaled * (1 + Number.EPSILON * 8));
  const result = rounded / factor;
  return value < 0 ? -result : result;
}

export function formatNumber(value: number, decimals: number): string {
  const rounded = roundHalfAway(value, decimals);
  const text = (rounded === 0 ? 0 : rounded).toFixed(decimals);
  return text === `-${(0).toFixed(decimals)}` ? (0).toFixed(decimals) : text;
}

/** Millimetres of stored geometry, shown in the drawing's units. */
export function formatLength(millimetres: number, units: Units): string {
  const value = units === 'm' ? millimetres / 1000 : millimetres;
  return formatNumber(value, LENGTH_DECIMALS[units]);
}

/** Square millimetres of stored geometry, shown in the drawing's units. */
export function formatArea(squareMillimetres: number, units: Units): string {
  const value = units === 'm' ? squareMillimetres / 1_000_000 : squareMillimetres;
  return formatNumber(value, LENGTH_DECIMALS[units]);
}

export function formatAngle(degrees: number): string {
  return `${formatNumber(normalizeAngle(degrees), 2)}°`;
}

export function normalizeAngle(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** Reads a typed length or coordinate component in the drawing's units, returning millimetres. */
export function lengthToMillimetres(value: number, units: Units): number {
  return units === 'm' ? value * 1000 : value;
}

export function unitsLabel(units: Units): string {
  return units === 'm' ? 'Meters' : 'Millimeters';
}

export function unitsWord(units: Units): string {
  return units === 'm' ? 'meters' : 'millimeters';
}

function zonedParts(at: Date, zone: string, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, ...options }).formatToParts(at);
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  return map;
}

/** `MMM D, YYYY, h:mm A` in the studio time zone. */
export function formatDateTime(at: Date, zone: string): string {
  const p = zonedParts(at, zone, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${p.month} ${p.day}, ${p.year}, ${p.hour}:${p.minute} ${(p.dayPeriod ?? '').toUpperCase()}`;
}

/** `MMM D, YYYY` in the studio time zone. */
export function formatDayLabel(at: Date, zone: string): string {
  const p = zonedParts(at, zone, { year: 'numeric', month: 'short', day: 'numeric' });
  return `${p.month} ${p.day}, ${p.year}`;
}

/** `YYYY-MM-DD` in the studio time zone. */
export function formatIsoDate(at: Date, zone: string): string {
  const p = zonedParts(at, zone, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}

/** `YYYYMMDD` in the studio time zone. */
export function formatCompactDate(at: Date, zone: string): string {
  return formatIsoDate(at, zone).replaceAll('-', '');
}

/** `HH:mm`, 24 hour, in the studio time zone. */
export function formatClockTime(at: Date, zone: string): string {
  const p = zonedParts(at, zone, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${formatNumber(bytes / 1000, 1)} KB`;
  if (bytes < 1_000_000_000) return `${formatNumber(bytes / 1_000_000, 1)} MB`;
  return `${formatNumber(bytes / 1_000_000_000, 1)} GB`;
}

export function formatByteLimit(bytes: number): string {
  return bytes.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function objectCount(n: number): string {
  return n === 1 ? '1 object' : `${n} objects`;
}

export function itemCount(n: number): string {
  return n === 1 ? '1 item' : `${n} items`;
}

export function unsupportedObjectCount(n: number): string {
  return n === 1 ? '1 unsupported object' : `${n} unsupported objects`;
}
