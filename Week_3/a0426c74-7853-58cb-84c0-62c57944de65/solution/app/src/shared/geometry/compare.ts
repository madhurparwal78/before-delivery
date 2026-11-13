// Delta swipe: which entities were added, removed or changed between two published models, and which markups sit on a change.
import type { BlockDef, CompareEntry, CompareResult, Entity, Markup, ModelSnapshot, Rect } from '../types.ts';
import { rectBetween, rectsMeet, unionRect } from './curves.ts';
import { TOL } from './numbers.ts';
import { type Scene, type SceneEntity, buildScene, modelInput } from './scene.ts';

export interface ModelDiff {
  result: CompareResult;
  /** union of the earlier and later bounding boxes of every added, removed or changed entity, by id */
  boxes: ReadonlyMap<string, Rect>;
}

/** Numbers within 0.001, everything else equal; a missing field equals an undefined one. */
function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= TOL;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    const left: Record<string, unknown> = { ...a };
    const right: Record<string, unknown> = { ...b };
    const keys = new Set([...Object.keys(left), ...Object.keys(right)].filter((key) => key !== 'author'));
    return [...keys].every((key) => sameValue(left[key], right[key]));
  }
  return a === b;
}

/** A block definition with every definition it nests, in first-use order: what an insert of it draws. */
function definitionOf(name: string, blocks: Readonly<Record<string, BlockDef>>, seen: BlockDef[] = []): BlockDef[] {
  const def = blocks[name];
  if (def === undefined || seen.includes(def)) return seen;
  seen.push(def);
  for (const child of def.entities) if (child.type === 'insert') definitionOf(child.block, blocks, seen);
  return seen;
}

function changedBetween(earlier: SceneEntity, later: SceneEntity): boolean {
  if (!sameValue(earlier.entity, later.entity)) return true;
  const a: Entity = earlier.entity;
  const b: Entity = later.entity;
  return a.type === 'insert' && b.type === 'insert' && !sameValue(definitionOf(a.block, earlier.blocks), definitionOf(b.block, later.blocks));
}

/** Compares two scenes entity by entity (by id, so xref entities match as `<xref>|<handle>`). */
function diffScenes(earlier: Scene, later: Scene): ModelDiff {
  const entities: CompareEntry[] = [];
  const boxes = new Map<string, Rect>();
  const counts = { added: 0, removed: 0, changed: 0 };
  for (const entry of later.entities) {
    const before = earlier.byId.get(entry.id);
    const diff = before === undefined ? 'added' : changedBetween(before, entry) ? 'changed' : 'same';
    entities.push({ id: entry.id, diff });
    if (diff === 'same') continue;
    counts[diff] += 1;
    boxes.set(entry.id, before === undefined ? entry.bounds : unionRect(before.bounds, entry.bounds));
  }
  for (const entry of earlier.entities) {
    if (later.byId.has(entry.id)) continue;
    entities.push({ id: entry.id, diff: 'removed' });
    counts.removed += 1;
    boxes.set(entry.id, entry.bounds);
  }
  return { result: { ...counts, entities }, boxes };
}

/** Delta swipe: entities match by id (`<xref>|<handle>` for xref entities); added / removed; changed = a number differs by more than 0.001 or any other field, or an insert whose block definition differs. */
export function diffModels(earlier: ModelSnapshot, later: ModelSnapshot): ModelDiff {
  return diffScenes(buildScene(modelInput(earlier)), buildScene(modelInput(later)));
}

/** The carry-forward flag of each markup (same order): `geometry-changed` when an added, removed or changed entity's box meets the markup's box (touching included). */
export function markupFlags(markups: readonly Pick<Markup, 'x1' | 'y1' | 'x2' | 'y2'>[], diff: ModelDiff): Markup['flag'][] {
  const changes = [...diff.boxes.values()];
  return markups.map((markup) => {
    const box = rectBetween([markup.x1, markup.y1], [markup.x2, markup.y2]);
    return changes.some((change) => rectsMeet(change, box, TOL)) ? 'geometry-changed' : null;
  });
}
