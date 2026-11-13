// Xrefs: attach, clip, reload and bind.
import * as copy from '../copy.ts';
import { invalid } from '../errors.ts';
import { rectBetween, round6, XREF_SEPARATOR } from '../geometry/index.ts';
import type { BlockDef, Entity, Op, Rect, Xref } from '../types.ts';
import type { Context, OpOutcome } from './context.ts';
import { freeName, ZERO_LAYER } from './names.ts';
import type { XrefDirectory } from './index.ts';

function xrefNamed(ctx: Context, name: string): Xref {
  const xref = ctx.ws.xrefs.get(name);
  if (!xref) throw invalid(copy.noXref(name));
  return xref;
}

/** The Xrefs circular rule: the chain `[current, source, …, current]` of drawing names when attaching `sourceId` to `currentId` would loop. */
export function xrefCircularChain(currentId: string, sourceId: string, directory: XrefDirectory): string[] | null {
  const visited = new Set<string>();
  const walk = (id: string, path: string[]): string[] | null => {
    if (id === currentId) return [...path, directory.name(id)];
    if (visited.has(id)) return null;
    visited.add(id);
    for (const next of directory.sources(id)) {
      const chain = walk(next, [...path, directory.name(id)]);
      if (chain) return chain;
    }
    return null;
  };
  const chain = walk(sourceId, [directory.name(currentId)]);
  return chain;
}

export function xrefAttachOp(ctx: Context, op: Extract<Op, { type: 'xref_attach' }>): OpOutcome {
  if (op.name.trim() === '' || op.name.includes(XREF_SEPARATOR)) throw invalid(copy.invalidValue('name'));
  if (ctx.ws.xrefs.has(op.name)) throw invalid(copy.xrefExists(op.name));
  const scale = round6(op.scale);
  if (scale <= 0) throw invalid(copy.NUMBER_ABOVE_ZERO);
  const { drawingId, xrefDirectory, xrefSource } = ctx.loaders;
  const chain = xrefCircularChain(drawingId, op.source, xrefDirectory);
  if (chain) throw invalid(copy.circularReference(chain));
  const source = xrefSource(op.source);
  ctx.ws.xrefs.set(op.name, {
    name: op.name, source: op.source, x: round6(op.x), y: round6(op.y), scale, rotation: round6(op.rotation),
    clip: null, version_id: source.version_id, model: source.model,
  });
  return { status: 'applied', handles: [] };
}

export function xrefClipOp(ctx: Context, op: Extract<Op, { type: 'xref_clip' }>): OpOutcome {
  const xref = xrefNamed(ctx, op.name);
  let clip: Rect | null = null;
  if (op.rect !== null) {
    const [x1, y1, x2, y2] = op.rect.map(round6);
    clip = rectBetween([x1, y1], [x2, y2]);
  }
  ctx.ws.xrefs.set(op.name, { ...xref, clip });
  return { status: 'applied', handles: [] };
}

export function xrefReloadOp(ctx: Context, op: Extract<Op, { type: 'xref_reload' }>): OpOutcome {
  const xref = xrefNamed(ctx, op.name);
  const source = ctx.loaders.xrefSource(xref.source);
  ctx.ws.xrefs.set(op.name, { ...xref, version_id: source.version_id, model: source.model });
  return { status: 'applied', handles: [] };
}

/**
 * XBIND turns one xref level into a block named after the xref (free-named if taken) holding the xref's entities with fresh handles, its layers
 * into `<xref name>$<layer>` and its own blocks into `<xref name>$<block>`, and puts one insert of that block where the xref was placed.
 * The clip and nested xrefs are not carried into the block.
 */
export function xrefBindOp(ctx: Context, op: Extract<Op, { type: 'xref_bind' }>): OpOutcome {
  const xref = xrefNamed(ctx, op.name);
  const { ws } = ctx;
  const layerOf = (name: string): string => `${xref.name}$${name}`;
  for (const layer of xref.model.layers) {
    if (!ws.layers.has(layerOf(layer.name))) ws.layers.set(layerOf(layer.name), { ...layer, name: layerOf(layer.name) });
  }
  const blockNames = new Map<string, string>();
  const taken = (name: string): boolean => ws.blocks.has(name) || [...blockNames.values()].includes(name);
  for (const block of xref.model.blocks) blockNames.set(block.name, freeName(`${xref.name}$${block.name}`, taken));
  const mainName = freeName(xref.name, taken);
  const handles = new Map<string, string>();
  const rehome = (entities: readonly Entity[]): Entity[] => {
    for (const entity of entities) handles.set(entity.handle, ctx.newHandle(entity.type));
    return entities.map((entity) => rehomed(entity, handles, layerOf, blockNames, ctx.user));
  };
  for (const block of xref.model.blocks) {
    const definition: BlockDef = { ...block, name: blockNames.get(block.name) ?? block.name, entities: rehome(block.entities) };
    ws.blocks.set(definition.name, definition);
  }
  ws.blocks.set(mainName, { name: mainName, base: [0, 0], entities: rehome(xref.model.entities), attributes: [] });
  ws.xrefs.delete(xref.name);
  ctx.assertUnlocked(ZERO_LAYER);
  const handle = ctx.newHandle('insert');
  ws.entities.set(handle, {
    type: 'insert', handle, layer: ZERO_LAYER, block: mainName, x: xref.x, y: xref.y, scale: xref.scale, rotation: xref.rotation,
    attributes: {}, author: ctx.user,
  });
  return { status: 'applied', handles: [handle] };
}

function rehomed(entity: Entity, handles: ReadonlyMap<string, string>, layerOf: (name: string) => string, blocks: ReadonlyMap<string, string>, author: string): Entity {
  const common = { handle: handles.get(entity.handle) ?? entity.handle, layer: layerOf(entity.layer), author };
  const mapped = (handle: string): string => handles.get(handle) ?? handle;
  switch (entity.type) {
    case 'insert': return { ...entity, ...common, block: blocks.get(entity.block) ?? entity.block };
    case 'dimension': return { ...entity, ...common, refs: entity.refs.map((ref) => ({ ...ref, handle: mapped(ref.handle) })) };
    case 'hatch': return { ...entity, ...common, boundary: entity.boundary.map(mapped) };
    default: return { ...entity, ...common };
  }
}
