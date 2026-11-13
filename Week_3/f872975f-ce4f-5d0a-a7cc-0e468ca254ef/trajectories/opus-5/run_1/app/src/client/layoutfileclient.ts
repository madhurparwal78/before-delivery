import { Chip } from './layoutstate';
import { LayoutFile, LayoutFilePiece } from './types';

const KNOWN_TOP = ['format', 'version', 'board', 'unit', 'pieces'];
const KNOWN_PIECE = ['label', 'length_mm', 'width_mm', 'start_mm'];

function unknownOf(source: Record<string, unknown>, known: string[]): Array<[string, unknown]> {
  return Object.keys(source)
    .filter((key) => !known.includes(key))
    .map((key): [string, unknown] => [key, source[key]]);
}

/** The version 2 file the export sends back to the server, carrying the kept unknown keys. */
export function fileFromChips(tag: string, chips: Chip[], topUnknown: Array<[string, unknown]>): Record<string, unknown> {
  const file: Record<string, unknown> = {
    format: 'kerf',
    version: 2,
    board: tag,
    unit: 'mm',
    pieces: chips.map((chip) => {
      const piece: Record<string, unknown> = {
        label: chip.label,
        length_mm: chip.length_mm,
        width_mm: chip.width_mm,
        start_mm: chip.start_mm
      };
      for (const [key, value] of chip.unknown) piece[key] = value;
      return piece;
    })
  };
  for (const [key, value] of topUnknown) file[key] = value;
  return file;
}

export interface ImportedLayout {
  chips: Chip[];
  topUnknown: Array<[string, unknown]>;
}

export function chipsFromFile(file: LayoutFile): ImportedLayout {
  const pieces = Array.isArray(file.pieces) ? file.pieces : [];
  return {
    chips: pieces.map((piece: LayoutFilePiece) => ({
      label: String(piece.label),
      length_mm: Number(piece.length_mm),
      width_mm: Number(piece.width_mm),
      start_mm: Number(piece.start_mm),
      rotated: false,
      unknown: unknownOf(piece as Record<string, unknown>, KNOWN_PIECE)
    })),
    topUnknown: unknownOf(file as unknown as Record<string, unknown>, KNOWN_TOP)
  };
}
