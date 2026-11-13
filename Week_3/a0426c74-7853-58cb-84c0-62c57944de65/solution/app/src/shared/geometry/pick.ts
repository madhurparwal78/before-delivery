// Picking and window / crossing selection over the whole scene (never the DOM).
import type { Point, Rect } from '../types.ts';
import { distanceToPrim, primTouchesRect, rectBetween, rectContains, rectsMeet } from './curves.ts';
import { handleNumber } from './numbers.ts';
import { type Scene, type SceneEntity, listOrder, queryRect } from './scene.ts';
import { SNAP_APERTURE_PX } from './snap.ts';
import type { View } from './view.ts';

/** Picking: the nearest selectable entity within the 10 px aperture (ties: lower handle number), else null. */
export function pickEntity(scene: Scene, world: Point, view: View): SceneEntity | null {
  const reach = SNAP_APERTURE_PX / view.zoom;
  let best: { entity: SceneEntity; gap: number } | null = null;
  for (const entity of queryRect(scene, [world[0] - reach, world[1] - reach, world[0] + reach, world[1] + reach])) {
    if (!entity.selectable) continue;
    const gap = Math.min(...entity.prims.map((prim) => distanceToPrim(prim, world)));
    if (gap > reach) continue;
    if (best === null || gap < best.gap || (gap === best.gap && handleNumber(entity.id) < handleNumber(best.entity.id))) best = { entity, gap };
  }
  return best === null ? null : best.entity;
}

export type WindowMode = 'window' | 'crossing';

/** Left to right is a window (wholly inside), right to left is a crossing (whatever it touches). */
export function windowMode(from: Point, to: Point): WindowMode {
  return to[0] >= from[0] ? 'window' : 'crossing';
}

const touches = (entity: SceneEntity, rect: Rect): boolean =>
  entity.prims.length === 0 ? rectsMeet(entity.bounds, rect) : entity.prims.some((prim) => primTouchesRect(prim, rect));

/** Selectable entity ids in entity list order that the window or crossing selects. */
export function selectInWindow(scene: Scene, from: Point, to: Point): { mode: WindowMode; ids: string[] } {
  const mode = windowMode(from, to);
  const rect = rectBetween(from, to);
  const hits = queryRect(scene, rect).filter((e) => e.selectable && (mode === 'window' ? rectContains(rect, e.bounds) : touches(e, rect)));
  return { mode, ids: hits.sort(listOrder(scene)).map((e) => e.id) };
}
