import type { CarryMode, Category, DisplayUnit, ListState } from './types.js';
import { CATEGORIES } from './types.js';
import { formatWeight, goalDeltaText } from './format.js';

/** The derived read model. One decision for the per-line worn/base/consumable
 * split, the totals built from it, carry notes, the Not in closet test,
 * frozen name selection and packed-in counts. Nothing here is stored; every
 * read of a list, share, sheet or sync answer recomputes it from line state.
 */

export interface StockLike {
  readonly id: string;
  readonly name: string;
  readonly category: Category;
  readonly weightGrams: number;
  readonly unitsOwned: number;
  readonly status: 'active' | 'retired';
}

export interface LineLike {
  readonly id: string;
  readonly itemId: string;
  readonly name: string;
  readonly category: Category;
  readonly quantity: number;
  readonly mode: CarryMode;
  readonly unitWeightGrams: number;
}

export interface ItemStock {
  readonly id: string;
  readonly name: string;
  readonly category: Category;
  readonly weightGrams: number;
  readonly unitsOwned: number;
  readonly status: 'active' | 'retired';
}

export interface LineSplit {
  readonly baseGrams: number;
  readonly wornGrams: number;
  readonly consumableGrams: number;
}

/** The per-line base/worn/consumable split. A Not in closet line is all zeroes. */
export function lineSplit(line: LineLike, inCloset: boolean): LineSplit {
  if (!inCloset) return { baseGrams: 0, wornGrams: 0, consumableGrams: 0 };
  const unit = line.unitWeightGrams;
  const lineWeight = line.quantity * unit;
  switch (line.mode) {
    case 'base':
      return { baseGrams: lineWeight, wornGrams: 0, consumableGrams: 0 };
    case 'worn':
      return { baseGrams: (line.quantity - 1) * unit, wornGrams: unit, consumableGrams: 0 };
    case 'consumable':
      return { baseGrams: 0, wornGrams: 0, consumableGrams: lineWeight };
  }
}

export function lineWeightGrams(line: LineLike): number {
  return line.quantity * line.unitWeightGrams;
}

/** The Not in closet test: a planning or packed line over current stock. */
export function lineInCloset(line: LineLike, stock: ItemStock | undefined, listState: ListState): boolean {
  if (listState === 'walked') return true;
  if (stock === undefined) return false;
  return line.quantity <= stock.unitsOwned;
}

/** The carry note, one of "", "worn", "worn 1, <spare> in pack" or "consumable". */
export function carryNote(line: Pick<LineLike, 'mode' | 'quantity'>): string {
  switch (line.mode) {
    case 'base':
      return '';
    case 'worn':
      return line.quantity > 1 ? `worn 1, ${line.quantity - 1} in pack` : 'worn';
    case 'consumable':
      return 'consumable';
  }
}

export interface Totals {
  readonly baseGrams: number;
  readonly wornGrams: number;
  readonly consumableGrams: number;
  readonly skinOutGrams: number;
  readonly goalGrams: number;
  readonly deltaGrams: number;
  readonly display: { base: string; worn: string; consumable: string; skinOut: string; goal: string; delta: string };
}

export interface CategoryEntry {
  readonly category: Category;
  readonly subtotalGrams: number;
  readonly baseGrams: number;
  readonly subtotalDisplay: string;
  readonly baseDisplay: string;
}

export interface DerivedList {
  readonly lines: readonly DerivedLine[];
  readonly categories: readonly CategoryEntry[];
  readonly totals: Totals;
}

export interface DerivedLine extends LineLike {
  readonly inCloset: boolean;
  readonly lineWeightGrams: number;
  readonly baseGrams: number;
  readonly wornGrams: number;
  readonly consumableGrams: number;
  readonly carryNote: string;
  readonly weightDisplay: string;
}

/**
 * Derives every computed figure for one list. `stock` maps item id to its
 * current closet record; `unit` is the display unit for text figures.
 */
export function deriveList(
  lines: readonly LineLike[],
  listState: ListState,
  stock: ReadonlyMap<string, ItemStock>,
  goalGrams: number,
  unit: DisplayUnit,
): DerivedList {
  const derived: DerivedLine[] = lines.map((line) => {
    const item = stock.get(line.itemId);
    const inCloset = lineInCloset(line, item, listState);
    const split = lineSplit(line, inCloset);
    const weight = lineWeightGrams(line);
    return {
      ...line,
      inCloset,
      lineWeightGrams: weight,
      ...split,
      carryNote: carryNote(line),
      weightDisplay: formatWeight(weight, unit),
    };
  });

  let base = 0;
  let worn = 0;
  let consumable = 0;
  const perCategory = new Map<Category, { subtotal: number; base: number }>();
  for (const line of derived) {
    if (!line.inCloset) continue;
    base += line.baseGrams;
    worn += line.wornGrams;
    consumable += line.consumableGrams;
    const entry = perCategory.get(line.category) ?? { subtotal: 0, base: 0 };
    entry.subtotal += line.lineWeightGrams;
    entry.base += line.baseGrams;
    perCategory.set(line.category, entry);
  }

  const skinOut = base + worn + consumable;
  const delta = goalGrams - base;
  const totals: Totals = {
    baseGrams: base,
    wornGrams: worn,
    consumableGrams: consumable,
    skinOutGrams: skinOut,
    goalGrams,
    deltaGrams: delta,
    display: {
      base: formatWeight(base, unit),
      worn: formatWeight(worn, unit),
      consumable: formatWeight(consumable, unit),
      skinOut: formatWeight(skinOut, unit),
      goal: formatWeight(goalGrams, unit),
      delta: goalDeltaText(goalGrams, base, unit),
    },
  };

  const categories: CategoryEntry[] = CATEGORIES.flatMap((category) => {
    const entry = perCategory.get(category);
    if (entry === undefined) return [];
    return [
      {
        category,
        subtotalGrams: entry.subtotal,
        baseGrams: entry.base,
        subtotalDisplay: formatWeight(entry.subtotal, unit),
        baseDisplay: formatWeight(entry.base, unit),
      },
    ];
  });

  return { lines: derived, categories, totals };
}
