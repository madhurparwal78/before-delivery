import { randomUUID } from "node:crypto";
import { applyOp, Invalid } from "../shared/ops.ts";
import type { OpEnv } from "../shared/ops.ts";
import { isRecord } from "../shared/schema.ts";
import { BLANK_STAGE_BPM, STARTER_SHADER } from "../shared/starter.ts";
import type { AssetKind, LayerDoc, OpInput, SetDocument } from "../shared/types.ts";
import { emptyDocument } from "./sets.ts";

export interface ImportedAsset {
  oldId: string;
  newId: string;
  name: string;
  kind: AssetKind;
}

interface ImportedShaderVersion {
  layerId: string;
  number: number;
  source: string;
  restoredFrom: number | null;
}

interface ImportedDocument {
  doc: SetDocument;
  shaderVersions: ImportedShaderVersion[];
}

const asRecords = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter(isRecord) : []);
const asString = (value: unknown): string => (typeof value === "string" ? value : "");

function treeOrder(layers: Record<string, unknown>[]): Record<string, unknown>[] {
  const ordered: Record<string, unknown>[] = [];
  const walk = (parentId: unknown): void => {
    const children = layers
      .filter((layer) => (layer["parent_id"] ?? null) === parentId)
      .sort((a, b) => Number(a["index"]) - Number(b["index"]));
    for (const child of children) {
      ordered.push(child);
      walk(child["id"]);
    }
  };
  walk(null);
  return ordered;
}

/** Rebuilds an exported set through the same op rules a live edit obeys; returns null when it does not fit them. */
export function buildImportedDocument(manifest: Record<string, unknown>, name: string, assets: ImportedAsset[]): ImportedDocument | null {
  const setInfo = isRecord(manifest["set"]) ? manifest["set"] : {};
  const doc = emptyDocument(randomUUID(), name, BLANK_STAGE_BPM);
  const env: OpEnv = {
    assets: new Map(assets.map((asset) => [asset.newId, { kind: asset.kind, status: "ready" as const }])),
    shaderSource: () => undefined,
  };
  const assetIds = new Map(assets.map((asset) => [asset.oldId, asset.newId]));
  const layerIds = new Map<string, string>();
  const mapAsset = (value: unknown): string | null => (typeof value === "string" ? (assetIds.get(value) ?? null) : null);
  const run = (op: OpInput): void => {
    applyOp(doc, op, env);
  };
  try {
    const rawLayers = asRecords(manifest["layers"]);
    for (const raw of treeOrder(rawLayers)) {
      const oldId = asString(raw["id"]);
      const id = randomUUID();
      layerIds.set(oldId, id);
      const parent = raw["parent_id"] === null ? null : (layerIds.get(asString(raw["parent_id"])) ?? null);
      const siblings = doc.layers.filter((layer) => layer.parent_id === parent).length;
      run({ type: "layer.add", target: id, payload: { parent_id: parent, index: siblings, name: raw["name"], kind: raw["kind"] } });
      const set = (path: string, value: unknown): void => run({ type: "layer.set", target: id, payload: { path, value } });
      set("visible", raw["visible"]);
      set("position", raw["position"]);
      set("rotation", raw["rotation"]);
      set("scale", raw["scale"]);
      if (isRecord(raw["props"])) for (const [key, value] of Object.entries(raw["props"])) set(`props.${key}`, value);
      if (isRecord(raw["material"])) {
        set("material.tint", raw["material"]["tint"]);
        set("material.tint_alpha", raw["material"]["tint_alpha"]);
        set("material.albedo_texture_id", mapAsset(raw["material"]["albedo_texture_id"]));
        set("material.emissive_texture_id", mapAsset(raw["material"]["emissive_texture_id"]));
      }
      if (raw["model_asset_id"] !== null && raw["model_asset_id"] !== undefined) set("model_asset_id", mapAsset(raw["model_asset_id"]));
      if (Array.isArray(raw["output_buses"]) && raw["output_buses"].length > 0) set("output_buses", raw["output_buses"]);
    }
    for (const key of asRecords(manifest["keys"])) {
      const target = layerIds.get(asString(key["layer_id"]));
      if (!target) return null;
      run({ type: "key.set", target, payload: { property: key["property"], tick: key["tick"], value: key["value"] } });
    }
    const graph = isRecord(manifest["graph"]) ? manifest["graph"] : {};
    const nodeIds = new Map<string, string>();
    for (const node of asRecords(graph["nodes"])) {
      const id = randomUUID();
      nodeIds.set(asString(node["node_id"]), id);
      const params = isRecord(node["params"]) ? { ...node["params"] } : {};
      if (node["type"] === "Layer property" && typeof params["layer_id"] === "string") params["layer_id"] = layerIds.get(params["layer_id"]) ?? null;
      run({ type: "graph.node.add", target: "graph", payload: { node_id: id, type: node["type"], params, x: node["x"], y: node["y"] } });
    }
    for (const wire of asRecords(graph["wires"])) {
      const from = isRecord(wire["from"]) ? wire["from"] : {};
      const to = isRecord(wire["to"]) ? wire["to"] : {};
      run({
        type: "graph.wire.add", target: "graph",
        payload: {
          wire_id: randomUUID(),
          from: { node_id: nodeIds.get(asString(from["node_id"])), port: from["port"] },
          to: { node_id: nodeIds.get(asString(to["node_id"])), port: to["port"] },
        },
      });
    }
    for (const script of asRecords(manifest["scripts"])) {
      const id = randomUUID();
      run({ type: "script.add", target: id, payload: { name: script["name"], source: script["source"] } });
      const ids = Array.isArray(script["asset_ids"]) ? script["asset_ids"].map(mapAsset) : [];
      run({ type: "script.save", target: id, payload: { source: script["source"], asset_ids: ids.filter((id) => id !== null) } });
    }
    run({ type: "set.update", target: "set", payload: { bpm: setInfo["bpm"] } });
    const camera = layerIds.get(asString(setInfo["active_camera_id"]));
    if (camera) run({ type: "set.update", target: "set", payload: { active_camera_id: camera } });
  } catch (error) {
    if (error instanceof Invalid) return null;
    throw error;
  }
  return { doc: finalise(doc), shaderVersions: shaderVersionsOf(doc, manifest, layerIds) };
}

