// The scene graph, its operations and their inverses. Server and browser both apply operations
// through this module, so a graph replayed anywhere hashes the same.
import { sha256Hex } from "./sha256.js";

export type Vec3 = [number, number, number];

const NODE_KINDS = ["group", "mesh", "camera", "light"] as const;
const PRIMITIVES = ["box", "sphere", "cylinder", "plane"] as const;
export const LAYER_TYPES = ["base", "clearcoat", "sheen", "emission"] as const;
export const OVERRIDE_FIELDS = ["position", "rotation", "scale", "visible"] as const;
const TRIGGERS = ["hover", "click", "scroll"] as const;
const OPERATION_TYPES = [
  "node.add", "node.remove", "node.rename", "node.reparent", "transform.set",
  "material.layer.add", "material.layer.set", "material.layer.remove",
  "state.add", "state.remove", "state.override.set", "transition.set", "camera.view.set",
] as const;

type NodeKind = (typeof NODE_KINDS)[number];
type Primitive = (typeof PRIMITIVES)[number];
export type LayerType = (typeof LAYER_TYPES)[number];
type OverrideField = (typeof OVERRIDE_FIELDS)[number];
export type Trigger = (typeof TRIGGERS)[number];
export type TransformField = "position" | "rotation" | "scale";

export const REST_STATE = "rest";
const MAX_LAYERS = 8;
const MAX_BATCH = 200;
const DURATION_MAX_MS = 2000;
const FOV_RANGE: readonly [number, number] = [10, 120];
export const TRANSFORM_RANGES: Readonly<Record<TransformField, readonly [number, number]>> = {
  position: [-1000, 1000],
  rotation: [-360, 360],
  scale: [0.001, 1000],
};

export interface Layer { id: string; type: LayerType; color: Vec3; roughness: number; metalness: number }
export interface SceneNode {
  id: string; name: string; kind: NodeKind; parentId: string | null; primitive: Primitive | null;
  assetId: string | null; position: Vec3; rotation: Vec3; scale: Vec3; materialLayers: Layer[]; visible: boolean;
}
type OverrideValue = Vec3 | boolean;
interface Override { nodeId: string; field: OverrideField; value: OverrideValue }
export interface State { id: string; name: string; overrides: Override[] }
interface Transition { from: string; to: string; trigger: Trigger; durationMs: number }
export interface CameraView { name: string; position: Vec3; target: Vec3; fov: number }
export interface Graph { nodes: SceneNode[]; states: State[]; transitions: Transition[]; cameraViews: CameraView[] }
interface NodeOverride { stateId: string; field: OverrideField; value: OverrideValue }

export type Operation =
  | { type: "node.add"; payload: { node: SceneNode; overrides?: NodeOverride[] } }
  | { type: "node.remove"; payload: { id: string } }
  | { type: "node.rename"; payload: { id: string; name: string } }
  | { type: "node.reparent"; payload: { id: string; parentId: string } }
  | { type: "transform.set"; payload: { id: string } & Partial<Record<TransformField, Vec3>> }
  | { type: "material.layer.add"; payload: { id: string; layer: Layer; index?: number } }
  | { type: "material.layer.set"; payload: { id: string; layerId: string; color?: Vec3; roughness?: number; metalness?: number } }
  | { type: "material.layer.remove"; payload: { id: string; layerId: string } }
  | { type: "state.add"; payload: { state: { id: string; name: string } } }
  | { type: "state.remove"; payload: { id: string } }
  | { type: "state.override.set"; payload: { stateId: string; nodeId: string; field: OverrideField; value: OverrideValue | null } }
  | { type: "transition.set"; payload: { from: string; to: string; trigger: Trigger; durationMs: number | null } }
  | { type: "camera.view.set"; payload: { name: string; position: Vec3 | null; target: Vec3; fov: number } };

export type FieldErrors = Record<string, string>;

const ID_PATTERN = /^[a-z0-9_-]{1,40}$/;
const ID_MESSAGE = "Use 1 to 40 lowercase letters, digits, _ or -";
const NAME_MESSAGE = "Use 1 to 80 characters";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function isName(value: unknown, max = 80): value is string {
  return typeof value === "string" && value.trim().length > 0 && [...value].length <= max;
}

function oneOf<T extends string>(choices: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (choices as readonly string[]).includes(value);
}

