import type { Repeat } from '../../shared/api.ts'
import type { ChartData } from './chart.ts'

interface Grids { chart: ChartData; rev: number[][] }

const boxWidth = (box: Repeat) => box.toCol - box.fromCol + 1

export function addedColumns(box: Repeat): number {
  return (box.times - 1) * boxWidth(box)
}

export function overlaps(a: Pick<Repeat, 'fromCol' | 'toCol' | 'fromRow' | 'toRow'>, b: Pick<Repeat, 'fromCol' | 'toCol' | 'fromRow' | 'toRow'>): boolean {
  return a.fromRow <= b.toRow && b.fromRow <= a.toRow && a.fromCol <= b.toCol && b.fromCol <= a.toCol
}

/** Widens the chart by the box's extra copies; the box goes and the lines and counts stay the same. */
export function expandBox(grids: Grids, box: Repeat): Grids {
  const { chart, rev } = grids
  const add = addedColumns(box)
  const stitch: string[][] = []
  const colour: string[][] = []
  const nextRev: number[][] = []
  for (let r = 1; r <= chart.height; r++) {
    const inside = r >= box.fromRow && r <= box.toRow
    const copy = <T,>(source: T[]) => {
      const unit = source.slice(box.fromCol - 1, box.toCol)
      return { left: source.slice(0, box.toCol), extra: Array.from({ length: box.times - 1 }, () => unit).flat(), right: source.slice(box.toCol) }
    }
    const s = copy(chart.stitch[r - 1])
    stitch.push([...s.left, ...(inside ? s.extra : s.extra.map(() => 'ns')), ...s.right])
    const c = copy(chart.colour[r - 1])
    colour.push([...c.left, ...c.extra, ...c.right])
    const v = copy(rev[r - 1])
    nextRev.push([...v.left, ...v.extra.map(() => 0), ...v.right])
  }
  const shift = (col: number) => (col > box.toCol ? col + add : col)
  const repeats = chart.repeats.filter((b) => b.id !== box.id).map((b) => ({ ...b, fromCol: shift(b.fromCol), toCol: shift(b.toCol) }))
  return { chart: { ...chart, width: chart.width + add, stitch, colour, repeats }, rev: nextRev }
}

/** Undoes an expansion: drops the added columns and brings the box back. */
export function collapseBox(grids: Grids, box: Repeat): Grids {
  const { chart, rev } = grids
  const add = addedColumns(box)
  const cut = <T,>(row: T[]) => [...row.slice(0, box.toCol), ...row.slice(box.toCol + add)]
  const shift = (col: number) => (col > box.toCol ? col - add : col)
  const repeats = [...chart.repeats.map((b) => ({ ...b, fromCol: shift(b.fromCol), toCol: shift(b.toCol) })), box]
    .sort((a, b) => a.id.localeCompare(b.id))
  return {
    chart: { ...chart, width: chart.width - add, stitch: chart.stitch.map(cut), colour: chart.colour.map(cut), repeats },
    rev: rev.map(cut),
  }
}
