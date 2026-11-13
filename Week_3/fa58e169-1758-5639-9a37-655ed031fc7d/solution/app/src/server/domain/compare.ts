import { type ChartData, analyseChart, stitchesOf } from './chart.ts'

type Diff = 'added' | 'changed' | 'same'

interface Comparison {
  rowsChanged: number
  rowsAdded: number
  rowsRemoved: number
  cellsChanged: number
  stitchesFrom: number
  stitchesTo: number
  summary: string
  cells: { row: number; col: number; stitch: string; colour: string; diff: Diff }[]
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Rows pair by number and columns by number; the grid shown is the later version's. */
export function compareCharts(a: ChartData, b: ChartData): Comparison {
  const paired = Math.min(a.height, b.height)
  const widest = Math.max(a.width, b.width)
  let rowsChanged = 0
  let cellsChanged = 0
  for (let row = 1; row <= paired; row++) {
    let differing = 0
    for (let col = 1; col <= widest; col++) {
      const past = col > a.width || col > b.width
      if (past || a.stitch[row - 1][col - 1] !== b.stitch[row - 1][col - 1] || a.colour[row - 1][col - 1] !== b.colour[row - 1][col - 1]) differing++
    }
    if (differing) rowsChanged++
    cellsChanged += differing
  }
  const rowsAdded = Math.max(0, b.height - a.height)
  const rowsRemoved = Math.max(0, a.height - b.height)
  const cells: Comparison['cells'] = []
  for (let row = 1; row <= b.height; row++) {
    for (let col = 1; col <= b.width; col++) {
      const stitch = b.stitch[row - 1][col - 1]
      const colour = b.colour[row - 1][col - 1]
      const diff: Diff = row > a.height || col > a.width ? 'added'
        : stitch !== a.stitch[row - 1][col - 1] || colour !== a.colour[row - 1][col - 1] ? 'changed' : 'same'
      cells.push({ row, col, stitch, colour, diff })
    }
  }
  const stitchesFrom = stitchesOf(analyseChart(a))
  const stitchesTo = stitchesOf(analyseChart(b))
  const summary = `${plural(rowsChanged, 'row changed', 'rows changed')}, ${plural(rowsAdded, 'row added', 'rows added')}, `
    + `${plural(rowsRemoved, 'row removed', 'rows removed')}, ${plural(cellsChanged, 'cell changed', 'cells changed')}. `
    + `Stitches ${stitchesFrom} to ${stitchesTo}.`
  return { rowsChanged, rowsAdded, rowsRemoved, cellsChanged, stitchesFrom, stitchesTo, summary, cells }
}
