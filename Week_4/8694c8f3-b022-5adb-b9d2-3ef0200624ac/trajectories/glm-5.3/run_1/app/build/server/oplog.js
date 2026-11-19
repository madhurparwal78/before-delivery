import { newId } from './crypto.js';
export async function loadLayer(client, setId, layerId) {
    const result = await client.query('SELECT * FROM layers WHERE id = $1 AND set_id = $2 AND NOT removed', [layerId, setId]);
    return (result.rowCount ?? 0) === 0 ? null : rowToLayer(result.rows[0]);
}
export function rowToLayer(row) {
    const props = row.props;
    const layer = {
        id: row.id,
        parent_id: row.parent_id,
        index: row.index,
        name: row.name,
        kind: row.kind,
        version: row.version,
        visible: row.visible,
        position: row.position,
        rotation: row.rotation,
        scale: row.scale,
        props,
        material: row.material,
        model_asset_id: row.model_asset_id,
        output_buses: row.output_buses,
        shader_version: row.shader_version,
    };
    return layer;
}
export async function nextShaderVersionNumber(client, setId, layerId) {
    const result = await client.query('SELECT COALESCE(MAX(number), 0) AS max FROM shader_versions WHERE set_id = $1 AND layer_id = $2', [setId, layerId]);
    return Number(result.rows[0].max) + 1;
}
export async function writeActivity(client, setId, actorId, action, target, summary) {
    await client.query('INSERT INTO activity (id, set_id, actor_id, action, target, summary) VALUES ($1,$2,$3,$4,$5,$6)', [newId(), setId, actorId, action, target, summary]);
}
export async function loadChangedBy(client, userId) {
    const result = await client.query('SELECT id, display_name FROM users WHERE id = $1', [userId]);
    const row = result.rows[0];
    return { user_id: row?.id ?? userId, display_name: row?.display_name ?? 'Someone' };
}
const LAYER_ADD_TYPES = new Set(['layer.add', 'script.add', 'graph.node.add', 'graph.wire.add']);
export const opRequiresBaseVersion = (type) => !LAYER_ADD_TYPES.has(type);