function finalise(doc: SetDocument): SetDocument {
  for (const layer of doc.layers) layer.version = 1;
  for (const script of doc.scripts) script.version = 1;
  doc.set.settings_version = 1;
  doc.graph.version = 1;
  return doc;
}

function shaderVersionsOf(doc: SetDocument, manifest: Record<string, unknown>, layerIds: Map<string, string>): ImportedShaderVersion[] {
  const histories = new Map<string, ImportedShaderVersion[]>();
  for (const entry of asRecords(manifest["shaders"])) {
    const layerId = layerIds.get(asString(entry["layer_id"]));
    if (!layerId) continue;
    const versions = asRecords(entry["versions"]).flatMap((version): ImportedShaderVersion[] =>
      typeof version["number"] === "number" && typeof version["source"] === "string"
        ? [{ layerId, number: version["number"], source: version["source"], restoredFrom: typeof version["restored_from"] === "number" ? version["restored_from"] : null }]
        : []);
    histories.set(layerId, versions.sort((a, b) => a.number - b.number));
  }
  const rowsOut: ImportedShaderVersion[] = [];
  for (const layer of doc.layers.filter((candidate: LayerDoc) => candidate.kind === "shader")) {
    const history = histories.get(layer.id) ?? [{ layerId: layer.id, number: 1, source: STARTER_SHADER, restoredFrom: null }];
    layer.shader_version = history[history.length - 1]?.number ?? 1;
    rowsOut.push(...history);
  }
  return rowsOut;
}

