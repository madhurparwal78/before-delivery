import type { CarryMode, ListState, PaperSize, TripList, Profile } from './types.js';
import type { DisplayUnit } from './weights.js';
import { sortLines } from './lines.js';

/** The content a pack sheet was rendered from: currency is judged against this. */
export interface SheetContent {
  listName: string;
  state: ListState;
  hikerName: string;
  unit: DisplayUnit;
  paperSize: PaperSize;
  goalGrams: number;
  lines: Array<{
    name: string;
    category: string;
    quantity: number;
    mode: CarryMode;
    unitWeightGrams: number;
  }>;
}

export function sheetContent(list: TripList, profile: Profile): SheetContent {
  return {
    listName: list.name,
    state: list.state,
    hikerName: profile.displayName,
    unit: profile.unit,
    paperSize: profile.paperSize,
    goalGrams: profile.goalGrams,
    lines: sortLines(list.lines)
      .filter((line) => line.inCloset)
      .map((line) => ({
        name: line.name,
        category: line.category,
        quantity: line.quantity,
        mode: line.mode,
        unitWeightGrams: line.unitWeightGrams,
      })),
  };
}

function canonical(content: SheetContent): string {
  return JSON.stringify([
    content.listName,
    content.state,
    content.hikerName,
    content.unit,
    content.paperSize,
    content.goalGrams,
    content.lines.map((line) => [
      line.name,
      line.category,
      line.quantity,
      line.mode,
      line.unitWeightGrams,
    ]),
  ]);
}

export function isSheetCurrent(stored: SheetContent, now: SheetContent): boolean {
  return canonical(stored) === canonical(now);
}
