// Display forms of server values. Nothing here computes a figure; it only lays out what was returned.

export const HALF_HOUR = 1800;
export const DAY = 86_400;

/** `<signed tonnes>`: a leading `+` when positive, `-` when negative, no sign for 0.000. */
export function signed(tonnes: string): string {
  return tonnes.startsWith("-") || /^0\.0+$/.test(tonnes) ? tonnes : `+${tonnes}`;
}

export function epochOf(iso: string): number {
  return Date.parse(iso) / 1000;
}

function isoOf(epoch: number): string {
  return new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function apiTimestamp(epoch: number): string {
  return isoOf(epoch);
}

/** `YYYY-MM-DD HH:MM UTC` */
export function minuteDisplay(epochOrIso: number | string): string {
  const iso = typeof epochOrIso === "number" ? isoOf(epochOrIso) : epochOrIso;
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** `YYYY-MM-DD HH:MM:SS UTC` */
export function secondDisplay(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

/** `YYYY-MM-DD` of the UTC day holding the instant. */
export function dayOf(epoch: number): string {
  return isoOf(epoch).slice(0, 10);
}

/** 00:00 UTC of a `YYYY-MM-DD` day, or null when it is not a real day in that form. */
export function parseDay(text: string | null): number | null {
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const epoch = Date.parse(`${text}T00:00:00Z`) / 1000;
  return Number.isNaN(epoch) || dayOf(epoch) !== text ? null : epoch;
}

/** `YYYYMMDDHHMM` UTC */
export function stamp(epoch: number): string {
  return isoOf(epoch).slice(0, 16).replace(/[-T:]/g, "");
}

export function parseStamp(text: string | null): number | null {
  if (!text || !/^\d{12}$/.test(text)) return null;
  const iso = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T${text.slice(8, 10)}:${text.slice(10, 12)}:00Z`;
  const epoch = Date.parse(iso) / 1000;
  return Number.isNaN(epoch) || isoOf(epoch) !== iso ? null : epoch;
}

/** Whole square metres with thin-space thousands groups. */
export function area(m2: number): string {
  return String(m2).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function intervalDisplay(start: string, end: string): string {
  return `${minuteDisplay(start)} to ${minuteDisplay(end)}`;
}

export const STATUS_WORD = { sealed: "Sealed", broken: "Broken", superseded: "Superseded" } as const;
export const LINK_WORD = { live: "Live", expired: "Expired", revoked: "Revoked" } as const;
export const KIND_WORD = { issuance: "Issuance", buffer: "Buffer", reversal: "Reversal" } as const;
export const SENSOR_KIND_WORD = { tower: "Tower", satellite: "Satellite cell" } as const;
