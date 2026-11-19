import { createHash } from "node:crypto";
import type { Queryable } from "./db.ts";
import { rows } from "./db.ts";
import type { Effects } from "../shared/ops.ts";
import type { GraphDoc, KeyDoc, LayerDoc, LayerKind, Material, OutputBus, Role, ScriptDoc, SetDocument, Vec3 } from "../shared/types.ts";

interface SetRow {
  id: string;
  name: string;
  bpm: number;
  head: number;
  settings_version: number;
  graph_version: number;
  graph: { nodes: GraphDoc["nodes"]; wires: GraphDoc["wires"] };
  active_camera_id: string | null;
  show_token: string;
}

interface LayerRow {
  id: string;
  parent_id: string | null;
  idx: number;
  name: string;
  kind: LayerKind;
  version: number;
  visible: boolean;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  props: Record<string, number>;
  material: Material | null;
  model_asset_id: string | null;
  output_buses: OutputBus[];
  shader_version: number | null;
}

interface KeyRow { layer_id: string; property: string; tick: number; value: number }

const layerOf = (row: LayerRow): LayerDoc => ({
  id: row.id, parent_id: row.parent_id, index: row.idx, name: row.name, kind: row.kind, version: row.version,
  visible: row.visible, position: row.position, rotation: row.rotation, scale: row.scale, props: row.props,
  material: row.material, model_asset_id: row.model_asset_id, output_buses: row.output_buses, shader_version: row.shader_version,
});

export async function loadDocument(q: Queryable, setId: string, role: Role, forUpdate = false): Promise<SetDocument> {
  const [set] = await rows<SetRow>(
    q,
    `SELECT id, name, bpm, head, settings_version, graph_version, graph, active_camera_id, show_token
     FROM sets WHERE id = $1${forUpdate ? " FOR UPDATE" : ""}`,
    [setId],
  );
  if (!set) throw new Error("set vanished");
  const layers = await rows<LayerRow>(q, "SELECT * FROM layers WHERE set_id = $1 ORDER BY parent_id NULLS FIRST, idx", [setId]);
  const keys = await rows<KeyRow>(
    q, "SELECT layer_id, property, tick, value FROM layer_keys WHERE set_id = $1 ORDER BY layer_id, property, tick", [setId],
  );
  const scripts = await rows<ScriptDoc>(
    q, "SELECT id, name, version, source, asset_ids FROM scripts WHERE set_id = $1 ORDER BY created_at, id", [setId],
  );
  return {
    set: {
      id: set.id, name: set.name, bpm: set.bpm, head: set.head, settings_version: set.settings_version,
      graph_version: set.graph_version, active_camera_id: set.active_camera_id, show_token: set.show_token, role,
    },
    layers: layers.map(layerOf),
    keys: keys as KeyDoc[],
    graph: { version: set.graph_version, nodes: set.graph.nodes, wires: set.graph.wires },
    scripts,
  };
}

async function upsertLayer(q: Queryable, setId: string, layer: LayerDoc): Promise<void> {
  await q.query(
    `INSERT INTO layers (id, set_id, parent_id, idx, name, kind, version, visible, position, rotation, scale, props,
                         material, model_asset_id, output_buses, shader_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (id) DO UPDATE SET parent_id = EXCLUDED.parent_id, idx = EXCLUDED.idx, name = EXCLUDED.name,
       version = EXCLUDED.version, visible = EXCLUDED.visible, position = EXCLUDED.position,
       rotation = EXCLUDED.rotation, scale = EXCLUDED.scale, props = EXCLUDED.props, material = EXCLUDED.material,
       model_asset_id = EXCLUDED.model_asset_id, output_buses = EXCLUDED.output_buses,
       shader_version = EXCLUDED.shader_version`,
    [
      layer.id, setId, layer.parent_id, layer.index, layer.name, layer.kind, layer.version, layer.visible,
      JSON.stringify(layer.position), JSON.stringify(layer.rotation), JSON.stringify(layer.scale),
      JSON.stringify(layer.props), layer.material ? JSON.stringify(layer.material) : null, layer.model_asset_id,
      JSON.stringify(layer.output_buses), layer.shader_version,
    ],
  );
}

