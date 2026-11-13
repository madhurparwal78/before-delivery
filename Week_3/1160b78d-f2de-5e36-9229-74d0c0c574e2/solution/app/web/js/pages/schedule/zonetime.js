// Time arithmetic for schedule screens. Instants travel as epoch milliseconds; every wall-clock reading is in the
// viewed zone, never the browser's.
import { offsetMinutes, localDate, localHM, instantFromLocal } from '../../lib/format.js';

export const MINUTE = 60000;
export const STEP = 15 * MINUTE;
const DAY_MS = 24 * 60 * MINUTE;

export const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');

// snapStep is the nearest 15-minute step of the zone's wall clock; exactly halfway takes the later step.
export function snapStep(ms, zone) {
  const offset = offsetMinutes(ms, zone) * MINUTE;
  return Math.floor((ms + offset) / STEP + 0.5) * STEP - offset;
}

// floorStep is the latest 15-minute step of the zone's wall clock at or before an instant.
export function floorStep(ms, zone) {
  const offset = offsetMinutes(ms, zone) * MINUTE;
  return Math.floor((ms + offset) / STEP) * STEP - offset;
}

// stepBy moves a step by a whole number of 15-minute steps on the wall clock of the zone.
export function stepBy(ms, steps, zone) {
  return snapStep(ms + steps * STEP, zone);
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDate(text) {
  const m = DATE_PATTERN.exec(text);
  if (!m) return false;
  const [y, mo, d] = m.slice(1).map(Number);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

export function addDays(date, days) {
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
}

// mondayOf is the Monday on or before a calendar date.
export function mondayOf(date) {
  const [y, mo, d] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

export function weekdayShort(date) {
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
}

// startOfDay is the instant (ms) a calendar date begins in a zone.
export function startOfDay(date, zone) {
  return Date.parse(instantFromLocal(`${date} 00:00`, zone));
}

export function dateIn(ms, zone) {
  return localDate(iso(ms), zone);
}

export function clockIn(ms, zone) {
  return localHM(iso(ms), zone);
}

// typed is "YYYY-MM-DD HH:MM" in the zone.
export function typed(ms, zone) {
  return `${dateIn(ms, zone)} ${clockIn(ms, zone)}`;
}

export function fromTyped(text, zone) {
  const instant = instantFromLocal(text, zone);
  return instant ? Date.parse(instant) : null;
}

// lengthText is "<h> h <m> min", or "<m> min" under an hour.
export function lengthText(ms) {
  const minutes = Math.round(ms / MINUTE);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

