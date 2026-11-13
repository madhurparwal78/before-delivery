// Patches: what a group changed, as clients apply it to their confirmed state without re-running any rule.
import type { DrawingState, Entity, StatePatch } from '../types.ts';
import { inheritFollowers } from './derive.ts';
import type { Change } from './index.ts';

export function makePatch(after: DrawingState, changes: readonly Change[]): StatePatch {
  const upsert: Entity[] = [];
  const remove: string[] = [];
  const touched = new Set<string>();
  for (const change of changes) {
    touched.add(change.kind);
    if (change.kind !== 'entity') continue;
    if (change.after) upsert.push(change.after);
    else remove.push(change.key);
  }
  return {
    revision: after.revision,
    next_handle: after.next_handle,
    entities_upsert: upsert,
    entities_delete: remove,
    ...(touched.has('layer') ? { layers: Object.values(after.layers) } : {}),
    ...(touched.has('block') ? { blocks: Object.values(after.blocks) } : {}),
    ...(touched.has('dim_style') ? { dim_styles: Object.values(after.dim_styles) } : {}),
    ...(touched.has('parameter') ? { parameters: Object.values(after.parameters) } : {}),
    ...(touched.has('constraint') ? { constraints: after.constraints } : {}),
    ...(touched.has('xref') ? { xrefs: Object.values(after.xrefs) } : {}),
    ...(touched.has('layer_state') ? { layer_states: Object.values(after.layer_states) } : {}),
    ...(touched.has('underlay') ? { underlays: after.underlays } : {}),
  };
}

const keyed = <V>(list: readonly V[], key: (value: V) => string): Record<string, V> => Object.fromEntries(list.map((value) => [key(value), value]));

export function applyPatch(state: DrawingState, patch: StatePatch): DrawingState {
  let entities = state.entities;
  if (patch.entities_upsert.length > 0 || patch.entities_delete.length > 0) {
    entities = { ...state.entities };
    for (const entity of patch.entities_upsert) entities[entity.handle] = entity;
    for (const handle of patch.entities_delete) delete entities[handle];
    inheritFollowers(state.entities, entities, [...patch.entities_upsert.map((entity): [string, Entity | null] => [entity.handle, entity]), ...patch.entities_delete.map((handle): [string, Entity | null] => [handle, null])]);
  }
  return {
    revision: patch.revision,
    next_handle: patch.next_handle,
    entities,
    layers: patch.layers ? keyed(patch.layers, (layer) => layer.name) : state.layers,
    blocks: patch.blocks ? keyed(patch.blocks, (block) => block.name) : state.blocks,
    dim_styles: patch.dim_styles ? keyed(patch.dim_styles, (style) => style.name) : state.dim_styles,
    parameters: patch.parameters ? keyed(patch.parameters, (parameter) => parameter.name) : state.parameters,
    constraints: patch.constraints ?? state.constraints,
    xrefs: patch.xrefs ? keyed(patch.xrefs, (xref) => xref.name) : state.xrefs,
    layer_states: patch.layer_states ? keyed(patch.layer_states, (layerState) => layerState.name) : state.layer_states,
    underlays: patch.underlays ?? state.underlays,
  };
}
