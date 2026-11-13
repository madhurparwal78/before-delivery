import { ApiError } from '../http/errors.js';
import { DEFECT_KINDS, GRADES, MAX_PIECES, SPECIES } from './constants.js';
import type { PieceInput } from './geometry.js';

export interface Fields {
  [field: string]: string;
}

export function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

export function validateIntake(body: unknown): { lot: string; species: string; lengthMm: number; widthMm: number; thicknessMm: number; defects: Array<{ kind: string; startMm: number; endMm: number }> } {
  const fields: Fields = {};
  const record = asRecord(body);
  const lot = typeof record['lot'] === 'string' ? (record['lot'] as string) : undefined;
  if (!lot) fields['lot'] = 'Choose a lot.';
  const species = record['species'];
  if (typeof species !== 'string' || !SPECIES.includes(species as (typeof SPECIES)[number])) {
    fields['species'] = 'Choose a species.';
  }
  const lengthMm = record['length_mm'];
  if (!isInteger(lengthMm) || lengthMm < 300 || lengthMm > 12000) fields['length_mm'] = 'Length must be between 300 and 12,000 mm.';
  const widthMm = record['width_mm'];
  if (!isInteger(widthMm) || widthMm < 20 || widthMm > 600) fields['width_mm'] = 'Width must be between 20 and 600 mm.';
  const thicknessMm = record['thickness_mm'];
  if (!isInteger(thicknessMm) || thicknessMm < 10 || thicknessMm > 400) fields['thickness_mm'] = 'Thickness must be between 10 and 400 mm.';
  const defectsRaw = record['defects'];
  const defects: Array<{ kind: string; startMm: number; endMm: number }> = [];
  if (defectsRaw !== undefined && !Array.isArray(defectsRaw)) fields['defects'] = 'Defect zones must be a list.';
  if (Array.isArray(defectsRaw)) {
    if (defectsRaw.length > 50) fields['defects'] = 'At most 50 defect zones.';
    for (let i = 0; i < defectsRaw.length; i += 1) {
      const zone = asRecord(defectsRaw[i]);
      const kind = zone['kind'];
      const startMm = zone['start_mm'];
      const endMm = zone['end_mm'];
      const prefix = `defects.${i}`;
      if (typeof kind !== 'string' || !DEFECT_KINDS.includes(kind as (typeof DEFECT_KINDS)[number])) {
        fields[`${prefix}`] = 'Choose a defect kind.';
      }
      if (!isInteger(startMm) || !isInteger(endMm) || !(0 <= startMm && startMm < endMm && endMm <= (isInteger(lengthMm) ? lengthMm : 0))) {
        fields[`${prefix}`] = 'Defect zone must run from a smaller to a larger position within the board.';
      } else {
        defects.push({ kind: kind as string, startMm, endMm });
      }
    }
  }
  if (Object.keys(fields).length > 0) throw new ApiError('validation', 'Check the highlighted fields.', fields);
  return {
    lot: lot as string,
    species: species as string,
    lengthMm: lengthMm as number,
    widthMm: widthMm as number,
    thicknessMm: thicknessMm as number,
    defects,
  };
}

export function validateDimensions(body: unknown): { widthMm: number; thicknessMm: number; lengthMm: number | null } {
  const fields: Fields = {};
  const record = asRecord(body);
  const widthMm = record['width_mm'];
  if (!isInteger(widthMm) || widthMm < 20 || widthMm > 600) fields['width_mm'] = 'Width must be between 20 and 600 mm.';
  const thicknessMm = record['thickness_mm'];
  if (!isInteger(thicknessMm) || thicknessMm < 10 || thicknessMm > 400) fields['thickness_mm'] = 'Thickness must be between 10 and 400 mm.';
  const lengthRaw = record['length_mm'];
  let lengthMm: number | null = null;
  if (lengthRaw !== undefined && lengthRaw !== null) {
    if (!isInteger(lengthRaw) || lengthRaw < 300 || lengthRaw > 12000) {
      fields['length_mm'] = 'Length must be between 300 and 12,000 mm.';
    } else {
      lengthMm = lengthRaw;
    }
  }
  if (Object.keys(fields).length > 0) throw new ApiError('validation', 'Check the highlighted fields.', fields);
  return { widthMm: widthMm as number, thicknessMm: thicknessMm as number, lengthMm };
}

