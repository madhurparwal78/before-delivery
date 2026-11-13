import type { Member } from '../shared/api.js';
import {
  formatArea,
  formatCentroid,
  formatDensity,
  formatDimension,
  formatFixed,
  formatLength,
  formatMass,
  formatVolume,
  lengthToDisplay,
  type DisplayUnit,
  type Tolerance,
} from '../shared/units.js';

export type Display = { units: DisplayUnit; precision: number };

export function displayOf(member: Member | null): Display {
  return { units: member?.units ?? 'mm', precision: member?.precision ?? 2 };
}

export const show = {
  length: (mm: number, display: Display) => formatLength(mm, display.units, display.precision),
  area: (mm2: number, display: Display) => formatArea(mm2, display.units, display.precision),
  volume: (mm3: number, display: Display) => formatVolume(mm3, display.units, display.precision),
  mass: (grams: number) => formatMass(grams),
  density: (value: number) => formatDensity(value),
  centroid: (centroid: { x: number; y: number; z: number }, display: Display) =>
    formatCentroid(centroid, display.units, display.precision),
  dimension: (
    valueMm: number,
    tolerance: Tolerance | null,
    display: Display,
    withUnit: boolean,
  ) => formatDimension(valueMm, tolerance, display.units, display.precision, withUnit),
  plain: (mm: number, display: Display) =>
    formatFixed(lengthToDisplay(mm, display.units), display.precision),
};
