import { TOLERANCE } from './numbers.js';
import type { BlockDef, Entity } from './model.js';
import { type Box, boxesMeet, entityBox } from './geometry.js';
import { type VersionSnapshot, snapshotEntities } from './snapshot.js';
import { emptyModel } from './model.js';

export type DiffState = 'added' | 'removed' | 'changed' | 'same';

export interface CompareEntity {
  id: string;
  diff: DiffState;
}

export interface CompareResult {
  added: number;
  removed: number;
  changed: number;
  entities: CompareEntity[];
}

function numbersDiffer(a: number, b: number): boolean {
  return Math.abs(a - b) > TOLERANCE;
}

function valuesDiffer(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return numbersDiffer(a, b);
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return true;
    return a.some((item, index) => valuesDiffer(item, b[index]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      if (valuesDiffer(left[key], right[key])) return true;
    }
    return false;
  }
  return a !== b;
}

export function entitiesDiffer(a: Entity, b: Entity, blockA?: BlockDef, blockB?: BlockDef): boolean {
  if (a.type !== b.type) return true;
  if (valuesDiffer(a as unknown, b as unknown)) return true;
  if (a.type === 'insert' && (blockA || blockB)) {
    if (valuesDiffer(blockA as unknown, blockB as unknown)) return true;
  }
  return false;
}

/** The compare rule for two published versions. */
export function compareSnapshots(earlier: VersionSnapshot, later: VersionSnapshot): CompareResult {
  const earlierEntities = new Map(snapshotEntities(earlier).map((item) => [item.id, item]));
  const laterEntities = new Map(snapshotEntities(later).map((item) => [item.id, item]));
  const entities: CompareEntity[] = [];
  let added = 0;
  let removed = 0;
  let changed = 0;
  const ids = [...new Set([...earlierEntities.keys(), ...laterEntities.keys()])].sort();
  for (const id of ids) {
    const before = earlierEntities.get(id);
    const after = laterEntities.get(id);
    if (!before && after) {
      added += 1;
      entities.push({ id, diff: 'added' });
      continue;
    }
    if (before && !after) {
      removed += 1;
      entities.push({ id, diff: 'removed' });
      continue;
    }
    if (before && after) {
      if (entitiesDiffer(before.entity, after.entity, before.block, after.block)) {
        changed += 1;
        entities.push({ id, diff: 'changed' });
      } else {
        entities.push({ id, diff: 'same' });
      }
    }
  }
  return { added, removed, changed, entities };
}

export function compareCountsText(result: CompareResult): string {
  return `Added ${result.added}, removed ${result.removed}, changed ${result.changed}`;
}

export interface MarkupBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function markupBox(markup: MarkupBox): Box {
  return {
    minX: Math.min(markup.x1, markup.x2),
    minY: Math.min(markup.y1, markup.y2),
    maxX: Math.max(markup.x1, markup.x2),
    maxY: Math.max(markup.y1, markup.y2),
  };
}

/** A carried-forward markup is flagged when a changed entity's box meets its box. */
export function markupNeedsFlag(
  earlier: VersionSnapshot,
  later: VersionSnapshot,
  markup: MarkupBox,
): boolean {
  const result = compareSnapshots(earlier, later);
  const box = markupBox(markup);
  const earlierById = new Map(snapshotEntities(earlier).map((item) => [item.id, item.entity]));
  const laterById = new Map(snapshotEntities(later).map((item) => [item.id, item.entity]));
  const model = emptyModel();
  model.blocks = [...earlier.model.blocks, ...later.model.blocks];
  for (const entry of result.entities) {
    if (entry.diff === 'same') continue;
    const entity = laterById.get(entry.id) ?? earlierById.get(entry.id);
    if (!entity) continue;
    if (boxesMeet(entityBox(model, entity), box)) return true;
  }
  return false;
}

export const GEOMETRY_CHANGED_FLAG = 'geometry-changed';
export const GEOMETRY_CHANGED_LABEL = 'Geometry changed under this markup';
