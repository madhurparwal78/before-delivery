import type { GraphDoc } from './api.js';

export interface NodeDefinition {
  typeName: string;
  inputs: string[];
  outputs: string[];
  run: (inputs: Record<string, number>) => Record<string, number>;
}

// Built-in node ports and evaluation. Plugin nodes register extra types.
const BUILT_INS: Record<string, { inputs: string[]; outputs: string[] }> = {
  'Beat clock': { inputs: [], outputs: ['beat', 'phase'] },
  'LFO': { inputs: ['beat'], outputs: ['value'] },
  'Remap': { inputs: ['in'], outputs: ['out'] },
  'Layer property': { inputs: ['value'], outputs: [] },
};

export class GraphEvaluator {
  private readonly plugins = new Map<string, NodeDefinition>();

  registerPlugin (definition: NodeDefinition): void {
    this.plugins.set(definition.typeName, definition);
  }

  portsOf (type: string): { inputs: string[]; outputs: string[] } {
    const builtIn = BUILT_INS[type];
    if (builtIn !== undefined) return builtIn;
    const plugin = this.plugins.get(type);
    if (plugin !== undefined) return { inputs: plugin.inputs, outputs: plugin.outputs };
    return { inputs: [], outputs: [] };
  }

  // Evaluate once per drawn frame. Returns per-layer property overrides.
  evaluate (graph: GraphDoc, beat: number, bpm: number): Map<string, Map<string, number>> {
    const overrides = new Map<string, Map<string, number>>();
    const outputs = new Map<string, number>();
    const compute = (nodeId: string, seen: Set<string>): void => {
      if (outputs.has(nodeId)) return;
      if (seen.has(nodeId)) return;
      seen.add(nodeId);
      const node = graph.nodes.find((n) => n.node_id === nodeId);
      if (node === undefined) return;
      const inputs: Record<string, number> = {};
      const ports = this.portsOf(node.type);
      for (const port of ports.inputs) {
        inputs[port] = 0;
      }
      for (const wire of graph.wires) {
        if (wire.to.node_id !== nodeId) continue;
        compute(wire.from.node_id, seen);
        const value = outputs.get(`${wire.from.node_id}:${wire.from.port}`);
        if (value !== undefined && wire.to.port in inputs) {
          inputs[wire.to.port] = value;
        }
      }
      if (node.type === 'Beat clock') {
        outputs.set(`${nodeId}:beat`, beat);
        outputs.set(`${nodeId}:phase`, beat % 1);
      } else if (node.type === 'LFO') {
        const params = node.params as { shape?: string; rate_beats?: number };
        const rate = params.rate_beats ?? 1;
        const phase = (beat / Math.max(0.25, rate)) % 1;
        const shape = params.shape ?? 'sine';
        let value = 0;
        if (shape === 'sine') value = Math.sin(phase * Math.PI * 2);
        else if (shape === 'triangle') value = 4 * Math.abs(phase - 0.5) - 1;
        else if (shape === 'square') value = phase < 0.5 ? 1 : -1;
        else if (shape === 'saw') value = phase * 2 - 1;
        outputs.set(`${nodeId}:value`, value);
      } else if (node.type === 'Remap') {
        const params = node.params as { in_min?: number; in_max?: number; out_min?: number; out_max?: number };
        const input = inputs.in ?? 0;
        const inMin = params.in_min ?? -1;
        const inMax = params.in_max ?? 1;
        const outMin = params.out_min ?? 0;
        const outMax = params.out_max ?? 1;
        const t = inMax === inMin ? 0 : (input - inMin) / (inMax - inMin);
        outputs.set(`${nodeId}:out`, outMin + (outMax - outMin) * t);
      } else if (node.type === 'Layer property') {
        const params = node.params as { layer_id?: string; property?: string };
        if (typeof params.layer_id === 'string' && typeof params.property === 'string') {
          let map = overrides.get(params.layer_id);
          if (map === undefined) {
            map = new Map();
            overrides.set(params.layer_id, map);
          }
          map.set(params.property, inputs.value ?? 0);
        }
      } else {
        const plugin = this.plugins.get(node.type);
        if (plugin !== undefined) {
          const result = plugin.run(inputs);
          for (const port of plugin.outputs) {
            const value = result[port];
            outputs.set(`${nodeId}:${port}`, typeof value === 'number' && Number.isFinite(value) ? value : 0);
          }
        }
      }
    };
    for (const node of graph.nodes) {
      compute(node.node_id, new Set());
    }
    void bpm;
    return overrides;
  }
}
