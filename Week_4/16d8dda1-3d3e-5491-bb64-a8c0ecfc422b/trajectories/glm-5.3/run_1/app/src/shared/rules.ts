// Domain rules that both the server and the browser use. Each rule is decided
// in exactly one place, here, and every caller goes through it.

export type PieceKind = 'board' | 'table' | 'seat'

export interface Piece {
  kind: PieceKind
  column: number
  row: number
}

export interface Layout {
  columns: number
  rows: number
  pieces: Piece[]
}

export interface SeatInfo {
  seatId: string
  table: string | null
  row: number
  column: number
}

export interface TableInfo {
  tableId: string
  row: number
  column: number
}

export interface ArrangedRoom {
  layout: Layout
  seats: SeatInfo[]
  tables: TableInfo[]
}

const ROW_LETTERS = 'ABCDEFGHI'

export function seatIdFor(row: number, column: number): string {
  return `${ROW_LETTERS[row - 1]}${column + 1}`
}

function seatSortKey(seatId: string): [number, number] {
  const letterIndex = ROW_LETTERS.indexOf(seatId[0])
  const column = Number(seatId.slice(1))
  return [letterIndex, column]
}

export function compareSeatIds(a: string, b: string): number {
  const [ar, ac] = seatSortKey(a)
  const [br, bc] = seatSortKey(b)
  return ar - br || ac - bc
}

function cellKey(column: number, row: number): string {
  return `${column},${row}`
}

/** Checks a layout and returns the refusal text, or the arranged room. */
export function arrangeRoom(layout: Layout): { error: string } | { room: ArrangedRoom } {
  const columns = layout?.columns
  const rows = layout?.rows
  if (
    typeof columns !== 'number' || typeof rows !== 'number' ||
    !Number.isInteger(columns) || !Number.isInteger(rows) ||
    columns < 4 || columns > 12 || rows < 3 || rows > 10
  ) {
    return { error: 'A room is 4 to 12 columns by 3 to 10 rows.' }
  }
  if (!Array.isArray(layout.pieces)) return { error: 'A classroom needs exactly one board.' }
  const owner = new Map<string, number>() // cell -> 1-based piece index
  let boardCount = 0
  for (let i = 0; i < layout.pieces.length; i++) {
    const piece = layout.pieces[i]
    const n = i + 1
    if (piece?.kind !== 'board' && piece?.kind !== 'table' && piece?.kind !== 'seat') {
      return { error: `Piece ${n} isn't a board, table or seat.` }
    }
    const { column, row } = piece
    if (
      typeof column !== 'number' || typeof row !== 'number' ||
      !Number.isInteger(column) || !Number.isInteger(row) ||
      column < 0 || row < 0 ||
      (piece.kind === 'board' ? column + 4 > columns : column >= columns) || row >= rows
    ) {
      return { error: `Piece ${n} is outside the room.` }
    }
    if (piece.kind === 'board') {
      if (row !== 0) return { error: 'The board must sit on the front wall.' }
      boardCount++
    } else if (row === 0) {
      return { error: "Seats and tables can't go on the front wall." }
    }
    const cells: [number, number][] = []
    const width = piece.kind === 'board' ? 4 : 1
    for (let c = column; c < column + width; c++) cells.push([c, row])
    for (const [c, r] of cells) {
      const key = cellKey(c, r)
      const first = owner.get(key)
      if (first !== undefined) return { error: `Piece ${n} overlaps piece ${first}.` }
    }
    for (const [c, r] of cells) owner.set(cellKey(c, r), n)
  }
  if (boardCount !== 1) return { error: 'A classroom needs exactly one board.' }

  const seats: SeatInfo[] = []
  const tables: TableInfo[] = []
  const tableCells = new Map<string, string>() // cell -> tableId
  const orderedTables = layout.pieces
    .filter((p): p is Piece & { kind: 'table' } => p.kind === 'table')
    .sort((a, b) => a.row - b.row || a.column - b.column)
  orderedTables.forEach((piece, index) => {
    const tableId = `T${index + 1}`
    tables.push({ tableId, row: piece.row, column: piece.column })
    tableCells.set(cellKey(piece.column, piece.row), tableId)
  })
  for (const piece of layout.pieces) {
    if (piece.kind !== 'seat') continue
    const table =
      tableCells.get(cellKey(piece.column - 1, piece.row)) ??
      tableCells.get(cellKey(piece.column + 1, piece.row)) ??
      null
    seats.push({ seatId: seatIdFor(piece.row, piece.column), table, row: piece.row, column: piece.column })
  }
  seats.sort((a, b) => compareSeatIds(a.seatId, b.seatId))
  return { room: { layout, seats, tables } }
}

/** Deals seated learners, in seat-id order, to tables T1..Tk in turn. */
export function dealBreakout(seatIds: string[], tableCount: number): Map<string, string> {
  const deal = new Map<string, string>()
  const sorted = [...seatIds].sort(compareSeatIds)
  sorted.forEach((seatId, index) => {
    deal.set(seatId, `T${(index % tableCount) + 1}`)
  })
  return deal
}

export function pollPercent(count: number, total: number): number {
  if (total === 0) return 0
  return Math.floor((count * 100) / total + 0.5)
}

export function formatClock(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds)
  const minutes = Math.floor(clamped / 60)
  const seconds = clamped % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export const STARTING_LAYOUT: Layout = {
  columns: 8,
  rows: 6,
  pieces: [{ kind: 'board', column: 2, row: 0 }]
}
