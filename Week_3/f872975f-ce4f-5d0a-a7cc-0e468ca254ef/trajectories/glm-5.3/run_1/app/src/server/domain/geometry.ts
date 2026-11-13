import { KERF_ROUND_MM, OFFCUT_MIN_MM } from './constants.js';

export interface Zone {
  kind: string;
  start_mm: number;
  end_mm: number;
}

export interface PieceInput {
  label: string;
  length_mm: number;
  width_mm: number;
  start_mm: number;
}

export type PieceStatus = 'clear' | 'over defect' | 'overlap' | 'off board' | 'too wide';

export interface PieceResult extends PieceInput {
  status: PieceStatus;
}

export interface FitFigures {
  pieces: PieceResult[];
  clear_count: number;
  cuts_mm: number[];
  take_mm: number | null;
  sale: 'cut' | 'whole' | null;
  offcut_mm: number | null;
  clear_offcut_mm: number | null;
  board_feet: string | null;
  price_cents: number | null;
  verdict: string;
}

export function overlaps(aStart: number, aLen: number, bStart: number, bLen: number): boolean {
  return aStart < bStart + bLen && bStart < aStart + aLen;
}

function pieceStatuses(boardLength: number, boardWidth: number, pieces: PieceInput[], zones: Zone[]): PieceStatus[] {
  const ends = pieces.map((p) => p.start_mm + p.length_mm);
  return pieces.map((p, i) => {
    if (ends[i] > boardLength) return 'off board';
    if (p.width_mm > boardWidth) return 'too wide';
    for (let j = 0; j < pieces.length; j += 1) {
      if (j === i) continue;
      // less than 10 mm from another piece: gap < 10 means spans come within 10 mm
      const other = pieces[j];
      const gap = p.start_mm <= other.start_mm ? other.start_mm - ends[i] : p.start_mm - (other.start_mm + other.length_mm);
      if (gap < 10) return 'overlap';
    }
    for (const z of zones) {
      if (overlaps(p.start_mm, p.length_mm, z.start_mm, z.end_mm - z.start_mm)) return 'over defect';
    }
    return 'clear';
  });
}

export function cutPositions(boardLength: number, pieces: PieceInput[]): number[] {
  const set = new Set<number>();
  for (const p of pieces) {
    if (p.start_mm > 0) set.add(p.start_mm);
    const end = p.start_mm + p.length_mm;
    if (end < boardLength) set.add(end);
  }
  return [...set].sort((a, b) => a - b);
}

export function longestClearRun(boardLength: number, zones: Zone[]): number {
  const sorted = [...zones].sort((a, b) => a.start_mm - b.start_mm).filter((z) => z.end_mm > z.start_mm);
  let best = 0;
  let cursor = 0;
  for (const z of sorted) {
    if (z.start_mm > cursor) best = Math.max(best, z.start_mm - cursor);
    cursor = Math.max(cursor, z.end_mm);
  }
  if (boardLength > cursor) best = Math.max(best, boardLength - cursor);
  return best;
}

function clearOffcutRun(zones: Zone[], offcutStart: number, offcutEnd: number): number {
  if (offcutEnd <= offcutStart) return 0;
  let best = 0;
  let cursor = offcutStart;
  for (const z of zones) {
    if (z.end_mm <= cursor) continue;
    if (z.start_mm >= offcutEnd) break;
    if (z.start_mm > cursor) best = Math.max(best, Math.min(z.start_mm, offcutEnd) - cursor);
    cursor = Math.max(cursor, z.end_mm);
    if (cursor >= offcutEnd) break;
  }
  if (cursor < offcutEnd) best = Math.max(best, offcutEnd - cursor);
  return best;
}

/** Compute the full fit result. price_cents is null when the board has no grade or rate in force. */
export function computeFit(
  boardLength: number,
  boardWidth: number,
  zones: Zone[],
  input: PieceInput[],
  rateCents: number | null,
  priceOf: (takeMm: number) => number | null,
  boardFeetOf: (takeMm: number) => string,
): FitFigures {
  const statuses = pieceStatuses(boardLength, boardWidth, input, zones);
  const pieces: PieceResult[] = input.map((p, i) => ({ ...p, status: statuses[i] }));
  const clearCount = pieces.filter((p) => p.status === 'clear').length;
  const broken = pieces.some((p) => p.status === 'off board' || p.status === 'too wide' || p.status === 'overlap');
  const total = pieces.length;
  if (broken) {
    return {
      pieces,
      clear_count: clearCount,
      cuts_mm: [],
      take_mm: null,
      sale: null,
      offcut_mm: null,
      clear_offcut_mm: null,
      board_feet: null,
      price_cents: null,
      verdict: `${clearCount} of ${total} cuts fit clear of defects, layout needs fixing`,
    };
  }
  const cuts = cutPositions(boardLength, input);
  let take = 0;
  for (const p of input) take = Math.max(take, p.start_mm + p.length_mm);
  const possibleOffcut = boardLength - take - KERF_ROUND_MM;
  let sale: 'cut' | 'whole';
  let offcutMm: number;
  if (possibleOffcut >= OFFCUT_MIN_MM) {
    sale = 'cut';
    offcutMm = possibleOffcut;
  } else {
    sale = 'whole';
    take = boardLength;
    offcutMm = 0;
  }
  const clearOffcut = sale === 'cut' ? clearOffcutRun(zones, take + KERF_ROUND_MM, boardLength) : 0;
  const verdict =
    sale === 'cut'
      ? `${clearCount} of ${total} cuts fit clear of defects, offcut ${offcutMm} mm`
      : `${clearCount} of ${total} cuts fit clear of defects, no offcut`;
  return {
    pieces,
    clear_count: clearCount,
    cuts_mm: cuts,
    take_mm: take,
    sale,
    offcut_mm: sale === 'cut' ? offcutMm : null,
    clear_offcut_mm: sale === 'cut' ? clearOffcut : null,
    board_feet: boardFeetOf(take),
    price_cents: rateCents === null ? null : priceOf(take),
    verdict,
  };
}