function rangeMessage(label: string, [min, max]: readonly [number, number]): string {
  return `${label} must be between ${min} and ${max}`;
}

const TRANSFORM_LABELS: Record<TransformField, string> = { position: "Position", rotation: "Rotation", scale: "Scale" };

/** Reads payload fields, writing an error under its path for each invalid one. */
class Reader {
  constructor(readonly errors: FieldErrors) {}

  fail(path: string, message: string): undefined {
    if (!(path in this.errors)) this.errors[path] = message;
    return undefined;
  }

  record(value: unknown, path: string): Record<string, unknown> | undefined {
    return isRecord(value) ? value : this.fail(path, "Must be an object");
  }

  id(value: unknown, path: string): string | undefined {
    return isId(value) ? value : this.fail(path, ID_MESSAGE);
  }

  name(value: unknown, path: string): string | undefined {
    return isName(value) ? value : this.fail(path, NAME_MESSAGE);
  }

  choice<T extends string>(choices: readonly T[], value: unknown, path: string): T | undefined {
    return oneOf(choices, value) ? value : this.fail(path, `Use one of: ${choices.join(", ")}`);
  }

  number(value: unknown, path: string, range: readonly [number, number], label: string): number | undefined {
    return isFiniteNumber(value) && value >= range[0] && value <= range[1] ? value : this.fail(path, rangeMessage(label, range));
  }

  vec3(value: unknown, path: string, range: readonly [number, number], label: string): Vec3 | undefined {
    if (Array.isArray(value) && value.length === 3 && value.every((n) => isFiniteNumber(n) && n >= range[0] && n <= range[1])) {
      return [value[0], value[1], value[2]];
    }
    return this.fail(path, rangeMessage(label, range));
  }

  boolean(value: unknown, path: string): boolean | undefined {
    return typeof value === "boolean" ? value : this.fail(path, "Must be true or false");
  }

  overrideValue(field: OverrideField, value: unknown, path: string): OverrideValue | undefined {
    return field === "visible" ? this.boolean(value, path) : this.vec3(value, path, TRANSFORM_RANGES[field], TRANSFORM_LABELS[field]);
  }

  layer(value: unknown, path: string): Layer | undefined {
    const raw = this.record(value, path);
    if (!raw) return undefined;
    const id = this.id(raw.id, `${path}.id`);
    const type = this.choice(LAYER_TYPES, raw.type, `${path}.type`);
    const color = this.vec3(raw.color, `${path}.color`, [0, 1], "Colour");
    const roughness = this.number(raw.roughness, `${path}.roughness`, [0, 1], "Roughness");
    const metalness = this.number(raw.metalness, `${path}.metalness`, [0, 1], "Metalness");
    if (id === undefined || type === undefined || color === undefined || roughness === undefined || metalness === undefined) return undefined;
    return { id, type, color, roughness, metalness };
  }

  node(value: unknown, path: string): SceneNode | undefined {
    const raw = this.record(value, path);
    if (!raw) return undefined;
    const id = this.id(raw.id, `${path}.id`);
    const name = this.name(raw.name, `${path}.name`);
    const kind = this.choice(NODE_KINDS, raw.kind, `${path}.kind`);
    const parentId = this.id(raw.parentId, `${path}.parentId`);
    const primitive = raw.primitive === null || raw.primitive === undefined ? null : this.choice(PRIMITIVES, raw.primitive, `${path}.primitive`);
    const assetId = raw.assetId === null || raw.assetId === undefined ? null
      : typeof raw.assetId === "string" && raw.assetId.length > 0 ? raw.assetId : this.fail(`${path}.assetId`, "Must be an asset ID");
    const position = this.vec3(raw.position, `${path}.position`, TRANSFORM_RANGES.position, "Position");
    const rotation = this.vec3(raw.rotation, `${path}.rotation`, TRANSFORM_RANGES.rotation, "Rotation");
    const scale = this.vec3(raw.scale, `${path}.scale`, TRANSFORM_RANGES.scale, "Scale");
    const visible = raw.visible === undefined ? true : this.boolean(raw.visible, `${path}.visible`);
    let materialLayers: Layer[] | undefined = [];
    if (raw.materialLayers !== undefined) {
      if (!Array.isArray(raw.materialLayers) || raw.materialLayers.length > MAX_LAYERS) {
        materialLayers = this.fail(`${path}.materialLayers`, `Use at most ${MAX_LAYERS} layers`);
      } else {
        const layers = raw.materialLayers.map((entry, i) => this.layer(entry, `${path}.materialLayers[${i}]`));
        materialLayers = layers.every((l): l is Layer => l !== undefined) ? layers : undefined;
        if (materialLayers && new Set(materialLayers.map((l) => l.id)).size !== materialLayers.length) {
          materialLayers = this.fail(`${path}.materialLayers`, "Layer IDs must be unique");
        }
      }
    }
    if (id === undefined || name === undefined || kind === undefined || parentId === undefined || primitive === undefined
      || assetId === undefined || position === undefined || rotation === undefined || scale === undefined
      || visible === undefined || materialLayers === undefined) return undefined;
    return { id, name, kind, parentId, primitive, assetId, position, rotation, scale, materialLayers, visible };
  }
}

