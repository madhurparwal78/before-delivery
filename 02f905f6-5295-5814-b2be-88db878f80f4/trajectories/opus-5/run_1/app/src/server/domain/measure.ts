import type { Cone, GlazeCone, Plan, Shape, SidesIn, Unit } from '../../shared/types';
import { clayRatedFor, planHasGlaze } from '../../shared/labels';

/**
 * Sizes are held in half-inch units: a rounded side of 3.5 in is 7 half-units.
 * Every size on a piece is a multiple of 0.5 in, so half-units keep the
 * arithmetic exact.
 */
export const HALF_UNITS_PER_INCH = 2;
export const MAX_SIDE_HALF_UNITS = 46; // 23.0 in
export const PLATE_FLOOR_HALF_UNITS = 3; // 1.5 in

export interface MeasuredSides {
  shape: Shape;
  /** Along x at 0 degrees. For round and plate this is the diameter. */
  width: number;
  /** Along y at 0 degrees. For round and plate this is the diameter. */
  depth: number;
  height: number;
}

export interface Measured extends MeasuredSides {
  /** Cubic inches in thousandths. */
  cubicMilli: number;
}

export type FieldErrors = Record<string, string>;

export const MSG = {
  shape: 'Choose a shape',
  unit: 'Choose cm or in',
  plan: 'Choose a firing plan',
  sizeAboveZero: 'Enter a size above 0',
  sizeDecimals: 'Enter a number with at most two decimals',
  sizeTooLarge: 'Too large for the shelf: 23 in at most',
  tooTall: (maxIn: string) => `Too tall for any kiln: ${maxIn} in at most`,
  clay: 'Choose a clay body',
  cone: 'Choose a glaze cone',
  clayNotRated: (cone: Cone) => `Clay not rated for cone ${cone}`,
  photoMissing: 'Add a photo of the piece',
  photoUsed: 'Photo already used or not yours',
  guestName: 'Enter a name',
  guestEmail: 'Enter a valid email',
} as const;

const SHAPES: Shape[] = ['round', 'rectangular', 'plate'];
const UNITS: Unit[] = ['in', 'cm'];
const PLANS: Plan[] = ['bisque_and_glaze', 'bisque_only', 'glaze_only'];
const GLAZE_CONES: GlazeCone[] = ['06', '6'];

export function parseShape(raw: unknown): Shape | null {
  return typeof raw === 'string' && (SHAPES as string[]).includes(raw) ? (raw as Shape) : null;
}

export function parseUnit(raw: unknown): Unit | null {
  return typeof raw === 'string' && (UNITS as string[]).includes(raw) ? (raw as Unit) : null;
}

export function parsePlan(raw: unknown): Plan | null {
  return typeof raw === 'string' && (PLANS as string[]).includes(raw) ? (raw as Plan) : null;
}

export function parseGlazeCone(raw: unknown): GlazeCone | null {
  return typeof raw === 'string' && (GLAZE_CONES as string[]).includes(raw)
    ? (raw as GlazeCone)
    : null;
}

/** Size keys a shape asks for, in the order they appear on the form. */
export function sizeKeysFor(shape: Shape): ('length' | 'width' | 'diameter' | 'height')[] {
  return shape === 'rectangular' ? ['length', 'width', 'height'] : ['diameter', 'height'];
}

interface SizeNumber {
  /** The typed value in hundredths of the chosen unit, truncated. */
  hundredths: number;
  tooPrecise: boolean;
}

function parseSizeNumber(raw: unknown): SizeNumber | 'missing' | 'malformed' {
  if (raw === undefined || raw === null) return 'missing';
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : null;
  if (text === null) return 'malformed';
  if (text === '') return 'missing';
  if (!/^-?(\d+(\.\d+)?|\.\d+)$/.test(text)) return 'malformed';
  const unsigned = text.replace('-', '');
  const [whole = '', fraction = ''] = unsigned.split('.');
  const sign = text.startsWith('-') ? -1 : 1;
  const hundredths = sign * (Number(whole || '0') * 100 + Number((fraction + '00').slice(0, 2)));
  return { hundredths, tooPrecise: fraction.length > 2 };
}

