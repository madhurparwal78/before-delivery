import { hhmmOfMinutes, minutesOfHhmm } from '../shared/format';

interface Anchor {
  serverMs: number;
  receivedAt: number;
  offsetMinutes: number;
}

let anchor: Anchor | null = null;
let timeZone = 'America/Chicago';

export function setKitchenTimeZone(zone: string): void {
  timeZone = zone;
}

function offsetOfIso(iso: string): number {
  const sign = iso.slice(-6, -5);
  if (sign !== '+' && sign !== '-') return 0;
  const hours = Number(iso.slice(-5, -3));
  const minutes = Number(iso.slice(-2));
  return (sign === '-' ? -1 : 1) * (hours * 60 + minutes);
}

/** The browser's estimate of the server clock, from the latest response's now field. */
export function anchorServerTime(nowIso: string): void {
  anchor = {
    serverMs: Date.parse(nowIso),
    receivedAt: performance.now(),
    offsetMinutes: offsetOfIso(nowIso),
  };
}

export function serverNowMs(): number {
  if (anchor === null) return Date.now();
  return anchor.serverMs + (performance.now() - anchor.receivedAt);
}

function offsetMinutesAt(at: number): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(at));
    const read = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
    const hour = read('hour');
    const asUtc = Date.UTC(
      read('year'),
      read('month') - 1,
      read('day'),
      hour === 24 ? 0 : hour,
      read('minute'),
      read('second'),
    );
    return Math.round((asUtc - Math.floor(at / 1000) * 1000) / 60000);
  } catch {
    return anchor?.offsetMinutes ?? 0;
  }
}

function kitchenPartsAt(at: number): { date: string; minutes: number } {
  const offset = offsetMinutesAt(at);
  const shifted = new Date(at + offset * 60000);
  const date = shifted.toISOString().slice(0, 10);
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  return { date, minutes };
}

export function kitchenToday(): string {
  return kitchenPartsAt(serverNowMs()).date;
}

export function kitchenClockText(): string {
  const parts = kitchenPartsAt(serverNowMs());
  return `Kitchen time ${hhmmOfMinutes(parts.minutes)} ${'\u00b7'} ${timeZone}`;
}

function offsetSuffix(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** An ISO time with the kitchen's own offset for that kitchen-local wall clock. */
export function kitchenIsoFor(date: string, hhmm: string): string {
  const wall = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
    0,
    0,
    0,
  ) + minutesOfHhmm(hhmm) * 60000;
  let offset = offsetMinutesAt(wall);
  for (let round = 0; round < 2; round += 1) {
    const next = offsetMinutesAt(wall - offset * 60000);
    if (next === offset) break;
    offset = next;
  }
  return `${date}T${hhmm}:00${offsetSuffix(offset)}`;
}
