import { roundBpm, TICK_LIMIT } from "./beat.ts";
import {
  defaultParams, isBuiltIn, LFO_RATE_RANGE, LFO_SHAPES, portsOf, wireRefusal,
} from "./graph.ts";
import {
  BUS_LABELS, createLayer, descendantsOf, isKeyable, KEYABLE_PROPERTIES, KINDS_WITH_BUSES, propertyLabel,
  rangeMessage, readLayerValue, TINT_RANGE, treeOrder,
} from "./layers.ts";
import type { Fields } from "./schema.ts";
import { STARTER_SHADER } from "./starter.ts";
import { isRecord } from "./schema.ts";
import type {
  AssetKind, AssetStatus, GraphNode, KeyDoc, LayerDoc, OpInput, OutputBus, ScriptDoc, SetDocument, Vec3,
} from "./types.ts";
import { LAYER_KINDS, OUTPUT_BUSES } from "./types.ts";

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCE_LIMIT_BYTES = 100_000;
const LAYER_NAME_MAX = 60;
const SET_NAME_MAX = 80;
const BPM_RANGE = { min: 40, max: 240 };

export class Invalid extends Error {
  readonly fields: Fields;
  constructor(fields: Fields) {
    super(Object.values(fields)[0] ?? "Invalid");
    this.fields = fields;
  }
}

export class TargetMissing extends Error {}

function invalid(field: string, message: string): never {
  throw new Invalid({ [field]: message });
}

export interface OpEnv {
  /** Remote ops were already validated by the server; a browser applying them skips the asset lookups. */
  trusted?: boolean;
  assets: ReadonlyMap<string, { kind: AssetKind; status: AssetStatus }>;
  shaderSource: (layerId: string, number: number) => string | undefined;
}

interface ShaderSave {
  layer_id: string;
  number: number;
  source: string | undefined;
  restored_from: number | null;
}

export interface Effects {
  layersUpserted: LayerDoc[];
  layersRemoved: string[];
  keysUpserted: KeyDoc[];
  keysRemoved: { layer_id: string; property: string; tick: number }[];
  scriptsUpserted: ScriptDoc[];
  scriptsRemoved: string[];
  settingsChanged: boolean;
  graphChanged: boolean;
  shaderSave: ShaderSave | null;
  freedLocks: string[];
  summary: string;
  /** The target's version once the op is applied; a removed target reports the version its removal would have made. */
  version: number;
}

function emptyEffects(summary: string): Effects {
  return {
    layersUpserted: [], layersRemoved: [], keysUpserted: [], keysRemoved: [], scriptsUpserted: [],
    scriptsRemoved: [], settingsChanged: false, graphChanged: false, shaderSave: null, freedLocks: [], summary, version: 0,
  };
}

type VersionedTarget =
  | { kind: "layer"; layer: LayerDoc }
  | { kind: "script"; script: ScriptDoc }
  | { kind: "set" }
  | { kind: "graph" };

const ADD_TYPES: readonly string[] = ["layer.add", "script.add", "graph.node.add", "graph.wire.add"];

export function needsBaseVersion(type: OpInput["type"]): boolean {
  return !ADD_TYPES.includes(type);
}

export function resolveTarget(doc: SetDocument, op: OpInput): VersionedTarget | null {
  const family = op.type.split(".")[0];
  if (family === "set") return { kind: "set" };
  if (family === "graph") return { kind: "graph" };
  if (family === "script") {
    const script = doc.scripts.find((candidate) => candidate.id === op.target);
    return script ? { kind: "script", script } : null;
  }
  const layer = doc.layers.find((candidate) => candidate.id === op.target);
  return layer ? { kind: "layer", layer } : null;
}

export function versionOf(doc: SetDocument, target: VersionedTarget): number {
  switch (target.kind) {
    case "layer": return target.layer.version;
    case "script": return target.script.version;
    case "set": return doc.set.settings_version;
    case "graph": return doc.graph.version;
  }
}

export function stateOf(doc: SetDocument, target: VersionedTarget): unknown {
  switch (target.kind) {
    case "layer": return target.layer;
    case "script": return target.script;
    case "set": return { name: doc.set.name, bpm: doc.set.bpm, active_camera_id: doc.set.active_camera_id };
    case "graph": return doc.graph;
  }
}

