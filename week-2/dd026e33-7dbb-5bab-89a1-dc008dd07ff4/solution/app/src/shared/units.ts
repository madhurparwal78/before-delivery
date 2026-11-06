// Unit conversion (brief: Business rules › Units). Readings are stored once as integer µm,
// bar with two decimals and integer km; every display and every input conversion goes through here.
import { formatScaled, parseDecimal, roundHalfUp, type Rational } from "./decimal.js";

export type FilmUnit = "um" | "mil";
export type PressureUnit = "bar" | "psi";
export type DistanceUnit = "km" | "mi";

export interface Units {
  film: FilmUnit;
  pressure: PressureUnit;
  distance: DistanceUnit;
}

export const FILM_SYMBOL: Record<FilmUnit, string> = { um: "µm", mil: "mil" };
export const PRESSURE_SYMBOL: Record<PressureUnit, string> = { bar: "bar", psi: "psi" };
export const DISTANCE_SYMBOL: Record<DistanceUnit, string> = { km: "km", mi: "mi" };

// Conversion factors as exact rationals.
const UM_PER_MIL: Rational = { num: 254n, den: 10n }; // 25.4
const PSI_PER_BAR: Rational = { num: 145038n, den: 10000n }; // 14.5038
const KM_PER_MI: Rational = { num: 1609344n, den: 1000000n }; // 1.609344

/** Film build in the chosen unit, as written on screen: "158 µm" or "6.2 mil". */
export function formatFilm(um: number, unit: FilmUnit): string {
  return `${filmValue(um, unit)} ${FILM_SYMBOL[unit]}`;
}

/** The number part only: whole µm, or mil to one decimal. */
export function filmValue(um: number, unit: FilmUnit): string {
  if (unit === "um") return String(um);
  const tenths = roundHalfUp(BigInt(um) * 10n * UM_PER_MIL.den, UM_PER_MIL.num);
  return formatScaled(tenths, 1);
}

/** A typed film reading converted to whole µm, or null when it is not a number. */
export function filmToMicrometres(text: string, unit: FilmUnit): number | null {
  const value = parseDecimal(text);
  if (!value) return null;
  const um = unit === "um" ? roundHalfUp(value.num, value.den) : roundHalfUp(value.num * UM_PER_MIL.num, value.den * UM_PER_MIL.den);
  return Number(um);
}

/** Pressure stored as centibar (bar × 100) shown in the chosen unit: "2.20 bar" or "31.9 psi". */
export function formatPressure(centibar: number, unit: PressureUnit): string {
  return `${pressureValue(centibar, unit)} ${PRESSURE_SYMBOL[unit]}`;
}

function pressureValue(centibar: number, unit: PressureUnit): string {
  if (unit === "bar") return formatScaled(BigInt(centibar), 2);
  const tenths = roundHalfUp(BigInt(centibar) * PSI_PER_BAR.num, 10n * PSI_PER_BAR.den);
  return formatScaled(tenths, 1);
}

/** A typed pressure converted to centibar, or null when it is not a number. */
export function pressureToCentibar(text: string, unit: PressureUnit): number | null {
  const value = parseDecimal(text);
  if (!value) return null;
  const centibar =
    unit === "bar"
      ? roundHalfUp(value.num * 100n, value.den)
      : roundHalfUp(value.num * 100n * PSI_PER_BAR.den, value.den * PSI_PER_BAR.num);
  return Number(centibar);
}

/** Distance stored as km shown in the chosen unit: "48210 km" or "29957 mi". */
export function formatDistance(km: number, unit: DistanceUnit): string {
  return `${distanceValue(km, unit)} ${DISTANCE_SYMBOL[unit]}`;
}

function distanceValue(km: number, unit: DistanceUnit): string {
  if (unit === "km") return String(km);
  return roundHalfUp(BigInt(km) * KM_PER_MI.den, KM_PER_MI.num).toString();
}

/** A typed odometer reading converted to whole km, or null when it is not a number. */
export function distanceToKilometres(text: string, unit: DistanceUnit): number | null {
  const value = parseDecimal(text);
  if (!value) return null;
  const km = unit === "km" ? roundHalfUp(value.num, value.den) : roundHalfUp(value.num * KM_PER_MI.num, value.den * KM_PER_MI.den);
  return Number(km);
}

/** Centibar as the API's bar string with two decimals ("2.20"). */
export function centibarText(centibar: number): string {
  return formatScaled(BigInt(centibar), 2);
}
