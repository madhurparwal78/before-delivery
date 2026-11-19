import { newId, newToken } from '../crypto.js';
import { withTransaction } from '../db.js';
import { errors } from '../errors.js';
import { defaultLayer, STARTER_SHADER, validateName } from '../layers.js';
import { requireMember, requireUser } from '../access.js';
import { jsonOk, readBody } from './api.js';
import type { ApiDeps, RouteSpec } from './api.js';
import type { RequestCtx } from '../router.js';
import { sessionCookieValue } from './auth.js';
import type { Client } from 'pg';
import type { SetDocument, LayerDoc } from './setdoc.js';

export async function readSetDocument (deps: ApiDeps, setId: string): Promise<SetDocument> {
  const setResult = await deps.pool.query('SELECT * FROM sets WHERE id = $1', [setId]);
  const setRow = setResult.rows[0];
  if (setRow === undefined) throw errors.notFound();
  const layers = await readLayers(deps.pool, setId);
  const keys = await readKeys(deps.pool, setId);
  const graph = await readGraph(deps.pool, setId);
  const scripts = await readScripts(deps.pool, setId);
  return {
    set: {
      id: setRow.id, name: setRow.name, bpm: Number(setRow.bpm), head: Number(setRow.head),
      settings_version: setRow.settings_version, graph_version: setRow.graph_version,
      active_camera_id: setRow.active_camera_id, show_token: setRow.show_token,
    },
    layers, keys, graph, scripts,
  };
}

async function readLayers (pool: ApiDeps['pool'], setId: string): Promise<LayerDoc[]> {
  const result = await pool.query('SELECT * FROM layers WHERE set_id = $1 AND NOT removed', [setId]);
  const layers = result.rows.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    parent_id: (row.parent_id as string | null),
    index: row.index as number,
    name: row.name as string,
    kind: row.kind as LayerDoc['kind'],
    version: row.version as number,
    visible: row.visible as boolean,
    position: row.position as [number, number, number],
    rotation: row.rotation as [number, number, number],
    scale: row.scale as [number, number, number],
    props: row.props as Record<string, number>,
    material: (row.material as LayerDoc['material']),
    model_asset_id: (row.model_asset_id as string | null),
    output_buses: (row.output_buses as string[]),
    shader_version: (row.shader_version as number | null),
  }));
  return depthFirstOrder(layers);
}

// Tree order: each parent followed by its children, in index order.
function depthFirstOrder (layers: LayerDoc[]): LayerDoc[] {
  const byParent = new Map<string | null, LayerDoc[]>();
  for (const layer of layers) {
    const key = layer.parent_id;
    const list = byParent.get(key) ?? [];
    list.push(layer);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.index - b.index);
  const out: LayerDoc[] = [];
  const walk = (parent: string | null): void => {
    for (const layer of byParent.get(parent) ?? []) {
      out.push(layer);
      walk(layer.id);
    }
  };
  walk(null);
  return out;
}

async function readKeys (pool: ApiDeps['pool'], setId: string): Promise<{ layer_id: string; property: string; tick: number; value: number }[]> {
  const result = await pool.query('SELECT layer_id, property, tick, value FROM keys WHERE set_id = $1 ORDER BY tick', [setId]);
  return result.rows.map((row: Record<string, unknown>) => ({
    layer_id: row.layer_id as string,
    property: row.property as string,
    tick: Number(row.tick),
    value: row.value as number,
  }));
}

async function readGraph (pool: ApiDeps['pool'], setId: string): Promise<SetDocument['graph']> {
  const setRow = await pool.query('SELECT graph_version FROM sets WHERE id = $1', [setId]);
  const nodesResult = await pool.query('SELECT node_id, type, params, x, y FROM graph_nodes WHERE set_id = $1', [setId]);
  const wiresResult = await pool.query('SELECT wire_id, from_node_id, from_port, to_node_id, to_port FROM graph_wires WHERE set_id = $1', [setId]);
  return {
    version: (setRow.rows[0] as { graph_version: number }).graph_version,
    nodes: nodesResult.rows.map((row: Record<string, unknown>) => ({
      node_id: row.node_id as string,
      type: row.type as string,
      params: row.params as Record<string, unknown>,
      x: row.x as number,
      y: row.y as number,
    })),
    wires: wiresResult.rows.map((row: Record<string, unknown>) => ({
      wire_id: row.wire_id as string,
      from: { node_id: row.from_node_id as string, port: row.from_port as string },
      to: { node_id: row.to_node_id as string, port: row.to_port as string },
    })),
  };
}

async function readScripts (pool: ApiDeps['pool'], setId: string): Promise<SetDocument['scripts']> {
  const result = await pool.query('SELECT id, name, version, source, asset_ids FROM scripts WHERE set_id = $1', [setId]);
  return result.rows.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    name: row.name as string,
    version: row.version as number,
    source: row.source as string,
    asset_ids: row.asset_ids as string[],
  }));
}