export function isTargetTaken(doc: SetDocument, op: OpInput): boolean {
  if (op.type === "layer.add") return doc.layers.some((layer) => layer.id === op.target);
  if (op.type === "script.add") return doc.scripts.some((script) => script.id === op.target);
  return false;
}

export function targetSuits(op: OpInput): boolean {
  const family = op.type.split(".")[0];
  if (family === "set") return op.target === "set";
  if (family === "graph") return op.target === "graph";
  return op.target !== "set" && op.target !== "graph";
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

function parseName(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") return invalid(field, `Name must be 1 to ${max} characters`);
  const name = value.trim();
  if (name.length < 1 || [...name].length > max) return invalid(field, `Name must be 1 to ${max} characters`);
  return name;
}

function parseSource(value: unknown): string {
  if (typeof value !== "string") return invalid("source", "Source must be text");
  if (utf8Length(value) > SOURCE_LIMIT_BYTES) return invalid("source", `Source must be at most ${SOURCE_LIMIT_BYTES} bytes`);
  return value;
}

function parseVec3(value: unknown, label: string, min: number, max: number): Vec3 {
  const message = rangeMessage(label, min, max);
  if (!Array.isArray(value) || value.length !== 3) return invalid("value", message);
  const parts = value.map((part) => (typeof part === "number" && Number.isFinite(part) && part >= min && part <= max ? part : null));
  const [x, y, z] = parts;
  if (x == null || y == null || z == null) return invalid("value", message);
  return [x, y, z];
}

function parseNumber(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    return invalid("value", rangeMessage(label, min, max));
  }
  return value;
}

function boundAsset(env: OpEnv, id: unknown, kind: AssetKind, field: string): string | null {
  if (id === null) return null;
  if (env.trusted && typeof id === "string") return id;
  const asset = typeof id === "string" ? env.assets.get(id) : undefined;
  if (!asset || asset.status !== "ready" || asset.kind !== kind) return invalid(field, `Choose a ready ${kind}`);
  return typeof id === "string" ? id : null;
}

function siblingsOf(doc: SetDocument, parentId: string | null, except: string | null): LayerDoc[] {
  return doc.layers
    .filter((layer) => layer.parent_id === parentId && layer.id !== except)
    .sort((a, b) => a.index - b.index);
}

function parseIndex(value: unknown, count: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > count) {
    return invalid("index", `Index must be a whole number from 0 to ${count}`);
  }
  return value;
}

function parseParent(doc: SetDocument, value: unknown): string | null {
  if (value === null) return null;
  const parent = typeof value === "string" ? doc.layers.find((layer) => layer.id === value) : undefined;
  return parent ? parent.id : invalid("parent_id", "Parent layer not found");
}

function renumber(layers: LayerDoc[], touched: Map<string, LayerDoc>): void {
  for (const [index, layer] of layers.entries()) {
    if (layer.index !== index) {
      layer.index = index;
      touched.set(layer.id, layer);
    }
  }
}

function describeValue(value: unknown): string {
  if (typeof value === "number") return value.toFixed(3);
  if (Array.isArray(value)) return value.map((part) => describeValue(part)).join(", ");
  return String(value);
}

const VECTOR_LABELS = { position: "Position", rotation: "Rotation", scale: "Scale" } as const;

function isVectorGroup(group: string | undefined): group is keyof typeof VECTOR_LABELS {
  return group === "position" || group === "rotation" || group === "scale";
}

