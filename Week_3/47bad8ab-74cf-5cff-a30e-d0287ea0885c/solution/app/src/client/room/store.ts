import type { Square } from '../../shared/types.ts'

const key = (row: number, col: number): string => `${row},${col}`

export const emptySquare = (row: number, col: number): Square => ({ row, col, value: '', pencil: false, state: 'empty', owner: null })

/** The squares as the server settled them, plus this player's own writes that have not been answered yet. */
export class SquareStore {
  private confirmed = new Map<string, Square>()
  private readonly pending = new Map<string, { opId: string; square: Square }>()

  reset(squares: readonly Square[]): void {
    this.confirmed = new Map(squares.map((square) => [key(square.row, square.col), square]))
    this.pending.clear()
  }

  get(row: number, col: number): Square {
    return this.pending.get(key(row, col))?.square ?? this.confirmed.get(key(row, col)) ?? emptySquare(row, col)
  }

  /** The settled value of a square: what the server last said about it. */
  settled(row: number, col: number): Square {
    return this.confirmed.get(key(row, col)) ?? emptySquare(row, col)
  }

  settle(square: Square): void {
    this.confirmed.set(key(square.row, square.col), square)
  }

  expect(opId: string, square: Square): void {
    this.pending.set(key(square.row, square.col), { opId, square })
  }

  /** Drops this operation's optimistic square once the server answered it; returns the square's key, if it had one. */
  answered(opId: string | null): string | null {
    for (const [at, entry] of this.pending) {
      if (entry.opId === opId) {
        this.pending.delete(at)
        return at
      }
    }
    return null
  }
}
