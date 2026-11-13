import { CATEGORY_ORDER, type Category } from './categories.js';
import type { CarryMode, CategoryEntry, Line, ListState, Totals } from './types.js';
import { formatGoalDelta, formatGrams, type DisplayUnit } from './weights.js';

/** What a line needs to be weighed: everything else is derived here. */
export interface LineFacts {
  id: string;
  itemId: string;
  name: string;
  category: Category;
  quantity: number;
  mode: CarryMode;
  unitWeightGrams: number;
  unitsOwned: number;
}

/** A line is Not in closet when its quantity outruns current stock. */
export function isInCloset(
  facts: Pick<LineFacts, 'quantity' | 'unitsOwned'>,
  listState: ListState,
): boolean {
  if (listState === 'walked') return true;
  return facts.quantity <= facts.unitsOwned;
}

export function lineWeightGrams(facts: Pick<LineFacts, 'quantity' | 'unitWeightGrams'>): number {
  return facts.quantity * facts.unitWeightGrams;
}

/** The per-line split: only one unit of a worn line is worn. */
export function lineSplit(
  facts: Pick<LineFacts, 'quantity' | 'mode' | 'unitWeightGrams'>,
  inCloset: boolean,
): { baseGrams: number; wornGrams: number; consumableGrams: number } {
  if (!inCloset) return { baseGrams: 0, wornGrams: 0, consumableGrams: 0 };
  const weight = lineWeightGrams(facts);
  if (facts.mode === 'worn') {
    return {
      baseGrams: (facts.quantity - 1) * facts.unitWeightGrams,
      wornGrams: facts.unitWeightGrams,
      consumableGrams: 0,
    };
  }
  if (facts.mode === 'consumable') {
    return { baseGrams: 0, wornGrams: 0, consumableGrams: weight };
  }
  return { baseGrams: weight, wornGrams: 0, consumableGrams: 0 };
}

export function carryNote(quantity: number, mode: CarryMode): string {
  if (mode === 'consumable') return 'consumable';
  if (mode !== 'worn') return '';
  return quantity > 1 ? `worn 1, ${quantity - 1} in pack` : 'worn';
}

export function buildLine(facts: LineFacts, listState: ListState, unit: DisplayUnit): Line {
  const inCloset = isInCloset(facts, listState);
  const split = lineSplit(facts, inCloset);
  const weight = lineWeightGrams(facts);
  return {
    id: facts.id,
    itemId: facts.itemId,
    name: facts.name,
    category: facts.category,
    quantity: facts.quantity,
    mode: facts.mode,
    unitWeightGrams: facts.unitWeightGrams,
    lineWeightGrams: weight,
    baseGrams: split.baseGrams,
    wornGrams: split.wornGrams,
    consumableGrams: split.consumableGrams,
    carryNote: carryNote(facts.quantity, facts.mode),
    weightDisplay: formatGrams(weight, unit),
    inCloset,
  };
}

export function buildTotals(lines: Line[], goalGrams: number, unit: DisplayUnit): Totals {
  let baseGrams = 0;
  let wornGrams = 0;
  let consumableGrams = 0;
  for (const line of lines) {
    baseGrams += line.baseGrams;
    wornGrams += line.wornGrams;
    consumableGrams += line.consumableGrams;
  }
  const skinOutGrams = baseGrams + wornGrams + consumableGrams;
  return {
    baseGrams,
    wornGrams,
    consumableGrams,
    skinOutGrams,
    goalGrams,
    deltaGrams: goalGrams - baseGrams,
    display: {
      base: formatGrams(baseGrams, unit),
      worn: formatGrams(wornGrams, unit),
      consumable: formatGrams(consumableGrams, unit),
      skinOut: formatGrams(skinOutGrams, unit),
      goal: formatGrams(goalGrams, unit),
      delta: formatGoalDelta(baseGrams, goalGrams, unit),
    },
  };
}

export function buildCategoryEntries(lines: Line[], unit: DisplayUnit): CategoryEntry[] {
  const entries: CategoryEntry[] = [];
  for (const category of CATEGORY_ORDER) {
    const inCategory = lines.filter((line) => line.category === category && line.inCloset);
    if (inCategory.length === 0) continue;
    const subtotalGrams = inCategory.reduce((sum, line) => sum + line.lineWeightGrams, 0);
    const baseGrams = inCategory.reduce((sum, line) => sum + line.baseGrams, 0);
    entries.push({
      category,
      subtotalGrams,
      baseGrams,
      subtotalDisplay: formatGrams(subtotalGrams, unit),
      baseDisplay: formatGrams(baseGrams, unit),
    });
  }
  return entries;
}

/** Lines in category order, keeping each category's own insertion order. */
export function sortLines(lines: Line[]): Line[] {
  const order = new Map<string, number>(CATEGORY_ORDER.map((category, index) => [category, index]));
  return [...lines].sort((a, b) => (order.get(a.category) ?? 0) - (order.get(b.category) ?? 0));
}
