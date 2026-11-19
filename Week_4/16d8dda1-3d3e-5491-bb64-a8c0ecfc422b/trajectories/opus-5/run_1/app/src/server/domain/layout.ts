import type { LayoutJson, SeatPlan, TablePlan } from '../../shared/types.js';
import { compareSeatIds, seatIdFor } from '../../shared/rules.js';
import { ApiError } from '../http.js';

export const BOARD_WIDTH = 4;
const MIN_COLUMNS = 4;
const MAX_COLUMNS = 12;
const MIN_ROWS = 3;
const MAX_ROWS = 10;

export interface RoomPlan {
  layout: LayoutJson;
  seats: SeatPlan[];
  tables: TablePlan[];
}

type Kind = 'board' | 'table' | 'seat';

interface CheckedPiece {
  kind: Kind;
  column: number;
  row: number;
}

function refuse(text: string): never {
  throw new ApiError(422, text);
}

function cellsOf(piece: CheckedPiece): string[] {
  const width = piece.kind === 'board' ? BOARD_WIDTH : 1;
  const cells: string[] = [];
  for (let offset = 0; offset < width; offset += 1) cells.push(`${piece.column + offset},${piece.row}`);
  return cells;
}

function readInteger(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : Number.NaN;
}

/** DP-03: the one place a room layout is judged. */
export function planRoom(body: unknown): RoomPlan {
  const source = (body ?? {}) as { columns?: unknown; rows?: unknown; pieces?: unknown };
  const columns = readInteger(source.columns);
  const rows = readInteger(source.rows);
  if (
    Number.isNaN(columns) ||
    Number.isNaN(rows) ||
    columns < MIN_COLUMNS ||
    columns > MAX_COLUMNS ||
    rows < MIN_ROWS ||
    rows > MAX_ROWS
  ) {
    refuse('A room is 4 to 12 columns by 3 to 10 rows.');
  }
  const rawPieces = Array.isArray(source.pieces) ? source.pieces : [];
  const placed: { piece: CheckedPiece; cells: Set<string> }[] = [];

  rawPieces.forEach((raw, index) => {
    const number = index + 1;
    const item = (raw ?? {}) as { kind?: unknown; column?: unknown; row?: unknown };
    const kind = item.kind;
    if (kind !== 'board' && kind !== 'table' && kind !== 'seat') {
      refuse(`Piece ${number} isn't a board, table or seat.`);
    }
    const piece: CheckedPiece = { kind, column: readInteger(item.column), row: readInteger(item.row) };
    const width = kind === 'board' ? BOARD_WIDTH : 1;
    if (
      Number.isNaN(piece.column) ||
      Number.isNaN(piece.row) ||
      piece.column < 0 ||
      piece.row < 0 ||
      piece.column + width > columns ||
      piece.row >= rows
    ) {
      refuse(`Piece ${number} is outside the room.`);
    }
    if (kind === 'board' && piece.row !== 0) refuse('The board must sit on the front wall.');
    if (kind !== 'board' && piece.row === 0) refuse("Seats and tables can't go on the front wall.");
    const cells = new Set(cellsOf(piece));
    const clash = placed.findIndex((earlier) => [...cells].some((cell) => earlier.cells.has(cell)));
    if (clash !== -1) refuse(`Piece ${number} overlaps piece ${clash + 1}.`);
    placed.push({ piece, cells });
  });

  const boards = placed.filter((entry) => entry.piece.kind === 'board');
  if (boards.length !== 1) refuse('A classroom needs exactly one board.');

  const layout: LayoutJson = {
    columns,
    rows,
    pieces: placed.map((entry) => ({ kind: entry.piece.kind, column: entry.piece.column, row: entry.piece.row }))
  };
  return { layout, ...derivePlan(layout) };
}

/** Table ids run in row order then column order; a seat joins the table beside it. */
export function derivePlan(layout: LayoutJson): { seats: SeatPlan[]; tables: TablePlan[] } {
  const tablePieces = layout.pieces
    .filter((piece) => piece.kind === 'table')
    .sort((a, b) => (a.row === b.row ? a.column - b.column : a.row - b.row));
  const tables: TablePlan[] = tablePieces.map((piece, index) => ({
    tableId: `T${index + 1}`,
    row: piece.row,
    column: piece.column
  }));
  const tableAt = new Map<string, string>();
  for (const table of tables) tableAt.set(`${table.column},${table.row}`, table.tableId);

  const seats: SeatPlan[] = layout.pieces
    .filter((piece) => piece.kind === 'seat')
    .map((piece) => ({
      seatId: seatIdFor(piece.column, piece.row),
      table: tableAt.get(`${piece.column - 1},${piece.row}`) ?? tableAt.get(`${piece.column + 1},${piece.row}`) ?? null,
      row: piece.row,
      column: piece.column
    }))
    .sort((a, b) => compareSeatIds(a.seatId, b.seatId));

  return { seats, tables };
}
