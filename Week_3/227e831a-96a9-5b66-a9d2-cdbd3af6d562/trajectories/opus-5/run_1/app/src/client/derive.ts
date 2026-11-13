import { categoryRank } from '../shared/categories.js';
import {
  buildCategoryEntries,
  buildLine,
  buildTotals,
  type LineFacts,
} from '../shared/lines.js';
import type { Item, Line, Profile, SyncOp, TripList } from '../shared/types.js';

/**
 * The offline and optimistic view of a list, derived with the same rules the
 * server uses, so a change looks the same before and after its answer.
 */
export function rebuildList(list: TripList, items: Item[], profile: Profile): TripList {
  const byId = new Map(items.map((item) => [item.id, item]));
  const lines: Line[] = list.lines
    .map((line) => {
      const item = byId.get(line.itemId);
      const frozen = list.state !== 'planning';
      const facts: LineFacts = {
        id: line.id,
        itemId: line.itemId,
        name: frozen || item === undefined ? line.name : item.name,
        category: item?.category ?? line.category,
        quantity: line.quantity,
        mode: line.mode,
        unitWeightGrams: frozen || item === undefined ? line.unitWeightGrams : item.weightGrams,
        unitsOwned: item?.unitsOwned ?? 0,
      };
      return buildLine(facts, list.state, profile.unit);
    })
    .sort((a, b) => categoryRank(a.category) - categoryRank(b.category));

  return {
    id: list.id,
    name: list.name,
    state: list.state,
    lines,
    categories: buildCategoryEntries(lines, profile.unit),
    totals: buildTotals(lines, profile.goalGrams, profile.unit),
  };
}

/** Replays the device's queued offline changes onto a list, in queue order. */
export function applyQueuedOps(list: TripList, items: Item[], ops: SyncOp[]): void {
  for (const op of ops) {
    if (op.listId !== list.id) continue;
    const line = list.lines.find((candidate) => candidate.itemId === op.itemId);
    if (op.type === 'pack') {
      const item = items.find((candidate) => candidate.id === op.itemId);
      if (item === undefined || line !== undefined) continue;
      list.lines = [
        ...list.lines,
        {
          id: `queued-${op.opId}`,
          itemId: item.id,
          name: item.name,
          category: item.category,
          quantity: op.quantity ?? 1,
          mode: op.mode ?? 'base',
          unitWeightGrams: item.weightGrams,
          lineWeightGrams: item.weightGrams,
          baseGrams: item.weightGrams,
          wornGrams: 0,
          consumableGrams: 0,
          carryNote: '',
          weightDisplay: item.weightDisplay,
          inCloset: true,
        },
      ];
      continue;
    }
    if (line === undefined) continue;
    if (op.type === 'set_quantity' && op.quantity !== undefined) line.quantity = op.quantity;
    else if (op.type === 'set_mode' && op.mode !== undefined) line.mode = op.mode;
    else if (op.type === 'unpack') {
      list.lines = list.lines.filter((candidate) => candidate !== line);
    }
  }
}

/** Units of an item not yet packed on this list. */
export function unpackedUnits(item: Item, list: TripList): number {
  const line = list.lines.find((candidate) => candidate.itemId === item.id);
  return item.unitsOwned - (line?.quantity ?? 0);
}
