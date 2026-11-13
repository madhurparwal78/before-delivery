// Blocks: BLOCK (define and redefine), EXPLODE and PURGE.
import * as copy from '../copy.ts';
import { invalid } from '../errors.ts';
import { explodeInsert, findBlockCycle, round6 } from '../geometry/index.ts';
import type { BlockAttribute, BlockDef, DrawingState, Entity, Op } from '../types.ts';
import type { Context, OpOutcome } from './context.ts';
import { assertModelHandle, dropped, removeEntities } from './entityops.ts';
import { buildEntity, completeAttributes } from './entity.ts';
import { ZERO_LAYER } from './names.ts';

type Drawing = Pick<DrawingState, 'entities' | 'blocks' | 'layers'>;

/** What PURGE removes: block definitions no model insert reaches (directly or through nested definitions) and layers nothing uses. */
export function purgeCandidates(drawing: Drawing): { blocks: string[]; layers: string[] } {
  const reached = new Set<string>();
  const reach = (entities: readonly Entity[]): void => {
    for (const entity of entities) {
      if (entity.type === 'insert' && !reached.has(entity.block)) {
        reached.add(entity.block);
        reach(drawing.blocks[entity.block]?.entities ?? []);
      }
    }
  };
  reach(Object.values(drawing.entities));
  const usedLayers = new Set<string>([ZERO_LAYER]);
  for (const entity of Object.values(drawing.entities)) usedLayers.add(entity.layer);
  for (const name of reached) {
    for (const entity of drawing.blocks[name]?.entities ?? []) usedLayers.add(entity.layer);
  }
  return {
    blocks: Object.keys(drawing.blocks).filter((name) => !reached.has(name)),
    layers: Object.keys(drawing.layers).filter((name) => !usedLayers.has(name)),
  };
}

export function purgeOp(ctx: Context): OpOutcome {
  const unused = purgeCandidates({ entities: ctx.ws.entities.record, blocks: ctx.ws.blocks.record, layers: ctx.ws.layers.record });
  for (const name of unused.blocks) ctx.ws.blocks.delete(name);
  for (const name of unused.layers) ctx.ws.layers.delete(name);
  const before = ctx.purged ?? { blocks: 0, layers: 0 };
  ctx.purged = { blocks: before.blocks + unused.blocks.length, layers: before.layers + unused.layers.length };
  return { status: 'applied', handles: [] };
}

function uniqueTags(attributes: readonly BlockAttribute[]): BlockAttribute[] {
  if (attributes.some((attribute, i) => attribute.tag === '' || attributes.findIndex((other) => other.tag === attribute.tag) !== i)) {
    throw invalid(copy.invalidValue('attributes'));
  }
  return [...attributes];
}

/** Redefinition: every insert of the block, in the model and inside other definitions, keeps its values for tags that still exist. */
function refreshInserts(ctx: Context, definition: BlockDef): void {
  const refreshed = (entity: Entity): Entity =>
    entity.type === 'insert' && entity.block === definition.name
      ? { ...entity, attributes: completeAttributes(definition.attributes, entity.attributes) }
      : entity;
  for (const entity of ctx.ws.entities.values()) {
    const next = refreshed(entity);
    if (next !== entity) ctx.ws.entities.set(entity.handle, next);
  }
  for (const block of ctx.ws.blocks.values()) {
    if (block.name !== definition.name && block.entities.some((entity) => refreshed(entity) !== entity)) {
      ctx.ws.blocks.set(block.name, { ...block, entities: block.entities.map(refreshed) });
    }
  }
}

export function blockDefineOp(ctx: Context, op: Extract<Op, { type: 'block_define' }>): OpOutcome {
  if (op.name.trim() === '') throw invalid(copy.NAME_REQUIRED);
  const base: BlockDef['base'] = [round6(op.base[0]), round6(op.base[1])];
  const picked: Entity[] = op.handles.map((handle) => {
    assertModelHandle(handle);
    const entity = ctx.ws.entities.get(handle);
    if (!entity) throw invalid(copy.noEntity(handle));
    ctx.assertUnlocked(entity.layer);
    return entity;
  });
  const chain = findBlockCycle(op.name, picked, ctx.ws.blocks.record);
  if (chain) throw invalid(copy.blockSelfContained(op.name, chain));
  const definition: BlockDef = { name: op.name, base, entities: picked, attributes: uniqueTags(op.attributes) };
  removeEntities(ctx, op.handles);
  const redefined = ctx.ws.blocks.has(op.name);
  ctx.ws.blocks.set(op.name, definition);
  if (redefined) refreshInserts(ctx, definition);
  const handle = ctx.newHandle('insert');
  ctx.ws.entities.set(handle, buildEntity(ctx, {
    type: 'insert', layer: picked[0]?.layer ?? ZERO_LAYER, block: op.name, x: base[0], y: base[1], scale: 1, rotation: 0, attributes: {},
  }, handle, ctx.user));
  return { status: 'applied', handles: [handle] };
}

export function explodeOp(ctx: Context, op: Extract<Op, { type: 'explode' }>): OpOutcome {
  assertModelHandle(op.handle);
  const insert = ctx.ws.entities.get(op.handle);
  if (!insert) return { status: 'dropped', handles: [], ...dropped(ctx, op.handle) };
  if (insert.type !== 'insert') throw invalid(copy.notAnInsert(op.handle));
  ctx.assertUnlocked(insert.layer);
  const handles: string[] = [];
  for (const draft of explodeInsert(insert, ctx.ws.blocks.record, ctx.ws.layers.record)) {
    ctx.assertUnlocked(draft.layer);
    const handle = ctx.newHandle(draft.type);
    ctx.ws.entities.set(handle, buildEntity(ctx, draft, handle, ctx.user));
    handles.push(handle);
  }
  removeEntities(ctx, [op.handle]);
  return { status: 'applied', handles };
}
