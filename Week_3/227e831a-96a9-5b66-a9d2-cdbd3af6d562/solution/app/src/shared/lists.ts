import type {
  CarryMode, Category, CategoryEntry, DisplayUnit, Line, ListState, ShareLine, TripList, Totals,
} from './api-types'
import { categoryRank } from './categories'
import { formatDelta, formatWeight } from './display'

/** A line holds up to the units owned; walked lists are history and are never Not in closet. */
export function isInCloset(state: ListState, quantity: number, unitsOwned: number): boolean {
  return state === 'walked' || quantity <= unitsOwned
}

interface LineSplit {
  baseGrams: number
  wornGrams: number
  consumableGrams: number
}

/** Only one unit of a worn line counts as worn; its spare units are base weight. */
function splitLine(mode: CarryMode, quantity: number, unitWeightGrams: number): LineSplit {
  const lineWeight = quantity * unitWeightGrams
  if (mode === 'worn') return { baseGrams: (quantity - 1) * unitWeightGrams, wornGrams: unitWeightGrams, consumableGrams: 0 }
  if (mode === 'consumable') return { baseGrams: 0, wornGrams: 0, consumableGrams: lineWeight }
  return { baseGrams: lineWeight, wornGrams: 0, consumableGrams: 0 }
}

function carryNote(mode: CarryMode, quantity: number): string {
  if (mode === 'consumable') return 'consumable'
  if (mode === 'worn') return quantity > 1 ? `worn 1, ${quantity - 1} in pack` : 'worn'
  return ''
}

export interface ItemFacts {
  name: string
  category: Category
  weightGrams: number
  unitsOwned: number
}

export interface LineSource {
  id: string
  itemId: string
  quantity: number
  mode: CarryMode
  frozenName: string | null
  frozenWeightGrams: number | null
  item: ItemFacts
}

/** Packed and walked lines keep the name and weight they were packed with; planning lines follow the closet. */
export function buildLine(source: LineSource, state: ListState, unit: DisplayUnit): Line {
  const name = source.frozenName ?? source.item.name
  const unitWeightGrams = source.frozenWeightGrams ?? source.item.weightGrams
  const inCloset = isInCloset(state, source.quantity, source.item.unitsOwned)
  const lineWeightGrams = source.quantity * unitWeightGrams
  const split: LineSplit = inCloset
    ? splitLine(source.mode, source.quantity, unitWeightGrams)
    : { baseGrams: 0, wornGrams: 0, consumableGrams: 0 }
  return {
    id: source.id,
    itemId: source.itemId,
    name,
    category: source.item.category,
    quantity: source.quantity,
    mode: source.mode,
    unitWeightGrams,
    lineWeightGrams,
    ...split,
    carryNote: carryNote(source.mode, source.quantity),
    weightDisplay: formatWeight(lineWeightGrams, unit),
    inCloset,
  }
}

export function buildTotals(lines: readonly Line[], goalGrams: number, unit: DisplayUnit): Totals {
  let baseGrams = 0
  let wornGrams = 0
  let consumableGrams = 0
  for (const line of lines) {
    baseGrams += line.baseGrams
    wornGrams += line.wornGrams
    consumableGrams += line.consumableGrams
  }
  const skinOutGrams = baseGrams + wornGrams + consumableGrams
  return {
    baseGrams,
    wornGrams,
    consumableGrams,
    skinOutGrams,
    goalGrams,
    deltaGrams: goalGrams - baseGrams,
    display: {
      base: formatWeight(baseGrams, unit),
      worn: formatWeight(wornGrams, unit),
      consumable: formatWeight(consumableGrams, unit),
      skinOut: formatWeight(skinOutGrams, unit),
      goal: formatWeight(goalGrams, unit),
      delta: formatDelta(baseGrams, goalGrams, unit),
    },
  }
}

/** One entry for each category that has an in-closet line, in category order. */
export function buildCategories(lines: readonly Line[], unit: DisplayUnit): CategoryEntry[] {
  const entries = new Map<Category, { subtotalGrams: number; baseGrams: number }>()
  for (const line of lines) {
    if (!line.inCloset) continue
    const entry = entries.get(line.category) ?? { subtotalGrams: 0, baseGrams: 0 }
    entry.subtotalGrams += line.lineWeightGrams
    entry.baseGrams += line.baseGrams
    entries.set(line.category, entry)
  }
  return [...entries.entries()]
    .sort(([a], [b]) => categoryRank(a) - categoryRank(b))
    .map(([category, entry]) => ({
      category,
      ...entry,
      subtotalDisplay: formatWeight(entry.subtotalGrams, unit),
      baseDisplay: formatWeight(entry.baseGrams, unit),
    }))
}

interface ListHead {
  id: string
  name: string
  state: ListState
}

interface GoalSettings {
  unit: DisplayUnit
  goalGrams: number
}

/** Lines in category order, then in the order they were packed. */
export function buildList(head: ListHead, sources: readonly LineSource[], settings: GoalSettings): TripList {
  const lines = sources
    .map((source, index) => ({ line: buildLine(source, head.state, settings.unit), index }))
    .sort((a, b) => categoryRank(a.line.category) - categoryRank(b.line.category) || a.index - b.index)
    .map(({ line }) => line)
  return {
    ...head,
    lines,
    categories: buildCategories(lines, settings.unit),
    totals: buildTotals(lines, settings.goalGrams, settings.unit),
  }
}

export function toShareLine(line: Line): ShareLine {
  return {
    name: line.name,
    category: line.category,
    quantity: line.quantity,
    mode: line.mode,
    unitWeightGrams: line.unitWeightGrams,
    lineWeightGrams: line.lineWeightGrams,
    baseGrams: line.baseGrams,
    wornGrams: line.wornGrams,
    consumableGrams: line.consumableGrams,
    carryNote: line.carryNote,
    weightDisplay: line.weightDisplay,
  }
}
