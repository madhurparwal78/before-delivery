import type { Db } from '../db.js';
import { Err } from '../errors.js';
import type {
  Dependents,
  GraphDoc,
  GraphNodeDoc,
  GraphWireDoc,
  KeyDoc,
  LayerDoc,
  MaterialDoc,
  Role,
  ScriptDoc,
  SetDocument,
  SetHeader,
  Vec3,
} from '../../shared/types.js';
import type { LayerKind, OutputBus } from '../../shared/domain.js';

export interface SetRow {
  id: string;
  name: string;
  bpm: number;
  owner_id: string;
  head: number;
  settings_version: number;
  graph_version: number;
  active_camera_id: string | null;
  show_token: string;
  live_number: number | null;
}

interface LayerRow {
  id: string;
  parent_id: string | null;
  idx: number;
  name: string;
  kind: string;
  version: number;
  visible: boolean;
  position: number[];
  rotation: number[];
  scale: number[];
  props: Record<string, number>;
  material: MaterialDoc | null;
  model_asset_id: string | null;
  output_buses: string[];
  shader_version: number | null;
}

function vec(values: number[]): Vec3 {
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];
}

function toLayer(row: LayerRow): LayerDoc {
  return {
    id: row.id,
    parent_id: row.parent_id,
    index: row.idx,
    name: row.name,
    kind: row.kind as LayerKind,
    version: row.version,
    visible: row.visible,
    position: vec(row.position),
    rotation: vec(row.rotation),
    scale: vec(row.scale),
    props: row.props,
    material: row.material,
    model_asset_id: row.model_asset_id,
    output_buses: row.output_buses as OutputBus[],
    shader_version: row.shader_version,
  };
}

export async function loadSetRow(db: Db, setId: string): Promise<SetRow> {
  const result = await db.query<SetRow>(
    `select id, name, bpm, owner_id, head, settings_version, graph_version, active_camera_id, show_token, live_number
       from sets where id = $1`,
    [setId],
  );
  const row = result.rows[0];
  if (row === undefined) throw Err.notFound();
  return row;
}

export function setHeader(row: SetRow, role: Role): SetHeader {
  return {
    id: row.id,
    name: row.name,
    bpm: row.bpm,
    head: row.head,
    settings_version: row.settings_version,
    graph_version: row.graph_version,
    active_camera_id: row.active_camera_id,
    show_token: row.show_token,
    role,
  };
}

/** Layers in tree order: depth first, siblings by index. */
export function treeOrder(layers: LayerDoc[]): LayerDoc[] {
  const byParent = new Map<string | null, LayerDoc[]>();
  for (const layer of layers) {
    const siblings = byParent.get(layer.parent_id) ?? [];
    siblings.push(layer);
    byParent.set(layer.parent_id, siblings);
  }
  for (const siblings of byParent.values()) siblings.sort((a, b) => a.index - b.index);
  const ordered: LayerDoc[] = [];
  const walk = (parentId: string | null): void => {
    for (const layer of byParent.get(parentId) ?? []) {
      ordered.push(layer);
      walk(layer.id);
    }
  };
  walk(null);
  return ordered;
}

export async function readLayers(db: Db, setId: string): Promise<LayerDoc[]> {
  const result = await db.query<LayerRow>(
    `select id, parent_id, idx, name, kind, version, visible, position, rotation, scale, props, material,
            model_asset_id, output_buses, shader_version
       from layers where set_id = $1`,
    [setId],
  );
  return treeOrder(result.rows.map(toLayer));
}

export async function readLayer(db: Db, setId: string, layerId: string): Promise<LayerDoc | null> {
  const result = await db.query<LayerRow>(
    `select id, parent_id, idx, name, kind, version, visible, position, rotation, scale, props, material,
            model_asset_id, output_buses, shader_version
       from layers where set_id = $1 and id = $2`,
    [setId, layerId],
  );
  const row = result.rows[0];
  return row === undefined ? null : toLayer(row);
}

export async function readKeys(db: Db, setId: string): Promise<KeyDoc[]> {
  const result = await db.query<KeyDoc>(
    `select layer_id, property, tick, value from keys where set_id = $1 order by layer_id, property, tick`,
    [setId],
  );
  return result.rows;
}

export async function readGraph(db: Db, setId: string, version: number): Promise<GraphDoc> {
  const nodes = await db.query<GraphNodeDoc>(
    `select node_id, type, params, x, y from graph_nodes where set_id = $1 order by node_id`,
    [setId],
  );
  const wires = await db.query<{
    wire_id: string;
    from_node: string;
    from_port: string;
    to_node: string;
    to_port: string;
  }>(
    `select wire_id, from_node, from_port, to_node, to_port from graph_wires where set_id = $1 order by wire_id`,
    [setId],
  );
  const wireDocs: GraphWireDoc[] = wires.rows.map((row) => ({
    wire_id: row.wire_id,
    from: { node_id: row.from_node, port: row.from_port },
    to: { node_id: row.to_node, port: row.to_port },
  }));
  return { version, nodes: nodes.rows, wires: wireDocs };
}

export async function readScripts(db: Db, setId: string): Promise<ScriptDoc[]> {
  const result = await db.query<ScriptDoc>(
    `select id, name, version, source, asset_ids from scripts where set_id = $1 order by created_at, id`,
    [setId],
  );
  return result.rows;
}

export async function readSetDocument(db: Db, setId: string, role: Role): Promise<SetDocument> {
  const row = await loadSetRow(db, setId);
  const [layers, keys, graph, scripts] = await Promise.all([
    readLayers(db, setId),
    readKeys(db, setId),
    readGraph(db, setId, row.graph_version),
    readScripts(db, setId),
  ]);
  return { set: setHeader(row, role), layers, keys, graph, scripts };
}

/** An asset's dependents are the live layers, materials and scripts that reference it. */
export async function dependentsBySet(db: Db, setId: string): Promise<Map<string, Dependents>> {
  const layers = await readLayers(db, setId);
  const scripts = await readScripts(db, setId);
  const table = new Map<string, Dependents>();
  const bucket = (assetId: string): Dependents => {
    const existing = table.get(assetId) ?? { count: 0, layers: [], materials: [], scripts: [] };
    table.set(assetId, existing);
    return existing;
  };
  for (const layer of layers) {
    if (layer.model_asset_id !== null) {
      const entry = bucket(layer.model_asset_id);
      entry.layers.push({ id: layer.id, name: layer.name });
      entry.count += 1;
    }
    const material = layer.material;
    if (material !== null) {
      const slots = new Set<string>();
      if (material.albedo_texture_id !== null) slots.add(material.albedo_texture_id);
      if (material.emissive_texture_id !== null) slots.add(material.emissive_texture_id);
      for (const assetId of slots) {
        const entry = bucket(assetId);
        entry.materials.push({ layer_id: layer.id, name: layer.name });
        entry.count += 1;
      }
    }
  }
  for (const script of scripts) {
    for (const assetId of new Set(script.asset_ids)) {
      const entry = bucket(assetId);
      entry.scripts.push({ id: script.id, name: script.name });
      entry.count += 1;
    }
  }
  return table;
}

export function emptyDependents(): Dependents {
  return { count: 0, layers: [], materials: [], scripts: [] };
}
