import { DEFECT_KINDS, MAX_DEFECT_ZONES, MAX_PIECES, SPECIES } from '../../shared/constants';
import { DefectZone, PiecePlacement } from '../../shared/geometry';
import { ApiError, FieldErrors } from '../errors';

export function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** Reads a cut list, reporting a bad piece as `pieces.<n>`. */
export function readPieces(value: unknown): PiecePlacement[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PIECES) {
    throw new ApiError('validation', { pieces: `Give 1 to ${MAX_PIECES} pieces.` });
  }
  return value.map((entry, index) => {
    const field = `pieces.${index}`;
    if (typeof entry !== 'object' || entry === null) throw new ApiError('validation', { [field]: 'Give a piece.' });
    const piece = entry as Record<string, unknown>;
    const label = piece.label;
    if (typeof label !== 'string' || label.length < 1 || label.length > 40) {
      throw new ApiError('validation', { [field]: 'Give a label of 1 to 40 characters.' });
    }
    const length = piece.length_mm;
    const width = piece.width_mm;
    const start = piece.start_mm;
    if (!isWholeNumber(length) || length < 1 || length > 12_000) {
      throw new ApiError('validation', { [field]: 'Give a length of 1 to 12000 mm.' });
    }
    if (!isWholeNumber(width) || width < 1 || width > 600) {
      throw new ApiError('validation', { [field]: 'Give a width of 1 to 600 mm.' });
    }
    if (!isWholeNumber(start) || start < 0 || start > 12_000) {
      throw new ApiError('validation', { [field]: 'Give a start of 0 to 12000 mm.' });
    }
    return { label, length_mm: length, width_mm: width, start_mm: start };
  });
}

export function readIntakeDimensions(body: Record<string, unknown>, errors: FieldErrors): void {
  const checks: Array<[string, number, number]> = [
    ['length_mm', 300, 12_000],
    ['width_mm', 20, 600],
    ['thickness_mm', 10, 400]
  ];
  for (const [field, low, high] of checks) {
    const value = body[field];
    if (!isWholeNumber(value) || value < low || value > high) {
      errors.add(field, `Give a whole number of millimetres from ${low} to ${high}.`);
    }
  }
}

export function readDefects(value: unknown, lengthMm: number, errors: FieldErrors): DefectZone[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_DEFECT_ZONES) {
    errors.add('defects', `Give at most ${MAX_DEFECT_ZONES} defect zones.`);
    return [];
  }
  const zones: DefectZone[] = [];
  value.forEach((entry, index) => {
    const field = `defects.${index}`;
    if (typeof entry !== 'object' || entry === null) {
      errors.add(field, 'Give a defect zone.');
      return;
    }
    const zone = entry as Record<string, unknown>;
    const kind = zone.kind;
    const start = zone.start_mm;
    const end = zone.end_mm;
    if (typeof kind !== 'string' || !(DEFECT_KINDS as readonly string[]).includes(kind)) {
      errors.add(field, 'Choose a nail hole, check or bolt hole.');
      return;
    }
    if (!isWholeNumber(start) || !isWholeNumber(end) || start < 0 || end <= start || end > lengthMm) {
      errors.add(field, 'Give a zone inside the board, with the start before the end.');
      return;
    }
    zones.push({ kind: kind as DefectZone['kind'], start_mm: start, end_mm: end });
  });
  return zones;
}

export function readSpecies(value: unknown, errors: FieldErrors): string {
  if (typeof value !== 'string' || !(SPECIES as readonly string[]).includes(value)) {
    errors.add('species', 'Choose one of the yard species.');
    return '';
  }
  return value;
}

function luhnPasses(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let at = digits.length - 1; at >= 0; at -= 1) {
    let value = Number(digits[at]);
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

/** 13 to 19 digits once spaces are removed, passing the Luhn check. */
export function readCardNumber(value: unknown): string {
  const digits = typeof value === 'string' ? value.replace(/ /g, '') : '';
  if (!/^\d{13,19}$/.test(digits) || !luhnPasses(digits)) {
    throw new ApiError('validation', { card_number: 'Enter a valid card number.' });
  }
  return digits;
}

export function readIdempotencyKey(value: string | undefined): string {
  if (value === undefined || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new ApiError('validation', { idempotency_key: 'Send an Idempotency-Key of 1 to 64 safe characters.' });
  }
  return value;
}

const FILTER_LIMIT = 12_000;

export function readFilterInteger(value: string | null, field: string): number | null {
  if (value === null || value === '') return null;
  if (!/^\d+$/.test(value)) throw new ApiError('validation', { [field]: `Give a whole number from 0 to ${FILTER_LIMIT}.` });
  const parsed = Number(value);
  if (parsed > FILTER_LIMIT) throw new ApiError('validation', { [field]: `Give a whole number from 0 to ${FILTER_LIMIT}.` });
  return parsed;
}