/** Checks one operation's shape (types and ranges); semantic checks against the graph happen in apply. */
export function parseOperation(value: unknown, path: string, errors: FieldErrors): Operation | undefined {
  const read = new Reader(errors);
  const raw = read.record(value, path);
  if (!raw) return undefined;
  if (!oneOf(OPERATION_TYPES, raw.type)) {
    return read.fail(`${path}.type`, "Unknown operation");
  }
  const at = `${path}.payload`;
  const p = read.record(raw.payload, at);
  if (!p) return undefined;
  const before = Object.keys(errors).length;
  const done = <T extends Operation>(op: T): T | undefined => (Object.keys(errors).length === before ? op : undefined);
  switch (raw.type) {
    case "node.add": {
      const node = read.node(p.node, `${at}.node`);
      let overrides: NodeOverride[] | undefined;
      if (p.overrides !== undefined) {
        if (!Array.isArray(p.overrides)) return read.fail(`${at}.overrides`, "Must be a list");
        overrides = [];
        p.overrides.forEach((entry, i) => {
          const o = read.record(entry, `${at}.overrides[${i}]`);
          if (!o) return;
          const stateId = read.id(o.stateId, `${at}.overrides[${i}].stateId`);
          const field = read.choice(OVERRIDE_FIELDS, o.field, `${at}.overrides[${i}].field`);
          const v = field ? read.overrideValue(field, o.value, `${at}.overrides[${i}].value`) : undefined;
          if (stateId !== undefined && field !== undefined && v !== undefined) overrides?.push({ stateId, field, value: v });
        });
      }
      if (!node) return undefined;
      return done({ type: "node.add", payload: overrides === undefined ? { node } : { node, overrides } });
    }
    case "node.remove": {
      const id = read.id(p.id, `${at}.id`);
      return id === undefined ? undefined : { type: "node.remove", payload: { id } };
    }
    case "node.rename": {
      const id = read.id(p.id, `${at}.id`);
      const name = read.name(p.name, `${at}.name`);
      return id === undefined || name === undefined ? undefined : { type: "node.rename", payload: { id, name } };
    }
    case "node.reparent": {
      const id = read.id(p.id, `${at}.id`);
      const parentId = read.id(p.parentId, `${at}.parentId`);
      return id === undefined || parentId === undefined ? undefined : { type: "node.reparent", payload: { id, parentId } };
    }
    case "transform.set": {
      const id = read.id(p.id, `${at}.id`);
      const payload: { id: string } & Partial<Record<TransformField, Vec3>> = { id: id ?? "" };
      for (const field of ["position", "rotation", "scale"] as const) {
        if (p[field] === undefined) continue;
        const v = read.vec3(p[field], `${at}.${field}`, TRANSFORM_RANGES[field], TRANSFORM_LABELS[field]);
        if (v) payload[field] = v;
      }
      if (p.position === undefined && p.rotation === undefined && p.scale === undefined) {
        return read.fail(at, "Set at least one of position, rotation or scale");
      }
      return done({ type: "transform.set", payload });
    }
    case "material.layer.add": {
      const id = read.id(p.id, `${at}.id`);
      const layer = read.layer(p.layer, `${at}.layer`);
      const index = p.index === undefined ? undefined
        : Number.isInteger(p.index) && typeof p.index === "number" && p.index >= 0 ? p.index : read.fail(`${at}.index`, "Must be a whole number from 0");
      if (id === undefined || layer === undefined) return undefined;
      return done({ type: "material.layer.add", payload: index === undefined ? { id, layer } : { id, layer, index } });
    }
    case "material.layer.set": {
      const id = read.id(p.id, `${at}.id`);
      const layerId = read.id(p.layerId, `${at}.layerId`);
      const payload: Extract<Operation, { type: "material.layer.set" }>["payload"] = { id: id ?? "", layerId: layerId ?? "" };
      if (p.color !== undefined) { const c = read.vec3(p.color, `${at}.color`, [0, 1], "Colour"); if (c) payload.color = c; }
      if (p.roughness !== undefined) { const r = read.number(p.roughness, `${at}.roughness`, [0, 1], "Roughness"); if (r !== undefined) payload.roughness = r; }
      if (p.metalness !== undefined) { const m = read.number(p.metalness, `${at}.metalness`, [0, 1], "Metalness"); if (m !== undefined) payload.metalness = m; }
      if (p.color === undefined && p.roughness === undefined && p.metalness === undefined) {
        return read.fail(at, "Set at least one of color, roughness or metalness");
      }
      return done({ type: "material.layer.set", payload });
    }
    case "material.layer.remove": {
      const id = read.id(p.id, `${at}.id`);
      const layerId = read.id(p.layerId, `${at}.layerId`);
      return id === undefined || layerId === undefined ? undefined : { type: "material.layer.remove", payload: { id, layerId } };
    }
    case "state.add": {
      const s = read.record(p.state, `${at}.state`);
      if (!s) return undefined;
      const id = read.id(s.id, `${at}.state.id`);
      const name = read.name(s.name, `${at}.state.name`);
      return id === undefined || name === undefined ? undefined : { type: "state.add", payload: { state: { id, name } } };
    }
    case "state.remove": {
      const id = read.id(p.id, `${at}.id`);
      return id === undefined ? undefined : { type: "state.remove", payload: { id } };
    }
    case "state.override.set": {
      const stateId = read.id(p.stateId, `${at}.stateId`);
      const nodeId = read.id(p.nodeId, `${at}.nodeId`);
      const field = read.choice(OVERRIDE_FIELDS, p.field, `${at}.field`);
      const value = p.value === null ? null : field ? read.overrideValue(field, p.value, `${at}.value`) : undefined;
      if (stateId === undefined || nodeId === undefined || field === undefined || value === undefined) return undefined;
      return { type: "state.override.set", payload: { stateId, nodeId, field, value } };
    }
    case "transition.set": {
      const from = read.id(p.from, `${at}.from`);
      const to = read.id(p.to, `${at}.to`);
      const trigger = read.choice(TRIGGERS, p.trigger, `${at}.trigger`);
      const durationMs = p.durationMs === null ? null
        : Number.isInteger(p.durationMs) && typeof p.durationMs === "number" && p.durationMs >= 0 && p.durationMs <= DURATION_MAX_MS
          ? p.durationMs : read.fail(`${at}.durationMs`, rangeMessage("Duration", [0, DURATION_MAX_MS]));
      if (from === undefined || to === undefined || trigger === undefined || durationMs === undefined) return undefined;
      return { type: "transition.set", payload: { from, to, trigger, durationMs } };
    }
    case "camera.view.set": {
      const name = read.name(p.name, `${at}.name`);
      const position = p.position === null ? null : read.vec3(p.position, `${at}.position`, TRANSFORM_RANGES.position, "Position");
      const target = read.vec3(p.target, `${at}.target`, TRANSFORM_RANGES.position, "Target");
      const fov = read.number(p.fov, `${at}.fov`, FOV_RANGE, "Field of view");
      if (name === undefined || position === undefined || target === undefined || fov === undefined) return undefined;
      return { type: "camera.view.set", payload: { name, position, target, fov } };
    }
  }
}

