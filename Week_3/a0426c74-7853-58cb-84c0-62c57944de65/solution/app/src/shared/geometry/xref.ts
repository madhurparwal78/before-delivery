// Xrefs: another drawing's published model drawn by the block insert transform, with prefixed ids and layers, nesting and clips.
import type { BlockDef, Entity, Layer, Point, Rect, Xref } from '../types.ts';
import { placeEntity, placePoint } from './transform.ts';

export const XREF_SEPARATOR = '|';
const ORIGIN: Point = [0, 0];

/** `Site|Walls` */
function xrefLayerName(xrefPath: string, layer: string): string {
  return `${xrefPath}${XREF_SEPARATOR}${layer}`;
}

/** `Site|L1`: only xref entities and layers carry the separator. */
export function isXrefId(id: string): boolean {
  return id.includes(XREF_SEPARATOR);
}

/** An xref entity in world space with everything needed to draw it. */
export interface XrefItem {
  entity: Entity;
  /** `Site`, nested `Outer|Inner` */
  path: string;
  /** the blocks of the model the entity came from */
  blocks: Readonly<Record<string, BlockDef>>;
  /** world rectangle outside which the entity is cut, null when unclipped */
  clip: Rect | null;
}

function prefixed(entity: Entity, path: string): Entity {
  const handle = xrefLayerName(path, entity.handle);
  const layer = xrefLayerName(path, entity.layer);
  switch (entity.type) {
    case 'hatch':
      return { ...entity, handle, layer, boundary: entity.boundary.map((h) => xrefLayerName(path, h)) };
    case 'dimension':
      return { ...entity, handle, layer, refs: entity.refs.map((ref) => ({ ...ref, handle: xrefLayerName(path, ref.handle) })) };
    default:
      return { ...entity, handle, layer };
  }
}

function clipBounds(clip: Rect, xref: Xref): Rect {
  const corners = ([[clip[0], clip[1]], [clip[2], clip[1]], [clip[2], clip[3]], [clip[0], clip[3]]] satisfies Point[]).map((corner) => placePoint(corner, ORIGIN, xref));
  const xs = corners.map((corner) => corner[0]);
  const ys = corners.map((corner) => corner[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function intersect(a: Rect | null, b: Rect | null): Rect | null {
  if (a === null || b === null) return a ?? b;
  return [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
}

function expand(xref: Xref, path: string): { items: XrefItem[]; layers: Layer[] } {
  const blocks = Object.fromEntries(xref.model.blocks.map((block) => [block.name, block]));
  const items: XrefItem[] = xref.model.entities.map((entity) => ({
    entity: prefixed(placeEntity(entity, ORIGIN, xref), path), path, blocks, clip: xref.clip,
  }));
  const layers = xref.model.layers.map((layer) => ({ ...layer, name: xrefLayerName(path, layer.name) }));
  for (const nested of xref.model.xrefs) {
    const inner = expand(nested, xrefLayerName(path, nested.name));
    for (const item of inner.items) {
      items.push({
        ...item,
        entity: placeEntity(item.entity, ORIGIN, xref),
        clip: intersect(item.clip === null ? null : clipBounds(item.clip, xref), xref.clip),
      });
    }
    layers.push(...inner.layers);
  }
  return { items, layers };
}

/** Every xref entity in text order (own entities, then nested xrefs) in world space, with the xref layers `<xref>|<layer>`. */
export function flattenXrefs(xrefs: Readonly<Record<string, Xref>>): { items: XrefItem[]; layers: Layer[] } {
  const items: XrefItem[] = [];
  const layers: Layer[] = [];
  for (const xref of Object.values(xrefs)) {
    const expanded = expand(xref, xref.name);
    items.push(...expanded.items);
    layers.push(...expanded.layers);
  }
  return { items, layers };
}
