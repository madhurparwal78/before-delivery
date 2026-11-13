import { useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react'
import type { Category, DisplayUnit, TripList } from '../../shared/api-types'
import { CATEGORIES } from '../../shared/categories'
import { formatWeight, percentOf, scaleToColumn } from '../../shared/display'
import type { ChangeInfo } from './controller'

export const COLUMN_WIDE = 480
export const COLUMN_PHONE = 360
const CAP_NUMERATOR = 5
const CAP_DENOMINATOR = 4

function capPx(columnPx: number): number {
  return Math.floor((columnPx * CAP_NUMERATOR) / CAP_DENOMINATOR)
}

/** The strata column's geometry and numerals: pixels per band and side column, grams for the numerals. */
interface StrataSnap {
  bands: number[]
  worn: number
  consumable: number
  base: number
  wornGrams: number
  consumableGrams: number
  skinOut: number
}

export function snapOf(totals: TripList['totals'], categories: TripList['categories'], columnPx: number): StrataSnap {
  const goal = totals.goalGrams
  return {
    bands: CATEGORIES.map((category) => scaleToColumn(categories.find((entry) => entry.category === category)?.baseGrams ?? 0, columnPx, goal)),
    worn: scaleToColumn(totals.wornGrams, columnPx, goal),
    consumable: scaleToColumn(totals.consumableGrams, columnPx, goal),
    base: totals.baseGrams,
    wornGrams: totals.wornGrams,
    consumableGrams: totals.consumableGrams,
    skinOut: totals.skinOutGrams,
  }
}

const key = (snap: StrataSnap): string => JSON.stringify(snap)

type Step = 'chip' | 'band' | 'num'
const DURATION: Record<Step, number> = { chip: 320, band: 240, num: 400 }

interface Run {
  steps: Step[]
  index: number
  startedAt: number | null
  from: StrataSnap
  to: StrataSnap
  chip: { x0: number; y0: number; x1: number; y1: number; label: string } | null
}

interface ChipView {
  x: number
  y: number
  label: string
}

const easeOut = (t: number): number => 1 - (1 - t) ** 3
const easeInOut = (t: number): number => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)
const mix = (from: number, to: number, t: number): number => from + Math.trunc((to - from) * t)

function between(from: StrataSnap, to: StrataSnap, bands: number, nums: number): StrataSnap {
  return {
    bands: from.bands.map((px, i) => mix(px, to.bands[i] ?? 0, bands)),
    worn: mix(from.worn, to.worn, bands),
    consumable: mix(from.consumable, to.consumable, bands),
    base: mix(from.base, to.base, nums),
    wornGrams: mix(from.wornGrams, to.wornGrams, nums),
    consumableGrams: mix(from.consumableGrams, to.consumableGrams, nums),
    skinOut: mix(from.skinOut, to.skinOut, nums),
  }
}

function centre(selector: string): { x: number; y: number } | null {
  const rect = document.querySelector(selector)?.getBoundingClientRect()
  return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null
}

function chipFlight(change: ChangeInfo, unitLabel: string, forward: boolean): Run['chip'] {
  const band = centre(`[data-band="${change.category}"]`) ?? centre('.strata-column')
  const row = forward
    ? (change.rect ? { x: change.rect.x + change.rect.width / 2, y: change.rect.y + change.rect.height / 2 } : null)
    : centre(`[data-closet-row="${CSS.escape(change.itemId)}"]`) ?? centre('[data-focus-key="region:closet"]')
  if (!band || !row) return null
  const [a, b] = forward ? [row, band] : [band, row]
  return { x0: a.x, y0: a.y, x1: b.x, y1: b.y, label: `Moving ${change.itemName}, ${unitLabel}` }
}

interface Options {
  collapsed: boolean
  reduced: boolean
  columnPx: number
  unit: DisplayUnit
  /** False until the list has been read; its first figures are drawn at once, not counted up from nothing. */
  loaded: boolean
}

