// A classroom: the one place that validates a room and derives its seats and tables.
import { compareSeatIds } from '../../shared/seats';
import type { Layout, LayoutResult, Piece, PieceKind, SeatPlace, TablePlace } from '../../shared/wire';
import { Refusal } from '../errors';
import { isRecord } from '../http';

const GRID = 'A room is 4 to 12 columns by 3 to 10 rows.';
const BOARD_WIDTH = 4;
const KINDS: readonly string[] = ['board', 'table', 'seat'];

/** The room a new class starts with: 8 by 6 and the board on the front wall. */
export const STARTING_LAYOUT: Layout = { columns: 8, rows: 6, pieces: [{ kind: 'board', column: 2, row: 0 }] };

/** Tables are numbered from 1 in reading order. */
export function tableIdOf(index: number): string {
  return `T${index + 1}`;
}

function seatIdAt(row: number, column: number): string {
  return `${String.fromCharCode(64 + row)}${column + 1}`;
}

function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function cellsOf(piece: Piece): string[] {
  const width = piece.kind === 'board' ? BOARD_WIDTH : 1;
  return Array.from({ length: width }, (_, offset) => `${piece.column + offset},${piece.row}`);
}

function isInside(piece: Piece, columns: number, rows: number): boolean {
  const width = piece.kind === 'board' ? BOARD_WIDTH : 1;
  return (
    Number.isInteger(piece.column) &&
    Number.isInteger(piece.row) &&
    piece.column >= 0 &&
    piece.row >= 0 &&
    piece.column + width <= columns &&
    piece.row < rows
  );
}

/** Checks a layout in the published order and answers the first refusal as a 422. */
export function checkLayout(input: unknown): Layout {
  const source = isRecord(input) ? input : {};
  const { columns, rows } = source;
  if (!inRange(columns, 4, 12) || !inRange(rows, 3, 10)) throw new Refusal(422, GRID);
  const list = Array.isArray(source.pieces) ? source.pieces : [];
  const pieces: Piece[] = [];
  const occupied = new Map<string, number>();
  list.forEach((raw: unknown, index: number) => {
    const n = index + 1;
    const record = isRecord(raw) ? raw : {};
    if (typeof record.kind !== 'string' || !KINDS.includes(record.kind)) {
      throw new Refusal(422, `Piece ${n} isn't a board, table or seat.`);
    }
    const piece: Piece = { kind: record.kind as PieceKind, column: Number(record.column), row: Number(record.row) };
    if (!isInside(piece, columns, rows)) throw new Refusal(422, `Piece ${n} is outside the room.`);
    if (piece.kind === 'board' && piece.row !== 0) throw new Refusal(422, 'The board must sit on the front wall.');
    if (piece.kind !== 'board' && piece.row === 0) throw new Refusal(422, "Seats and tables can't go on the front wall.");
    const earlier = cellsOf(piece)
      .map((cell) => occupied.get(cell))
      .filter((m): m is number => m !== undefined);
    if (earlier.length > 0) throw new Refusal(422, `Piece ${n} overlaps piece ${Math.min(...earlier)}.`);
    for (const cell of cellsOf(piece)) occupied.set(cell, n);
    pieces.push(piece);
  });
  if (pieces.filter((piece) => piece.kind === 'board').length !== 1) {
    throw new Refusal(422, 'A classroom needs exactly one board.');
  }
  return { columns, rows, pieces };
}

/** The left column of the board; a saved room has exactly one (checkLayout). */
export function boardColumn(layout: Layout): number {
  const board = layout.pieces.find((piece) => piece.kind === 'board');
  if (!board) throw new Error('A saved room has its board.');
  return board.column;
}

export function derivePlaces(layout: Layout): { seats: SeatPlace[]; tables: TablePlace[] } {
  const tablePieces = layout.pieces
    .filter((piece) => piece.kind === 'table')
    .sort((a, b) => a.row - b.row || a.column - b.column);
  const tables: TablePlace[] = tablePieces.map((piece, index) => ({ tableId: tableIdOf(index), row: piece.row, column: piece.column }));
  const tableAt = new Map(tables.map((table) => [`${table.column},${table.row}`, table.tableId]));
  const seats: SeatPlace[] = layout.pieces
    .filter((piece) => piece.kind === 'seat')
    .map((piece) => ({
      seatId: seatIdAt(piece.row, piece.column),
      table: tableAt.get(`${piece.column - 1},${piece.row}`) ?? tableAt.get(`${piece.column + 1},${piece.row}`) ?? null,
      row: piece.row,
      column: piece.column,
    }))
    .sort((a, b) => compareSeatIds(a.seatId, b.seatId));
  return { seats, tables };
}

export function describeLayout(layout: Layout): LayoutResult {
  return { layout, ...derivePlaces(layout) };
}
