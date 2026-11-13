import { parseTimestamp, withinObservationWindow } from '../shared/clock.js';
import { isTrainId, resolveOptics } from '../shared/optics.js';
import { derivePair, isSkyPoint, samePoint } from '../shared/pair.js';
import { roundHalfUp } from '../shared/round.js';
import type {
  Kit,
  MeasuredPair,
  ObjectKind,
  ObservationFieldName,
  Optics,
} from '../shared/types.js';
import { FieldErrors, notFound } from './errors.js';

export const CONCENTRATION_CLASSES: readonly string[] = [
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
  'XI',
  'XII',
];

export const MAX_DESCRIPTION = 4000;

export interface FieldPatch {
  observed_at?: Date | null;
  seeing?: number | null;
  transparency_nelm?: number | null;
  concentration_class?: string | null;
  pair?: MeasuredPair | null;
  description?: string;
  optics?: Optics;
}

export interface FieldContext {
  kit: Kit;
  kind: ObjectKind;
  startedAt: Date;
}

/**
 * Optics must name the observer's own kit. A structurally incomplete selection
 * fails validation; a well-formed id the account does not own is a 404.
 */
export function validateOptics(kit: Kit, value: unknown): Optics {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    new FieldErrors().add('optics').throwIfAny();
  }
  const raw = value as Record<string, unknown>;
  const errors = new FieldErrors();
  const telescopeId = raw.telescope_id;
  const eyepieceId = raw.eyepiece_id;
  const barlowId = raw.barlow_id ?? null;
  if (typeof telescopeId !== 'string' || typeof eyepieceId !== 'string') errors.add('optics');
  if (barlowId !== null && typeof barlowId !== 'string') errors.add('optics');
  if (!isTrainId(raw.train)) errors.add('train');
  errors.throwIfAny();

  const optics: Optics = {
    telescope_id: telescopeId as string,
    eyepiece_id: eyepieceId as string,
    barlow_id: barlowId as string | null,
    train: raw.train as Optics['train'],
  };
  if (!resolveOptics(kit, optics)) throw notFound();
  return optics;
}

function readTransparency(value: unknown, errors: FieldErrors): number | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.add('transparency_nelm');
    return undefined;
  }
  const oneDecimal = roundHalfUp(value, 1);
  if (value < 1 || value > 8 || Math.abs(oneDecimal - value) > 1e-9) {
    errors.add('transparency_nelm');
    return undefined;
  }
  return oneDecimal;
}

function readPair(
  value: unknown,
  kind: ObjectKind,
  errors: FieldErrors,
): MeasuredPair | null | undefined {
  if (value === null) return null;
  if (kind !== 'double_star' || typeof value !== 'object' || Array.isArray(value)) {
    errors.add('pair');
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  if (!isSkyPoint(raw.primary) || !isSkyPoint(raw.secondary)) {
    errors.add('pair');
    return undefined;
  }
  if (samePoint(raw.primary, raw.secondary)) {
    errors.add('pair');
    return undefined;
  }
  return derivePair({ primary: raw.primary, secondary: raw.secondary });
}

/** Validate the `fields` object of a create or update and name the fields it touches. */
export function validateFields(
  fields: Record<string, unknown>,
  context: FieldContext,
): { patch: FieldPatch; touched: ObservationFieldName[] } {
  const errors = new FieldErrors();
  const patch: FieldPatch = {};
  const touched: ObservationFieldName[] = [];

  if ('observed_at' in fields) {
    touched.push('observed_at');
    const value = fields.observed_at;
    if (value === null) patch.observed_at = null;
    else {
      const parsed = parseTimestamp(value);
      if (!parsed || !withinObservationWindow(parsed, context.startedAt)) {
        errors.add('observed_at');
      } else patch.observed_at = parsed;
    }
  }

  if ('seeing' in fields) {
    touched.push('seeing');
    const value = fields.seeing;
    if (value === null) patch.seeing = null;
    else if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 10) {
      errors.add('seeing');
    } else patch.seeing = value;
  }

  if ('transparency_nelm' in fields) {
    touched.push('transparency_nelm');
    const value = readTransparency(fields.transparency_nelm, errors);
    if (value !== undefined) patch.transparency_nelm = value;
  }

  if ('concentration_class' in fields) {
    touched.push('concentration_class');
    const value = fields.concentration_class;
    if (value === null) patch.concentration_class = null;
    else if (
      context.kind !== 'globular' ||
      typeof value !== 'string' ||
      !CONCENTRATION_CLASSES.includes(value)
    ) {
      errors.add('concentration_class');
    } else patch.concentration_class = value;
  }

  if ('pair' in fields) {
    touched.push('pair');
    const value = readPair(fields.pair, context.kind, errors);
    if (value !== undefined) patch.pair = value;
  }

  if ('description' in fields) {
    touched.push('description');
    const value = fields.description;
    if (value === null) patch.description = '';
    else if (typeof value !== 'string' || value.trim().length > MAX_DESCRIPTION) {
      errors.add('description');
    } else patch.description = value;
  }

  errors.throwIfAny();

  if ('optics' in fields) {
    touched.push('optics');
    patch.optics = validateOptics(context.kit, fields.optics);
  }

  return { patch, touched };
}