/** Shape-checks a batch body `{ops:[...]}` (1 to 200 operations). */
export function parseBatch(body: unknown): { ops: Operation[] } | { errors: FieldErrors } {
  const errors: FieldErrors = {};
  if (!isRecord(body) || !Array.isArray(body.ops)) return { errors: { ops: "Send a list of operations" } };
  if (body.ops.length < 1 || body.ops.length > MAX_BATCH) return { errors: { ops: `Send 1 to ${MAX_BATCH} operations` } };
  const ops = body.ops.map((raw, i) => parseOperation(raw, `ops[${i}]`, errors));
  if (Object.keys(errors).length > 0) return { errors };
  return { ops: ops.filter((op): op is Operation => op !== undefined) };
}

/** Why an operation does not apply, naming the node or the state it concerns (at most one of them). */
export type ApplyFailure = { path: string; message: string; nodeId: string | null; stateId: string | null };
type ApplyResult = { ok: true; inverse: Operation } | ({ ok: false } & ApplyFailure);

const clone = <T>(value: T): T => structuredClone(value);
const findNode = (graph: Graph, id: string): SceneNode | undefined => graph.nodes.find((n) => n.id === id);
const findState = (graph: Graph, id: string): State | undefined => graph.states.find((s) => s.id === id);

function isDescendant(graph: Graph, candidate: string, ancestor: string): boolean {
  let current = findNode(graph, candidate);
  while (current) {
    if (current.id === ancestor) return true;
    current = current.parentId === null ? undefined : findNode(graph, current.parentId);
  }
  return false;
}