function layerSet(layer: LayerDoc, payload: Record<string, unknown>, env: OpEnv): Effects {
  const path = payload["path"];
  const value = payload["value"];
  if (typeof path !== "string") return invalid("path", "Path is required");
  const [group, axis] = path.split(".");
  if (path === "name") {
    layer.name = parseName(value, "value", LAYER_NAME_MAX);
  } else if (path === "visible") {
    if (typeof value !== "boolean") return invalid("value", "Visible must be true or false");
    layer.visible = value;
  } else if (isVectorGroup(path)) {
    const [min, max] = path === "scale" ? [0.001, 1000] : [-10_000, 10_000];
    layer[path] = parseVec3(value, VECTOR_LABELS[path], min, max);
  } else if (isVectorGroup(group) && (axis === "x" || axis === "y" || axis === "z")) {
    const spec = KEYABLE_PROPERTIES[path];
    if (!spec) return invalid("path", "Unknown path");
    layer[group][axis === "x" ? 0 : axis === "y" ? 1 : 2] = parseNumber(value, spec.label, spec.min, spec.max);
  } else if (group === "props" && axis !== undefined) {
    if (!(axis in layer.props) || !isKeyable(path)) return invalid("path", "This layer has no such property");
    layer.props[axis] = parseProp(layer, axis, path, value);
  } else if (path === "material.tint") {
    if (!layer.material) return invalid("path", "This layer has no material");
    layer.material.tint = parseVec3(value, "Tint", TINT_RANGE.min, TINT_RANGE.max);
  } else if (path === "material.tint_alpha") {
    if (!layer.material) return invalid("path", "This layer has no material");
    layer.material.tint_alpha = parseNumber(value, "Tint alpha", TINT_RANGE.min, TINT_RANGE.max);
  } else if (path === "material.albedo_texture_id" || path === "material.emissive_texture_id") {
    if (!layer.material) return invalid("path", "This layer has no material");
    const slot = path === "material.albedo_texture_id" ? "albedo_texture_id" : "emissive_texture_id";
    layer.material[slot] = boundAsset(env, value, "texture", "value");
  } else if (path === "model_asset_id") {
    if (layer.kind !== "model") return invalid("path", "Only model layers carry a model");
    layer.model_asset_id = boundAsset(env, value, "model", "value");
  } else if (path === "output_buses") {
    if (!KINDS_WITH_BUSES.includes(layer.kind)) return invalid("path", "This layer has no output buses");
    layer.output_buses = parseBuses(value);
  } else {
    return invalid("path", "Unknown path");
  }
  const label = path === "name" ? "name" : propertyLabel(path);
  const effects = emptyEffects(`Set ${label} on ${layer.name} to ${describeValue(value)}`);
  effects.layersUpserted.push(layer);
  return effects;
}

function parseProp(layer: LayerDoc, key: string, path: string, value: unknown): number {
  const spec = KEYABLE_PROPERTIES[path];
  if (!spec) return invalid("path", "Unknown path");
  if (key === "far") {
    const near = layer.props["near"] ?? 0;
    const far = parseNumber(value, spec.label, 0, spec.max);
    if (far <= near) return invalid("value", `Far plane must be greater than the near plane and at most ${spec.max}`);
    return far;
  }
  const number = parseNumber(value, spec.label, spec.min, spec.max);
  if (key === "near" && number >= (layer.props["far"] ?? Infinity)) {
    return invalid("value", "Near plane must be less than the far plane");
  }
  return number;
}

function parseBuses(value: unknown): OutputBus[] {
  const message = `Choose at least one of ${OUTPUT_BUSES.map((bus) => BUS_LABELS[bus]).join(", ")}`;
  if (!Array.isArray(value)) return invalid("value", message);
  const chosen = OUTPUT_BUSES.filter((bus) => value.includes(bus));
  if (chosen.length === 0 || chosen.length !== new Set(value).size) return invalid("value", message);
  return chosen;
}

function layerAdd(doc: SetDocument, op: OpInput): Effects {
  const { parent_id: parentRaw, index: indexRaw, name: nameRaw, kind } = op.payload;
  if (!UUID_PATTERN.test(op.target)) return invalid("target", "Target must be a new layer id");
  const parent = parseParent(doc, parentRaw);
  const siblings = siblingsOf(doc, parent, null);
  const index = parseIndex(indexRaw, siblings.length);
  const name = parseName(nameRaw, "name", LAYER_NAME_MAX);
  const layerKind = LAYER_KINDS.find((candidate) => candidate === kind);
  if (!layerKind) return invalid("kind", "Unknown layer kind");
  const touched = new Map<string, LayerDoc>();
  const layer = createLayer({ id: op.target, parent_id: parent, index, name, kind: layerKind });
  siblings.splice(index, 0, layer);
  renumber(siblings, touched);
  doc.layers.push(layer);
  touched.set(layer.id, layer);
  const effects = emptyEffects(`Added ${name}`);
  effects.layersUpserted.push(...touched.values());
  if (layerKind === "shader") effects.shaderSave = { layer_id: layer.id, number: 1, source: STARTER_SHADER, restored_from: null };
  return effects;
}

