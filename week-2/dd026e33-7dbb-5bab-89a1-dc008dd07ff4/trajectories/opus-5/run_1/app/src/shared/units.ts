/** Readings are stored once in micrometres, bar and kilometres; every display derives from the store. */

export type FilmUnit = 'um' | 'mil';
export type PressureUnit = 'bar' | 'psi';
export type DistanceUnit = 'km' | 'mi';

export interface UnitSettings {
  readonly film: FilmUnit;
  readonly pressure: PressureUnit;
  readonly distance: DistanceUnit;
}

export const DEFAULT_UNITS: UnitSettings = { film: 'um', pressure: 'bar', distance: 'km' };

export const FILM_UNITS: readonly FilmUnit[] = ['um', 'mil'];
export const PRESSURE_UNITS: readonly PressureUnit[] = ['bar', 'psi'];
export const DISTANCE_UNITS: readonly DistanceUnit[] = ['km', 'mi'];

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const n = negative ? -numerator : numerator;
  const q = n / denominator;
  const rounded = (n % denominator) * 2n >= denominator ? q + 1n : q;
  return negative ? -rounded : rounded;
}

function decimalToScaled(input: string, scale: number): bigint | null {
  const text = input.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const [whole = '', fraction = ''] = text.split('.');
  if (fraction.length > scale) return null;
  return BigInt(whole + (fraction + '0'.repeat(scale)).slice(0, scale));
}

function formatScaled(value: bigint, scale: number): string {
  const digits = value.toString().padStart(scale + 1, '0');
  if (scale === 0) return digits;
  return `${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`;
}

export const FILM_UNIT_LABEL: Record<FilmUnit, string> = { um: 'µm', mil: 'mil' };
export const PRESSURE_UNIT_LABEL: Record<PressureUnit, string> = { bar: 'bar', psi: 'psi' };
export const DISTANCE_UNIT_LABEL: Record<DistanceUnit, string> = { km: 'km', mi: 'mi' };

/** Whole micrometres shown in the chosen film unit: `158` or `6.2`. */
export function filmValue(filmUm: number, unit: FilmUnit): string {
  if (unit === 'um') return String(filmUm);
  return formatScaled(roundHalfUp(BigInt(filmUm) * 100n, 254n), 1);
}

export function filmReading(filmUm: number, unit: FilmUnit): string {
  return `${filmValue(filmUm, unit)} ${FILM_UNIT_LABEL[unit]}`;
}

/** Parses a reading typed in the chosen unit into whole stored micrometres. */
export function filmToUm(input: string, unit: FilmUnit): number | null {
  if (unit === 'um') {
    const scaled = decimalToScaled(input, 0);
    return scaled === null ? null : Number(scaled);
  }
  const scaled = decimalToScaled(input, 2);
  if (scaled === null) return null;
  return Number(roundHalfUp(scaled * 254n, 1000n));
}

/** A stored bar string shown in the chosen pressure unit. */
export function pressureValue(bar: string, unit: PressureUnit): string {
  const scaled = decimalToScaled(bar, 2);
  if (scaled === null) return bar;
  if (unit === 'bar') return formatScaled(scaled, 2);
  return formatScaled(roundHalfUp(scaled * 145038n, 1000000n), 1);
}

export function pressureReading(bar: string, unit: PressureUnit): string {
  return `${pressureValue(bar, unit)} ${PRESSURE_UNIT_LABEL[unit]}`;
}

/** Parses a pressure typed in the chosen unit into a stored bar string with two decimals. */
export function pressureToBar(input: string, unit: PressureUnit): string | null {
  const scaled = decimalToScaled(input, 2);
  if (scaled === null) return null;
  if (unit === 'bar') return formatScaled(scaled, 2);
  return formatScaled(roundHalfUp(scaled * 10000n, 145038n), 2);
}

export function distanceValue(km: number, unit: DistanceUnit): string {
  if (unit === 'km') return String(km);
  return roundHalfUp(BigInt(km) * 1000000n, 1609344n).toString();
}

export function distanceReading(km: number, unit: DistanceUnit): string {
  return `${distanceValue(km, unit)} ${DISTANCE_UNIT_LABEL[unit]}`;
}

export function distanceToKm(input: string, unit: DistanceUnit): number | null {
  const scaled = decimalToScaled(input, 0);
  if (scaled === null) return null;
  if (unit === 'km') return Number(scaled);
  return Number(roundHalfUp(scaled * 1609344n, 1000000n));
}

/** A stored two-decimal voltage, shown as `12.62 V`. */
export function voltageReading(batteryV: string): string {
  return `${batteryV} V`;
}

export function parseTwoDecimals(input: string): string | null {
  const scaled = decimalToScaled(input, 2);
  return scaled === null ? null : formatScaled(scaled, 2);
}

export function twoDecimalsToScaled(value: string): bigint | null {
  return decimalToScaled(value, 2);
}