/**
 * Plays the pack sequence between the snapshots the page settles on: chip, band, numerals for a pack, the reverse
 * for an unpack, band then numerals for any other change. Time comes from animation frames only.
 */
export function useStrataSequence(target: StrataSnap, change: ChangeInfo | null, options: Options): { shown: StrataSnap; chip: ChipView | null } {
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  const shown = useRef(target)
  const chip = useRef<ChipView | null>(null)
  const run = useRef<Run | null>(null)
  const frame = useRef(0)
  const lastKey = useRef(key(target))
  const lastSeq = useRef(change?.seq ?? 0)
  const lastColumn = useRef(options.columnPx)
  const wasLoaded = useRef(options.loaded)
  const latest = useRef({ target, options })
  latest.current = { target, options }
  const step = useRef<(time: number) => void>(() => undefined)

  step.current = (time: number) => {
    const current = run.current
    if (!current) return
    current.startedAt ??= time
    let name = current.steps[current.index]
    let t = name ? (time - current.startedAt) / DURATION[name] : 1
    while (name && t >= 1) {
      current.index += 1
      current.startedAt = time
      name = current.steps[current.index]
      t = name ? 0 : 1
    }
    if (!name) {
      run.current = null
      shown.current = current.to
      chip.current = null
      redraw()
      return
    }
    const fraction = (of: 'band' | 'num'): number => {
      const at = current.steps.indexOf(of)
      if (at === -1 || at < current.index) return 1
      return at > current.index ? 0 : easeOut(t)
    }
    shown.current = between(current.from, current.to, fraction('band'), fraction('num'))
    if (name === 'chip' && current.chip) {
      const e = easeInOut(t)
      chip.current = { x: current.chip.x0 + (current.chip.x1 - current.chip.x0) * e, y: current.chip.y0 + (current.chip.y1 - current.chip.y0) * e, label: current.chip.label }
    } else chip.current = null
    redraw()
    frame.current = requestAnimationFrame((next) => step.current(next))
  }

  const targetKey = key(target)
  useLayoutEffect(() => {
    const fresh = change && change.seq !== lastSeq.current ? change : null
    lastSeq.current = change?.seq ?? lastSeq.current
    if (targetKey === lastKey.current) return
    lastKey.current = targetKey
    const { target: to, options: opts } = latest.current
    cancelAnimationFrame(frame.current)
    const firstRead = !wasLoaded.current
    wasLoaded.current = opts.loaded
    if (opts.reduced || firstRead || opts.columnPx !== lastColumn.current) {
      lastColumn.current = opts.columnPx
      run.current = null
      chip.current = null
      shown.current = to
      redraw()
      return
    }
    const flying = run.current?.steps[run.current.index] === 'chip' ? run.current : null
    if (flying) {
      flying.to = to
    } else {
      const kind = fresh?.kind ?? 'adjust'
      const label = fresh ? formatWeight(fresh.unitWeightGrams, opts.unit) : ''
      let steps: Step[] = kind === 'pack-new' ? ['chip', 'band', 'num'] : kind === 'unpack' ? ['num', 'band', 'chip'] : ['band', 'num']
      if (opts.collapsed) steps = steps.filter((name) => name === 'num')
      const flight = fresh && steps.includes('chip') ? chipFlight(fresh, label, kind === 'pack-new') : null
      if (!flight) steps = steps.filter((name) => name !== 'chip')
      run.current = { steps, index: 0, startedAt: null, from: shown.current, to, chip: flight }
    }
    frame.current = requestAnimationFrame((time) => step.current(time))
  }, [targetKey, change])

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  if (options.reduced) return { shown: target, chip: null }
  return { shown: shown.current, chip: chip.current }
}

interface ColumnProps {
  categories: TripList['categories']
  totals: TripList['totals']
  shown: StrataSnap
  columnPx: number
  unit: DisplayUnit
}

