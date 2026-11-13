import { COLOUR_FAMILIES, FIELD_COPY, yearCopy } from '../../shared/copy.js';
import type { SizeTenths, Unit } from '../../shared/types.js';
import { validationError } from './errors.js';
import { parseSizeToTenths, resolveSizeOnEdit } from './sizes.js';
import { isAcceptedZone } from './zones.js';

/** Inputs are validated once, here, at the API edge. */

export type RawValue = string | number | boolean | null | string[] | undefined;
export type RawFields = Record<string, RawValue>;

export interface Facts {
  title: string;
  maker: string | null;
  year: number | null;
  materials: string[];
  finish: string | null;
  colour_family: string;
  source_url: string | null;
  source_note: string | null;
  notes: string | null;
  size: SizeTenths;
}

export interface SwatchPoint {
  x: number;
  y: number;
}

export class FieldCollector {
  private readonly fields: Record<string, string> = {};

  add(field: string, copy: string): void {
    if (!(field in this.fields)) this.fields[field] = copy;
  }

  throwIfAny(): void {
    if (Object.keys(this.fields).length > 0) throw validationError(this.fields);
  }
}

function text(value: RawValue): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.join(',');
  return String(value).trim();
}

function optionalText(
  errors: FieldCollector,
  raw: RawValue,
  field: string,
  limit: number,
  copy: string,
): string | null | undefined {
  const value = text(raw);
  if (value === undefined) return undefined;
  if (value.length > limit) {
    errors.add(field, copy);
    return undefined;
  }
  return value === '' ? null : value;
}

export function validateUnit(errors: FieldCollector, raw: RawValue): Unit | undefined {
  const value = text(raw);
  if (value === 'mm' || value === 'in') return value;
  errors.add('unit', FIELD_COPY.unit);
  return undefined;
}

function validateTitle(errors: FieldCollector, raw: RawValue): string | undefined {
  const value = text(raw);
  if (value === undefined) return undefined;
  if (value.length < 1 || value.length > 80) {
    errors.add('title', FIELD_COPY.title);
    return undefined;
  }
  return value;
}

function validateYear(
  errors: FieldCollector,
  raw: RawValue,
  currentYear: number,
): number | null | undefined {
  const value = text(raw);
  if (value === undefined) return undefined;
  if (value === '') return null;
  if (!/^-?[0-9]+$/.test(value)) {
    errors.add('year', yearCopy(currentYear));
    return undefined;
  }
  const year = Number(value);
  if (year < 1800 || year > currentYear) {
    errors.add('year', yearCopy(currentYear));
    return undefined;
  }
  return year;
}

function validateMaterials(errors: FieldCollector, raw: RawValue): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const entries = (Array.isArray(raw) ? raw : String(raw).split(','))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length > 8 || entries.some((entry) => entry.length > 40)) {
    errors.add('materials', FIELD_COPY.materials);
    return undefined;
  }
  return entries;
}

function validateColourFamily(errors: FieldCollector, raw: RawValue): string | undefined {
  const value = text(raw);
  if (value === undefined) return undefined;
  if (!(COLOUR_FAMILIES as readonly string[]).includes(value)) {
    errors.add('colour_family', FIELD_COPY.colour_family);
    return undefined;
  }
  return value;
}

function validateSourceUrl(errors: FieldCollector, raw: RawValue): string | null | undefined {
  const value = text(raw);
  if (value === undefined) return undefined;
  if (value === '') return null;
  if (value.length > 500 || !/^https?:\/\//.test(value)) {
    errors.add('source_url', FIELD_COPY.source_url);
    return undefined;
  }
  return value;
}

const SIZE_FIELDS = ['width', 'height', 'depth'] as const;
export type SizeField = (typeof SIZE_FIELDS)[number];

