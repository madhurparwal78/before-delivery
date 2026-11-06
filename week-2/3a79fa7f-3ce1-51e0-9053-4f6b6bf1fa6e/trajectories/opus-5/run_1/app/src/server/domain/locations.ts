import { monthShort, weekdayShort, zonedParts } from '../tz.js';

const EARTH_RADIUS_KM = 6371.0;

export function haversineKm(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(toLat - fromLat);
  const dLon = toRad(toLon - fromLon);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function roundToTenth(value: number): number {
  return Math.floor(value * 10 + 0.5) / 10;
}

function clockTime(at: Date, timezone: string): string {
  const p = zonedParts(at, timezone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** "Sat 26 Oct 2030, 10:00 to 12:00 local time", always in the location's own zone. */
export function slotLabel(startsAt: Date, endsAt: Date, timezone: string): string {
  const start = zonedParts(startsAt, timezone);
  const date = `${String(start.year).padStart(4, '0')}-${String(start.month).padStart(2, '0')}-${String(start.day).padStart(2, '0')}`;
  return `${weekdayShort(date)} ${start.day} ${monthShort(start.month)} ${start.year}, ${clockTime(startsAt, timezone)} to ${clockTime(endsAt, timezone)} local time`;
}

/** Masked for a dealer: the first character of the local part, then *** and the domain. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return email;
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}