function layerReparent(doc: SetDocument, layer: LayerDoc, payload: Record<string, unknown>): Effects {
  const parent = parseParent(doc, payload["parent_id"]);
  if (parent !== null && (parent === layer.id || descendantsOf(doc.layers, layer.id).some((child) => child.id === parent))) {
    return invalid("parent_id", "A layer cannot be its own ancestor");
  }
  const destination = siblingsOf(doc, parent, layer.id);
  const index = parseIndex(payload["index"], destination.length);
  const touched = new Map<string, LayerDoc>();
  const origin = siblingsOf(doc, layer.parent_id, layer.id);
  layer.parent_id = parent;
  renumber(origin, touched);
  destination.splice(index, 0, layer);
  renumber(destination, touched);
  layer.index = index;
  touched.set(layer.id, layer);
  const effects = emptyEffects(`Moved ${layer.name}`);
  effects.layersUpserted.push(...touched.values());
  return effects;
}

function layerRemove(doc: SetDocument, layer: LayerDoc): Effects {
  const removed = new Set([layer.id, ...descendantsOf(doc.layers, layer.id).map((child) => child.id)]);
  const touched = new Map<string, LayerDoc>();
  doc.layers = doc.layers.filter((candidate) => !removed.has(candidate.id));
  renumber(siblingsOf(doc, layer.parent_id, null), touched);
  const effects = emptyEffects(`Removed ${layer.name}`);
  effects.layersUpserted.push(...touched.values());
  effects.layersRemoved.push(...removed);
  effects.freedLocks.push(...removed);
  for (const key of doc.keys.filter((candidate) => removed.has(candidate.layer_id))) {
    effects.keysRemoved.push({ layer_id: key.layer_id, property: key.property, tick: key.tick });
  }
  doc.keys = doc.keys.filter((candidate) => !removed.has(candidate.layer_id));
  const doomed = doc.graph.nodes.filter(
    (node) => node.type === "Layer property" && typeof node.params["layer_id"] === "string" && removed.has(node.params["layer_id"]),
  );
  if (doomed.length > 0) {
    const ids = new Set(doomed.map((node) => node.node_id));
    doc.graph.nodes = doc.graph.nodes.filter((node) => !ids.has(node.node_id));
    doc.graph.wires = doc.graph.wires.filter((wire) => !ids.has(wire.from.node_id) && !ids.has(wire.to.node_id));
    effects.graphChanged = true;
  }
  if (doc.set.active_camera_id !== null && removed.has(doc.set.active_camera_id)) {
    const next = treeOrder(doc.layers).find((candidate) => candidate.kind === "camera");
    doc.set.active_camera_id = next ? next.id : null;
    effects.settingsChanged = true;
  }
  return effects;
}

function shaderSave(layer: LayerDoc, payload: Record<string, unknown>): Effects {
  if (layer.kind !== "shader") return invalid("target", "Only shader layers carry a shader");
  const source = parseSource(payload["source"]);
  const number = (layer.shader_version ?? 0) + 1;
  layer.shader_version = number;
  const effects = emptyEffects(`Saved shader version ${number} on ${layer.name}`);
  effects.layersUpserted.push(layer);
  effects.shaderSave = { layer_id: layer.id, number, source, restored_from: null };
  return effects;
}

function shaderRestore(layer: LayerDoc, payload: Record<string, unknown>, env: OpEnv): Effects {
  if (layer.kind !== "shader") return invalid("target", "Only shader layers carry a shader");
  const from = payload["from_version"];
  const latest = layer.shader_version ?? 0;
  if (typeof from !== "number" || !Number.isInteger(from) || from < 1 || from > latest) {
    return invalid("from_version", "Choose an existing shader version");
  }
  const number = latest + 1;
  layer.shader_version = number;
  const effects = emptyEffects(`Restored shader version ${from} on ${layer.name}`);
  effects.layersUpserted.push(layer);
  effects.shaderSave = { layer_id: layer.id, number, source: env.shaderSource(layer.id, from), restored_from: from };
  return effects;
}

