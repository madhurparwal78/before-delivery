import { MAX_PIECES } from '../../shared/constants';
import { inchesNumberToMm } from '../../shared/units';
import { ApiError } from '../errors';

export type UnknownKeys = Array<[string, unknown]>;

export interface LayoutPiece {
  label: string;
  length_mm: number;
  width_mm: number;
  start_mm: number;
  unknown: UnknownKeys;
}

export interface LayoutFile {
  board: string;
  pieces: LayoutPiece[];
  unknown: UnknownKeys;
}

const KNOWN_TOP_V2 = ['format', 'version', 'board', 'unit', 'pieces'];
const KNOWN_TOP_V1 = ['format', 'version', 'board', 'unit', 'cuts'];
const KNOWN_PIECE_V2 = ['label', 'length_mm', 'width_mm', 'start_mm'];
const KNOWN_PIECE_V1 = ['name', 'len', 'w', 'at'];

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function keptKeys(source: Record<string, unknown>, known: string[]): UnknownKeys {
  return Object.keys(source)
    .filter((key) => !known.includes(key))
    .map((key): [string, unknown] => [key, source[key]]);
}

interface RawPiece {
  label: unknown;
  length: unknown;
  width: unknown;
  start: unknown;
  unknown: UnknownKeys;
}

function wholeMillimetres(value: unknown, version: 1 | 2): number | null {
  if (version === 2) return typeof value === 'number' && Number.isInteger(value) ? value : null;
  if (typeof value !== 'number') return null;
  return inchesNumberToMm(value);
}

function migratedPieces(raw: unknown, version: 1 | 2): RawPiece[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry): RawPiece => {
    const piece = asObject(entry);
    if (piece === null) return { label: null, length: null, width: null, start: null, unknown: [] };
    if (version === 2) {
      return {
        label: piece.label,
        length: piece.length_mm,
        width: piece.width_mm,
        start: piece.start_mm,
        unknown: keptKeys(piece, KNOWN_PIECE_V2)
      };
    }
    return {
      label: piece.name,
      length: piece.len,
      width: piece.w,
      start: piece.at,
      unknown: keptKeys(piece, KNOWN_PIECE_V1)
    };
  });
}

/** Reads a layout file, running the five published checks in order. */
export function parseLayoutFile(raw: unknown, tag: string): LayoutFile {
  const source = asObject(raw);
  if (source === null || source.format !== 'kerf') {
    throw new ApiError('validation', { format: 'This is not a Kerfwell layout file.' });
  }
  const version = source.version;
  if (typeof version === 'number' && version > 2) throw new ApiError('unsupported_version');
  if (version !== 1 && version !== 2) throw new ApiError('validation', { version: 'That layout file version is not known.' });

  if (typeof source.board !== 'string' || source.board === '') {
    throw new ApiError('validation', { board: 'The layout file needs a board tag.' });
  }
  if (source.board !== tag) throw new ApiError('wrong_board');

  const expectedUnit = version === 2 ? 'mm' : 'in';
  if (source.unit !== expectedUnit) {
    throw new ApiError('validation', { unit: `A version ${version} layout file measures in ${expectedUnit}.` });
  }

  const pieces = migratedPieces(version === 2 ? source.pieces : source.cuts, version);
  if (pieces.length < 1 || pieces.length > MAX_PIECES) {
    throw new ApiError('validation', { pieces: `Give 1 to ${MAX_PIECES} pieces.` });
  }
  const read: LayoutPiece[] = pieces.map((piece, index) => {
    const field = `pieces.${index}`;
    const label = piece.label;
    if (typeof label !== 'string' || label.length < 1 || label.length > 40) {
      throw new ApiError('validation', { [field]: 'Give a label of 1 to 40 characters.' });
    }
    const length = wholeMillimetres(piece.length, version);
    const width = wholeMillimetres(piece.width, version);
    const start = wholeMillimetres(piece.start, version);
    if (length === null || length < 1 || length > 12_000) throw new ApiError('validation', { [field]: 'Give a length of 1 to 12000 mm.' });
    if (width === null || width < 1 || width > 600) throw new ApiError('validation', { [field]: 'Give a width of 1 to 600 mm.' });
    if (start === null || start < 0 || start > 12_000) throw new ApiError('validation', { [field]: 'Give a start of 0 to 12000 mm.' });
    return { label, length_mm: length, width_mm: width, start_mm: start, unknown: piece.unknown };
  });

  const ordered = read
    .map((piece, index) => ({ piece, index }))
    .sort((a, b) => a.piece.start_mm - b.piece.start_mm || a.index - b.index)
    .map((entry) => entry.piece);

  return { board: tag, pieces: ordered, unknown: keptKeys(source, version === 2 ? KNOWN_TOP_V2 : KNOWN_TOP_V1) };
}

function entriesJson(entries: UnknownKeys): string {
  return entries.map(([key, value]) => `${JSON.stringify(key)}:${JSON.stringify(value ?? null)}`).join(',');
}

function pieceJson(piece: LayoutPiece): string {
  const known = [
    `"label":${JSON.stringify(piece.label)}`,
    `"length_mm":${piece.length_mm}`,
    `"width_mm":${piece.width_mm}`,
    `"start_mm":${piece.start_mm}`
  ].join(',');
  const extra = entriesJson(piece.unknown);
  return `{${extra === '' ? known : `${known},${extra}`}}`;
}

/** The stored and exported bytes: version 2, published key order, no whitespace. */
export function serialiseLayoutFile(file: LayoutFile): string {
  const head = `"format":"kerf","version":2,"board":${JSON.stringify(file.board)},"unit":"mm"`;
  const pieces = `"pieces":[${file.pieces.map(pieceJson).join(',')}]`;
  const extra = entriesJson(file.unknown);
  return `{${head},${pieces}${extra === '' ? '' : `,${extra}`}}`;
}
