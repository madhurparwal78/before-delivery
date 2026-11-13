import { CATEGORIES, type Category, type DisplayUnit } from './types.js';

/**
 * Pack-sheet currency. One decision for the content a sheet is rendered from,
 * and whether that content still equals what the server would render now.
 */

export interface SheetLineContent {
  readonly name: string;
  readonly category: Category;
  readonly quantity: number;
  readonly mode: string;
  readonly unitWeightGrams: number;
}

export interface SheetContent {
  readonly listName: string;
  readonly state: string;
  readonly hikerName: string;
  readonly unit: DisplayUnit;
  readonly paperSize: string;
  readonly goalGrams: number;
  readonly lines: readonly SheetLineContent[];
}

/** Renders a content into a comparable string. */
export function sheetContentKey(content: SheetContent): string {
  const head = [content.listName, content.state, content.hikerName, content.unit, content.paperSize, String(content.goalGrams)].join('\u0001');
  const lines = content.lines
    .map((line) => [line.name, line.category, String(line.quantity), line.mode, String(line.unitWeightGrams)].join('\u0001'))
    .join('\u0002');
  return `${head}\u0003${lines}`;
}

/** The content the server would render for a list right now. */
export function currentSheetContent(args: {
  listName: string;
  state: string;
  hikerName: string;
  unit: DisplayUnit;
  paperSize: string;
  goalGrams: number;
  lines: readonly {
    name: string;
    itemId: string;
    quantity: number;
    mode: string;
    nameFrozen: string;
    unitWeightGrams: number;
    unitWeightFrozen: number;
    inCloset: boolean;
    itemCategory: Category;
  }[];
}): SheetContent {
  const inClosetLines = args.lines
    .filter((line) => line.inCloset)
    .map((line) => ({
      name: line.nameFrozen,
      category: line.itemCategory,
      quantity: line.quantity,
      mode: line.mode,
      unitWeightGrams: line.unitWeightFrozen,
    }));
  inClosetLines.sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category));
  return {
    listName: args.listName,
    state: args.state,
    hikerName: args.hikerName,
    unit: args.unit,
    paperSize: args.paperSize,
    goalGrams: args.goalGrams,
    lines: inClosetLines,
  };
}

