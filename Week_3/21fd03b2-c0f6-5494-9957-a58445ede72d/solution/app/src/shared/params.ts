import { COPY } from "./copy";

export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];
export type RigKind = "ramp" | "pendulum" | "launcher" | "crate";
export type ObjectKind = RigKind | "model";
export type UnitGroup = "mass" | "length" | "angle" | "none";

export interface ParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
  step: number;
  group: UnitGroup;
  unit: string;
}

export const GRAVITY_DEF: ParamDef = { key: "gravity", label: "Gravity (m/s²)", min: 0.1, max: 30, default: 9.81, step: 0.01, group: "none", unit: "m/s²" };

const mass = (def: number): ParamDef => ({ key: "mass_kg", label: "Mass (kg)", min: 0.1, max: 100, default: def, step: 0.1, group: "mass", unit: "kg" });

export const RIG_PARAMS: Record<RigKind, ParamDef[]> = {
  ramp: [
    mass(1),
    { key: "angle_deg", label: "Angle (degrees)", min: 1, max: 60, default: 30, step: 1, group: "angle", unit: "deg" },
    { key: "length_m", label: "Length (m)", min: 0.5, max: 20, default: 3, step: 0.1, group: "length", unit: "m" },
    { key: "friction", label: "Friction", min: 0, max: 1, default: 0, step: 0.01, group: "none", unit: "" },
  ],
  pendulum: [
    mass(0.5),
    { key: "length_m", label: "Length (m)", min: 0.1, max: 10, default: 1, step: 0.1, group: "length", unit: "m" },
    { key: "release_deg", label: "Release angle (degrees)", min: 1, max: 80, default: 20, step: 1, group: "angle", unit: "deg" },
  ],
  launcher: [
    mass(0.2),
    { key: "speed_mps", label: "Launch speed (m/s)", min: 0.1, max: 50, default: 5, step: 0.1, group: "none", unit: "m/s" },
    { key: "launch_angle_deg", label: "Launch angle (degrees)", min: 0, max: 89, default: 45, step: 1, group: "angle", unit: "deg" },
    { key: "height_m", label: "Launch height (m)", min: 0, max: 20, default: 1, step: 0.1, group: "length", unit: "m" },
  ],
  crate: [mass(1)],
};

export const KIND_LABEL: Record<RigKind, string> = { ramp: "Ramp", pendulum: "Pendulum", launcher: "Launcher", crate: "Crate" };

export function isRigKind(kind: string): kind is RigKind {
  return kind === "ramp" || kind === "pendulum" || kind === "launcher" || kind === "crate";
}

export function paramDefs(kind: ObjectKind): ParamDef[] {
  return kind === "model" ? [] : RIG_PARAMS[kind];
}

export function defaultParams(kind: RigKind): Record<string, number> {
  return Object.fromEntries(RIG_PARAMS[kind].map((def) => [def.key, def.default]));
}

export const POSITION_LIMIT = 500;
const SCALE_MIN = 0.01;
const SCALE_MAX = 100;
const NAME_MAX = 60;

export const MATERIALS = [
  { name: "Frictionless", friction: 0 },
  { name: "Ice", friction: 0.05 },
  { name: "Polished wood", friction: 0.2 },
  { name: "Rubber mat", friction: 0.8 },
] as const;

const FACTORS: Record<UnitGroup, Record<string, number>> = {
  mass: { kg: 1, g: 0.001, lb: 0.45359237 },
  length: { m: 1, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048 },
  angle: { deg: 1, rad: 180 / Math.PI },
  none: {},
};
const UNIT_ERROR: Record<UnitGroup, string> = { mass: COPY.massUnit, length: COPY.lengthUnit, angle: COPY.angleUnit, none: COPY.notANumber };

function roundTo(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

export function rangeError(def: Pick<ParamDef, "min" | "max">): string {
  return COPY.range(def.min, def.max);
}

type Entry = { ok: true; si: number } | { ok: false; error: string };

/** Parameter entry: a decimal number, optional spaces, an optional lowercase unit. Returns the converted SI value. */
function parseEntry(text: string, group: UnitGroup): Entry {
  const found = /^\s*(-?\d+(?:\.\d*)?)\s*(.*?)\s*$/.exec(text);
  if (!found) return { ok: false, error: COPY.notANumber };
  const unit = found[2];
  const factors = FACTORS[group];
  if (unit !== "" && !Object.prototype.hasOwnProperty.call(factors, unit)) return { ok: false, error: UNIT_ERROR[group] };
  const factor = unit === "" ? 1 : factors[unit];
  return { ok: true, si: roundTo(Number(found[1]) * factor, 9) };
}

/** Parse then range-check against a definition. */
export function parseParamEntry(text: string, def: ParamDef): Entry {
  const entry = parseEntry(text, def.group);
  if (!entry.ok) return entry;
  return inRange(entry.si, def) ? entry : { ok: false, error: rangeError(def) };
}

export function inRange(value: number, def: Pick<ParamDef, "min" | "max">): boolean {
  return Number.isFinite(value) && value >= def.min && value <= def.max;
}

/** On blur a field shows the SI value rounded to at most 6 decimals with trailing zeros dropped. */
export function formatSi(value: number): string {
  return String(Number(value.toFixed(6)));
}

export function validName(name: unknown): name is string {
  if (typeof name !== "string") return false;
  const length = [...name.trim()].length;
  return length >= 1 && length <= NAME_MAX;
}

export function transformValid(field: "position" | "rotation" | "scale", value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const length = field === "rotation" ? 4 : 3;
  if (value.length !== length || !value.every((n) => typeof n === "number" && Number.isFinite(n))) return false;
  if (field === "position") return (value as number[]).every((n) => Math.abs(n) <= POSITION_LIMIT);
  if (field === "scale") return (value as number[]).every((n) => n >= SCALE_MIN && n <= SCALE_MAX);
  const [x, y, z, w] = value as number[];
  return Math.abs(Math.sqrt(x * x + y * y + z * z + w * w) - 1) <= 1e-5;
}

export function roundMillionth(value: number): number {
  return roundTo(value, 6);
}

export const ID_PATTERN = /^[a-z0-9-]{1,40}$/;