export function validatePieces(body: Record<string, unknown>): PieceInput[] {
  const fields: Fields = {};
  const piecesRaw = body['pieces'];
  if (!Array.isArray(piecesRaw) || piecesRaw.length < 1 || piecesRaw.length > MAX_PIECES) {
    throw new ApiError('validation', 'Check the highlighted fields.', { pieces: 'A layout holds 1 to 20 pieces.' });
  }
  const pieces: PieceInput[] = [];
  for (let i = 0; i < piecesRaw.length; i += 1) {
    const entry = asRecord(piecesRaw[i]);
    const label = entry['label'];
    const lengthMm = entry['length_mm'];
    const widthMm = entry['width_mm'];
    const startMm = entry['start_mm'];
    const prefix = `pieces.${i}`;
    if (typeof label !== 'string' || label.length < 1 || label.length > 40) fields[`${prefix}`] = 'Label must be 1 to 40 characters.';
    if (!isInteger(lengthMm) || lengthMm < 1 || lengthMm > 12000) fields[`${prefix}`] = 'Length must be 1 to 12,000 mm.';
    if (!isInteger(widthMm) || widthMm < 1 || widthMm > 600) fields[`${prefix}`] = 'Width must be 1 to 600 mm.';
    if (!isInteger(startMm) || startMm < 0 || startMm > 12000) fields[`${prefix}`] = 'Start must be 0 to 12,000 mm.';
    if (Object.keys(fields).length === 0 || !fields[`${prefix}`]) {
      pieces.push({ label: label as string, length_mm: lengthMm as number, width_mm: widthMm as number, start_mm: startMm as number });
    }
  }
  if (Object.keys(fields).length > 0) throw new ApiError('validation', 'Check the highlighted fields.', fields);
  return pieces;
}

export function validateCardNumber(value: unknown): string {
  const fields: Fields = {};
  const digits = typeof value === 'string' ? value.replace(/\s+/g, '') : '';
  if (!/^\d{13,19}$/.test(digits)) fields['card_number'] = 'Enter a valid card number.';
  else if (!luhn(digits)) fields['card_number'] = 'Enter a valid card number.';
  if (Object.keys(fields).length > 0) throw new ApiError('validation', 'Check the highlighted fields.', fields);
  return digits;
}

export function validateIdempotencyKey(value: string | undefined): string {
  const fields: Fields = {};
  if (typeof value !== 'string' || value.length < 1 || value.length > 64 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    fields['idempotency_key'] = 'An idempotency key of 1 to 64 letters, digits, - or _ is required.';
    throw new ApiError('validation', 'Check the highlighted fields.', fields);
  }
  return value;
}

export function validateGrade(body: unknown): string {
  const record = asRecord(body);
  const grade = record['grade'];
  if (typeof grade !== 'string' || !GRADES.includes(grade as (typeof GRADES)[number])) {
    throw new ApiError('validation', 'Check the highlighted fields.', { grade: 'Choose a grade.' });
  }
  return grade;
}

export function validateLot(body: unknown): { name: string; origin: string; builtYear: number } {
  const fields: Fields = {};
  const record = asRecord(body);
  const name = record['name'];
  const origin = record['origin'];
  const builtYear = record['built_year'];
  if (typeof name !== 'string' || name.length < 1 || name.length > 80) fields['name'] = 'Name must be 1 to 80 characters.';
  if (typeof origin !== 'string' || origin.length < 1 || origin.length > 200) fields['origin'] = 'Origin must be 1 to 200 characters.';
  if (!isInteger(builtYear) || builtYear < 1600 || builtYear > 2026) fields['built_year'] = 'Built year must be between 1600 and 2026.';
  if (Object.keys(fields).length > 0) throw new ApiError('validation', 'Check the highlighted fields.', fields);
  return { name: name as string, origin: origin as string, builtYear: builtYear as number };
}

export function validateRateBody(body: unknown): { species: string; grade: string; rateCents: number; effectiveAt: Date | null } {
  const fields: Fields = {};
  const record = asRecord(body);
  const species = record['species'];
  const grade = record['grade'];
  const rateCents = record['rate_cents'];
  const effectiveRaw = record['effective_at'];
  if (typeof species !== 'string' || !SPECIES.includes(species as (typeof SPECIES)[number])) fields['species'] = 'Choose a species.';
  if (typeof grade !== 'string' || !GRADES.includes(grade as (typeof GRADES)[number])) fields['grade'] = 'Choose a grade.';
  if (!isInteger(rateCents) || rateCents < 1 || rateCents > 1000000) fields['rate_cents'] = 'Rate must be between 1 and 1,000,000 cents.';
  let effectiveAt: Date | null = null;
  if (effectiveRaw !== undefined && effectiveRaw !== null && effectiveRaw !== '') {
    if (typeof effectiveRaw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(effectiveRaw)) {
      fields['effective_at'] = 'Effective from must be an ISO 8601 timestamp.';
    } else {
      effectiveAt = new Date(effectiveRaw);
      if (Number.isNaN(effectiveAt.getTime())) fields['effective_at'] = 'Effective from must be an ISO 8601 timestamp.';
    }
  }
  if (Object.keys(fields).length > 0) throw new ApiError('validation', 'Check the highlighted fields.', fields);
  return { species: species as string, grade: grade as string, rateCents: rateCents as number, effectiveAt };
}

export function validateOffcutMm(body: unknown, planned: number | null): number | null {
  const record = asRecord(body);
  const offcut = record['offcut_mm'];
  if (planned === null) {
    if (offcut !== undefined && offcut !== null) {
      throw new ApiError('validation', 'Check the highlighted fields.', { offcut_mm: 'This ticket has no offcut.' });
    }
    return null;
  }
  if (!isInteger(offcut) || offcut < 1 || offcut > planned) {
    throw new ApiError('validation', 'Check the highlighted fields.', { offcut_mm: `Measured offcut must be 1 to ${planned} mm.` });
  }
  return offcut;
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new ApiError('bad_json', 'Body is not a JSON object');
}

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = Number(digits[i]);
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}