/** The node an operation names through `id` or `nodeId`, if any. */
export function namedNode(op: Operation): string | null {
  switch (op.type) {
    case "node.remove": case "node.rename": case "node.reparent": case "transform.set":
    case "material.layer.add": case "material.layer.set": case "material.layer.remove":
      return op.payload.id;
    case "node.add":
      return op.payload.node.id;
    case "state.override.set":
      return op.payload.nodeId;
    case "state.add": case "state.remove": case "transition.set": case "camera.view.set":
      return null;
  }
}

/** Nodes a batch must hold locks on: every existing node an operation names, in batch order. */
export function lockTargets(graph: Graph, ops: Operation[]): string[] {
  const targets: string[] = [];
  for (const op of ops) {
    if (op.type === "node.add") continue;
    const id = namedNode(op);
    if (id !== null && findNode(graph, id) && !targets.includes(id)) targets.push(id);
  }
  return targets;
}

/** Applies one operation in place and returns its exact inverse, or leaves the graph untouched and says why. */
export function applyOperation(graph: Graph, op: Operation, path = "payload"): ApplyResult {
  const fail = (field: string, message: string, nodeId: string | null = null, stateId: string | null = null): ApplyResult =>
    ({ ok: false, path: field ? `${path}.${field}` : path, message, nodeId, stateId });
  switch (op.type) {
    case "node.add": {
      const { node, overrides = [] } = op.payload;
      if (findNode(graph, node.id)) return fail("node.id", "ID is already used");
      if (node.parentId === null || !findNode(graph, node.parentId)) return fail("node.parentId", "Parent does not exist", node.parentId);
      for (const [i, o] of overrides.entries()) {
        if (o.stateId === REST_STATE || !findState(graph, o.stateId)) return fail(`overrides[${i}].stateId`, "State does not exist", null, o.stateId);
      }
      graph.nodes.push(clone(node));
      for (const o of overrides) findState(graph, o.stateId)?.overrides.push({ nodeId: node.id, field: o.field, value: clone(o.value) });
      return { ok: true, inverse: { type: "node.remove", payload: { id: node.id } } };
    }
    case "node.remove": {
      const node = findNode(graph, op.payload.id);
      if (!node) return fail("id", "Node does not exist", op.payload.id);
      if (node.parentId === null) return fail("id", "The root cannot be removed");
      if (graph.nodes.some((n) => n.parentId === node.id)) return fail("id", "Remove its children first");
      const overrides: NodeOverride[] = [];
      for (const state of graph.states) {
        for (const o of state.overrides) if (o.nodeId === node.id) overrides.push({ stateId: state.id, field: o.field, value: clone(o.value) });
        state.overrides = state.overrides.filter((o) => o.nodeId !== node.id);
      }
      graph.nodes = graph.nodes.filter((n) => n.id !== node.id);
      return { ok: true, inverse: { type: "node.add", payload: { node: clone(node), overrides } } };
    }
    case "node.rename": {
      const node = findNode(graph, op.payload.id);
      if (!node) return fail("id", "Node does not exist", op.payload.id);
      const name = node.name;
      node.name = op.payload.name;
      return { ok: true, inverse: { type: "node.rename", payload: { id: node.id, name } } };
    }
    case "node.reparent": {
      const node = findNode(graph, op.payload.id);
      if (!node) return fail("id", "Node does not exist", op.payload.id);
      if (node.parentId === null) return fail("id", "The root cannot be moved");
      if (!findNode(graph, op.payload.parentId)) return fail("parentId", "Parent does not exist", op.payload.parentId);
      if (isDescendant(graph, op.payload.parentId, node.id)) return fail("parentId", "A node cannot move under itself");
      const parentId = node.parentId;
      node.parentId = op.payload.parentId;
      return { ok: true, inverse: { type: "node.reparent", payload: { id: node.id, parentId } } };
    }
    case "transform.set": {
      const node = findNode(graph, op.payload.id);
      if (!node) return fail("id", "Node does not exist", op.payload.id);
      const inverse: { id: string } & Partial<Record<TransformField, Vec3>> = { id: node.id };
      for (const field of ["position", "rotation", "scale"] as const) {
        const next = op.payload[field];
        if (!next) continue;
        inverse[field] = [...node[field]];
        node[field] = [...next];
      }
      return { ok: true, inverse: { type: "transform.set", payload: inverse } };
    }
    case "material.layer.add": {
      const node = findNode(graph, op.payload.id);
      if (!node) return fail("id", "Node does not exist", op.payload.id);
      if (node.materialLayers.length >= MAX_LAYERS) return fail("layer", `A node has at most ${MAX_LAYERS} layers`);
      if (node.materialLayers.some((l) => l.id === op.payload.layer.id)) return fail("layer.id", "Layer ID is already used");
      const index = op.payload.index ?? node.materialLayers.length;
      if (index > node.materialLayers.length) return fail("index", "Index is past the end of the layer list");
      node.materialLayers.splice(index, 0, clone(op.payload.layer));
      return { ok: true, inverse: { type: "material.layer.remove", payload: { id: node.id, layerId: op.payload.layer.id } } };
    }
    case "material.layer.set": {
      const node = findNode(graph, op.payload.id);
      if (!node) return fail("id", "Node does not exist", op.payload.id);
      const layer = node.materialLayers.find((l) => l.id === op.payload.layerId);
      if (!layer) return fail("layerId", "Layer does not exist", node.id);
      const inverse: Extract<Operation, { type: "material.layer.set" }>["payload"] = { id: node.id, layerId: layer.id };
      if (op.payload.color) { inverse.color = [...layer.color]; layer.color = [...op.payload.color]; }
      if (op.payload.roughness !== undefined) { inverse.roughness = layer.roughness; layer.roughness = op.payload.roughness; }
      if (op.payload.metalness !== undefined) { inverse.metalness = layer.metalness; layer.metalness = op.payload.metalness; }
      return { ok: true, inverse: { type: "material.layer.set", payload: inverse } };
    }
    case "material.layer.remove": {
      const node = findNode(graph, op.payload.id);
      if (!node) return fail("id", "Node does not exist", op.payload.id);
      const index = node.materialLayers.findIndex((l) => l.id === op.payload.layerId);
      if (index < 0) return fail("layerId", "Layer does not exist", node.id);
      const [layer] = node.materialLayers.splice(index, 1);
      return { ok: true, inverse: { type: "material.layer.add", payload: { id: node.id, layer, index } } };
    }
    case "state.add": {
      const { id, name } = op.payload.state;
      if (id === REST_STATE || findState(graph, id)) return fail("state.id", "State ID is already used", null, id);
      graph.states.push({ id, name, overrides: [] });
      return { ok: true, inverse: { type: "state.remove", payload: { id } } };
    }
    case "state.remove": {
      const { id } = op.payload;
      const state = findState(graph, id);
      if (!state || id === REST_STATE) return fail("id", "State does not exist or is Rest", null, id);
      if (state.overrides.length > 0 || graph.transitions.some((t) => t.from === id || t.to === id)) {
        return fail("id", "A state override or transition still names this state", null, id);
      }
      graph.states = graph.states.filter((s) => s.id !== id);
      return { ok: true, inverse: { type: "state.add", payload: { state: { id, name: state.name } } } };
    }
    case "state.override.set": {
      const { stateId, nodeId, field, value } = op.payload;
      const state = findState(graph, stateId);
      if (!state || stateId === REST_STATE) return fail("stateId", "State does not exist or is Rest", null, stateId);
      if (!findNode(graph, nodeId)) return fail("nodeId", "Node does not exist", nodeId);
      const existing = state.overrides.find((o) => o.nodeId === nodeId && o.field === field);
      const previous = existing ? clone(existing.value) : null;
      state.overrides = state.overrides.filter((o) => o !== existing);
      if (value !== null) state.overrides.push({ nodeId, field, value: clone(value) });
      return { ok: true, inverse: { type: "state.override.set", payload: { stateId, nodeId, field, value: previous } } };
    }
    case "transition.set": {
      const { from, to, trigger, durationMs } = op.payload;
      if (!findState(graph, from)) return fail("from", "State does not exist", null, from);
      if (!findState(graph, to)) return fail("to", "State does not exist", null, to);
      if (from === to) return fail("to", "A transition joins two different states");
      const existing = graph.transitions.find((t) => t.from === from && t.trigger === trigger);
      graph.transitions = graph.transitions.filter((t) => t !== existing);
      if (durationMs !== null) graph.transitions.push({ from, to, trigger, durationMs });
      const inverse = existing
        ? { from, to: existing.to, trigger, durationMs: existing.durationMs }
        : { from, to, trigger, durationMs: null };
      return { ok: true, inverse: { type: "transition.set", payload: inverse } };
    }
    case "camera.view.set": {
      const { name, position, target, fov } = op.payload;
      const existing = graph.cameraViews.find((v) => v.name === name);
      graph.cameraViews = graph.cameraViews.filter((v) => v !== existing);
      if (position !== null) graph.cameraViews.push({ name, position: [...position], target: [...target], fov });
      const inverse = existing ? clone(existing) : { name, position: null, target: [target[0], target[1], target[2]] satisfies Vec3, fov };
      return { ok: true, inverse: { type: "camera.view.set", payload: inverse } };
    }
  }
}

