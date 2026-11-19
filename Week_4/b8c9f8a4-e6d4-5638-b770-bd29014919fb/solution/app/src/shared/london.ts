// Europe/London is the product's zone for viewing slots and every date the product shows,
// whatever zone the device is in. The server alone turns a local time into an instant.

const PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour12: false,
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

interface LondonParts {
  weekday: string;
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
  second: string;
}

function partsOf(instant: Date): LondonParts {
  const found: Record<string, string> = {};
  for (const part of PARTS.formatToParts(instant)) {
    if (part.type !== 'literal') found[part.type] = part.value;
  }
  return {
    weekday: found.weekday ?? '',
    day: found.day ?? '',
    month: found.month ?? '',
    year: found.year ?? '',
    hour: found.hour === '24' ? '00' : (found.hour ?? ''),
    minute: found.minute ?? '',
    second: found.second ?? '',
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** London's offset from UTC in minutes at this instant. */
function offsetMinutes(instant: Date): number {
  const parts = partsOf(instant);
  const asUtc = Date.UTC(
    Number(parts.year),
    MONTHS.indexOf(parts.month),
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - instant.getTime()) / 60000);
}

type Zone = 'GMT' | 'BST';

export function zoneOf(instant: Date): Zone {
  return offsetMinutes(instant) === 0 ? 'GMT' : 'BST';
}

/** `14 Nov 2026, 10:30` in London. */
export function formatDate(instant: Date): string {
  const parts = partsOf(instant);
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute}`;
}

/** `Sat 14 Nov 2026, 10:30 GMT` in London. */
export function formatSlotLabel(instant: Date): string {
  const parts = partsOf(instant);
  return `${parts.weekday} ${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} ${zoneOf(instant)}`;
}

const LOCAL_START = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

type LocalStartResult =
  | { kind: 'ok'; instant: Date }
  | { kind: 'missing' }
  | { kind: 'malformed' };

/**
 * `YYYY-MM-DDTHH:mm` read as London wall time. A time that does not exist on that date is
 * refused; a time that happens twice resolves to the first occurrence.
 */
export function instantFromLocal(text: string): LocalStartResult {
  const match = LOCAL_START.exec(text);
  if (!match) return { kind: 'malformed' };
  const [, year, month, day, hour, minute] = match.map(Number) as unknown as number[];
  const wall = Date.UTC(year, month - 1, day, hour, minute, 0);
  if (Number.isNaN(wall)) return { kind: 'malformed' };
  const candidates: Date[] = [];
  for (const guess of [60, 0]) {
    const instant = new Date(wall - guess * 60000);
    if (offsetMinutes(instant) === guess) candidates.push(instant);
  }
  if (candidates.length === 0) return { kind: 'missing' };
  // The earliest instant is the first occurrence of a wall time that happens twice.
  candidates.sort((a, b) => a.getTime() - b.getTime());
  return { kind: 'ok', instant: candidates[0] };
}

/** The `YYYY-MM-DDTHH:mm` London wall time of an instant. */
export function localStartOf(instant: Date): string {
  const parts = partsOf(instant);
  const month = String(MONTHS.indexOf(parts.month) + 1).padStart(2, '0');
  return `${parts.year}-${month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** The next instants at a London wall time of 10:30 on a Saturday, at least `days` days away. */
export function saturdaysAt(from: Date, days: number, hour: number, minute: number, count: number): Date[] {
  const found: Date[] = [];
  const start = new Date(from.getTime() + days * 86400000);
  for (let step = 0; step < 60 && found.length < count; step += 1) {
    const day = new Date(start.getTime() + step * 86400000);
    const parts = partsOf(day);
    if (parts.weekday !== 'Sat') continue;
    const month = String(MONTHS.indexOf(parts.month) + 1).padStart(2, '0');
    const text = `${parts.year}-${month}-${parts.day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    const made = instantFromLocal(text);
    if (made.kind === 'ok' && made.instant.getTime() >= start.getTime()) found.push(made.instant);
  }
  return found;
}