function keySet(doc: SetDocument, layer: LayerDoc, payload: Record<string, unknown>): Effects {
  const property = payload["property"];
  const tick = payload["tick"];
  const spec = typeof property === "string" ? KEYABLE_PROPERTIES[property] : undefined;
  if (typeof property !== "string" || !spec || readLayerValue(layer, property) === undefined) {
    return invalid("property", "This layer has no such keyable property");
  }
  if (typeof tick !== "number" || !Number.isInteger(tick) || tick < 0 || tick >= TICK_LIMIT) {
    return invalid("tick", `Tick must be a whole number from 0 to ${TICK_LIMIT - 1}`);
  }
  const value = parseNumber(payload["value"], spec.label, spec.min, spec.max);
  const existing = doc.keys.find((key) => key.layer_id === layer.id && key.property === property && key.tick === tick);
  const key: KeyDoc = existing ?? { layer_id: layer.id, property, tick, value };
  key.value = value;
  if (!existing) doc.keys.push(key);
  const effects = emptyEffects(`Keyed ${propertyLabel(property)} on ${layer.name} at tick ${tick}`);
  effects.layersUpserted.push(layer);
  effects.keysUpserted.push(key);
  return effects;
}

function keyRemove(doc: SetDocument, layer: LayerDoc, payload: Record<string, unknown>): Effects {
  const { property, tick } = payload;
  const index = doc.keys.findIndex((key) => key.layer_id === layer.id && key.property === property && key.tick === tick);
  const found = doc.keys[index];
  if (!found) return invalid("tick", "There is no key at this tick");
  doc.keys.splice(index, 1);
  const effects = emptyEffects(`Removed ${propertyLabel(found.property)} key on ${layer.name} at tick ${found.tick}`);
  effects.layersUpserted.push(layer);
  effects.keysRemoved.push({ layer_id: layer.id, property: found.property, tick: found.tick });
  return effects;
}

function setUpdate(doc: SetDocument, payload: Record<string, unknown>): Effects {
  const touched: string[] = [];
  if ("name" in payload) {
    doc.set.name = parseName(payload["name"], "name", SET_NAME_MAX);
    touched.push("name");
  }
  if ("bpm" in payload) {
    const bpm = payload["bpm"];
    if (typeof bpm !== "number" || !Number.isFinite(bpm) || bpm < BPM_RANGE.min || bpm > BPM_RANGE.max || roundBpm(bpm) !== bpm) {
      return invalid("bpm", `BPM must be from ${BPM_RANGE.min} to ${BPM_RANGE.max} with at most one decimal place`);
    }
    doc.set.bpm = bpm;
    touched.push("BPM");
  }
  if ("active_camera_id" in payload) {
    const id = payload["active_camera_id"];
    const camera = doc.layers.find((layer) => layer.id === id && layer.kind === "camera");
    if (!camera) return invalid("active_camera_id", "Choose a camera layer in this set");
    doc.set.active_camera_id = camera.id;
    touched.push("active camera");
  }
  if (touched.length === 0) return invalid("name", "Nothing to update");
  const effects = emptyEffects(`Changed ${touched.join(" and ")}`);
  effects.settingsChanged = true;
  return effects;
}

function parseCoordinate(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 100_000) {
    return invalid(field, "Position must be a number");
  }
  return value;
}

function parseNodeParams(doc: SetDocument, type: string, params: unknown, base: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(params)) return invalid("params", "Params must be an object");
  const merged = { ...base, ...params };
  if (type === "LFO") {
    const rate = merged["rate_beats"];
    if (!LFO_SHAPES.some((shape) => shape === merged["shape"])) return invalid("params", `Shape must be one of ${LFO_SHAPES.join(", ")}`);
    if (typeof rate !== "number" || rate < LFO_RATE_RANGE.min || rate > LFO_RATE_RANGE.max) {
      return invalid("params", rangeMessage("Rate", LFO_RATE_RANGE.min, LFO_RATE_RANGE.max));
    }
  } else if (type === "Remap") {
    for (const key of ["in_min", "in_max", "out_min", "out_max"]) {
      if (typeof merged[key] !== "number" || !Number.isFinite(merged[key])) return invalid("params", "Remap limits must be numbers");
    }
  } else if (type === "Layer property") {
    const layerId = merged["layer_id"];
    const property = merged["property"];
    if (layerId !== null && !doc.layers.some((layer) => layer.id === layerId)) return invalid("params", "Choose a layer in this set");
    if (property !== null && (typeof property !== "string" || !isKeyable(property))) return invalid("params", "Choose a keyable property");
  } else if (!isBuiltIn(type)) {
    const ports = portsOf({ type, params: merged });
    if (ports.inputs.length + ports.outputs.length === 0 && !("inputs" in merged || "outputs" in merged)) {
      return invalid("params", "Plugin nodes carry their inputs and outputs");
    }
  }
  return merged;
}

