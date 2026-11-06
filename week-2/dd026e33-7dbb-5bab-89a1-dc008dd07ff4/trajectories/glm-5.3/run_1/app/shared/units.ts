/**
 * Unit conversion — the single decision place for stored vs displayed units.
 * Stored: film build in integer micrometres, pressure in bar (2 dp), odometer in integer km.
 */
export type FilmUnit = 'um' | 'mil';
export type PressureUnit = 'bar' | 'psi';
export type DistanceUnit = 'km' | 'mi';

export interface Units {
  film: FilmUnit;
  pressure: PressureUnit;
  distance: DistanceUnit;
}

export const DEFAULT_UNITS: Units = { film: 'um', pressure: 'bar', distance: 'km' };

const PSI_PER_BAR = 14.5038;
const KM_PER_MILE = 1.609344;

function roundHalfUp(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.sign(value) * Math.round(Math.abs(value) * factor + Number.EPSILON) / factor;
}

/** Mil input → whole µm, stored. */
export function milToUm(mil: string): number {
  return Math.round((Number(mil) * 25.4 + Number.EPSILON));
}

export function filmStored(value: string, unit: FilmUnit): number {
  if (unit === 'um') {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return NaN;
    return parsed;
  }
  return milToUm(value);
}

export function filmDisplay(um: number | null, unit: FilmUnit): string {
  if (um === null) return '—';
  if (unit === 'um') return `${um} µm`;
  return `${roundHalfUp(um / 25.4, 1).toFixed(1)} mil`;
}

export function filmValueDisplay(um: number, unit: FilmUnit): string {
  return unit === 'um' ? `${um}` : roundHalfUp(um / 25.4, 1).toFixed(1);
}

export function pressureStored(value: string, unit: PressureUnit): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  if (unit === 'bar') return roundHalfUp(parsed, 2).toFixed(2);
  return roundHalfUp(parsed / PSI_PER_BAR, 2).toFixed(2);
}

export function pressureDisplay(bar: string, unit: PressureUnit): string {
  if (unit === 'bar') return `${bar} bar`;
  return `${roundHalfUp(Number(bar) * PSI_PER_BAR, 1).toFixed(1)} psi`;
}

export function distanceStored(value: string, unit: DistanceUnit): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return NaN;
  if (unit === 'km') return Math.round(parsed);
  return Math.round(parsed * KM_PER_MILE);
}

export function distanceDisplay(km: number, unit: DistanceUnit): string {
  if (unit === 'km') return `${km} km`;
  return `${Math.round(km / KM_PER_MILE)} mi`;
}

export function distanceUnitLabel(unit: DistanceUnit): string {
  return unit === 'km' ? 'km' : 'mi';
}

export function pressureUnitLabel(unit: PressureUnit): string {
  return unit === 'bar' ? 'bar' : 'psi';
}