function validateSizes(
  errors: FieldCollector,
  raw: RawFields,
  unit: Unit,
): SizeTenths | undefined {
  const parsed: Partial<Record<SizeField, number>> = {};
  for (const field of SIZE_FIELDS) {
    const value = text(raw[field]);
    if (value === undefined || value === '') {
      errors.add(field, FIELD_COPY.size);
      continue;
    }
    const tenths = parseSizeToTenths(value, unit);
    if (tenths === null) {
      errors.add(field, FIELD_COPY.size);
      continue;
    }
    parsed[field] = tenths;
  }
  if (parsed.width === undefined || parsed.height === undefined || parsed.depth === undefined) {
    return undefined;
  }
  return { width: parsed.width, height: parsed.height, depth: parsed.depth };
}

export function validateSwatchPoint(
  errors: FieldCollector,
  rawX: RawValue,
  rawY: RawValue,
  fieldX: 'swatch_x' | 'x',
  fieldY: 'swatch_y' | 'y',
  required: boolean,
): SwatchPoint | null {
  const xText = text(rawX);
  const yText = text(rawY);
  const xGiven = xText !== undefined && xText !== '';
  const yGiven = yText !== undefined && yText !== '';
  if (!xGiven && !yGiven) {
    if (required) {
      errors.add(fieldX, FIELD_COPY.swatchPoint);
      errors.add(fieldY, FIELD_COPY.swatchPoint);
    }
    return null;
  }
  const x = xGiven ? fraction(xText) : null;
  const y = yGiven ? fraction(yText) : null;
  if (x === null) errors.add(fieldX, FIELD_COPY.swatchPoint);
  if (y === null) errors.add(fieldY, FIELD_COPY.swatchPoint);
  if (x === null || y === null) return null;
  return { x, y };
}

function fraction(value: string): number | null {
  if (!/^[0-9]+(\.[0-9]+)?$/.test(value)) return null;
  const parsed = Number(value);
  return parsed >= 0 && parsed <= 1 ? parsed : null;
}

export function validateCapture(
  raw: RawFields,
  currentYear: number,
): { facts: Facts; swatchPoint: SwatchPoint | null } {
  const errors = new FieldCollector();
  const title = validateTitle(errors, raw.title ?? '');
  const maker = optionalText(errors, raw.maker ?? '', 'maker', 80, FIELD_COPY.maker);
  const year = validateYear(errors, raw.year ?? '', currentYear);
  const unit = validateUnit(errors, raw.unit);
  const size = unit ? validateSizes(errors, raw, unit) : undefined;
  const materials = validateMaterials(errors, raw.materials ?? '');
  const finish = optionalText(errors, raw.finish ?? '', 'finish', 80, FIELD_COPY.finish);
  const colourFamily = validateColourFamily(errors, raw.colour_family ?? '');
  const sourceUrl = validateSourceUrl(errors, raw.source_url ?? '');
  const sourceNote = optionalText(
    errors,
    raw.source_note ?? '',
    'source_note',
    120,
    FIELD_COPY.source_note,
  );
  const notes = optionalText(errors, raw.notes ?? '', 'notes', 2000, FIELD_COPY.notes);
  const swatchPoint = validateSwatchPoint(
    errors,
    raw.swatch_x,
    raw.swatch_y,
    'swatch_x',
    'swatch_y',
    false,
  );
  if (title === undefined) errors.add('title', FIELD_COPY.title);
  if (colourFamily === undefined) errors.add('colour_family', FIELD_COPY.colour_family);
  errors.throwIfAny();
  return {
    facts: {
      title: title!,
      maker: maker ?? null,
      year: year ?? null,
      materials: materials ?? [],
      finish: finish ?? null,
      colour_family: colourFamily!,
      source_url: sourceUrl ?? null,
      source_note: sourceNote ?? null,
      notes: notes ?? null,
      size: size!,
    },
    swatchPoint,
  };
}

