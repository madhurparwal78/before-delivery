import type { Unit } from './types';

export const CENTRE_LINE_MM = 1450;
export const MIN_GAP_MM = 200;
export const MIN_DIMENSION_MM = 1;
export const MAX_DIMENSION_MM = 20000;

interface Decimal {
  negative: boolean;
  digits: string;
  fraction: string;
}

function parseDecimal(raw: string): Decimal | null {
  const text = raw.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  return { negative: match[1] === '-', digits: match[2] ?? '', fraction: match[3] ?? '' };
}

function roundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** Converts a length typed in cm (1 decimal) or inches (2 decimals) to whole millimetres. */
export function lengthToMm(raw: string | number, unit: Unit): number | null {
  const decimal = parseDecimal(typeof raw === 'number' ? String(raw) : raw);
  if (!decimal || decimal.negative) return null;
  const maxFraction = unit === 'cm' ? 1 : 2;
  if (decimal.fraction.length > maxFraction) return null;
  const scale = unit === 'cm' ? 10 : 100;
  const padded = decimal.fraction.padEnd(maxFraction, '0');
  const scaled = Number(decimal.digits) * scale + (padded === '' ? 0 : Number(padded));
  if (!Number.isFinite(scaled)) return null;
  return unit === 'cm' ? scaled : roundHalfUp(scaled * 254, 1000);
}

export function mmToUnitValue(mm: number, unit: Unit): number {
  return unit === 'cm' ? mm / 10 : roundHalfUp(mm * 100, 254) / 10;
}

/** The single length display format: one decimal, its unit, and no thousands separator. */
export function formatLength(mm: number, unit: Unit): string {
  return `${mmToUnitValue(mm, unit).toFixed(1)} ${unit}`;
}

export function formatLengthValue(mm: number, unit: Unit): string {
  return mmToUnitValue(mm, unit).toFixed(1);
}

export function formatWhole(value: number): string {
  return String(value);
}

export function formatGrouped(value: number): string {
  const text = String(Math.trunc(Math.abs(value)));
  const grouped = text.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return value < 0 ? `-${grouped}` : grouped;
}

export function formatLux(lux: number): string {
  return `${formatWhole(lux)} lux`;
}

export function formatLuxHours(luxHours: number): string {
  return formatGrouped(luxHours);
}

export function formatDimensions(widthMm: number, heightMm: number, unit: Unit): string {
  return `${formatLengthValue(widthMm, unit)} \u00d7 ${formatLength(heightMm, unit)}`;
}

export function formatMoneyGbp(value: number): string {
  return `\u00a3${formatGrouped(value)}`;
}

export function isWholeNumberInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}
