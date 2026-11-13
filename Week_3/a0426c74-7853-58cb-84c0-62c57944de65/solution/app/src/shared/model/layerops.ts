// Layers and layer states.
import * as copy from '../copy.ts';
import { invalid } from '../errors.ts';
import type { Layer, LayerState, Op } from '../types.ts';
import type { Context, OpOutcome } from './context.ts';
import { ZERO_LAYER } from './names.ts';

function layerNamed(ctx: Context, name: string): Layer {
  const layer = ctx.ws.layers.get(name);
  if (!layer) throw invalid(copy.noLayer(name));
  return layer;
}

function requireName(name: string): string {
  if (name.trim() === '') throw invalid(copy.NAME_REQUIRED);
  return name;
}

export function layerAddOp(ctx: Context, op: Extract<Op, { type: 'layer_add' }>): OpOutcome {
  const name = requireName(op.name);
  if (ctx.ws.layers.has(name)) throw invalid(copy.layerExists(name));
  ctx.ws.layers.set(name, {
    name, colour: op.colour, linetype: op.linetype, lineweight: op.lineweight, on: true, frozen: false, locked: false,
  });
  return { status: 'applied', handles: [] };
}

/** Everything on a layer follows its rename: entities (model and block definitions) and the layer states. */
function renameLayer(ctx: Context, from: string, to: string): void {
  const { ws } = ctx;
  for (const entity of ws.entities.values()) {
    if (entity.layer === from) ws.entities.set(entity.handle, { ...entity, layer: to });
  }
  for (const block of ws.blocks.values()) {
    if (block.entities.some((entity) => entity.layer === from)) {
      ws.blocks.set(block.name, { ...block, entities: block.entities.map((entity) => (entity.layer === from ? { ...entity, layer: to } : entity)) });
    }
  }
  for (const state of ws.layerStates.values()) {
    if (state.layers.some((layer) => layer.name === from)) {
      ws.layerStates.set(state.name, { ...state, layers: state.layers.map((layer) => (layer.name === from ? { ...layer, name: to } : layer)) });
    }
  }
}

export function layerSetOp(ctx: Context, op: Extract<Op, { type: 'layer_set' }>): OpOutcome {
  const layer = layerNamed(ctx, op.name);
  const { set } = op;
  const { rename, ...properties } = set;
  const updated: Layer = { ...layer, ...properties };
  if (rename === undefined || rename === layer.name) {
    ctx.ws.layers.set(layer.name, updated);
    return { status: 'applied', handles: [] };
  }
  if (layer.name === ZERO_LAYER) throw invalid(copy.LAYER_ZERO);
  const name = requireName(rename);
  if (ctx.ws.layers.has(name)) throw invalid(copy.layerExists(name));
  ctx.ws.layers.delete(layer.name);
  ctx.ws.layers.set(name, { ...updated, name });
  renameLayer(ctx, layer.name, name);
  return { status: 'applied', handles: [] };
}

export function layerDeleteOp(ctx: Context, op: Extract<Op, { type: 'layer_delete' }>): OpOutcome {
  if (op.name === ZERO_LAYER) throw invalid(copy.LAYER_ZERO);
  layerNamed(ctx, op.name);
  const inModel = ctx.ws.entities.values().filter((entity) => entity.layer === op.name).length;
  const inBlocks = ctx.ws.blocks.values().reduce((n, block) => n + block.entities.filter((entity) => entity.layer === op.name).length, 0);
  if (inModel + inBlocks > 0) throw invalid(copy.layerHasEntities(op.name, inModel + inBlocks));
  ctx.ws.layers.delete(op.name);
  return { status: 'applied', handles: [] };
}

export function layerStateSaveOp(ctx: Context, op: Extract<Op, { type: 'layer_state_save' }>): OpOutcome {
  const name = requireName(op.name);
  ctx.ws.layerStates.set(name, { name, layers: ctx.ws.layers.values() });
  return { status: 'applied', handles: [] };
}

export function layerStateRestoreOp(ctx: Context, op: Extract<Op, { type: 'layer_state_restore' }>): OpOutcome {
  const state: LayerState | undefined = ctx.ws.layerStates.get(op.name);
  if (!state) throw invalid(copy.noLayerState(op.name));
  for (const saved of state.layers) {
    if (ctx.ws.layers.has(saved.name)) ctx.ws.layers.set(saved.name, saved);
  }
  return { status: 'applied', handles: [] };
}
