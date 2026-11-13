/**
 * The client's offline mirror of the domain. The same one decision the server
 * uses for totals, carry notes and the Not in closet test, applied on the
 * device so the workspace keeps working with no connection.
 */

import { deriveList, type ItemStock, type LineLike, type DerivedLine } from '../domain/derived.js';
import { goalDeltaText } from '../domain/format.js';
import type { DisplayUnit, ListState } from '../domain/types.js';
import type { Item, Line, Totals, TripList } from './apiTypes.js';

export interface OfflineStock {
  readonly items: readonly Item[];
}

/** A line as the device currently shows it, provisional lines included. */
export interface LocalLine {
  id: string;
  itemId: string;
  name: string;
  category: string;
  quantity: number;
  mode: 'base' | 'worn' | 'consumable';
  unitWeightGrams: number;
}

export function stockOf(items: readonly Item[]): Map<string, ItemStock> {
  return new Map(items.map((item) => [item.id, { id: item.id, name: item.name, category: item.category as ItemStock['category'], weightGrams: item.weightGrams, unitsOwned: item.unitsOwned, status: item.status }]));
}

/** Derives the workspace's figures for a local view of a list. */
export function deriveLocal(lines: readonly LocalLine[], state: ListState, items: readonly Item[], goalGrams: number, unit: DisplayUnit): { lines: readonly DerivedLine[]; totals: Totals; categories: { category: string; subtotalGrams: number; baseGrams: number; subtotalDisplay: string; baseDisplay: string }[] } {
  const lineLikes: LineLike[] = lines.map((line) => ({
    id: line.id,
    itemId: line.itemId,
    name: line.name,
    category: line.category as LineLike['category'],
    quantity: line.quantity,
    mode: line.mode,
    unitWeightGrams: line.unitWeightGrams,
  }));
  const derived = deriveList(lineLikes, state, stockOf(items), goalGrams, unit);
  return { lines: derived.lines, totals: derived.totals as unknown as Totals, categories: derived.categories as unknown as [] };
}

/** The Pack updates announcement for any packing change. */
export function packAnnouncement(totals: Totals, goalGrams: number, unit: DisplayUnit): string {
  return `Base weight ${totals.display.base}. ${goalDeltaText(goalGrams, totals.baseGrams, unit)}.`;
}

/** The collapsed summary line for the phone strip. */
export function collapsedSummary(totals: Totals, goalGrams: number, unit: DisplayUnit): string {
  return `Base ${totals.display.base}, ${goalDeltaText(goalGrams, totals.baseGrams, unit)}.`;
}

/** Converts server lines to the local view. */
export function localLinesFrom(list: TripList): LocalLine[] {
  return list.lines.map((line: Line) => ({ id: line.id, itemId: line.itemId, name: line.name, category: line.category, quantity: line.quantity, mode: line.mode, unitWeightGrams: line.unitWeightGrams }));
}

export { deriveList };
