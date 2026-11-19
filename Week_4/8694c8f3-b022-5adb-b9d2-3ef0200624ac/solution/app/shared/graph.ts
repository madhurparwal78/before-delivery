import { isRecord } from "./schema.ts";
import type { GraphDoc, GraphNode, GraphWire } from "./types.ts";

export const LFO_SHAPES = ["sine", "triangle", "square", "saw"] as const;
export type LfoShape = (typeof LFO_SHAPES)[number];

export const LFO_RATE_RANGE = { min: 0.25, max: 16 };

export const BUILT_IN_NODES = ["Beat clock", "LFO", "Remap", "Layer property"] as const;
type BuiltInNode = (typeof BUILT_IN_NODES)[number];

interface Ports {
  inputs: string[];
  outputs: string[];
}

const BUILT_IN_PORTS: Record<BuiltInNode, Ports> = {
  "Beat clock": { inputs: [], outputs: ["beat", "phase"] },
  LFO: { inputs: ["beat"], outputs: ["value"] },
  Remap: { inputs: ["in"], outputs: ["out"] },
  "Layer property": { inputs: ["value"], outputs: [] },
};

const BUILT_IN_DEFAULTS: Record<BuiltInNode, Record<string, unknown>> = {
  "Beat clock": {},
  LFO: { shape: "sine", rate_beats: 1 },
  Remap: { in_min: 0, in_max: 1, out_min: 0, out_max: 1 },
  "Layer property": { layer_id: null, property: null },
};

export function isBuiltIn(type: string): type is BuiltInNode {
  return (BUILT_IN_NODES as readonly string[]).includes(type);
}

export function defaultParams(type: string): Record<string, unknown> {
  return isBuiltIn(type) ? { ...BUILT_IN_DEFAULTS[type] } : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function portsOf(node: Pick<GraphNode, "type" | "params">): Ports {
  if (isBuiltIn(node.type)) return BUILT_IN_PORTS[node.type];
  const params: unknown = node.params;
  return isRecord(params)
    ? { inputs: stringList(params["inputs"]), outputs: stringList(params["outputs"]) }
    : { inputs: [], outputs: [] };
}

const WIRE_MESSAGES = {
  direction: "Wires run from an output to an input",
  occupied: "This input already has a wire",
  loop: "This wire would make a loop",
} as const;

function reaches(graph: GraphDoc, from: string, target: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || seen.has(current)) continue;
    if (current === target) return true;
    seen.add(current);
    for (const wire of graph.wires) if (wire.from.node_id === current) stack.push(wire.to.node_id);
  }
  return false;
}

export function wireRefusal(graph: GraphDoc, wire: GraphWire): string | null {
  const from = graph.nodes.find((node) => node.node_id === wire.from.node_id);
  const to = graph.nodes.find((node) => node.node_id === wire.to.node_id);
  if (!from || !to || from.node_id === to.node_id) return WIRE_MESSAGES.direction;
  if (!portsOf(from).outputs.includes(wire.from.port) || !portsOf(to).inputs.includes(wire.to.port)) {
    return WIRE_MESSAGES.direction;
  }
  if (graph.wires.some((other) => other.to.node_id === to.node_id && other.to.port === wire.to.port)) {
    return WIRE_MESSAGES.occupied;
  }
  return reaches(graph, to.node_id, from.node_id) ? WIRE_MESSAGES.loop : null;
}

export function topologicalOrder(graph: GraphDoc): GraphNode[] {
  const pending = new Map(graph.nodes.map((node) => [node.node_id, node]));
  const order: GraphNode[] = [];
  while (pending.size > 0) {
    const ready = [...pending.values()].find(
      (node) => !graph.wires.some((wire) => wire.to.node_id === node.node_id && pending.has(wire.from.node_id)),
    );
    const next = ready ?? pending.values().next().value;
    if (next === undefined) break;
    pending.delete(next.node_id);
    order.push(next);
  }
  return order;
}