/** Replays operations over a copy of the base graph. */
export function replay(base: Graph, ops: readonly Operation[]): Graph {
  const graph = clone(base);
  for (const op of ops) applyOperation(graph, op);
  return graph;
}

function compareCodePoints(a: string, b: string): number {
  const x = [...a].map((c) => c.codePointAt(0) ?? 0);
  const y = [...b].map((c) => c.codePointAt(0) ?? 0);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}

function canonicalNumber(value: number): string {
  const rounded = Number(value.toFixed(4));
  return String(rounded === 0 ? 0 : rounded);
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return canonicalNumber(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort(compareCodePoints).map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return "null";
}

/** Lowercase hex SHA-256 of the canonical serialisation set out under Hash in the brief. */
export function graphHash(graph: Graph): string {
  const by = <T>(key: (item: T) => string[]) => (a: T, b: T) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) { const c = compareCodePoints(ka[i], kb[i]); if (c !== 0) return c; }
    return 0;
  };
  const sorted = {
    nodes: [...graph.nodes].sort(by((n) => [n.id])),
    states: graph.states
      .map((s) => ({ ...s, overrides: [...s.overrides].sort(by((o) => [o.nodeId, o.field])) }))
      .sort(by((s) => [s.id])),
    transitions: [...graph.transitions].sort(by((t) => [t.from, t.trigger])),
    cameraViews: [...graph.cameraViews].sort(by((c) => [c.name])),
  };
  return sha256Hex(canonical(sorted));
}

