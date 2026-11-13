import type { CarryMode, CategoryEntry, Item, Line, Profile, TripList } from '../../shared/api-types'
import { categoryRank } from '../../shared/categories'
import { buildCategories, buildLine, buildTotals } from '../../shared/lists'

/** The line the hiker is steering toward, over what the server last confirmed. */
export interface Desired {
  exists: boolean
  quantity: number
  mode: CarryMode
}

export interface Displayed {
  lines: Line[]
  categories: CategoryEntry[]
  totals: TripList['totals']
}

interface AvailableRow {
  item: Item
  left: number
  /** The `<n> left` text, shown only while some but not all units are packed. */
  showLeft: boolean
}

/** Confirmed lines with the hiker's pending targets laid over them, totals computed by the shared rules. */
export function displayList(
  confirmed: TripList,
  items: readonly Item[],
  desired: ReadonlyMap<string, Desired>,
  profile: Pick<Profile, 'unit' | 'goalGrams'>,
): Displayed {
  const ownedOf = (itemId: string): number => items.find((item) => item.id === itemId)?.unitsOwned ?? 0
  const lines: Line[] = []
  for (const line of confirmed.lines) {
    const target = desired.get(line.itemId)
    if (!target) lines.push(line)
    else if (target.exists) {
      lines.push(buildLine({
        id: line.id, itemId: line.itemId, quantity: target.quantity, mode: target.mode,
        frozenName: line.name, frozenWeightGrams: line.unitWeightGrams,
        item: { name: line.name, category: line.category, weightGrams: line.unitWeightGrams, unitsOwned: ownedOf(line.itemId) },
      }, confirmed.state, profile.unit))
    }
  }
  for (const [itemId, target] of desired) {
    const item = items.find((candidate) => candidate.id === itemId)
    if (!target.exists || !item || confirmed.lines.some((line) => line.itemId === itemId)) continue
    lines.push(buildLine({
      id: `provisional:${itemId}`, itemId, quantity: target.quantity, mode: target.mode, frozenName: null, frozenWeightGrams: null,
      item: { name: item.name, category: item.category, weightGrams: item.weightGrams, unitsOwned: item.unitsOwned },
    }, confirmed.state, profile.unit))
  }
  const ordered = lines.map((line, index) => ({ line, index }))
    .sort((a, b) => categoryRank(a.line.category) - categoryRank(b.line.category) || a.index - b.index)
    .map(({ line }) => line)
  return {
    lines: ordered,
    categories: buildCategories(ordered, profile.unit),
    totals: buildTotals(ordered, profile.goalGrams, profile.unit),
  }
}

/** Active items with at least one unpacked unit for this list, in category order. */
export function availableGear(items: readonly Item[], lines: readonly Line[]): AvailableRow[] {
  return items
    .filter((item) => item.status === 'active')
    .map((item) => {
      const packed = lines.find((line) => line.itemId === item.id)?.quantity ?? 0
      const left = item.unitsOwned - packed
      return { item, left, showLeft: packed > 0 && left > 0 }
    })
    .filter((row) => row.left > 0)
    .sort((a, b) => categoryRank(a.item.category) - categoryRank(b.item.category) || a.item.name.localeCompare(b.item.name))
}

export function lineMatches(want: Desired, have: Line | undefined): boolean {
  if (!want.exists) return have === undefined
  return have !== undefined && have.quantity === want.quantity && have.mode === want.mode
}
