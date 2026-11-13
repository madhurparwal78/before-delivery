import { useMemo, useState, type FocusEvent, type PointerEvent } from 'react'
import type { LinesView } from './Lines.tsx'
import { type Source, type Twin, sameTwin, twinOf, wholeRow } from './lift.ts'
import type { ChartModel } from './model.ts'

function sourceOf(el: EventTarget | null): Source | null {
  const node = el instanceof Element ? el : null
  const cell = node?.closest<HTMLElement>('[role=gridcell][data-col]')
  if (cell) return { kind: 'cell', row: Number(cell.dataset.row), col: Number(cell.dataset.col) }
  const token = node?.closest<HTMLElement>('[data-token]')
  if (token) return { kind: 'token', row: Number(token.closest<HTMLElement>('[data-row]')!.dataset.row), index: Number(token.dataset.index) }
  return null
}

/** Pointer, focus and pin state of the twin lift: which written token and chart cells are the same stitches. */
export function useTwinLift(model: ChartModel | null, forcedRow?: number) {
  const [hover, setHover] = useState<Source | null>(null)
  const [focus, setFocus] = useState<Source | null>(null)
  const [pinned, setPinned] = useState<Twin | null>(null)

  const stitchAt = (row: number, col: number) => model!.grid[row - 1]?.[col - 1]?.stitch ?? 'ns'
  const shown = useMemo(() => (model ? twinOf(hover ?? focus, model.rows, (r, c) => model.grid[r - 1]?.[c - 1]?.stitch ?? 'ns') : null), [hover, focus, model])
  const pin = useMemo(() => (model && forcedRow ? wholeRow(model.rows[forcedRow - 1]) : pinned), [model, forcedRow, pinned])

  const togglePin = (twin: Twin | null) => { if (twin) setPinned((old) => (sameTwin(old, twin) ? null : twin)) }
  const pinToken = (row: number, index: number) => togglePin(twinOf({ kind: 'token', row, index }, model!.rows, stitchAt))
  const pinCell = (row: number, col: number) => togglePin(twinOf({ kind: 'cell', row, col }, model!.rows, stitchAt))
  const pinRow = (row: number) => setPinned((old) => (old?.whole && old.row === row ? null : wholeRow(model!.rows[row - 1])))

  const maps = useMemo(() => {
    const lifted = new Map<number, Set<number>>()
    const pinnedCols = new Map<number, Set<number>>()
    const add = (into: Map<number, Set<number>>, twin: Twin | null) => {
      if (!twin) return
      if (!into.has(twin.row)) into.set(twin.row, new Set())
      twin.cols.forEach((c) => into.get(twin.row)!.add(c))
    }
    add(lifted, shown)
    add(lifted, pin)
    add(pinnedCols, pin)
    return { lifted, pinned: pinnedCols }
  }, [shown, pin])

  const lines: LinesView = {
    lifted: new Map(shown && shown.token >= 0 ? [[shown.row, shown.token]] : []),
    pinnedToken: new Map(pin && !pin.whole && pin.token >= 0 ? [[pin.row, pin.token]] : []),
    pinnedRow: pin?.whole && !forcedRow ? pin.row : null,
    followRow: forcedRow,
  }

  const events = {
    onPointerOver: (e: PointerEvent) => setHover(sourceOf(e.target)),
    onPointerLeave: () => setHover(null),
    onFocus: (e: FocusEvent) => setFocus(sourceOf(e.target)),
    onBlur: () => setFocus(null),
  }

  return { ...maps, shown, pin, lines, events, togglePin, pinToken, pinCell, pinRow }
}
