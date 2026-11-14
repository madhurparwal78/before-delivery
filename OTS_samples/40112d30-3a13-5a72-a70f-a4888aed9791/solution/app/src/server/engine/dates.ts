const ISO_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const MILLISECONDS_PER_DAY = 86_400_000;
const MONTH_NAMES = 'JanFebMarAprMayJunJulAugSepOctNovDec';

/** Days since 1970-01-01 for a valid `YYYY-MM-DD`. */
export function dayNumber(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`) / MILLISECONDS_PER_DAY;
}

const FIRST_DAY = dayNumber('0000-01-01');
const LAST_DAY = dayNumber('9999-12-31');

/** `YYYY-MM-DD` and a real calendar day. */
export function validRealDate(text: string): boolean {
  if (!ISO_DATE.test(text)) return false;
  const time = Date.parse(`${text}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().startsWith(text);
}

/** The date `days` after 1970-01-01, or null when it falls outside the years 0000 to 9999. */
export function isoFromDayNumber(days: number): string | null {
  if (days < FIRST_DAY || days > LAST_DAY) return null;
  return new Date(days * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
}

/** 2026-03-14 becomes "14 Mar 2026"; text that is not a real date is returned as it is. */
export function shortDate(iso: string): string {
  if (!validRealDate(iso)) return iso;
  const month = Number(iso.slice(5, 7));
  return `${Number(iso.slice(8, 10))} ${MONTH_NAMES.slice(3 * (month - 1), 3 * month)} ${iso.slice(0, 4)}`;
}