/** Rounds a typed size up to the next half inch, exactly. */
function roundUpToHalfInch(hundredths: number, unit: Unit): number {
  // in: (h/100) inches -> ceil(h/50) half-units.  cm: (h/100)/2.54 inches -> ceil(h/127).
  const divisor = unit === 'in' ? 50 : 127;
  return Math.ceil(hundredths / divisor);
}

export interface MeasureInput {
  shape?: unknown;
  unit?: unknown;
  length?: unknown;
  width?: unknown;
  diameter?: unknown;
  height?: unknown;
}

export interface MeasureOutcome {
  measured: Measured | null;
  shape: Shape | null;
  unit: Unit | null;
  fields: FieldErrors;
}

/**
 * Turns typed sizes into the rounded sides and cubic inches of a piece.
 * The only place the house measuring rules live.
 */
export function measure(input: MeasureInput, maxHeightHalfUnits: number): MeasureOutcome {
  const fields: FieldErrors = {};
  const shape = parseShape(input.shape);
  const unit = parseUnit(input.unit);
  if (!shape) fields.shape = MSG.shape;
  if (!unit) fields.unit = MSG.unit;

  if (!shape || !unit) return { measured: null, shape, unit, fields };

  const halfUnits: Partial<Record<'length' | 'width' | 'diameter' | 'height', number>> = {};
  for (const key of sizeKeysFor(shape)) {
    const parsed = parseSizeNumber(input[key]);
    if (parsed === 'missing') {
      fields[key] = MSG.sizeAboveZero;
      continue;
    }
    if (parsed === 'malformed') {
      fields[key] = MSG.sizeDecimals;
      continue;
    }
    if (parsed.hundredths <= 0) {
      fields[key] = MSG.sizeAboveZero;
      continue;
    }
    if (parsed.tooPrecise) {
      fields[key] = MSG.sizeDecimals;
      continue;
    }
    let rounded = roundUpToHalfInch(parsed.hundredths, unit);
    if (key === 'height' && shape === 'plate' && rounded < PLATE_FLOOR_HALF_UNITS) {
      rounded = PLATE_FLOOR_HALF_UNITS;
    }
    if (rounded > MAX_SIDE_HALF_UNITS) {
      fields[key] = MSG.sizeTooLarge;
      continue;
    }
    if (key === 'height' && rounded > maxHeightHalfUnits) {
      fields[key] = MSG.tooTall(halfUnitsToInches(maxHeightHalfUnits));
      continue;
    }
    halfUnits[key] = rounded;
  }

  if (Object.keys(fields).length > 0) return { measured: null, shape, unit, fields };

  const height = halfUnits.height as number;
  const width = shape === 'rectangular' ? (halfUnits.length as number) : (halfUnits.diameter as number);
  const depth = shape === 'rectangular' ? (halfUnits.width as number) : (halfUnits.diameter as number);
  return {
    measured: { shape, width, depth, height, cubicMilli: cubicMilliOf(width, depth, height) },
    shape,
    unit,
    fields,
  };
}

/** Cubic inches in thousandths: three half-unit sides give eighths of an inch cubed. */
export function cubicMilliOf(width: number, depth: number, height: number): number {
  return (width * depth * height * 1000) / 8;
}

export function halfUnitsToInches(halfUnits: number): string {
  return (halfUnits / HALF_UNITS_PER_INCH).toFixed(1);
}

export function cubicMilliToString(cubicMilli: number): string {
  return (cubicMilli / 1000).toFixed(3);
}

export function sidesInOf(sides: MeasuredSides): SidesIn {
  if (sides.shape === 'rectangular') {
    return {
      length: halfUnitsToInches(sides.width),
      width: halfUnitsToInches(sides.depth),
      height: halfUnitsToInches(sides.height),
    };
  }
  return {
    diameter: halfUnitsToInches(sides.width),
    height: halfUnitsToInches(sides.height),
  };
}

/** The glaze cone an intake needs, or the field error that stops it. */
export function checkCone(plan: Plan, raw: unknown, clayMaxCone: Cone | null): {
  cone: GlazeCone | null;
  error: string | null;
} {
  if (!planHasGlaze(plan)) return { cone: null, error: null };
  const cone = parseGlazeCone(raw);
  if (!cone) return { cone: null, error: MSG.cone };
  if (clayMaxCone && !clayRatedFor(clayMaxCone, cone)) {
    return { cone: null, error: MSG.clayNotRated(cone) };
  }
  return { cone, error: null };
}
