// The drawing state as a value: its starting point, and its conversion from and to the collections of a drawing document.
import { compareHandles, evaluateParameters, STANDARD_DIM_STYLE } from '../geometry/index.ts';
import type { DrawingDocument, DrawingState, Entity, ParameterView } from '../types.ts';
import type { DocumentCollections } from './index.ts';
import { ZERO_LAYER } from './names.ts';

export function emptyDrawingState(): DrawingState {
  return {
    revision: 0,
    next_handle: 1,
    layers: { [ZERO_LAYER]: { name: ZERO_LAYER, colour: 'white', linetype: 'Continuous', lineweight: 0.25, on: true, frozen: false, locked: false } },
    entities: {},
    blocks: {},
    dim_styles: { [STANDARD_DIM_STYLE.name]: STANDARD_DIM_STYLE },
    parameters: {},
    constraints: [],
    xrefs: {},
    layer_states: {},
    underlays: [],
  };
}

export function parameterViews(state: DrawingState): ParameterView[] {
  const outcome = evaluateParameters(state.parameters);
  return Object.values(state.parameters).map((parameter) => ({ ...parameter, value: outcome.ok ? outcome.values[parameter.name] ?? null : null }));
}

/** The document lists entities grouped by handle letter (line, polyline, circle...), each group in handle number order. */
const byHandleLetterThenNumber = (a: Entity, b: Entity): number =>
  a.handle.charAt(0).localeCompare(b.handle.charAt(0)) || compareHandles(a.handle, b.handle);

export function documentCollections(state: DrawingState): DocumentCollections {
  return {
    layers: Object.values(state.layers),
    entities: Object.values(state.entities).sort(byHandleLetterThenNumber),
    blocks: Object.values(state.blocks),
    dim_styles: Object.values(state.dim_styles),
    parameters: parameterViews(state),
    constraints: state.constraints,
    xrefs: Object.values(state.xrefs),
    layer_states: Object.values(state.layer_states),
    underlays: state.underlays,
  };
}

const keyed = <V>(list: readonly V[], key: (value: V) => string): Record<string, V> => Object.fromEntries(list.map((value) => [key(value), value]));

export function stateFromDocument(doc: Pick<DrawingDocument, 'revision' | 'next_handle'> & DocumentCollections): DrawingState {
  return {
    revision: doc.revision,
    next_handle: doc.next_handle,
    layers: keyed(doc.layers, (layer) => layer.name),
    entities: keyed(doc.entities, (entity) => entity.handle),
    blocks: keyed(doc.blocks, (block) => block.name),
    dim_styles: keyed(doc.dim_styles, (style) => style.name),
    parameters: keyed(doc.parameters.map(({ name, expression }) => ({ name, expression })), (parameter) => parameter.name),
    constraints: doc.constraints,
    xrefs: keyed(doc.xrefs, (xref) => xref.name),
    layer_states: keyed(doc.layer_states, (layerState) => layerState.name),
    underlays: doc.underlays,
  };
}
