import { INCH_PER_MILLIMETRE, rationalFromDecimalString, rationalScale, rationalToFixed, type Rational } from './decimal.js';
import type { UnitDecision } from './domain.js';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const formatUtcDate = (iso: string | Date): string => {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
};

export const formatUtcTime = (iso: string | Date): string => {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
};

export const TIMES_SIGN = '\u00d7';
const SEPARATOR = ` ${TIMES_SIGN} `;

/** Metres x unit scale x 1,000, held exactly. */
export const MILLIMETRE_FACTOR: Record<UnitDecision, Rational> = {
  as_exported: { numerator: 1000n, denominator: 1n },
  mm: { numerator: 1n, denominator: 1n },
  cm: { numerator: 10n, denominator: 1n },
  in: { numerator: 254n, denominator: 10n },
};

export type Dimensions = { x: string; y: string; z: string };

const triple = (dimensions: Dimensions): Rational[] => [
  rationalFromDecimalString(dimensions.x),
  rationalFromDecimalString(dimensions.y),
  rationalFromDecimalString(dimensions.z),
];

export const millimetresOf = (metres: Dimensions, unit: UnitDecision): Rational[] =>
  triple(metres).map((value) => rationalScale(value, MILLIMETRE_FACTOR[unit]));

export const millimetreReadout = (metres: Dimensions, unit: UnitDecision): string =>
  `${millimetresOf(metres, unit)
    .map((value) => rationalToFixed(value, 1))
    .join(SEPARATOR)} mm`;

export const inchReadout = (metres: Dimensions, unit: UnitDecision): string =>
  `${millimetresOf(metres, unit)
    .map((value) => rationalToFixed(rationalScale(value, INCH_PER_MILLIMETRE), 2))
    .join(SEPARATOR)} in`;

export const metreReadout = (metres: Dimensions): string =>
  `${triple(metres)
    .map((value) => rationalToFixed(value, 3))
    .join(SEPARATOR)} m`;

export const fullReadout = (metres: Dimensions, unit: UnitDecision): string =>
  `${millimetreReadout(metres, unit)} \u00b7 ${inchReadout(metres, unit)}`;

export const fxLineIndicative = (rate: string): string => `Indicative at ${rate} per \u00a31.`;

export const fxLineLocked = (rate: string, lockedAt: string): string =>
  `Locked at ${rate} per \u00a31 on ${formatUtcDate(lockedAt)}.`;

export const FX_LINE_GBP = 'Priced in GBP.';

export const payByLine = (overdueAt: string): string =>
  `Pay by ${formatUtcDate(overdueAt)}, ${formatUtcTime(overdueAt)} UTC to avoid an overdue notice.`;

export const reviewExpiryLine = (expiresAt: string): string =>
  `This link works until ${formatUtcDate(expiresAt)}, ${formatUtcTime(expiresAt)} UTC.`;

export const degrees = (value: number): string => `${Math.round(value)}\u00b0`;
