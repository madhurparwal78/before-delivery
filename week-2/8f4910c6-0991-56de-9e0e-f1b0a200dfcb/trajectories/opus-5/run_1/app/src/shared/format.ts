/** The published display formats. Each one is decided here and nowhere else. */

import {
  MONTH_LONG,
  MONTH_SHORT,
  WEEKDAY_NAMES,
  type CivilDate,
  instantToZoned,
  parseIsoDate,
  weekday,
} from './zone.js';

export function roundHalfUp(value: number): number {
  return Math.sign(value) * Math.floor(Math.abs(value) + 0.5);
}

/** `CAD 1,234.50`, with a leading minus for negative amounts. */
export function formatMoneyCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, '0');
  const grouped = whole.toLocaleString('en-CA', { useGrouping: true, maximumFractionDigits: 0 });
  return `${negative ? '-' : ''}CAD ${grouped}.${fraction}`;
}

/** Plain decimal with two places, used by the statement CSV. */
export function formatDecimalCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  return `${negative ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** `Mon 15 Mar 2027` */
export function formatDate(date: CivilDate): string {
  return `${WEEKDAY_NAMES[weekday(date)]} ${date.day} ${MONTH_SHORT[date.month - 1]} ${date.year}`;
}

export function formatIsoDateHuman(isoDate: string): string {
  const date = parseIsoDate(isoDate);
  return date ? formatDate(date) : isoDate;
}

/** `Fri 12 Mar 2027, 12:00 Toronto time` */
export function formatOfficeTime(instantMs: number, zone: string, city: string): string {
  const z = instantToZoned(zone, instantMs);
  const hhmm = `${String(z.hour).padStart(2, '0')}:${String(z.minute).padStart(2, '0')}`;
  return `${formatDate(z)}, ${hhmm} ${city} time`;
}

/** `March 2027` */
export function formatMonth(year: number, month: number): string {
  return `${MONTH_LONG[month - 1]} ${year}`;
}

/** Truncating compact numbers: 374650 → `374.6K`, 1000000 → `1M`, 999 → `999`. */
export function formatCompactReach(value: number): string {
  const units: Array<{ limit: number; suffix: string }> = [
    { limit: 1_000_000_000, suffix: 'B' },
    { limit: 1_000_000, suffix: 'M' },
    { limit: 1_000, suffix: 'K' },
  ];
  for (const unit of units) {
    if (value >= unit.limit) {
      const scaled = Math.floor((value / unit.limit) * 10) / 10;
      const text = Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(1);
      return `${text}${unit.suffix}`;
    }
  }
  return String(value);
}

export function cmToInches(cm: number): number {
  return roundHalfUp(cm / 2.54);
}

export function inchesToCm(inches: number): number {
  return roundHalfUp(inches * 2.54);
}

/** `173 cm / 5 ft 8 in` */
export function formatHeight(cm: number): string {
  const inches = cmToInches(cm);
  return `${cm} cm / ${Math.floor(inches / 12)} ft ${inches % 12} in`;
}

export function formatHeightInchesOnly(cm: number): string {
  const inches = cmToInches(cm);
  return `${Math.floor(inches / 12)} ft ${inches % 12} in`;
}

/** `84 cm / 33 in` */
export function formatMeasurement(cm: number): string {
  return `${cm} cm / ${cmToInches(cm)} in`;
}

export function ordinalRank(rank: number): string {
  return rank === 1 ? '1st' : rank === 2 ? '2nd' : '3rd';
}

export const MEDIA_NAMES = {
  digital: 'Digital',
  print: 'Print',
  out_of_home: 'Out of home',
  broadcast: 'Broadcast',
} as const;

export const TERRITORY_NAMES = {
  canada: 'Canada',
  north_america: 'North America',
  worldwide: 'Worldwide',
} as const;

export const BOARD_TITLES = {
  women: 'Women',
  men: 'Men',
  creators: 'Creators',
  new_faces: 'New Faces',
} as const;

export const ROLE_TITLES = {
  agency_director: 'Agency director',
  booker: 'Booker',
  accounts_lead: 'Accounts lead',
  scout: 'Scout',
  talent: 'Talent',
} as const;
