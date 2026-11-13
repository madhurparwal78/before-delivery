import type { CarryMode, Category, DisplayUnit, ListState, PaperSize, TripList } from './api-types'
import { canonicalJson } from './numbers'

/** What a pack sheet is rendered from, and what its currency is judged against. */
export interface SheetContent {
  listName: string
  state: ListState
  hikerName: string
  unit: DisplayUnit
  paperSize: PaperSize
  goalGrams: number
  lines: { name: string; category: Category; quantity: number; mode: CarryMode; unitWeightGrams: number }[]
}

interface SheetSettings {
  displayName: string
  unit: DisplayUnit
  paperSize: PaperSize
}

export function sheetContent(list: TripList, settings: SheetSettings): SheetContent {
  return {
    listName: list.name,
    state: list.state,
    hikerName: settings.displayName,
    unit: settings.unit,
    paperSize: settings.paperSize,
    goalGrams: list.totals.goalGrams,
    lines: list.lines
      .filter((line) => line.inCloset)
      .map(({ name, category, quantity, mode, unitWeightGrams }) => ({ name, category, quantity, mode, unitWeightGrams })),
  }
}

/** A sheet is current exactly when the content the server would render now equals its own. */
export function isSheetCurrent(stored: SheetContent, now: SheetContent): boolean {
  return canonicalJson(stored) === canonicalJson(now)
}
