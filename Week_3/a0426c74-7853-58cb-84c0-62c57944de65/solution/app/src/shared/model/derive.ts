// Derived values: dimension values and hatch boundaries follow the geometry while they are associative. When the geometry they follow
// is gone they keep their last value and area, stop following, and their author gets a toast.
import * as copy from '../copy.ts';
import { dimensionStyle, dimensionValue, findHatch, outlineBox, rectsMeet, TOL, unionRect } from '../geometry/index.ts';
import type { DimensionEntity, Entity, HatchEntity, Rect } from '../types.ts';
import type { Context } from './context.ts';

const isFollower = (entity: Entity): boolean => entity.type === 'dimension' || entity.type === 'hatch';

/** The handles of the dimensions and hatches of an entities record, remembered per record so a group only pays for what it touched. */
const followerCache = new WeakMap<Record<string, Entity>, ReadonlySet<string>>();

function followersOf(entities: Record<string, Entity>): ReadonlySet<string> {
  let found = followerCache.get(entities);
  if (!found) {
    found = new Set(Object.values(entities).filter(isFollower).map((entity) => entity.handle));
    followerCache.set(entities, found);
  }
  return found;
}

/** Teaches the cache that `after` is `before` with these entities replaced (`null`: deleted). */
export function inheritFollowers(before: Record<string, Entity>, after: Record<string, Entity>, replaced: Iterable<[string, Entity | null]>): void {
  if (before === after) return;
  const handles = new Set(followersOf(before));
  for (const [handle, entity] of replaced) {
    if (entity !== null && isFollower(entity)) handles.add(handle);
    else handles.delete(handle);
  }
  followerCache.set(after, handles);
}

/** Recomputes the associative dimensions and hatches that the group's changes can affect. */
export function deriveDependants(ctx: Context): void {
  const { ws } = ctx;
  const handles = new Set(followersOf(ws.origin.entities));
  for (const key of ws.entities.touched.keys()) {
    const entity = ws.entities.get(key);
    if (entity && isFollower(entity)) handles.add(key);
    else handles.delete(key);
  }
  if (handles.size === 0) return;
  const explicit = new Set(ws.entities.touched.keys());
  const changed: Rect[] = [];
  for (const [key, before] of ws.entities.touched) {
    for (const entity of [before, ws.entities.get(key)]) {
      const box = entity && outlineBox(entity);
      if (box) changed.push(box);
    }
  }
  const styleChanged = ws.dimStyles.touched.size > 0;
  const layersChanged = ws.layers.touched.size > 0;
  for (const handle of handles) {
    const entity = ws.entities.get(handle);
    if (entity?.type === 'dimension' && entity.associative && (styleChanged || explicit.has(handle) || entity.refs.some((ref) => explicit.has(ref.handle)))) {
      followDimension(ctx, entity, explicit);
    } else if (entity?.type === 'hatch' && entity.associative && (layersChanged || hatchAffected(ctx, entity, explicit, changed))) {
      followHatch(ctx, entity, explicit);
    }
  }
}

/** A hatch needs a new search when it was edited, one of its edges changed, or something changed inside the box around its edges and seed. */
function hatchAffected(ctx: Context, hatch: HatchEntity, explicit: ReadonlySet<string>, changed: readonly Rect[]): boolean {
  if (explicit.has(hatch.handle) || hatch.boundary.some((handle) => explicit.has(handle))) return true;
  let region: Rect = [hatch.seed_x, hatch.seed_y, hatch.seed_x, hatch.seed_y];
  for (const handle of hatch.boundary) {
    const entity = ctx.ws.entities.get(handle);
    const box = entity && outlineBox(entity);
    if (box) region = unionRect(region, box);
  }
  return changed.some((box) => rectsMeet(box, region, TOL));
}

function settle(ctx: Context, before: Entity, after: Entity, explicit: ReadonlySet<string>): void {
  if (!explicit.has(before.handle)) ctx.derived.add(before.handle);
  ctx.ws.entities.set(before.handle, after);
}

function followDimension(ctx: Context, dimension: DimensionEntity, explicit: ReadonlySet<string>): void {
  const style = dimensionStyle(ctx.ws.dimStyles.record, dimension.style);
  const value = dimensionValue(dimension, ctx.ws.entities.record, style);
  if (value === null) {
    settle(ctx, dimension, { ...dimension, associative: false }, explicit);
    if (dimension.author) ctx.notify(dimension.author, copy.dimensionLost(dimension.handle));
  } else if (value !== dimension.value) {
    settle(ctx, dimension, { ...dimension, value }, explicit);
  }
}

function followHatch(ctx: Context, hatch: HatchEntity, explicit: ReadonlySet<string>): void {
  const found = findHatch([hatch.seed_x, hatch.seed_y], ctx.ws.entities.record, ctx.ws.layers.record);
  if (found === null) {
    settle(ctx, hatch, { ...hatch, associative: false }, explicit);
    if (hatch.author) ctx.notify(hatch.author, copy.hatchBroken(hatch.handle));
  } else if (found.area !== hatch.area || found.boundary.join() !== hatch.boundary.join()) {
    settle(ctx, hatch, { ...hatch, area: found.area, boundary: found.boundary }, explicit);
  }
}
