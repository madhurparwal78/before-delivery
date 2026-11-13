// Argument validation for base commands: one reader per kind of value, one refusal shape.
import { COPY } from '../../shared/copy.ts';
import type { Point, StoredObject } from '../../shared/types.ts';
import type { DrawingModel, Refusal } from './types.ts';

/** Messages the brief does not publish; every published one comes from `shared/copy.ts`. */
export const MESSAGE = {
  argsInvalid: 'Arguments must be an object.',
  unknownCommand: (text: string) => `Unknown command "${text}". Press F1 for the command reference.`,
  unknownLayer: 'Choose an existing layer.',
  unknownBlock: 'Choose a block from the library.',
  invalidValue: 'Invalid value.',
  sidesMinimum: 'Enter at least 3 sides.',
  distinctPoints: 'The two points must differ.',
  zeroSize: 'The corners must differ in both directions.',
  notApplicable: 'This does not apply to the selected object.',
  distanceTooLarge: 'The distance is too large for this object.',
  radiusTooLarge: 'The radius is too large for these lines.',
  parallel: 'The lines are parallel.',
  frozenCurrent: 'A frozen layer can\'t be made current.',
  onTheObject: 'Pick a point to one side of the object.',
  contentsRequired: 'Enter the text.',
  sameObject: 'Pick two different objects.',
  mirrorLine: 'The mirror line needs two different points.',
  nothingToSet: 'Choose at least one value to change.',
} as const;

export class Refuse extends Error {
  readonly refusal: Refusal;

  constructor(refusal: Refusal) {
    super('refused');
    this.refusal = refusal;
  }
}

export function invalid(field: string, message: string): never {
  throw new Refuse({ status: 422, body: { errors: { [field]: message } } });
}

const LIMIT = 1e9;
const isCoordinate = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= LIMIT;

function isPoint(value: unknown): value is Point {
  return Array.isArray(value) && value.length === 2 && isCoordinate(value[0]) && isCoordinate(value[1]);
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Reads typed values out of a command's args; a bad value refuses the command naming the field. */
export class Reader {
  readonly values: Record<string, unknown>;
  private readonly model: DrawingModel;

  constructor(args: unknown, model: DrawingModel) {
    if (!isRecord(args)) invalid('args', MESSAGE.argsInvalid);
    this.values = args;
    this.model = model;
  }

  has(key: string): boolean {
    return this.values[key] !== undefined;
  }

  point(key: string): Point {
    const value = this.values[key];
    if (!isPoint(value)) invalid(key, COPY.invalidPoint);
    return value;
  }

  points(key: string, minimum: number): Point[] {
    const value = this.values[key];
    if (!Array.isArray(value) || value.length < minimum || !value.every(isPoint)) invalid(key, COPY.invalidPoint);
    return value;
  }

  finite(key: string): number {
    const value = this.values[key];
    if (!isCoordinate(value)) invalid(key, COPY.notANumber);
    return value;
  }

  positive(key: string): number {
    const value = this.values[key];
    if (!isCoordinate(value) || value <= 0) invalid(key, COPY.positiveNumber);
    return value;
  }

  flag(key: string, fallback: boolean): boolean {
    const value = this.values[key];
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') invalid(key, MESSAGE.invalidValue);
    return value;
  }

  text(key: string): string {
    const value = this.values[key];
    if (typeof value !== 'string') invalid(key, MESSAGE.invalidValue);
    return value;
  }

  oneOf<T extends string>(key: string, allowed: readonly T[]): T {
    const value = this.values[key];
    const match = allowed.find((candidate) => candidate === value);
    if (match === undefined) invalid(key, MESSAGE.invalidValue);
    return match;
  }

  /** One existing object named by `key`. */
  object(key: string): StoredObject {
    const handle = this.values[key];
    const found = typeof handle === 'string' ? this.model.objects.find((o) => o.handle === handle) : undefined;
    if (!found) invalid(key, COPY.noObjectFound);
    return found;
  }

  /** The distinct existing objects listed under `key`, in the model's creation order. */
  objects(key: string): StoredObject[] {
    const handles = this.values[key];
    if (!Array.isArray(handles) || handles.length === 0 || !handles.every((h) => typeof h === 'string')) invalid(key, COPY.noObjectFound);
    const wanted = new Set<string>(handles);
    const found = this.model.objects.filter((o) => wanted.has(o.handle));
    if (found.length !== wanted.size) invalid(key, COPY.noObjectFound);
    return found;
  }
}