async function upsertScript(q: Queryable, setId: string, script: ScriptDoc): Promise<void> {
  await q.query(
    `INSERT INTO scripts (id, set_id, name, version, source, asset_ids) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, version = EXCLUDED.version, source = EXCLUDED.source,
       asset_ids = EXCLUDED.asset_ids`,
    [script.id, setId, script.name, script.version, script.source, JSON.stringify(script.asset_ids)],
  );
}

async function writeSettings(q: Queryable, doc: SetDocument): Promise<void> {
  await q.query(
    `UPDATE sets SET name = $2, bpm = $3, settings_version = $4, graph_version = $5, graph = $6, active_camera_id = $7
     WHERE id = $1`,
    [
      doc.set.id, doc.set.name, doc.set.bpm, doc.set.settings_version, doc.graph.version,
      JSON.stringify({ nodes: doc.graph.nodes, wires: doc.graph.wires }), doc.set.active_camera_id,
    ],
  );
}

export async function persistEffects(q: Queryable, doc: SetDocument, effects: Effects): Promise<void> {
  const setId = doc.set.id;
  if (effects.layersRemoved.length > 0) await q.query("DELETE FROM layers WHERE id = ANY($1::uuid[])", [effects.layersRemoved]);
  for (const layer of effects.layersUpserted) await upsertLayer(q, setId, layer);
  for (const key of effects.keysUpserted) {
    await q.query(
      `INSERT INTO layer_keys (layer_id, set_id, property, tick, value) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (layer_id, property, tick) DO UPDATE SET value = EXCLUDED.value`,
      [key.layer_id, setId, key.property, key.tick, key.value],
    );
  }
  for (const key of effects.keysRemoved) {
    await q.query("DELETE FROM layer_keys WHERE layer_id = $1 AND property = $2 AND tick = $3", [key.layer_id, key.property, key.tick]);
  }
  for (const script of effects.scriptsUpserted) await upsertScript(q, setId, script);
  if (effects.scriptsRemoved.length > 0) await q.query("DELETE FROM scripts WHERE id = ANY($1::uuid[])", [effects.scriptsRemoved]);
  if (effects.settingsChanged || effects.graphChanged) await writeSettings(q, doc);
}

export async function insertDocument(q: Queryable, doc: SetDocument, ownerId: string): Promise<void> {
  await q.query(
    `INSERT INTO sets (id, name, owner_id, bpm, settings_version, graph_version, graph, active_camera_id, show_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      doc.set.id, doc.set.name, ownerId, doc.set.bpm, doc.set.settings_version, doc.graph.version,
      JSON.stringify({ nodes: doc.graph.nodes, wires: doc.graph.wires }), doc.set.active_camera_id, doc.set.show_token,
    ],
  );
  await q.query("INSERT INTO members (set_id, user_id, role) VALUES ($1,$2,'owner')", [doc.set.id, ownerId]);
  for (const layer of doc.layers) await upsertLayer(q, doc.set.id, layer);
  for (const key of doc.keys) {
    await q.query(
      "INSERT INTO layer_keys (layer_id, set_id, property, tick, value) VALUES ($1,$2,$3,$4,$5)",
      [key.layer_id, doc.set.id, key.property, key.tick, key.value],
    );
  }
  for (const script of doc.scripts) await upsertScript(q, doc.set.id, script);
}

export async function insertShaderVersion(
  q: Queryable,
  version: { layerId: string; setId: string; number: number; source: string; authorId: string; restoredFrom: number | null },
): Promise<void> {
  await q.query(
    `INSERT INTO shader_versions (layer_id, set_id, number, source, sha256, size, author_id, restored_from)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      version.layerId, version.setId, version.number, version.source, createHash("sha256").update(version.source).digest("hex"),
      Buffer.byteLength(version.source), version.authorId, version.restoredFrom,
    ],
  );
}
