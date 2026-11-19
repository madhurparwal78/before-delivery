import { isBuiltIn, portsOf, topologicalOrder } from "../../shared/graph.ts";
import type { LfoShape } from "../../shared/graph.ts";
import type { GraphNode, KeyDoc, LayerDoc, SetDocument, Vec3 } from "../../shared/types.ts";
import { compose, multiply } from "./math.ts";
import type { ScriptHost } from "./scripts.ts";
import type { Mat4 } from "./math.ts";
import { identity } from "./math.ts";

export interface EffectiveLayer {
  layer: LayerDoc;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  props: Record<string, number>;
  tintAlpha: number;
}

interface FrameInputs {
  doc: SetDocument;
  tick: number;
  beat: number;
  plugins: ScriptHost;
  scrubbing: { layerId: string; path: string } | null;
  animate: ((beat: number, effective: Map<string, EffectiveLayer>) => void) | null;
}

function writeValue(effective: EffectiveLayer, path: string, value: number): void {
  const [group, tail] = path.split(".");
  const slot = tail === "x" ? 0 : tail === "y" ? 1 : 2;
  if (group === "position") effective.position[slot] = value;
  else if (group === "rotation") effective.rotation[slot] = value;
  else if (group === "scale") effective.scale[slot] = value;
  else if (group === "props" && tail) effective.props[tail] = value;
  else if (path === "material.tint_alpha") effective.tintAlpha = value;
}

function keyedValue(keys: KeyDoc[], tick: number): number {
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (!first || !last) return 0;
  if (tick <= first.tick) return first.value;
  if (tick >= last.tick) return last.value;
  for (let i = 1; i < keys.length; i += 1) {
    const next = keys[i];
    const previous = keys[i - 1];
    if (next && previous && tick <= next.tick) {
      return previous.value + ((next.value - previous.value) * (tick - previous.tick)) / (next.tick - previous.tick);
    }
  }
  return last.value;
}

function lfoValue(shape: LfoShape, beat: number, rate: number): number {
  const t = (((beat / rate) % 1) + 1) % 1;
  switch (shape) {
    case "sine": return Math.sin(t * Math.PI * 2);
    case "triangle": return t < 0.5 ? 4 * t - 1 : 3 - 4 * t;
    case "square": return t < 0.5 ? 1 : -1;
    case "saw": return 2 * t - 1;
  }
}

function numberParam(node: GraphNode, key: string, fallback: number): number {
  const value = node.params[key];
  return typeof value === "number" ? value : fallback;
}

function lfoShapeOf(node: GraphNode): LfoShape {
  const shape = node.params["shape"];
  return shape === "triangle" || shape === "square" || shape === "saw" ? shape : "sine";
}

/** Evaluates the node graph once; returns the values Layer property nodes drive, keyed by layer id and path. */
function evaluateGraph(doc: SetDocument, beat: number, plugins: ScriptHost): Map<string, Map<string, number>> {
  const outputs = new Map<string, Record<string, number>>();
  const driven = new Map<string, Map<string, number>>();
  for (const node of topologicalOrder(doc.graph)) {
    const inputs: Record<string, number> = {};
    for (const port of portsOf(node).inputs) {
      const wire = doc.graph.wires.find((candidate) => candidate.to.node_id === node.node_id && candidate.to.port === port);
      inputs[port] = wire ? (outputs.get(wire.from.node_id)?.[wire.from.port] ?? 0) : 0;
    }
    if (node.type === "Beat clock") {
      outputs.set(node.node_id, { beat, phase: beat - Math.floor(beat) });
    } else if (node.type === "LFO") {
      outputs.set(node.node_id, { value: lfoValue(lfoShapeOf(node), inputs["beat"] ?? 0, numberParam(node, "rate_beats", 1)) });
    } else if (node.type === "Remap") {
      const [inMin, inMax] = [numberParam(node, "in_min", 0), numberParam(node, "in_max", 1)];
      const [outMin, outMax] = [numberParam(node, "out_min", 0), numberParam(node, "out_max", 1)];
      const t = inMax === inMin ? 0 : ((inputs["in"] ?? 0) - inMin) / (inMax - inMin);
      outputs.set(node.node_id, { out: outMin + t * (outMax - outMin) });
    } else if (node.type === "Layer property") {
      const wired = doc.graph.wires.some((wire) => wire.to.node_id === node.node_id);
      const layerId = node.params["layer_id"];
      const property = node.params["property"];
      if (wired && typeof layerId === "string" && typeof property === "string") {
        const forLayer = driven.get(layerId) ?? new Map<string, number>();
        forLayer.set(property, inputs["value"] ?? 0);
        driven.set(layerId, forLayer);
      }
    } else if (!isBuiltIn(node.type)) {
      outputs.set(node.node_id, plugins.run(node.type, inputs));
    }
  }
  return driven;
}

export function evaluateFrame(input: FrameInputs): Map<string, EffectiveLayer> {
  const { doc, tick, beat } = input;
  const effective = new Map<string, EffectiveLayer>();
  for (const layer of doc.layers) {
    effective.set(layer.id, {
      layer, position: [...layer.position], rotation: [...layer.rotation], scale: [...layer.scale], props: { ...layer.props },
      tintAlpha: layer.material?.tint_alpha ?? 1,
    });
  }
  const grouped = new Map<string, KeyDoc[]>();
  for (const key of doc.keys) {
    const id = `${key.layer_id}\u0000${key.property}`;
    grouped.set(id, [...(grouped.get(id) ?? []), key]);
  }
  const scrubbed = (layerId: string, path: string): boolean => input.scrubbing?.layerId === layerId && input.scrubbing.path === path;
  for (const [id, keys] of grouped) {
    const [layerId, property] = id.split("\u0000");
    const target = layerId ? effective.get(layerId) : undefined;
    if (target && property && !scrubbed(layerId ?? "", property)) {
      writeValue(target, property, keyedValue(keys.sort((a, b) => a.tick - b.tick), tick));
    }
  }
  for (const [layerId, values] of evaluateGraph(doc, beat, input.plugins)) {
    const target = effective.get(layerId);
    if (target) for (const [path, value] of values) if (!scrubbed(layerId, path)) writeValue(target, path, value);
  }
  for (const [composite, value] of input.plugins.overrides()) {
    const [name, path] = composite.split("\u0000");
    const target = [...effective.values()].find((candidate) => candidate.layer.name === name);
    if (target && path && !scrubbed(target.layer.id, path)) writeValue(target, path, value);
  }
  input.animate?.(beat, effective);
  return effective;
}

export function worldMatrices(layers: readonly LayerDoc[], effective: Map<string, EffectiveLayer>): Map<string, Mat4> {
  const world = new Map<string, Mat4>();
  const resolve = (layer: LayerDoc): Mat4 => {
    const cached = world.get(layer.id);
    if (cached) return cached;
    const own = effective.get(layer.id);
    const local = own ? compose(own.position, own.rotation, own.scale) : identity();
    const parent = layer.parent_id ? layers.find((candidate) => candidate.id === layer.parent_id) : undefined;
    const matrix = parent ? multiply(resolve(parent), local) : local;
    world.set(layer.id, matrix);
    return matrix;
  };
  for (const layer of layers) resolve(layer);
  return world;
}