function graphNodeAdd(doc: SetDocument, payload: Record<string, unknown>): Effects {
  const nodeId = payload["node_id"];
  const type = payload["type"];
  if (typeof nodeId !== "string" || nodeId.length < 8 || nodeId.length > 64) return invalid("node_id", "Node id is required");
  if (doc.graph.nodes.some((node) => node.node_id === nodeId)) return invalid("node_id", "Node id is already used");
  if (typeof type !== "string" || type.length < 1 || [...type].length > 40) return invalid("type", "Node type must be 1 to 40 characters");
  const node: GraphNode = {
    node_id: nodeId,
    type,
    params: parseNodeParams(doc, type, payload["params"] ?? {}, defaultParams(type)),
    x: parseCoordinate(payload["x"] ?? 0, "x"),
    y: parseCoordinate(payload["y"] ?? 0, "y"),
  };
  doc.graph.nodes.push(node);
  const effects = emptyEffects(`Added ${type} node`);
  effects.graphChanged = true;
  return effects;
}

function graphNodeUpdate(doc: SetDocument, payload: Record<string, unknown>): Effects {
  const node = doc.graph.nodes.find((candidate) => candidate.node_id === payload["node_id"]);
  if (!node) return invalid("node_id", "Node not found");
  if ("params" in payload) node.params = parseNodeParams(doc, node.type, payload["params"], node.params);
  if ("x" in payload) node.x = parseCoordinate(payload["x"], "x");
  if ("y" in payload) node.y = parseCoordinate(payload["y"], "y");
  const effects = emptyEffects(`Changed ${node.type} node`);
  effects.graphChanged = true;
  return effects;
}

function graphNodeRemove(doc: SetDocument, payload: Record<string, unknown>): Effects {
  const node = doc.graph.nodes.find((candidate) => candidate.node_id === payload["node_id"]);
  if (!node) return invalid("node_id", "Node not found");
  doc.graph.nodes = doc.graph.nodes.filter((candidate) => candidate !== node);
  doc.graph.wires = doc.graph.wires.filter((wire) => wire.from.node_id !== node.node_id && wire.to.node_id !== node.node_id);
  const effects = emptyEffects(`Removed ${node.type} node`);
  effects.graphChanged = true;
  return effects;
}

function parseEnd(value: unknown, field: string): { node_id: string; port: string } {
  if (!isRecord(value) || typeof value["node_id"] !== "string" || typeof value["port"] !== "string") {
    return invalid(field, "Wire ends need a node and a port");
  }
  return { node_id: value["node_id"], port: value["port"] };
}

function graphWireAdd(doc: SetDocument, payload: Record<string, unknown>): Effects {
  const wireId = payload["wire_id"];
  if (typeof wireId !== "string" || wireId.length < 8 || wireId.length > 64) return invalid("wire_id", "Wire id is required");
  if (doc.graph.wires.some((wire) => wire.wire_id === wireId)) return invalid("wire_id", "Wire id is already used");
  const wire = { wire_id: wireId, from: parseEnd(payload["from"], "from"), to: parseEnd(payload["to"], "to") };
  const refusal = wireRefusal(doc.graph, wire);
  if (refusal) return invalid("to", refusal);
  doc.graph.wires.push(wire);
  const effects = emptyEffects(`Connected ${wire.from.port} to ${wire.to.port}`);
  effects.graphChanged = true;
  return effects;
}

function graphWireRemove(doc: SetDocument, payload: Record<string, unknown>): Effects {
  const wire = doc.graph.wires.find((candidate) => candidate.wire_id === payload["wire_id"]);
  if (!wire) return invalid("wire_id", "Wire not found");
  doc.graph.wires = doc.graph.wires.filter((candidate) => candidate !== wire);
  const effects = emptyEffects(`Disconnected ${wire.from.port} from ${wire.to.port}`);
  effects.graphChanged = true;
  return effects;
}

