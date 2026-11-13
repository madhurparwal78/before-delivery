import { DefectKind, KERF_WHOLE_MM, MIN_OFFCUT_MM, MIN_PIECE_GAP_MM } from './constants';

export interface DefectZone {
  kind: DefectKind;
  start_mm: number;
  end_mm: number;
}

export interface PiecePlacement {
  label: string;
  length_mm: number;
  width_mm: number;
  start_mm: number;
}

/** A piece in the published key order, whatever order storage returned. */
export function pieceShapes(pieces: PiecePlacement[]): PiecePlacement[] {
  return pieces.map((piece) => ({
    label: piece.label,
    length_mm: piece.length_mm,
    width_mm: piece.width_mm,
    start_mm: piece.start_mm
  }));
}

export type PieceStatus = 'clear' | 'over defect' | 'overlap' | 'off board' | 'too wide';

export interface BoardGeometry {
  length_mm: number;
  width_mm: number;
  defects: DefectZone[];
}

export type SaleKind = 'cut' | 'whole';

export interface Span {
  start: number;
  end: number;
}

const spanOf = (piece: PiecePlacement): Span => ({ start: piece.start_mm, end: piece.start_mm + piece.length_mm });

/** Millimetres between two spans; negative when they intersect. */
function gapBetween(a: Span, b: Span): number {
  if (a.end <= b.start) return b.start - a.end;
  if (b.end <= a.start) return a.start - b.end;
  return -1;
}

function overlapsAnyDefect(span: Span, defects: DefectZone[]): boolean {
  return defects.some((zone) => zone.start_mm < span.end && span.start < zone.end_mm);
}

export function pieceStatus(index: number, pieces: PiecePlacement[], board: BoardGeometry): PieceStatus {
  const piece = pieces[index];
  if (piece === undefined) return 'clear';
  const span = spanOf(piece);
  if (span.end > board.length_mm) return 'off board';
  if (piece.width_mm > board.width_mm) return 'too wide';
  for (let other = 0; other < pieces.length; other += 1) {
    if (other === index) continue;
    const otherPiece = pieces[other];
    if (otherPiece === undefined) continue;
    if (gapBetween(span, spanOf(otherPiece)) < MIN_PIECE_GAP_MM) return 'overlap';
  }
  if (overlapsAnyDefect(span, board.defects)) return 'over defect';
  return 'clear';
}

/** Cut positions, ascending and listed once each. */
export function cutPositions(pieces: PiecePlacement[], boardLength: number): number[] {
  const ends = pieces.map((piece) => piece.start_mm + piece.length_mm);
  const positions = new Set<number>();
  for (const end of ends) {
    if (end < boardLength) positions.add(end);
  }
  for (const piece of pieces) {
    if (piece.start_mm <= 0) continue;
    const separatedByAnEnd = ends.some((end) => piece.start_mm === end + MIN_PIECE_GAP_MM);
    if (separatedByAnEnd) continue;
    positions.add(piece.start_mm);
  }
  return [...positions].sort((a, b) => a - b);
}

/** The longest stretch of [from, to) that no defect zone touches. */
export function longestClearRun(from: number, to: number, defects: DefectZone[]): number {
  if (to <= from) return 0;
  const clipped = defects
    .map((zone) => ({ start: Math.max(zone.start_mm, from), end: Math.min(zone.end_mm, to) }))
    .filter((zone) => zone.end > zone.start)
    .sort((a, b) => a.start - b.start);
  let longest = 0;
  let cursor = from;
  for (const zone of clipped) {
    if (zone.start > cursor) longest = Math.max(longest, zone.start - cursor);
    cursor = Math.max(cursor, zone.end);
  }
  if (to > cursor) longest = Math.max(longest, to - cursor);
  return longest;
}

export function boardLongestClearRun(board: BoardGeometry): number {
  return longestClearRun(0, board.length_mm, board.defects);
}

export interface SaleGeometry {
  take_mm: number;
  sale: SaleKind;
  offcut_mm: number | null;
  clear_offcut_mm: number | null;
}

export function saleGeometry(pieces: PiecePlacement[], board: BoardGeometry): SaleGeometry {
  const largestEnd = pieces.reduce((best, piece) => Math.max(best, piece.start_mm + piece.length_mm), 0);
  const possibleOffcut = board.length_mm - largestEnd - KERF_WHOLE_MM;
  if (possibleOffcut < MIN_OFFCUT_MM) {
    return { take_mm: board.length_mm, sale: 'whole', offcut_mm: null, clear_offcut_mm: null };
  }
  const offcutStart = largestEnd + KERF_WHOLE_MM;
  return {
    take_mm: largestEnd,
    sale: 'cut',
    offcut_mm: possibleOffcut,
    clear_offcut_mm: longestClearRun(offcutStart, board.length_mm, board.defects)
  };
}

export interface FitGeometry {
  statuses: PieceStatus[];
  clear_count: number;
  cuts_mm: number[];
  take_mm: number | null;
  sale: SaleKind | null;
  offcut_mm: number | null;
  clear_offcut_mm: number | null;
}

export function fitGeometry(pieces: PiecePlacement[], board: BoardGeometry): FitGeometry {
  const statuses = pieces.map((_piece, index) => pieceStatus(index, pieces, board));
  const clear_count = statuses.filter((status) => status === 'clear').length;
  const cuts_mm = cutPositions(pieces, board.length_mm);
  const blocked = statuses.some((status) => status === 'off board' || status === 'too wide' || status === 'overlap');
  if (blocked) {
    return { statuses, clear_count, cuts_mm, take_mm: null, sale: null, offcut_mm: null, clear_offcut_mm: null };
  }
  const sale = saleGeometry(pieces, board);
  return { statuses, clear_count, cuts_mm, ...sale };
}

export function verdictSentence(clearCount: number, total: number, sale: SaleKind | null, offcutMm: number | null): string {
  const head = `${clearCount} of ${total} cuts fit clear of defects`;
  if (sale === 'cut' && offcutMm !== null) return `${head}, offcut ${offcutMm} mm`;
  if (sale === 'whole') return `${head}, no offcut`;
  return `${head}, layout needs fixing`;
}

/** The parent's defect zones that fall inside an offcut, shifted to the offcut's own origin. */
export function offcutDefects(defects: DefectZone[], offcutStart: number, offcutLength: number): DefectZone[] {
  const zones: DefectZone[] = [];
  for (const zone of defects) {
    const start = Math.max(zone.start_mm, offcutStart) - offcutStart;
    const end = Math.min(zone.end_mm, offcutStart + offcutLength) - offcutStart;
    if (end > start) zones.push({ kind: zone.kind, start_mm: start, end_mm: end });
  }
  return zones;
}

/** Defect zones clipped to a shorter board, as after a re-measure at the saw. */
export function clipDefects(defects: DefectZone[], length: number): DefectZone[] {
  const zones: DefectZone[] = [];
  for (const zone of defects) {
    const end = Math.min(zone.end_mm, length);
    if (end > zone.start_mm) zones.push({ kind: zone.kind, start_mm: zone.start_mm, end_mm: end });
  }
  return zones;
}
