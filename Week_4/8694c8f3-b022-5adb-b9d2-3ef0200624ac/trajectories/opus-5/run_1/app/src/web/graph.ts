import type { GraphDoc, KeyDoc, LayerDoc, SetDocument } from '../shared/types.js';

export interface PluginNodeType {
  typeName: string;
  scriptId: string;
  inputs: string[];
  outputs: string[];
  run: (inputs: Record<string, number>) => unknown;
}

export type Overrides = Map<string, Map<string, number>>;

function put(overrides: Overrides, layerId: string, path: string, value: number): void {
  const existing = overrides.get(layerId) ?? new Map<string, number>();
  existing.set(path, value);
  overrides.set(layerId, existing);
}

function lfoValue(shape: string, phase: number): number {
  const wrapped = phase - Math.floor(phase);
  switch (shape) {
    case 'triangle':
      return 4 * Math.abs(wrapped - 0.5) - 1;
    case 'square':
      return wrapped < 0.5 ? 1 : -1;
    case 'saw':
      return wrapped * 2 - 1;
    default:
      return Math.sin(wrapped * Math.PI * 2);
  }
}

function numberParam(params: Record<string, string | number>, name: string, fallback: number): number {
  const value = params[name];
  return typeof value === 'number' ? value : fallback;
}

function sortedNodes(graph: GraphDoc): string[] {
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const node of graph.nodes) incoming.set(node.node_id, 0);
  for (const wire of graph.wires) {
    incoming.set(wire.to.node_id, (incoming.get(wire.to.node_id) ?? 0) + 1);
    outgoing.set(wire.from.node_id, [...(outgoing.get(wire.from.node_id) ?? []), wire.to.node_id]);
  }
  const ready = [...incoming.entries()].filter(([, count]) => count === 0).map(([id]) => id);
  const order: string[] = [];
  while (ready.length > 0) {
    const current = ready.shift() as string;
    order.push(current);
    for (const next of outgoing.get(current) ?? []) {
      const remaining = (incoming.get(next) ?? 1) - 1;
      incoming.set(next, remaining);
      if (remaining === 0) ready.push(next);
    }
  }
  return order;
}

/** Evaluates the node graph once for a drawn frame. */
export function evaluateGraph(
  graph: GraphDoc,
  beat: number,
  plugins: Map<string, PluginNodeType>,
): Overrides {
  const overrides: Overrides = new Map();
  const outputs = new Map<string, Map<string, number>>();
  const inputFor = (nodeId: string, port: string): number => {
    const wire = graph.wires.find((candidate) => candidate.to.node_id === nodeId && candidate.to.port === port);
    if (wire === undefined) return 0;
    return outputs.get(wire.from.node_id)?.get(wire.from.port) ?? 0;
  };

  for (const nodeId of sortedNodes(graph)) {
    const node = graph.nodes.find((candidate) => candidate.node_id === nodeId);
    if (node === undefined) continue;
    const produced = new Map<string, number>();
    if (node.type === 'Beat clock') {
      produced.set('beat', beat);
      produced.set('phase', beat - Math.floor(beat));
    } else if (node.type === 'LFO') {
      const rate = numberParam(node.params, 'rate_beats', 1);
      const shape = typeof node.params['shape'] === 'string' ? node.params['shape'] : 'sine';
      produced.set('value', lfoValue(shape, inputFor(nodeId, 'beat') / Math.max(0.25, rate)));
    } else if (node.type === 'Remap') {
      const inMin = numberParam(node.params, 'in_min', -1);
      const inMax = numberParam(node.params, 'in_max', 1);
      const outMin = numberParam(node.params, 'out_min', 0);
      const outMax = numberParam(node.params, 'out_max', 1);
      const span = inMax - inMin === 0 ? 1 : inMax - inMin;
      const ratio = (inputFor(nodeId, 'in') - inMin) / span;
      produced.set('out', outMin + ratio * (outMax - outMin));
    } else if (node.type === 'Layer property') {
      const layerId = typeof node.params['layer_id'] === 'string' ? node.params['layer_id'] : '';
      const property = typeof node.params['property'] === 'string' ? node.params['property'] : '';
      if (layerId !== '' && property !== '') put(overrides, layerId, property, inputFor(nodeId, 'value'));
    } else {
      const plugin = plugins.get(node.type);
      if (plugin !== undefined) {
        const inputs: Record<string, number> = {};
        for (const port of plugin.inputs) inputs[port] = inputFor(nodeId, port);
        const result = plugin.run(inputs);
        const record = result !== null && typeof result === 'object' ? (result as Record<string, unknown>) : {};
        for (const port of plugin.outputs) {
          const value = record[port];
          produced.set(port, typeof value === 'number' && Number.isFinite(value) ? value : 0);
        }
      }
    }
    outputs.set(nodeId, produced);
  }
  return overrides;
}

/** Between two keys the value is linear in ticks; keys override the stored value. */
export function keyedValue(keys: KeyDoc[], layer: LayerDoc, property: string, tick: number): number | null {
  const lane = keys
    .filter((key) => key.layer_id === layer.id && key.property === property)
    .sort((a, b) => a.tick - b.tick);
  if (lane.length === 0) return null;
  const first = lane[0] as KeyDoc;
  if (tick <= first.tick) return first.value;
  const last = lane[lane.length - 1] as KeyDoc;
  if (tick >= last.tick) return last.value;
  for (let index = 0; index < lane.length - 1; index += 1) {
    const current = lane[index] as KeyDoc;
    const next = lane[index + 1] as KeyDoc;
    if (tick >= current.tick && tick <= next.tick) {
      const span = next.tick - current.tick;
      const ratio = span === 0 ? 0 : (tick - current.tick) / span;
      return current.value + ratio * (next.value - current.value);
    }
  }
  return last.value;
}

export const KEY_LANE_PROPERTIES = [
  'position.x',
  'position.y',
  'position.z',
  'rotation.x',
  'rotation.y',
  'rotation.z',
  'scale.x',
  'scale.y',
  'scale.z',
  'props.fov',
  'props.near',
  'props.far',
  'props.twist',
  'props.radius',
  'props.intensity',
  'material.tint_alpha',
] as const;

/** A Layer property node overrides keys, and keys override the stored value. */
export function stageOverrides(
  doc: SetDocument,
  tick: number,
  graphOverrides: Overrides,
  scriptOverrides: Overrides,
): Overrides {
  const combined: Overrides = new Map();
  for (const layer of doc.layers) {
    for (const property of KEY_LANE_PROPERTIES) {
      const keyed = keyedValue(doc.keys, layer, property, tick);
      if (keyed !== null) put(combined, layer.id, property, keyed);
    }
  }
  for (const [layerId, values] of scriptOverrides) {
    for (const [path, value] of values) put(combined, layerId, path, value);
  }
  for (const [layerId, values] of graphOverrides) {
    for (const [path, value] of values) put(combined, layerId, path, value);
  }
  return combined;
}

