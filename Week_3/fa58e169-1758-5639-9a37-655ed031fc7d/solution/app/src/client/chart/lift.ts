import type { Row } from '../../shared/api.ts'

export type Source = { kind: 'cell'; row: number; col: number } | { kind: 'token'; row: number; index: number }

/** The pair a source stands for: a written token and the chart columns it was worked from. */
export interface Twin { row: number; token: number; cols: number[]; whole: boolean }

function tokensOf(row: Row): { cols: number[] }[] {
  return row.segments.filter((s) => s.cols).map((s) => ({ cols: s.cols! }))
}

export function twinOf(source: Source | null, rows: Row[], stitchAt: (row: number, col: number) => string): Twin | null {
  if (!source) return null
  const row = rows[source.row - 1]
  if (!row) return null
  const tokens = tokensOf(row)
  if (source.kind === 'token') {
    const token = tokens[source.index]
    return token ? { row: source.row, token: source.index, cols: token.cols, whole: false } : null
  }
  if (stitchAt(source.row, source.col) === 'ns') return null
  const index = tokens.findIndex((t) => t.cols.includes(source.col))
  return index < 0 ? { row: source.row, token: -1, cols: [source.col], whole: false } : { row: source.row, token: index, cols: tokens[index].cols, whole: false }
}

export function wholeRow(row: Row): Twin {
  return { row: row.row, token: -1, cols: [...new Set(tokensOf(row).flatMap((t) => t.cols))], whole: true }
}

export function sameTwin(a: Twin | null, b: Twin | null): boolean {
  return !!a && !!b && a.row === b.row && a.token === b.token && a.whole === b.whole && a.cols.join() === b.cols.join()
}
