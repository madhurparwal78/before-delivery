export interface LayoutPiece {
  label: string;
  length_mm: number;
  width_mm: number;
  start_mm: number;
}

export interface StoredLayout {
  format: 'kerf';
  version: 2;
  board: string;
  unit: 'mm';
  pieces: LayoutPiece[];
}

export type JsonRecord = Record<string, unknown>;

export class LayoutFileError extends Error {
  constructor(
    readonly code: 'validation' | 'unsupported_version' | 'wrong_board',
    readonly field: string,
  ) {
    super(code);
  }
}

/** Convert a decimal inch value to whole millimetres, exact decimal x 25.4 rounded half away from zero. */
export function inchesToMm(value: string | number): number {
  const text = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    throw new LayoutFileError('validation', 'pieces');
  }
  const negative = text.startsWith('-');
  const [wholePart, fracPart = ''] = text.replace('-', '').split('.');
  const scale = 10 ** fracPart.length;
  const num = BigInt(wholePart || '0') * BigInt(scale) + (fracPart ? BigInt(fracPart) : 0n);
  const prod = num * 254n;
  const denom = BigInt(scale) * 10n;
  let q = prod / denom;
  const rem = prod % denom;
  if (rem * 2n >= denom) q += 1n;
  const result = Number(q);
  return negative ? -result : result;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse and migrate a layout file to version 2, preserving unknown keys in arrival order.
 * Checks run in the published order: format, version, board, unit, pieces.
 */
export function migrateLayoutFile(raw: unknown, boardTag: string): JsonRecord {
  if (!isRecord(raw)) throw new LayoutFileError('validation', 'format');
  if (raw['format'] !== 'kerf') throw new LayoutFileError('validation', 'format');
  const version = raw['version'];
  if (typeof version === 'number' && version > 2) throw new LayoutFileError('unsupported_version', 'version');
  if (version !== 1 && version !== 2) throw new LayoutFileError('validation', 'version');
  const board = raw['board'];
  if (board !== boardTag) {
    if (typeof board !== 'string' || board.length === 0) throw new LayoutFileError('validation', 'board');
    throw new LayoutFileError('wrong_board', 'board');
  }
  const expectedUnit = version === 1 ? 'in' : 'mm';
  if (raw['unit'] !== expectedUnit) throw new LayoutFileError('validation', 'unit');

  const knownTop = new Set(['format', 'version', 'board', 'unit', version === 1 ? 'cuts' : 'pieces']);
  const unknownTop: Array<[string, unknown]> = [];
  for (const key of Object.keys(raw)) {
    if (!knownTop.has(key)) unknownTop.push([key, raw[key]]);
  }

  const source = version === 1 ? raw['cuts'] : raw['pieces'];
  if (!Array.isArray(source)) throw new LayoutFileError('validation', 'pieces');
  const migrated: Array<{ known: JsonRecord; order: string[] }> = [];
  for (const entry of source) {
    if (!isRecord(entry)) throw new LayoutFileError('validation', 'pieces');
    let label: string;
    let lengthMm: number;
    let widthMm: number;
    let startMm: number;
    let extra: JsonRecord;
    let order: string[];
    if (version === 1) {
      label = String(entry['name'] ?? '');
      lengthMm = inchesToMm(entry['len'] as string | number);
      widthMm = inchesToMm(entry['w'] as string | number);
      startMm = inchesToMm(entry['at'] as string | number);
      extra = {};
      order = [];
      for (const key of Object.keys(entry)) {
        if (key !== 'name' && key !== 'len' && key !== 'w' && key !== 'at') {
          extra[key] = entry[key];
          order.push(key);
        }
      }
    } else {
      label = String(entry['label'] ?? '');
      lengthMm = asInt(entry['length_mm'], 'pieces');
      widthMm = asInt(entry['width_mm'], 'pieces');
      startMm = asInt(entry['start_mm'], 'pieces');
      extra = {};
      order = [];
      for (const key of Object.keys(entry)) {
        if (key !== 'label' && key !== 'length_mm' && key !== 'width_mm' && key !== 'start_mm') {
          extra[key] = entry[key];
          order.push(key);
        }
      }
    }
    const piece: JsonRecord = { label, length_mm: lengthMm, width_mm: widthMm, start_mm: startMm };
    for (const key of order) piece[key] = extra[key];
    migrated.push({ known: piece, order });
  }

  // Sort by start_mm ascending, stable on file order
  const withIndex = migrated.map((m, i) => ({ m, i }));
  withIndex.sort((a, b) => {
    const sa = a.m.known['start_mm'];
    const sb = b.m.known['start_mm'];
    if (typeof sa !== 'number' || typeof sb !== 'number') return 0;
    if (sa !== sb) return sa - sb;
    return a.i - b.i;
  });

  const out: JsonRecord = { format: 'kerf', version: 2, board: boardTag, unit: 'mm', pieces: withIndex.map((x) => x.m.known) };
  for (const [key, value] of unknownTop) out[key] = value;

  // Validate migrated pieces against the piece rules
  const pieces = out['pieces'] as JsonRecord[];
  if (pieces.length < 1 || pieces.length > 20) throw new LayoutFileError('validation', 'pieces');
  for (let i = 0; i < pieces.length; i += 1) {
    const p = pieces[i];
    if (typeof p['label'] !== 'string' || p['label'].length < 1 || p['label'].length > 40) {
      throw new LayoutFileError('validation', `pieces.${i}`);
    }
    for (const field of ['length_mm', 'width_mm', 'start_mm'] as const) {
      const value = p[field];
      if (typeof value !== 'number' || !Number.isInteger(value)) throw new LayoutFileError('validation', `pieces.${i}`);
    }
    const l = p['length_mm'] as number;
    const w = p['width_mm'] as number;
    const s = p['start_mm'] as number;
    if (l < 1 || l > 12000 || w < 1 || w > 600 || s < 0 || s > 12000) {
      throw new LayoutFileError('validation', `pieces.${i}`);
    }
  }
  return out;
}

function asInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new LayoutFileError('validation', field);
  return value;
}

/** Serialize a stored layout with the published key order, no whitespace, no trailing newline. */
export function serializeLayout(file: JsonRecord): Buffer {
  const ordered = orderLayout(file);
  return Buffer.from(JSON.stringify(ordered), 'utf8');
}

function orderLayout(file: JsonRecord): JsonRecord {
  const known = ['format', 'version', 'board', 'unit', 'pieces'];
  const out: JsonRecord = {};
  for (const key of known) {
    if (key in file) out[key] = file[key];
  }
  const pieces = Array.isArray(file['pieces']) ? (file['pieces'] as JsonRecord[]) : [];
  const orderedPieces = pieces.map((p) => {
    const piece: JsonRecord = {};
    for (const key of ['label', 'length_mm', 'width_mm', 'start_mm']) {
      if (key in p) piece[key] = p[key];
    }
    for (const key of Object.keys(p)) {
      if (!['label', 'length_mm', 'width_mm', 'start_mm'].includes(key)) piece[key] = p[key];
    }
    return piece;
  });
  out['pieces'] = orderedPieces;
  for (const key of Object.keys(file)) {
    if (!known.includes(key) && !(key in out)) out[key] = file[key];
  }
  return out;
}
