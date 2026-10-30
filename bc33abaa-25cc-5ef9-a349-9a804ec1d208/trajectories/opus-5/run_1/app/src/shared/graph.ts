export type Vec3 = [number, number, number];

export type NodeKind = 'group' | 'mesh' | 'camera' | 'light';
export type Primitive = 'box' | 'sphere' | 'cylinder' | 'plane';
export type LayerType = 'base' | 'clearcoat' | 'sheen' | 'emission';
export type OverrideField = 'position' | 'rotation' | 'scale' | 'visible';
export type Trigger = 'hover' | 'click' | 'scroll';

export interface Layer {
  id: string;
  type: LayerType;
  color: Vec3;
  roughness: number;
  metalness: number;
}

export interface SceneNode {
  id: string;
  name: string;
  kind: NodeKind;
  parentId: string | null;
  primitive: Primitive | null;
  assetId: string | null;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  materialLayers: Layer[];
  visible: boolean;
}

export interface StateOverride {
  nodeId: string;
  field: OverrideField;
  value: Vec3 | boolean;
}

export interface SceneState {
  id: string;
  name: string;
  overrides: StateOverride[];
}

export interface Transition {
  from: string;
  to: string;
  trigger: Trigger;
  durationMs: number;
}

export interface CameraView {
  name: string;
  position: Vec3;
  target: Vec3;
  fov: number;
}

export interface Graph {
  nodes: SceneNode[];
  states: SceneState[];
  transitions: Transition[];
  cameraViews: CameraView[];
}

export const REST_STATE_ID = 'rest';

export function cloneGraph(graph: Graph): Graph {
  return JSON.parse(JSON.stringify(graph)) as Graph;
}

export function findNode(graph: Graph, id: string): SceneNode | undefined {
  return graph.nodes.find((node) => node.id === id);
}

export function findState(graph: Graph, id: string): SceneState | undefined {
  return graph.states.find((state) => state.id === id);
}

/** Rounds to 4 decimals and returns the shortest JSON number for the value. */
function roundNumber(value: number): number {
  const rounded = Math.round(value * 10_000) / 10_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function canonicalValue(value: unknown): unknown {
  if (typeof value === 'number') return roundNumber(value);
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      out[key] = canonicalValue(source[key]);
    }
    return out;
  }
  return value;
}

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function canonicalGraphJson(graph: Graph): string {
  const canonical = {
    cameraViews: [...graph.cameraViews].sort((a, b) => byString(a.name, b.name)),
    nodes: [...graph.nodes].sort((a, b) => byString(a.id, b.id)),
    states: [...graph.states]
      .sort((a, b) => byString(a.id, b.id))
      .map((state) => ({
        ...state,
        overrides: [...state.overrides].sort(
          (a, b) => byString(a.nodeId, b.nodeId) || byString(a.field, b.field),
        ),
      })),
    transitions: [...graph.transitions].sort(
      (a, b) => byString(a.from, b.from) || byString(a.trigger, b.trigger),
    ),
  };
  return JSON.stringify(canonicalValue(canonical));
}

export function resolveNodeInState(node: SceneNode, state: SceneState | undefined): SceneNode {
  if (!state || state.id === REST_STATE_ID) return node;
  const resolved: SceneNode = { ...node };
  for (const override of state.overrides) {
    if (override.nodeId !== node.id) continue;
    if (override.field === 'visible') {
      resolved.visible = override.value as boolean;
    } else {
      resolved[override.field] = override.value as Vec3;
    }
  }
  return resolved;
}

export function transitionFor(graph: Graph, from: string, trigger: Trigger): Transition | undefined {
  return graph.transitions.find((t) => t.from === from && t.trigger === trigger);
}