export interface FactsPatch {
  title?: string;
  maker?: string | null;
  year?: number | null;
  materials?: string[];
  finish?: string | null;
  colour_family?: string;
  source_url?: string | null;
  source_note?: string | null;
  notes?: string | null;
  size?: SizeTenths;
}

export function validateFactsPatch(
  raw: RawFields,
  currentYear: number,
  stored: SizeTenths,
): FactsPatch {
  const errors = new FieldCollector();
  const patch: FactsPatch = {};
  if ('title' in raw) {
    const title = validateTitle(errors, raw.title);
    if (title === undefined) errors.add('title', FIELD_COPY.title);
    else patch.title = title;
  }
  if ('maker' in raw) {
    const maker = optionalText(errors, raw.maker, 'maker', 80, FIELD_COPY.maker);
    if (maker !== undefined) patch.maker = maker;
  }
  if ('year' in raw) {
    const year = validateYear(errors, raw.year, currentYear);
    if (year !== undefined) patch.year = year;
  }
  if ('materials' in raw) {
    const materials = validateMaterials(errors, raw.materials);
    if (materials !== undefined) patch.materials = materials;
  }
  if ('finish' in raw) {
    const finish = optionalText(errors, raw.finish, 'finish', 80, FIELD_COPY.finish);
    if (finish !== undefined) patch.finish = finish;
  }
  if ('colour_family' in raw) {
    const family = validateColourFamily(errors, raw.colour_family);
    if (family === undefined) errors.add('colour_family', FIELD_COPY.colour_family);
    else patch.colour_family = family;
  }
  if ('source_url' in raw) {
    const url = validateSourceUrl(errors, raw.source_url);
    if (url !== undefined) patch.source_url = url;
  }
  if ('source_note' in raw) {
    const note = optionalText(errors, raw.source_note, 'source_note', 120, FIELD_COPY.source_note);
    if (note !== undefined) patch.source_note = note;
  }
  if ('notes' in raw) {
    const notes = optionalText(errors, raw.notes, 'notes', 2000, FIELD_COPY.notes);
    if (notes !== undefined) patch.notes = notes;
  }
  const sizeGiven = SIZE_FIELDS.some((field) => field in raw);
  if (sizeGiven) {
    const unit = validateUnit(errors, raw.unit);
    if (unit) {
      const next: SizeTenths = { ...stored };
      for (const field of SIZE_FIELDS) {
        if (!(field in raw)) continue;
        const value = text(raw[field]);
        const tenths =
          value === undefined || value === ''
            ? null
            : resolveSizeOnEdit(value, unit, stored[field]);
        if (tenths === null) errors.add(field, FIELD_COPY.size);
        else next[field] = tenths;
      }
      patch.size = next;
    }
  }
  errors.throwIfAny();
  return patch;
}

export function validateVersion(raw: RawValue, field: 'reference' | 'reel'): number {
  const copy = field === 'reference' ? FIELD_COPY.referenceVersion : FIELD_COPY.reelVersion;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    throw validationError({ version: copy });
  }
  return raw;
}

export function validateReelName(raw: RawValue): string {
  const value = text(raw);
  if (value === undefined || value.length < 1 || value.length > 60) {
    throw validationError({ name: FIELD_COPY.reelName });
  }
  return value;
}

export function validateZone(raw: RawValue): string {
  const value = text(raw);
  if (value === undefined || !isAcceptedZone(value)) {
    throw validationError({ zone: FIELD_COPY.zone });
  }
  return value;
}

export function validateUnitBody(raw: RawValue): Unit {
  const value = text(raw);
  if (value !== 'mm' && value !== 'in') {
    throw validationError({ unit: FIELD_COPY.unit });
  }
  return value;
}

export function validatePaper(raw: RawValue): 'a4' | 'letter' {
  const value = text(raw);
  if (value !== 'a4' && value !== 'letter') {
    throw validationError({ paper: FIELD_COPY.paper });
  }
  return value;
}
