import { sha256Hex } from "./sha256";
import type { Graph, Node, Layer, State, Transition, CameraView, OverrideField, Trigger, NodeKind, Primitive, LayerType } from "./graph-types";

export type { Graph, Node, Layer, State, Transition, CameraView, OverrideField, Trigger, NodeKind, Primitive, LayerType };

export const REST_STATE: State = { id: "rest", name: "Rest", overrides: [] };

export function cloneGraph(graph: Graph): Graph {
  return {
    nodes: graph.nodes.map((n) => ({
      ...n,
      position: [...n.position],
      rotation: [...n.rotation],
      scale: [...n.scale],
      materialLayers: n.materialLayers.map((l) => ({ ...l, color: [...l.color] })),
    })),
    states: graph.states.map((s) => ({
      ...s,
      overrides: s.overrides.map((o) => ({
        ...o,
        value: Array.isArray(o.value) ? [...(o.value as number[])] : o.value,
      })),
    })),
    transitions: graph.transitions.map((t) => ({ ...t })),
    cameraViews: graph.cameraViews.map((c) => ({ ...c, position: [...c.position], target: [...c.target] })),
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function graphHash(graph: Graph): string {
  const g = cloneGraph(graph);
  g.nodes.sort((a, b) => cmp(a.id, b.id));
  g.states.sort((a, b) => cmp(a.id, b.id));
  for (const st of g.states) {
    st.overrides.sort((a, b) => (a.nodeId === b.nodeId ? cmp(a.field, b.field) : cmp(a.nodeId, b.nodeId)));
  }
  g.transitions.sort((a, b) => (a.from === b.from ? cmp(a.trigger, b.trigger) : cmp(a.from, b.from)));
  g.cameraViews.sort((a, b) => cmp(a.name, b.name));
  const canon = (value: unknown): unknown => {
    if (typeof value === "number") {
      const r = round4(value);
      return Object.is(r, -0) ? 0 : r;
    }
    if (Array.isArray(value)) return value.map(canon);
    if (value !== null && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
      const out: Record<string, unknown> = {};
      for (const k of keys) out[k] = canon(obj[k]);
      return out;
    }
    return value;
  };
  const data = JSON.stringify(canon(g));
  return sha256Hex(data);
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function applyState(graph: Graph, stateId: string): Graph {
  const g = cloneGraph(graph);
  const state = g.states.find((s) => s.id === stateId);
  if (!state) return g;
  for (const o of state.overrides) {
    const node = g.nodes.find((n) => n.id === o.nodeId);
    if (!node) continue;
    if (o.field === "visible") node.visible = o.value === true;
    else if (Array.isArray(o.value)) {
      const vec = [...(o.value as number[])] as [number, number, number];
      if (o.field === "position") node.position = vec;
      else if (o.field === "rotation") node.rotation = vec;
      else if (o.field === "scale") node.scale = vec;
    }
  }
  return g;
}
