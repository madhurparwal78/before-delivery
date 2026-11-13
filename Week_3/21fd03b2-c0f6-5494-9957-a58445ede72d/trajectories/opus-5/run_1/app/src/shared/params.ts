import { fieldCopy, rangeCopy } from './copy.js';
import { roundTo } from './dmath.js';

export type ObjectKind = 'ramp' | 'pendulum' | 'launcher' | 'crate' | 'model';
export type RigKind = 'ramp' | 'pendulum' | 'launcher' | 'crate';
export type UnitGroup = 'mass' | 'length' | 'angle' | 'none';

export interface ParamSpec {
  readonly key: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly def: number;
  readonly step: number;
  readonly units: UnitGroup;
}

export const GRAVITY_SPEC: ParamSpec = {
  key: 'gravity',
  label: 'Gravity (m/s²)',
  min: 0.1,
  max: 30,
  def: 9.81,
  step: 0.01,
  units: 'none',
};

export const PARAM_SPECS: Readonly<Record<RigKind, readonly ParamSpec[]>> = {
  ramp: [
    { key: 'mass_kg', label: 'Mass (kg)', min: 0.1, max: 100, def: 1, step: 0.1, units: 'mass' },
    { key: 'angle_deg', label: 'Angle (degrees)', min: 1, max: 60, def: 30, step: 1, units: 'angle' },
    { key: 'length_m', label: 'Length (m)', min: 0.5, max: 20, def: 3, step: 0.1, units: 'length' },
    { key: 'friction', label: 'Friction', min: 0, max: 1, def: 0, step: 0.01, units: 'none' },
  ],
  pendulum: [
    { key: 'mass_kg', label: 'Mass (kg)', min: 0.1, max: 100, def: 0.5, step: 0.1, units: 'mass' },
    { key: 'length_m', label: 'Length (m)', min: 0.1, max: 10, def: 1, step: 0.1, units: 'length' },
    {
      key: 'release_deg',
      label: 'Release angle (degrees)',
      min: 1,
      max: 80,
      def: 20,
      step: 1,
      units: 'angle',
    },
  ],
  launcher: [
    { key: 'mass_kg', label: 'Mass (kg)', min: 0.1, max: 100, def: 0.2, step: 0.1, units: 'mass' },
    {
      key: 'speed_mps',
      label: 'Launch speed (m/s)',
      min: 0.1,
      max: 50,
      def: 5,
      step: 0.1,
      units: 'none',
    },
    {
      key: 'launch_angle_deg',
      label: 'Launch angle (degrees)',
      min: 0,
      max: 89,
      def: 45,
      step: 1,
      units: 'angle',
    },
    {
      key: 'height_m',
      label: 'Launch height (m)',
      min: 0,
      max: 20,
      def: 1,
      step: 0.1,
      units: 'length',
    },
  ],
  crate: [
    { key: 'mass_kg', label: 'Mass (kg)', min: 0.1, max: 100, def: 1, step: 0.1, units: 'mass' },
  ],
};

export const POSITION_LABELS = ['Position X (m)', 'Position Y (m)', 'Position Z (m)'] as const;
export const POSITION_LIMIT = 500;
export const SCALE_MIN = 0.01;
export const SCALE_MAX = 100;

export function specsFor(kind: ObjectKind): readonly ParamSpec[] {
  return kind === 'model' ? [] : PARAM_SPECS[kind];
}

export function findSpec(kind: ObjectKind, key: string): ParamSpec | undefined {
  return specsFor(kind).find((spec) => spec.key === key);
}

export function defaultParams(kind: ObjectKind): Record<string, number> {
  const params: Record<string, number> = {};
  for (const spec of specsFor(kind)) params[spec.key] = spec.def;
  return params;
}

export function inRange(spec: ParamSpec, value: number): boolean {
  return Number.isFinite(value) && value >= spec.min && value <= spec.max;
}

export function rangeMessage(spec: ParamSpec): string {
  return rangeCopy(String(spec.min), String(spec.max));
}

const MASS_UNITS: Record<string, number> = { kg: 1, g: 0.001, lb: 0.45359237 };
const LENGTH_UNITS: Record<string, number> = { m: 1, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048 };
const ANGLE_UNITS: Record<string, number> = { deg: 1, rad: 57.29577951308232 };

function unitTable(group: UnitGroup): Record<string, number> | null {
  if (group === 'mass') return MASS_UNITS;
  if (group === 'length') return LENGTH_UNITS;
  if (group === 'angle') return ANGLE_UNITS;
  return null;
}

export function unitErrorFor(group: UnitGroup): string {
  if (group === 'mass') return fieldCopy.massUnit;
  if (group === 'angle') return fieldCopy.angleUnit;
  return fieldCopy.lengthUnit;
}

export type ParseResult =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly message: string };

const NUMBER_THEN_UNIT = /^(-?(?:\d+(?:\.\d*)?|\.\d+))\s*([a-z]*)$/;

/** Parses a parameter field's text into its SI value. */
export function parseParameterText(text: string, group: UnitGroup): ParseResult {
  const trimmed = text.trim();
  const match = NUMBER_THEN_UNIT.exec(trimmed);
  if (!match) return { ok: false, message: fieldCopy.notANumber };
  const raw = Number(match[1]);
  if (!Number.isFinite(raw)) return { ok: false, message: fieldCopy.notANumber };
  const unit = match[2];
  if (unit === '') return { ok: true, value: raw };
  const table = unitTable(group);
  if (!table) return { ok: false, message: fieldCopy.notANumber };
  const factor = table[unit];
  if (factor === undefined) return { ok: false, message: unitErrorFor(group) };
  return { ok: true, value: raw * factor };
}

/** The value as shown on blur: SI, at most 6 decimals, trailing zeros dropped. */
export function formatSI(value: number): string {
  return String(roundTo(value, 6));
}
