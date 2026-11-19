import type { Client } from 'pg';
import { newId } from './crypto.js';
import { errors } from './errors.js';
import type { LayerDoc, LayerKind, Material } from './layers.js';

export async function loadLayer (client: Client, setId: string, layerId: string): Promise<LayerDoc | null> {
  const result = await client.query('SELECT * FROM layers WHERE id = $1 AND set_id = $2 AND NOT removed', [layerId, setId]);
  return (result.rowCount ?? 0) === 0 ? null : rowToLayer(result.rows[0]);
}

export function rowToLayer (row: Record<string, unknown>): LayerDoc {
  const props = row.props as Record<string, number>;
  const layer: LayerDoc = {
    id: row.id as string,
    parent_id: (row.parent_id as string | null),
    index: row.index as number,
    name: row.name as string,
    kind: row.kind as LayerKind,
    version: row.version as number,
    visible: row.visible as boolean,
    position: row.position as [number, number, number],
    rotation: row.rotation as [number, number, number],
    scale: row.scale as [number, number, number],
    props,
    material: (row.material as Material | null),
    model_asset_id: (row.model_asset_id as string | null),
    output_buses: (row.output_buses as string[]),
    shader_version: (row.shader_version as number | null),
  };
  return layer;
}

export async function nextShaderVersionNumber (client: Client, setId: string, layerId: string): Promise<number> {
  const result = await client.query('SELECT COALESCE(MAX(number), 0) AS max FROM shader_versions WHERE set_id = $1 AND layer_id = $2', [setId, layerId]);
  return Number((result.rows[0] as { max: string }).max) + 1;
}

export async function writeActivity (client: Client, setId: string, actorId: string, action: string, target: string, summary: string): Promise<void> {
  await client.query('INSERT INTO activity (id, set_id, actor_id, action, target, summary) VALUES ($1,$2,$3,$4,$5,$6)', [newId(), setId, actorId, action, target, summary]);
}

export async function loadChangedBy (client: Client, userId: string): Promise<{ user_id: string; display_name: string }> {
  const result = await client.query('SELECT id, display_name FROM users WHERE id = $1', [userId]);
  const row = result.rows[0] as { id: string; display_name: string } | undefined;
  return { user_id: row?.id ?? userId, display_name: row?.display_name ?? 'Someone' };
}

const LAYER_ADD_TYPES = new Set(['layer.add', 'script.add', 'graph.node.add', 'graph.wire.add']);
export const opRequiresBaseVersion = (type: string): boolean => !LAYER_ADD_TYPES.has(type);