const BLANK_STAGE_TREE: { name: string; kind: 'group' | 'camera' | 'light' | 'plane'; position?: [number, number, number]; scale?: [number, number, number]; intensity?: number }[] = [
  { name: 'Stage', kind: 'group' },
  { name: 'Main camera', kind: 'camera', position: [0, 2, 8] },
  { name: 'Key light', kind: 'light', position: [4, 6, 4] },
  { name: 'Floor', kind: 'plane', scale: [10, 1, 10] },
];

export async function createSet (deps: ApiDeps, ctx: RequestCtx): Promise<void> {
  const user = await requireUser(deps, sessionCookieValue(ctx));
  const body = await readBody<{ name?: unknown; starter?: unknown }>(ctx, 1_000_000);
  const name = validateName('name', body.name, 80);
  if (name instanceof Error) throw errors.validation({ name: name.message });
  if (body.starter !== 'blank-stage') throw errors.validation({ starter: 'Starter must be blank-stage' });

  const setId = newId();
  await withTransaction(deps.pool, async (client) => {
    await client.query('INSERT INTO sets (id, owner_id, name, bpm, show_token) VALUES ($1,$2,$3,120.0,$4)', [setId, user.id, name, newToken()]);
    await client.query('INSERT INTO members (set_id, user_id, role) VALUES ($1,$2,$3)', [setId, user.id, 'owner']);
    let parentId: string | null = null;
    const cameraId = newId();
    let stageId = '';
    for (const entry of BLANK_STAGE_TREE) {
      const layerId = entry.kind === 'camera' ? cameraId : newId();
      if (entry.name === 'Stage') stageId = layerId;
      const layer = defaultLayer(layerId, entry.kind, entry.name);
      layer.parent_id = entry.kind === 'group' ? null : stageId;
      layer.index = entry.kind === 'group' ? 0 : (entry.name === 'Main camera' ? 0 : entry.name === 'Key light' ? 1 : 2);
      if (entry.position !== undefined) layer.position = entry.position;
      if (entry.scale !== undefined) layer.scale = entry.scale;
      await insertLayer(client, setId, layer);
    }
    await client.query('UPDATE sets SET active_camera_id = $1 WHERE id = $2', [cameraId, setId]);
    const beatClockId = newId();
    await client.query('INSERT INTO graph_nodes (set_id, node_id, type, params, x, y) VALUES ($1,$2,$3,$4,$5,$6)', [setId, beatClockId, 'Beat clock', JSON.stringify({}), 80, 80]);
    void STARTER_SHADER;
  });
  const doc = await readSetDocument(deps, setId);
  jsonOk(ctx, 201, doc);
}

export async function insertLayer (client: Client, setId: string, layer: LayerDoc): Promise<void> {
  await client.query(
    `INSERT INTO layers (id, set_id, parent_id, index, name, kind, version, visible, position, rotation, scale, props, material, model_asset_id, output_buses, shader_version, removed)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,false)`,
    [layer.id, setId, layer.parent_id, layer.index, layer.name, layer.kind, layer.version, layer.visible,
      JSON.stringify(layer.position), JSON.stringify(layer.rotation), JSON.stringify(layer.scale),
      JSON.stringify(layer.props), JSON.stringify(layer.material), layer.model_asset_id,
      JSON.stringify(layer.output_buses), layer.shader_version],
  );
}

export async function listSets (deps: ApiDeps, ctx: RequestCtx): Promise<void> {
  const user = await requireUser(deps, sessionCookieValue(ctx));
  const result = await deps.pool.query(
    `SELECT s.id, s.name, s.bpm, s.head, s.show_token, m.role,
            (SELECT live_number FROM live_pointer WHERE set_id = s.id) AS live_number
       FROM members m JOIN sets s ON s.id = m.set_id
      WHERE m.user_id = $1 ORDER BY s.created_at`,
    [user.id],
  );
  jsonOk(ctx, 200, {
    sets: result.rows.map((row: Record<string, unknown>) => ({
      id: row.id, name: row.name, role: row.role, bpm: Number(row.bpm), head: Number(row.head),
      live_number: row.live_number === null ? null : Number(row.live_number),
    })),
  });
}

export async function getSet (deps: ApiDeps, ctx: RequestCtx): Promise<void> {
  const user = await requireUser(deps, sessionCookieValue(ctx));
  const role = await requireMember(deps, ctx.params.setId, user.id);
  const doc = await readSetDocument(deps, ctx.params.setId);
  jsonOk(ctx, 200, { ...doc, set: { ...doc.set, role } });
}

export const setRoutes = (deps: ApiDeps): RouteSpec[] => ([
  { method: 'GET', path: '/api/sets', handler: (ctx) => listSets(deps, ctx) },
  { method: 'POST', path: '/api/sets', handler: (ctx) => createSet(deps, ctx) },
  { method: 'GET', path: '/api/sets/:setId', handler: (ctx) => getSet(deps, ctx) },
]);
