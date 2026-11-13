// Typed input of the command line: coordinates, numbers, handles (brief: Business rules > Formats > Coordinate input).
import { round6, unitsToMm } from '../../../shared/format.ts';
import type { Point, Units } from '../../../shared/types.ts';

const NUMBER = '-?\\d+(?:\\.\\d+)?';
const ABSOLUTE = new RegExp(`^(${NUMBER}),(${NUMBER})$`);
const RELATIVE = new RegExp(`^@(${NUMBER}),(${NUMBER})$`);
const POLAR = new RegExp(`^@(${NUMBER})<(${NUMBER})$`);
const NUMERIC = new RegExp(`^${NUMBER}$`);
const HANDLE = /^#([0-9A-Za-z]+)$/;

export const roundPoint = (point: Point): Point => [round6(point[0]), round6(point[1])];

/** A typed point in the drawing's units, relative forms measured from `last`; null when it is not a coordinate. */
export function parsePoint(text: string, last: Point, units: Units): Point | null {
  const absolute = ABSOLUTE.exec(text);
  if (absolute) return roundPoint([unitsToMm(Number(absolute[1]), units), unitsToMm(Number(absolute[2]), units)]);
  const relative = RELATIVE.exec(text);
  if (relative) {
    return roundPoint([last[0] + unitsToMm(Number(relative[1]), units), last[1] + unitsToMm(Number(relative[2]), units)]);
  }
  const polar = POLAR.exec(text);
  if (polar) {
    const distance = unitsToMm(Number(polar[1]), units);
    const radians = (Number(polar[2]) * Math.PI) / 180;
    return roundPoint([last[0] + distance * Math.cos(radians), last[1] + distance * Math.sin(radians)]);
  }
  return null;
}

/** A plain number as typed, or null. */
export const parseNumber = (text: string): number | null => (NUMERIC.test(text) ? Number(text) : null);

/** `#1A` names the object with handle `1A`. */
export function parseHandle(text: string): string | null {
  const match = HANDLE.exec(text);
  return match?.[1] ? match[1].toUpperCase() : null;
}
