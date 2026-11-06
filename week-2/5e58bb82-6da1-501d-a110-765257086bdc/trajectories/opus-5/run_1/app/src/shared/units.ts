import { fixed, roundHalfUp } from './numbers.js';
import type { Units } from './types.js';

export const METRES_PER_FOOT = 0.3048;
export const METRES_PER_SECOND_PER_KNOT = 1852 / 3600;
export const SQUARE_METRES_PER_SQUARE_FOOT = 0.09290304;

/** The preference changes display only; stored and transmitted values stay in SI. */

export function lengthText(metres: number, units: Units): string {
  return units === 'imperial'
    ? `${fixed(metres / METRES_PER_FOOT, 1)} ft`
    : `${fixed(metres, 1)} m`;
}

export function lengthValue(metres: number, units: Units): number {
  return units === 'imperial' ? metres / METRES_PER_FOOT : metres;
}

export function lengthToSi(value: number, units: Units): number {
  return units === 'imperial' ? value * METRES_PER_FOOT : value;
}

export function speedText(metresPerSecond: number, units: Units): string {
  return units === 'imperial'
    ? `${fixed(metresPerSecond / METRES_PER_SECOND_PER_KNOT, 1)} kn`
    : `${fixed(metresPerSecond, 1)} m/s`;
}

export function speedToSi(value: number, units: Units): number {
  return units === 'imperial' ? value * METRES_PER_SECOND_PER_KNOT : value;
}

export function areaText(squareMetres: number, units: Units): string {
  return units === 'imperial'
    ? `${roundHalfUp(squareMetres / SQUARE_METRES_PER_SQUARE_FOOT)} ft²`
    : `${roundHalfUp(squareMetres)} m²`;
}

export function hoursText(hours: number): string {
  return `${fixed(hours, 1)} h`;
}

export function lengthUnitLabel(units: Units): string {
  return units === 'imperial' ? 'ft' : 'm';
}

export function speedUnitLabel(units: Units): string {
  return units === 'imperial' ? 'kn' : 'm/s';
}

export function vertexUnitWord(units: Units): string {
  return units === 'imperial' ? 'feet' : 'metres';
}

/** A grid position, shown with each ordinate in the user's length unit. */
export function positionText(easting: number, northing: number, units: Units): string {
  return `E ${fixed(lengthValue(easting, units), 1)} N ${fixed(lengthValue(northing, units), 1)}`;
}