/** The signature column: one band per category with base weight, worn and consumable beside it, the goal line across. */
export function StrataColumn({ categories, totals, shown, columnPx, unit }: ColumnProps) {
  const cap = capPx(columnPx)
  const over = totals.baseGrams > totals.goalGrams
  const visible = useMemo(() => {
    let used = 0
    return shown.bands.map((px) => {
      const px2 = Math.max(0, Math.min(px, cap - used))
      used += px2
      return px2
    })
  }, [shown.bands, cap])
  const stack = visible.reduce((sum, px) => sum + px, 0)
  /** Bands too thin to carry their own label are named in a key under the column. */
  const slivers = CATEGORIES.flatMap((category, index) => {
    const grams = categories.find((entry) => entry.category === category)?.baseGrams ?? 0
    const px = visible[index] ?? 0
    return grams > 0 && px < 18 ? [{ category, grams }] : []
  })
  return (
    <>
    <div className="strata-column" style={{ height: cap + 52, ['--column' as string]: `${columnPx}px` }}>
      <div className="strata-plot">
        <ol className="bands" aria-label="Base weight by category">
          {CATEGORIES.map((category: Category, index) => {
            const entry = categories.find((candidate) => candidate.category === category)
            const px = visible[index] ?? 0
            const grams = entry?.baseGrams ?? 0
            if (grams === 0 && px === 0) return null
            return (
              <li
                key={category} data-band={category} tabIndex={0} className="band" style={{ height: px }}
                aria-label={`${category}: ${formatWeight(grams, unit)}, ${percentOf(grams, totals.baseGrams)}% of base weight`}
                onKeyDown={(event) => {
                  const sibling = event.key === 'ArrowUp' ? event.currentTarget.nextElementSibling : event.key === 'ArrowDown' ? event.currentTarget.previousElementSibling : null
                  if (sibling instanceof HTMLElement) { event.preventDefault(); sibling.focus() }
                }}
              >
                {px >= 18 && <><span className="band-name" aria-hidden="true">{category}</span><span className="band-weight" aria-hidden="true">{formatWeight(grams, unit)}</span></>}
              </li>
            )
          })}
        </ol>
        <div className="side">
          <div role="img" tabIndex={0} aria-label={`Worn ${totals.display.worn}`} className={`hatch worn${shown.worn === 0 ? ' none' : ''}`} style={{ height: Math.min(shown.worn, cap) }} />
          <div role="img" tabIndex={0} aria-label={`Consumable ${totals.display.consumable}`} className={`hatch consumable${shown.consumable === 0 ? ' none' : ''}`} style={{ height: Math.min(shown.consumable, cap) }} />
        </div>
        <div role="img" aria-label={`Goal ${totals.display.goal}`} className="goal-line" style={{ bottom: columnPx }} />
        <span className="goal-label" aria-hidden="true" style={{ bottom: columnPx + 4 }}>Goal {totals.display.goal}</span>
        {over && (
          <div role="img" aria-label={`Over goal by ${formatWeight(totals.baseGrams - totals.goalGrams, unit)}`} className="over-chevron" style={{ bottom: stack + 2 }}>
            <svg viewBox="0 0 24 14" width="24" height="14" aria-hidden="true"><path d="M2 12 12 2l10 10" fill="none" stroke="currentColor" strokeWidth="3" /></svg>
          </div>
        )}
      </div>
      <div className="side-captions" aria-hidden="true"><span>Worn</span><span>Cons.</span></div>
    </div>
    {slivers.length > 0 && (
      <div className="strata-key" aria-hidden="true">
        {slivers.map((sliver) => <p key={sliver.category}><span>{sliver.category}</span><span className="figure">{formatWeight(sliver.grams, unit)}</span></p>)}
      </div>
    )}
    </>
  )
}

export function Chip({ view }: { view: ChipView }) {
  return (
    <div role="img" aria-label={view.label} className="chip" style={{ transform: `translate(${view.x}px, ${view.y}px) translate(-50%, -50%)` }}>
      {view.label.replace('Moving ', '')}
    </div>
  )
}
