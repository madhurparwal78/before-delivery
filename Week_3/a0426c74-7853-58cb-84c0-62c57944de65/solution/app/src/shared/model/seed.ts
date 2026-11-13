// The starting state of a seeded drawing (grading seed route). Handles you give are kept; derived values are computed.
import { invalid } from '../errors.ts';
import { evaluateParameters, handleNumber } from '../geometry/index.ts';
import type { DrawingState, Entity } from '../types.ts';
import { constraintAddOp, settleConstraints } from './constraintops.ts';
import { Context } from './context.ts';
import { buildEntity } from './entity.ts';
import type { DrawingSeed, SeedEntity } from './index.ts';
import { ZERO_LAYER } from './names.ts';
import { emptyDrawingState } from './state.ts';

const ROW = 100;
const isFollower = (entity: SeedEntity): boolean => entity.type === 'dimension' || entity.type === 'hatch';

export function seedDrawing(seed: DrawingSeed): DrawingState {
  const ctx = new Context(emptyDrawingState(), { username: 'seed' }, 0, 'SEED');
  const { ws } = ctx;
  for (const layer of seed.layers ?? []) ws.layers.set(layer.name, layer);
  for (const style of seed.dim_styles ?? []) ws.dimStyles.set(style.name, style);
  for (const parameter of seed.parameters ?? []) ws.parameters.set(parameter.name, parameter);
  const parameters = evaluateParameters(ws.parameters.record);
  if (!parameters.ok) throw invalid(parameters.message);
  const handles = [...(seed.entities ?? []), ...(seed.blocks ?? []).flatMap((block) => block.entities)].map((entity) => handleNumber(entity.handle));
  ws.nextHandle = Math.max(0, ...handles) + 1;
  // Blocks may nest in any order: register every definition, then build the entities that refer to them.
  for (const block of seed.blocks ?? []) ws.blocks.set(block.name, { name: block.name, base: block.base, attributes: block.attributes, entities: [] });
  for (const block of seed.blocks ?? []) {
    const entities: Entity[] = block.entities.map((entity) => buildEntity(ctx, entity, entity.handle, null));
    ws.blocks.set(block.name, { name: block.name, base: block.base, attributes: block.attributes, entities });
  }
  const entities = seed.entities ?? [];
  for (const entity of [...entities.filter((e) => !isFollower(e)), ...entities.filter((e) => e.type === 'dimension'), ...entities.filter((e) => e.type === 'hatch')]) {
    ws.entities.set(entity.handle, buildEntity(ctx, entity, entity.handle, null));
  }
  const { lines = 0, spacing = 0 } = seed.generate ?? {};
  for (let i = 0; i < lines; i += 1) {
    const handle = ctx.newHandle('line');
    const x = (i % ROW) * spacing;
    const y = Math.floor(i / ROW) * spacing;
    ws.entities.set(handle, buildEntity(ctx, { type: 'line', layer: ZERO_LAYER, x1: x, y1: y, x2: x + 1, y2: y }, handle, null));
  }
  for (const xref of seed.xrefs ?? []) ws.xrefs.set(xref.name, xref);
  for (const constraint of seed.constraints ?? []) constraintAddOp(ctx, { op_id: 'seed', type: 'constraint_add', ...constraint });
  settleConstraints(ctx, []);
  for (const layerState of seed.layer_states ?? []) ws.layerStates.set(layerState.name, { name: layerState.name, layers: ws.layers.values() });
  return ws.state(0);
}