/** The graph every new scene starts from: a root group, a camera and a key light. */
export function starterGraph(): Graph {
  const unit: Vec3 = [1, 1, 1];
  const base = { primitive: null, assetId: null, scale: unit, materialLayers: [], visible: true };
  return {
    nodes: [
      { ...base, id: "n_root", name: "Scene", kind: "group", parentId: null, position: [0, 0, 0], rotation: [0, 0, 0] },
      { ...base, id: "n_cam", name: "Main camera", kind: "camera", parentId: "n_root", position: [0, 1.2, 4], rotation: [-15, 0, 0] },
      { ...base, id: "n_key", name: "Key light", kind: "light", parentId: "n_root", position: [2, 3, 2], rotation: [0, 0, 0] },
    ],
    states: [{ id: REST_STATE, name: "Rest", overrides: [] }],
    transitions: [],
    cameraViews: [],
  };
}

/** A node's transform fields with a state's overrides applied (Rest is the base graph). */
export function resolvedNode(graph: Graph, node: SceneNode, stateId: string): SceneNode {
  const state = findState(graph, stateId);
  if (!state || stateId === REST_STATE) return node;
  const resolved = { ...node };
  for (const o of state.overrides) {
    if (o.nodeId !== node.id) continue;
    if (o.field === "visible") resolved.visible = o.value === true;
    else if (Array.isArray(o.value)) resolved[o.field] = o.value;
  }
  return resolved;
}