function parseAssetIds(env: OpEnv, value: unknown): string[] {
  if (!Array.isArray(value)) return invalid("asset_ids", "Asset ids must be a list");
  const ids: string[] = [];
  for (const id of value) {
    const asset = typeof id === "string" ? env.assets.get(id) : undefined;
    if (typeof id !== "string") return invalid("asset_ids", "Scripts can use ready textures only");
    if (env.trusted) {
      ids.push(id);
      continue;
    }
    if (!asset || asset.status !== "ready" || asset.kind !== "texture") {
      return invalid("asset_ids", "Scripts can use ready textures only");
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function scriptAdd(doc: SetDocument, op: OpInput): Effects {
  if (!UUID_PATTERN.test(op.target)) return invalid("target", "Target must be a new script id");
  const script: ScriptDoc = {
    id: op.target,
    name: parseName(op.payload["name"], "name", LAYER_NAME_MAX),
    version: 1,
    source: parseSource(op.payload["source"]),
    asset_ids: [],
  };
  doc.scripts.push(script);
  const effects = emptyEffects(`Added script ${script.name}`);
  effects.scriptsUpserted.push(script);
  return effects;
}

function scriptSave(script: ScriptDoc, payload: Record<string, unknown>, env: OpEnv): Effects {
  const source = parseSource(payload["source"]);
  const assetIds = parseAssetIds(env, payload["asset_ids"]);
  script.source = source;
  script.asset_ids = assetIds;
  const effects = emptyEffects(`Saved script ${script.name}`);
  effects.scriptsUpserted.push(script);
  return effects;
}

function scriptRemove(doc: SetDocument, script: ScriptDoc): Effects {
  doc.scripts = doc.scripts.filter((candidate) => candidate !== script);
  const effects = emptyEffects(`Removed script ${script.name}`);
  effects.scriptsRemoved.push(script.id);
  return effects;
}

const TARGET_BUMPING: readonly OpInput["type"][] = ["layer.set", "layer.reparent", "shader.save", "shader.restore", "key.set", "key.remove", "script.save"];

function perform(doc: SetDocument, op: OpInput, env: OpEnv, target: VersionedTarget | null): Effects {
  switch (op.type) {
    case "layer.add": return layerAdd(doc, op);
    case "graph.node.add": return graphNodeAdd(doc, op.payload);
    case "graph.wire.add": return graphWireAdd(doc, op.payload);
    case "script.add": return scriptAdd(doc, op);
    case "set.update": return setUpdate(doc, op.payload);
    case "graph.node.update": return graphNodeUpdate(doc, op.payload);
    case "graph.node.remove": return graphNodeRemove(doc, op.payload);
    case "graph.wire.remove": return graphWireRemove(doc, op.payload);
    default: break;
  }
  if (target?.kind === "layer") {
    const { layer } = target;
    switch (op.type) {
      case "layer.set": return layerSet(layer, op.payload, env);
      case "layer.reparent": return layerReparent(doc, layer, op.payload);
      case "layer.remove": return layerRemove(doc, layer);
      case "shader.save": return shaderSave(layer, op.payload);
      case "shader.restore": return shaderRestore(layer, op.payload, env);
      case "key.set": return keySet(doc, layer, op.payload);
      case "key.remove": return keyRemove(doc, layer, op.payload);
      default: break;
    }
  }
  if (target?.kind === "script") {
    if (op.type === "script.save") return scriptSave(target.script, op.payload, env);
    if (op.type === "script.remove") return scriptRemove(doc, target.script);
  }
  throw new TargetMissing(op.target);
}

/** Applies one op and bumps versions here, once: the op's own target, plus the graph or settings it touched. */
export function applyOp(doc: SetDocument, op: OpInput, env: OpEnv): Effects {
  const target = resolveTarget(doc, op);
  const before = target ? versionOf(doc, target) : 0;
  const effects = perform(doc, op, env, target);
  if (effects.graphChanged) doc.graph.version += 1;
  if (effects.settingsChanged) doc.set.settings_version += 1;
  if (TARGET_BUMPING.includes(op.type)) {
    if (target?.kind === "layer") target.layer.version += 1;
    if (target?.kind === "script") target.script.version += 1;
  }
  const after = resolveTarget(doc, op);
  effects.version = after ? versionOf(doc, after) : before + 1;
  return effects;
}
