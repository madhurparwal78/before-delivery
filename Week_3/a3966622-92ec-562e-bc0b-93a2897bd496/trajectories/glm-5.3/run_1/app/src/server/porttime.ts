// Port Ansell keeps all operating time in America/Halifax. Instants are stored
// as epoch milliseconds and every wall-clock reading is derived from them, so
// no duration is ever a difference of wall-clock readings.

export const PORT_ZONE = 'America/Halifax';
export const UTC_OFFSET_ADT = '-03:00';
export const UTC_OFFSET_AST = '-04:00';

// Halifax: -04:00 standard, -03:00 daylight. DST starts the second Sunday of
// March at 02:00 local standard time (06:00Z) and ends the first Sunday of
// November at 02:00 local daylight time (05:00Z).

function firstSunday(year: number, monthIndex: number): number {
  for (let day = 1; day <= 7; day++) {
    if (new Date(Date.UTC(year, monthIndex, day)).getUTCDay() === 0) return day;
  }
  return 7;
}

function secondSunday(year: number, monthIndex: number): number {
  let count = 0;
  for (let day = 1; day <= 14; day++) {
    if (new Date(Date.UTC(year, monthIndex, day)).getUTCDay() === 0) {
      count++;
      if (count === 2) return day;
    }
  }
  return 14;
}

export function offsetMinutesAt(ms: number): number {
  const year = new Date(ms).getUTCFullYear();
  const dstStart = Date.UTC(year, 2, secondSunday(year, 2), 6, 0, 0);
  const dstEnd = Date.UTC(year, 10, firstSunday(year, 10), 5, 0, 0);
  if (ms >= dstStart && ms < dstEnd) return -180;
  return -240;
}

export function offsetStringAt(ms: number): string {
  return offsetMinutesAt(ms) === -180 ? UTC_OFFSET_ADT : UTC_OFFSET_AST;
}

// All instants of a port-local date+time. A spring-forward gap has none; a
// fall-back repeat has two, the first of which is the one the port uses.
export function portInstants(date: string, hhmm: string): number[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m || !t) return [];
  const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const minutes = Number(t[1]) * 60 + Number(t[2]);
  const results: number[] = [];
  for (const offset of [-240, -180, -300]) {
    const candidate = base + minutes * 60_000 - offset * 60_000;
    if (offsetMinutesAt(candidate) === offset) results.push(candidate);
  }
  return [...new Set(results)].sort((a, b) => a - b);
}

// The port's instant for a local date+time: first occurrence, or null when the
// time does not exist in port time (the skipped hour of a spring-forward date).
export function portInstant(date: string, hhmm: string): number | null {
  return portInstants(date, hhmm)[0] ?? null;
}

export function portInstantOrThrow(date: string, hhmm: string): number {
  const ms = portInstant(date, hhmm);
  if (ms === null) throw new Error(`time does not exist in port time: ${date} ${hhmm}`);
  return ms;
}

// Accepts "YYYY-MM-DDTHH:MM" (API format) and returns the port instant.
export function portInstantFromApi(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  return portInstant(value.slice(0, 10), value.slice(11, 16));
}

export function existsInPortTime(date: string, hhmm: string): boolean {
  return portInstant(date, hhmm) !== null;
}

function shifted(ms: number): Date {
  return new Date(ms + offsetMinutesAt(ms) * 60_000);
}

export function formatPortDate(ms: number): string {
  return shifted(ms).toISOString().slice(0, 10);
}

export function formatPortTime(ms: number): string {
  return shifted(ms).toISOString().slice(11, 16);
}

export function formatPortStamp(ms: number): string {
  return shifted(ms).toISOString().slice(11, 19);
}

// "YYYY-MM-DDTHH:MM" in port time, the API boarding format.
export function formatPortDateTimeApi(ms: number): string {
  return shifted(ms).toISOString().slice(0, 16);
}

// "YYYY-MM-DD HH:MM" in port time, for notices and headings.
export function formatPortDateTimeSpace(ms: number): string {
  return shifted(ms).toISOString().slice(0, 16).replace('T', ' ');
}

export function portDateOf(ms: number): string {
  return formatPortDate(ms);
}

// Port midnight (00:00 local) of a port-local date.
export function portMidnight(date: string): number {
  return portInstantOrThrow(date, '00:00');
}

// Every 5-minute step of the port-local date that exists in port time.
export function daySteps(date: string): number[] {
  const steps: number[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += 5) {
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mm = String(minutes % 60).padStart(2, '0');
    const ms = portInstant(date, `${hh}:${mm}`);
    if (ms !== null) steps.push(ms);
  }
  return steps;
}

export function localMinutesOfDay(ms: number): number {
  const d = shifted(ms);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function localSecondsOfDay(ms: number): number {
  const d = shifted(ms);
  return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
}

// Night window: port-local 22:00 through 05:59 inclusive.
export function isNightBoarding(boardingMs: number): boolean {
  const minutes = localMinutesOfDay(boardingMs);
  return minutes >= 22 * 60 || minutes < 6 * 60;
}

// The port-local date a night duty is counted against: a boarding from 00:00
// to 05:59 belongs to the previous date's night.
export function nightDutyDate(boardingMs: number): string {
  if (localMinutesOfDay(boardingMs) < 6 * 60) {
    return formatPortDate(boardingMs - 24 * 3600_000);
  }
  return formatPortDate(boardingMs);
}

// Calendar date of a duty for rota-day counting, on the same convention as the
// night rule: early-morning boardings count against the previous date.
export function dutyDate(boardingMs: number): string {
  return nightDutyDate(boardingMs);
}
