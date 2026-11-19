import { withTransaction } from '../db.js';
import { errors, canonicalJson } from '../errors.js';
import { DRAWN_KINDS, KEYABLE_PROPERTIES, MAX_TICK, RANGES, OUTPUT_BUSES, barBeatString, snapToQuarterBeat, isFiniteNumber, inRange, validateName, STARTER_SHADER, } from '../layers.js';
import { loadLayer, nextShaderVersionNumber, writeActivity, loadChangedBy, opRequiresBaseVersion } from '../oplog.js';
import { requireMember, requireUser, requireWrite } from '../access.js';
import { jsonOk, readBody } from './api.js';
import { sessionCookieValue } from './auth.js';
import { publishCommittedOp } from './events.js';
import { sha256Hex } from '../crypto.js';
const opTypes = new Set([
    'layer.add', 'layer.set', 'layer.reparent', 'layer.remove',
    'shader.save', 'shader.restore', 'key.set', 'key.remove', 'set.update',
    'graph.node.add', 'graph.node.update', 'graph.node.remove', 'graph.wire.add', 'graph.wire.remove',
    'script.add', 'script.save', 'script.remove',
]);
export async function postOp(deps, ctx) {
    const user = await requireUser(deps, sessionCookieValue(ctx));
    const role = await requireMember(deps, ctx.params.setId, user.id);
    requireWrite(role);
    const body = await readBody(ctx, 1_000_000);
    const clientOpId = typeof body.client_op_id === 'string' ? body.client_op_id : '';
    if (clientOpId.length < 8 || clientOpId.length > 64)
        throw errors.validation({ client_op_id: 'Client op id must be 8 to 64 characters' });
    const opType = typeof body.type === 'string' ? body.type : '';
    if (!opTypes.has(opType))
        throw errors.validation({ type: 'Unknown op type' });
    const target = typeof body.target === 'string' ? body.target : '';
    if (target === '')
        throw errors.validation({ target: 'Target is required' });
    const payload = (body.payload !== undefined && body.payload !== null && typeof body.payload === 'object' && !Array.isArray(body.payload))
        ? body.payload
        : {};
    const needsBase = opRequiresBaseVersion(opType);
    const baseVersion = body.base_version;
    if (needsBase) {
        if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion))
            throw errors.validation({ base_version: 'Base version is required' });
    }
    else if (baseVersion !== undefined && typeof baseVersion !== 'number') {
        throw errors.validation({ base_version: 'Base version must be a number' });
    }
    const setId = ctx.params.setId;
    const outcome = await withTransaction(deps.pool, async (client) => {
        // Exactly-once check first, inside the transaction that will commit.
        const existing = await client.query('SELECT seq, target, type, payload, base_version, version, response, actor_id FROM ops WHERE set_id = $1 AND client_op_id = $2 FOR UPDATE', [setId, clientOpId]);
        const storedRow = existing.rows[0];
        if (storedRow !== undefined) {
            const same = storedRow.target === target && storedRow.type === opType
                && canonicalJson(storedRow.payload) === canonicalJson(payload)
                && storedRow.base_version === (typeof baseVersion === 'number' ? baseVersion : null);
            if (same) {
                return { replayed: true, seq: Number(storedRow.seq), version: storedRow.version, response: storedRow.response, layerId: storedRow.target, committedAt: '' };
            }
            throw errors.opIdReused();
        }
        if (opType === 'layer.add' || opType === 'script.add') {
            const taken = await client.query('SELECT 1 FROM layers WHERE id = $1 AND set_id = $2 UNION ALL SELECT 1 FROM scripts WHERE id = $1 AND set_id = $2', [target, setId]);
            if ((taken.rowCount ?? 0) > 0)
                throw errors.idTaken();
        }
        if (opType === 'graph.node.add' && typeof payload.node_id === 'string') {
            const taken = await client.query('SELECT 1 FROM graph_nodes WHERE node_id = $1 AND set_id = $2', [payload.node_id, setId]);
            if ((taken.rowCount ?? 0) > 0)
                throw errors.idTaken();
        }
        if (opType === 'graph.wire.add' && typeof payload.wire_id === 'string') {
            const taken = await client.query('SELECT 1 FROM graph_wires WHERE wire_id = $1 AND set_id = $2', [payload.wire_id, setId]);
            if ((taken.rowCount ?? 0) > 0)
                throw errors.idTaken();
        }
        const outcome = await applyOp(client, deps, {
            setId, actorId: user.id, actorName: user.display_name,
            op: { clientOpId, target, baseVersion: typeof baseVersion === 'number' ? baseVersion : undefined, type: opType, payload },
        });
        return { replayed: false, ...outcome };
    });
    if (!outcome.replayed) {
        await publishCommittedOp(deps, ctx.params.setId, {
            seq: outcome.seq,
            client_op_id: clientOpId,
            target: outcome.layerId,
            type: opType,
            payload,
            actor: { user_id: user.id, display_name: user.display_name },
            committed_at: outcome.committedAt,
        });
    }
    jsonOk(ctx, 200, { ...outcome.response, replayed: outcome.replayed });
}
function requireLayer(layer) {
    if (layer === null)
        throw errors.notFound();
    return layer;
}
// The person who made the latest change to a target, for stale-write refusals.
async function loadLatestChanger(client, setId, target) {
    const result = await client.query(`SELECT o.actor_id, u.display_name FROM ops o JOIN users u ON u.id = o.actor_id
      WHERE o.set_id = $1 AND o.target = $2 ORDER BY o.seq DESC LIMIT 1`, [setId, target]);
    const row = result.rows[0];
    if (row === undefined)
        return { user_id: '', display_name: 'Someone' };
    return { user_id: row.actor_id, display_name: row.display_name };
}
async function applyOp(client, deps, input) {
    const { setId, op } = input;
    const isSetTarget = op.target === 'set';
    const isGraphTarget = op.target === 'graph';
    if (!isSetTarget && !isGraphTarget && op.type !== 'layer.add' && op.type !== 'script.add') {
        const exists = await client.query("SELECT 1 FROM layers WHERE id = $1 AND set_id = $2 AND NOT removed", [op.target, setId]);
        const scriptExists = await client.query("SELECT 1 FROM scripts WHERE id = $1 AND set_id = $2", [op.target, setId]);
        if ((exists.rowCount ?? 0) === 0 && (scriptExists.rowCount ?? 0) === 0)
            throw errors.notFound();
    }
    // Lock check: an op on a layer someone else has locked is refused with 423.
    // While Valkey is unreachable the lock check is skipped entirely.
    if (!isSetTarget && !isGraphTarget && op.type !== 'layer.add' && op.type !== 'script.add') {
        const exists = await client.query("SELECT 1 FROM layers WHERE id = $1 AND set_id = $2 AND NOT removed", [op.target, setId]);
        if ((exists.rowCount ?? 0) > 0) {
            const lock = await deps.collab.getLock(setId, op.target).catch(() => null);
            if (lock !== null && lock.holder !== input.actorId) {
                const holderName = await loadChangedBy(client, lock.holder);
                throw errors.layerLocked(holderName, new Date(Date.now() + lock.pttl).toISOString());
            }
        }
    }
    // Stale check for layer targets.
    let layer = null;
    if (!isSetTarget && !isGraphTarget && op.type !== 'layer.add' && op.type !== 'script.add') {
        const loaded = await loadLayer(client, setId, op.target);
        if (loaded !== null) {
            layer = loaded;
            if (op.baseVersion !== undefined) {
                if (op.baseVersion < loaded.version) {
                    const changedBy = await loadLatestChanger(client, setId, op.target);
                    throw errors.staleVersion(loaded.version, layer, changedBy);
                }
                if (op.baseVersion > loaded.version) {
                    throw errors.validation({ base_version: 'Base version is ahead of the current version' });
                }
            }
        }
    }
    switch (op.type) {
        case 'layer.add': return await opLayerAdd(client, input);
        case 'layer.set': return await opLayerSet(client, input, requireLayer(layer));
        case 'layer.reparent': return await opLayerReparent(client, input, requireLayer(layer));
        case 'layer.remove': return await opLayerRemove(client, input, requireLayer(layer));
        case 'shader.save': return await opShaderSave(client, input, requireLayer(layer));
        case 'shader.restore': return await opShaderRestore(client, input, requireLayer(layer));
        case 'key.set': return await opKeySet(client, input, requireLayer(layer));
        case 'key.remove': return await opKeyRemove(client, input, requireLayer(layer));
        case 'set.update': return await opSetUpdate(client, input);
        case 'graph.node.add': return await opGraphNodeAdd(client, input);
        case 'graph.node.update': return await opGraphNodeUpdate(client, input);
        case 'graph.node.remove': return await opGraphNodeRemove(client, input);
        case 'graph.wire.add': return await opGraphWireAdd(client, input);
        case 'graph.wire.remove': return await opGraphWireRemove(client, input);
        case 'script.add': return await opScriptAdd(client, input);
        case 'script.save': return await opScriptSave(client, input);
        case 'script.remove': return await opScriptRemove(client, input);
        default: throw errors.validation({ type: 'Unknown op type' });
    }
}
async function finishOp(client, input, version, extraResponse = {}) {
    const seqResult = await client.query('UPDATE sets SET head = head + 1 WHERE id = $1 RETURNING head', [input.setId]);
    const seq = Number(seqResult.rows[0].head);
    const committedAt = new Date().toISOString();
    const response = { seq, target: input.op.target, version, ...extraResponse };
    await client.query('INSERT INTO ops (set_id, seq, client_op_id, actor_id, target, type, payload, base_version, version, response) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [input.setId, seq, input.op.clientOpId, input.actorId, input.op.target, input.op.type, JSON.stringify(input.op.payload), input.op.baseVersion ?? null, version, JSON.stringify(response)]);
    return { seq, version, response, layerId: input.op.target, committedAt };
}
async function opLayerAdd(client, input) {
    const { op, setId } = input;
    const kind = op.payload.kind;
    const name = validateName('name', op.payload.name, 60);
    if (name instanceof Error)
        throw errors.validation({ name: name.message });
    const allKinds = [...DRAWN_KINDS, 'group', 'camera', 'light'];
    if (typeof kind !== 'string' || !allKinds.includes(kind)) {
        throw errors.validation({ kind: 'Unknown layer kind' });
    }
    let parentId = null;
    if (op.payload.parent_id !== undefined && op.payload.parent_id !== null) {
        if (typeof op.payload.parent_id !== 'string')
            throw errors.validation({ parent_id: 'Parent must be a layer id' });
        const parent = await loadLayer(client, setId, op.payload.parent_id);
        if (parent === null)
            throw errors.validation({ parent_id: 'Parent layer not found' });
        parentId = parent.id;
    }
    const siblingCount = await countChildren(client, setId, parentId);
    const index = op.payload.index;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > siblingCount) {
        throw errors.validation({ index: `Index must be between 0 and ${siblingCount}` });
    }
    await shiftSiblingsUp(client, setId, parentId, index);
    const layerId = op.target;
    await client.query(`INSERT INTO layers (id, set_id, parent_id, index, name, kind, version, visible, position, rotation, scale, props, material, model_asset_id, output_buses, shader_version, removed)
     VALUES ($1,$2,$3,$4,$5,$6,1,true,'[0,0,0]','[0,0,0]','[1,1,1]',$7,$8,null,$9,$10,false)`, [layerId, setId, parentId, index, name, kind, JSON.stringify(defaultsFor(kind)), JSON.stringify(materialFor(kind)),
        JSON.stringify(DRAWN_KINDS.includes(kind) ? ['main'] : []), kind === 'shader' ? 1 : null]);
    if (kind === 'shader') {
        await client.query('INSERT INTO shader_versions (set_id, layer_id, number, sha256, size, source, author_id, restored_from, created_at) VALUES ($1,$2,1,$3,$4,$5,$6,null,now())', [setId, layerId, sha256Hex(Buffer.from(STARTER_SHADER, 'utf8')), Buffer.byteLength(STARTER_SHADER), STARTER_SHADER, input.actorId]);
    }
    await writeActivity(client, setId, input.actorId, 'layer.add', layerId, `Added ${kind} layer ${name}`);
    return await finishOp(client, input, 1);
}
function defaultsFor(kind) {
    if (kind === 'camera')
        return { fov: 50, near: 0.1, far: 200 };
    if (kind === 'light')
        return { intensity: 1 };
    if (kind === 'tube')
        return { twist: 0, radius: 1 };
    return {};
}
function materialFor(kind) {
    return ['cube', 'sphere', 'plane', 'torus', 'tube', 'model'].includes(kind)
        ? { tint: [1, 1, 1], tint_alpha: 1, albedo_texture_id: null, emissive_texture_id: null }
        : null;
}
async function countChildren(client, setId, parentId) {
    const result = await client.query('SELECT COUNT(*) AS n FROM layers WHERE set_id = $1 AND parent_id IS NOT DISTINCT FROM $2 AND NOT removed', [setId, parentId]);
    return Number(result.rows[0].n);
}
async function shiftSiblingsUp(client, setId, parentId, fromIndex) {
    await client.query('UPDATE layers SET index = index + 1 WHERE set_id = $1 AND parent_id IS NOT DISTINCT FROM $2 AND index >= $3 AND NOT removed', [setId, parentId, fromIndex]);
}
async function opLayerSet(client, input, layer) {
    const { op, setId } = input;
    const path = op.payload.path;
    const value = op.payload.value;
    if (typeof path !== 'string')
        throw errors.validation({ path: 'Path is required' });
    if (path === 'name') {
        const name = validateName('value', value, 60);
        if (name instanceof Error)
            throw errors.validation({ value: name.message });
        await client.query('UPDATE layers SET name = $1, version = version + 1 WHERE id = $2 AND set_id = $3', [name, op.target, setId]);
        await writeActivity(client, setId, input.actorId, 'layer.set', op.target, `Renamed layer to ${name}`);
        return await finishOp(client, input, layer.version + 1);
    }
    if (path === 'visible') {
        if (typeof value !== 'boolean')
            throw errors.validation({ value: 'Visible must be true or false' });
        await client.query('UPDATE layers SET visible = $1, version = version + 1 WHERE id = $2 AND set_id = $3', [value, op.target, setId]);
        await writeActivity(client, setId, input.actorId, 'layer.set', op.target, `Set ${layer.name} ${value ? 'visible' : 'hidden'}`);
        return await finishOp(client, input, layer.version + 1);
    }
    if (path === 'position' || path === 'rotation' || path === 'scale') {
        const rule = RANGES[path];
        if (!Array.isArray(value) || value.length !== 3 || !value.every(isFiniteNumber) || !value.every((c) => inRange(rule, c))) {
            throw errors.validation({ value: rule.label });
        }
        await client.query(`UPDATE layers SET ${path} = $1, version = version + 1 WHERE id = $2 AND set_id = $3`, [JSON.stringify(value), op.target, setId]);
        await writeActivity(client, setId, input.actorId, 'layer.set', op.target, `Set ${path} on ${layer.name}`);
        return await finishOp(client, input, layer.version + 1);
    }
    const componentMatch = /^(position|rotation|scale)\.(x|y|z)$/.exec(path);
    if (componentMatch !== null) {
        const [, base, axis] = componentMatch;
        if (!isFiniteNumber(value) || !inRange(RANGES[base], value))
            throw errors.validation({ value: RANGES[base].label });
        const next = [...layer[base]];
        next[axis === 'x' ? 0 : axis === 'y' ? 1 : 2] = value;
        await client.query(`UPDATE layers SET ${base} = $1, version = version + 1 WHERE id = $2 AND set_id = $3`, [JSON.stringify(next), op.target, setId]);
        await writeActivity(client, setId, input.actorId, 'layer.set', op.target, `Set ${path} on ${layer.name} to ${value.toFixed(3)}`);
        return await finishOp(client, input, layer.version + 1);
    }
    const propMatch = /^props\.([a-z_]+)$/.exec(path);
    if (propMatch !== null) {
        const prop = propMatch[1];
        const rule = RANGES[`props.${prop}`];
        if (rule === undefined)
            throw errors.validation({ path: 'Unknown property' });
        if (!isFiniteNumber(value) || !inRange(rule, value))
            throw errors.validation({ value: rule.label });
        if (prop === 'far' && value <= layer.props.near)
            throw errors.validation({ value: RANGES['props.far'].label });
        if (prop === 'near' && value >= layer.props.far)
            throw errors.validation({ value: RANGES['props.far'].label });
        const props = { ...layer.props, [prop]: value };
        await client.query('UPDATE layers SET props = $1, version = version + 1 WHERE id = $2 AND set_id = $3', [JSON.stringify(props), op.target, setId]);
        await writeActivity(client, setId, input.actorId, 'layer.set', op.target, `Set ${prop} on ${layer.name} to ${value.toFixed(3)}`);
        return await finishOp(client, input, layer.version + 1);
    }
    const materialMatch = /^material\.(tint|tint_alpha|albedo_texture_id|emissive_texture_id)$/.exec(path);
    if (materialMatch !== null && layer.material !== null) {
        const field = materialMatch[1];
        if (field === 'tint') {
            if (!Array.isArray(value) || value.length !== 3 || !value.every((c) => isFiniteNumber(c) && inRange(RANGES['material.tint'], c))) {
                throw errors.validation({ value: RANGES['material.tint'].label });
            }
        }
        else if (field === 'tint_alpha') {
            if (!isFiniteNumber(value) || !inRange(RANGES['material.tint_alpha'], value))
                throw errors.validation({ value: RANGES['material.tint_alpha'].label });
        }
        else {
            await assertBindableAsset(client, setId, value, 'texture');
        }
        const material = { ...layer.material };
        if (field === 'tint')
            material.tint = value;
        else if (field === 'tint_alpha')
            material.tint_alpha = value;
        else if (field === 'albedo_texture_id')
            material.albedo_texture_id = typeof value === 'string' ? value : null;
        else
            material.emissive_texture_id = typeof value === 'string' ? value : null;
        await client.query('UPDATE layers SET material = $1, version = version + 1 WHERE id = $2 AND set_id = $3', [JSON.stringify(material), op.target, setId]);
        await writeActivity(client, setId, input.actorId, 'layer.set', op.target, `Set ${field} on ${layer.name}`);
        return await finishOp(client, input, layer.version + 1);
    }
    if (materialMatch !== null) {
        throw errors.validation({ path: 'This layer has no material' });
    }
    if (path === 'model_asset_id') {
        if (value !== null)
            await assertBindableAsset(client, setId, value, 'model');
        await client.query('UPDATE layers SET model_asset_id = $1, version = version + 1 WHERE id = $2 AND set_id = $3', [value, op.target, setId]);
        await writeActivity(client, setId, input.actorId, 'layer.set', op.target, `Set model on ${layer.name}`);
        return await finishOp(client, input, layer.version + 1);
    }
    if (path === 'output_buses') {
        if (layer.kind === 'group' || layer.kind === 'camera' || layer.kind === 'light') {
            throw errors.validation({ path: 'This layer has no output buses' });
        }
        if (!Array.isArray(value) || value.length === 0 || !value.every((bus) => typeof bus === 'string' && OUTPUT_BUSES.includes(bus))) {
            throw errors.validation({ value: 'Output buses must be a non-empty subset of main, side and led' });
        }
        await client.query('UPDATE layers SET output_buses = $1, version = version + 1 WHERE id = $2 AND set_id = $3', [JSON.stringify(value), op.target, setId]);
        await writeActivity(client, setId, input.actorId, 'layer.set', op.target, `Set output buses on ${layer.name}`);
        return await finishOp(client, input, layer.version + 1);
    }
    throw errors.validation({ path: 'Unknown path' });
}
async function assertBindableAsset(client, setId, value, kind) {
    if (value === null || value === undefined)
        return;
    if (typeof value !== 'string')
        throw errors.validation({ value: 'Asset id required' });
    const result = await client.query('SELECT kind, status FROM assets WHERE id = $1 AND set_id = $2', [value, setId]);
    const row = result.rows[0];
    if (row === undefined || row.status !== 'ready' || row.kind !== kind) {
        throw errors.validation({ value: `This ${kind} is not available` });
    }
}
async function opLayerReparent(client, input, layer) {
    const { op, setId } = input;
    const parentId = op.payload.parent_id;
    if (typeof parentId !== 'string' && parentId !== null)
        throw errors.validation({ parent_id: 'Parent must be a layer id or null' });
    if (parentId === layer.id || (parentId !== null && await isDescendant(client, setId, parentId, layer.id))) {
        throw errors.validation({ parent_id: 'A layer cannot be its own ancestor' });
    }
    if (parentId !== null) {
        const parent = await loadLayer(client, setId, parentId);
        if (parent === null)
            throw errors.validation({ parent_id: 'Parent layer not found' });
    }
    await client.query('UPDATE layers SET index = index - 1 WHERE set_id = $1 AND parent_id IS NOT DISTINCT FROM $2 AND index > $3 AND NOT removed', [setId, layer.parent_id, layer.index]);
    const siblingCount = await countChildren(client, setId, parentId) - (parentId === layer.parent_id ? 1 : 0);
    const index = op.payload.index;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > siblingCount) {
        throw errors.validation({ index: `Index must be between 0 and ${siblingCount}` });
    }
    await shiftSiblingsUp(client, setId, parentId, index);
    await client.query('UPDATE layers SET parent_id = $1, index = $2, version = version + 1 WHERE id = $3 AND set_id = $4', [parentId, index, op.target, setId]);
    await writeActivity(client, setId, input.actorId, 'layer.reparent', op.target, `Moved ${layer.name}`);
    return await finishOp(client, input, layer.version + 1);
}
async function isDescendant(client, setId, candidateId, ancestorId) {
    let current = candidateId;
    const seen = new Set();
    while (current !== null) {
        if (current === ancestorId)
            return true;
        if (seen.has(current))
            return false;
        seen.add(current);
        const rows = await client.query('SELECT parent_id FROM layers WHERE id = $1 AND set_id = $2', [current, setId]).then((r) => r.rows);
        current = rows[0]?.parent_id ?? null;
    }
    return false;
}
async function opLayerRemove(client, input, layer) {
    const { op, setId } = input;
    const ids = await collectSubtree(client, setId, layer.id);
    await client.query('UPDATE layers SET index = index - 1 WHERE set_id = $1 AND parent_id IS NOT DISTINCT FROM $2 AND index > $3 AND NOT removed', [setId, layer.parent_id, layer.index]);
    for (const id of ids) {
        await client.query('UPDATE layers SET removed = true, parent_id = null WHERE id = $1 AND set_id = $2', [id, setId]);
        await client.query('DELETE FROM keys WHERE set_id = $1 AND layer_id = $2', [setId, id]);
    }
    await client.query("DELETE FROM graph_nodes WHERE set_id = $1 AND type = 'Layer property' AND params->>'layer_id' = ANY($2)", [setId, ids]);
    const activeResult = await client.query('SELECT active_camera_id FROM sets WHERE id = $1', [setId]);
    const activeCameraId = activeResult.rows[0].active_camera_id;
    if (activeCameraId !== null && ids.includes(activeCameraId)) {
        const next = await client.query("SELECT id FROM layers WHERE set_id = $1 AND kind = 'camera' AND NOT removed ORDER BY parent_id NULLS FIRST, index LIMIT 1", [setId]);
        const nextId = next.rows[0]?.id ?? null;
        await client.query('UPDATE sets SET active_camera_id = $1 WHERE id = $2', [nextId, setId]);
    }
    await writeActivity(client, setId, input.actorId, 'layer.remove', op.target, `Removed ${layer.name}`);
    return await finishOp(client, input, layer.version + 1);
}
async function collectSubtree(client, setId, rootId) {
    const ids = [];
    const stack = [rootId];
    while (stack.length > 0) {
        const id = stack.pop();
        ids.push(id);
        const result = await client.query('SELECT id FROM layers WHERE set_id = $1 AND parent_id = $2 AND NOT removed', [setId, id]);
        for (const row of result.rows)
            stack.push(row.id);
    }
    return ids;
}
async function opShaderSave(client, input, layer) {
    const { op, setId } = input;
    if (layer.kind !== 'shader')
        throw errors.validation({ target: 'Only shader layers have shader versions' });
    const source = op.payload.source;
    if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > 100_000) {
        throw errors.validation({ source: 'Source must be at most 100000 bytes' });
    }
    const number = await nextShaderVersionNumber(client, setId, op.target);
    await client.query('INSERT INTO shader_versions (set_id, layer_id, number, sha256, size, source, author_id, restored_from) VALUES ($1,$2,$3,$4,$5,$6,$7,null)', [setId, op.target, number, sha256Hex(Buffer.from(source, 'utf8')), Buffer.byteLength(source), source, input.actorId]);
    await client.query('UPDATE layers SET shader_version = $1, version = version + 1 WHERE id = $2 AND set_id = $3', [number, op.target, setId]);
    await writeActivity(client, setId, input.actorId, 'shader.save', op.target, `Saved ${layer.name} version ${number}`);
    return await finishOp(client, input, layer.version + 1, { shader_version: number });
}
async function opShaderRestore(client, input, layer) {
    const { op, setId } = input;
    if (layer.kind !== 'shader')
        throw errors.validation({ target: 'Only shader layers have shader versions' });
    const fromVersion = op.payload.from_version;
    if (typeof fromVersion !== 'number' || !Number.isInteger(fromVersion))
        throw errors.validation({ from_version: 'Version number required' });
    const result = await client.query('SELECT source FROM shader_versions WHERE set_id = $1 AND layer_id = $2 AND number = $3', [setId, op.target, fromVersion]);
    const row = result.rows[0];
    if (row === undefined)
        throw errors.notFound();
    const number = await nextShaderVersionNumber(client, setId, op.target);
    await client.query('INSERT INTO shader_versions (set_id, layer_id, number, sha256, size, source, author_id, restored_from) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [setId, op.target, number, sha256Hex(Buffer.from(row.source, 'utf8')), Buffer.byteLength(row.source), row.source, input.actorId, fromVersion]);
    await client.query('UPDATE layers SET shader_version = $1, version = version + 1 WHERE id = $2 AND set_id = $3', [number, op.target, setId]);
    await writeActivity(client, setId, input.actorId, 'shader.restore', op.target, `Restored ${layer.name} from version ${fromVersion}`);
    return await finishOp(client, input, layer.version + 1, { shader_version: number, restored_from: fromVersion });
}
async function opKeySet(client, input, layer) {
    const { op, setId } = input;
    const property = op.payload.property;
    if (typeof property !== 'string' || !KEYABLE_PROPERTIES.includes(property)) {
        throw errors.validation({ property: 'Not a keyable property' });
    }
    if (!keyableFor(layer, property))
        throw errors.validation({ property: 'This layer has no such property' });
    const tick = op.payload.tick;
    if (typeof tick !== 'number' || !Number.isInteger(tick) || tick < 0 || tick >= MAX_TICK) {
        throw errors.validation({ tick: 'Tick must be between 0 and 24575' });
    }
    const value = op.payload.value;
    if (!isFiniteNumber(value))
        throw errors.validation({ value: 'Value must be a number' });
    const snapped = snapToQuarterBeat(tick);
    await client.query('INSERT INTO keys (set_id, layer_id, property, tick, value) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (set_id, layer_id, property, tick) DO UPDATE SET value = $5', [setId, op.target, property, snapped, JSON.stringify(value)]);
    await client.query('UPDATE layers SET version = version + 1 WHERE id = $1 AND set_id = $2', [op.target, setId]);
    await writeActivity(client, setId, input.actorId, 'key.set', op.target, `Keyed ${property} on ${layer.name} at ${barBeatString(snapped)}`);
    return await finishOp(client, input, layer.version + 1);
}
function keyableFor(layer, property) {
    if (property.startsWith('position.') || property.startsWith('rotation.') || property.startsWith('scale.'))
        return true;
    if (property.startsWith('props.')) {
        const prop = property.slice('props.'.length);
        return layer.props[prop] !== undefined;
    }
    if (property === 'material.tint_alpha')
        return layer.material !== null;
    return false;
}
async function opKeyRemove(client, input, layer) {
    const { op, setId } = input;
    const property = op.payload.property;
    const tick = op.payload.tick;
    if (typeof property !== 'string' || typeof tick !== 'number' || !Number.isInteger(tick)) {
        throw errors.validation({ property: 'Property and tick are required' });
    }
    const result = await client.query('DELETE FROM keys WHERE set_id = $1 AND layer_id = $2 AND property = $3 AND tick = $4', [setId, op.target, property, tick]);
    if ((result.rowCount ?? 0) === 0)
        throw errors.notFound();
    await client.query('UPDATE layers SET version = version + 1 WHERE id = $1 AND set_id = $2', [op.target, setId]);
    await writeActivity(client, setId, input.actorId, 'key.remove', op.target, `Removed a key on ${layer.name}`);
    return await finishOp(client, input, layer.version + 1);
}
async function opSetUpdate(client, input) {
    const { op, setId } = input;
    const versionResult = await client.query('SELECT settings_version, bpm, active_camera_id, name FROM sets WHERE id = $1', [setId]);
    const setRow = versionResult.rows[0];
    if (op.baseVersion !== undefined) {
        if (op.baseVersion < setRow.settings_version) {
            throw errors.staleVersion(setRow.settings_version, { name: setRow.name, bpm: Number(setRow.bpm), active_camera_id: setRow.active_camera_id }, await loadLatestChanger(client, setId, 'set'));
        }
        if (op.baseVersion > setRow.settings_version)
            throw errors.validation({ base_version: 'Base version is ahead of the current version' });
    }
    const updates = [];
    const values = [];
    if (op.payload.bpm !== undefined) {
        const bpm = op.payload.bpm;
        if (!isFiniteNumber(bpm) || bpm < 40 || bpm > 240 || Math.round(bpm * 10) !== bpm * 10) {
            throw errors.validation({ bpm: 'BPM must be between 40 and 240 with one decimal place' });
        }
        updates.push('bpm');
        values.push(bpm.toFixed(1));
    }
    if (op.payload.name !== undefined) {
        const name = validateName('name', op.payload.name, 80);
        if (name instanceof Error)
            throw errors.validation({ name: name.message });
        updates.push('name');
        values.push(name);
    }
    if (op.payload.active_camera_id !== undefined) {
        const cameraId = op.payload.active_camera_id;
        if (cameraId !== null) {
            if (typeof cameraId !== 'string')
                throw errors.validation({ active_camera_id: 'Camera layer id required' });
            const camera = await client.query("SELECT 1 FROM layers WHERE id = $1 AND set_id = $2 AND kind = 'camera' AND NOT removed", [cameraId, setId]);
            if ((camera.rowCount ?? 0) === 0)
                throw errors.validation({ active_camera_id: 'Not a camera layer in this set' });
        }
        updates.push('active_camera_id');
        values.push(cameraId);
    }
    if (updates.length === 0)
        throw errors.validation({ payload: 'Nothing to update' });
    const assignments = updates.map((column, i) => `${column} = $${i + 1}`).join(', ');
    await client.query(`UPDATE sets SET ${assignments}, settings_version = settings_version + 1 WHERE id = $${updates.length + 1}`, [...values, setId]);
    await writeActivity(client, setId, input.actorId, 'set.update', 'set', `Updated set ${updates.join(', ')}`);
    return await finishOp(client, input, setRow.settings_version + 1);
}
async function opGraphNodeAdd(client, input) {
    const { op, setId } = input;
    const type = op.payload.type;
    if (typeof type !== 'string' || type.length < 1 || type.length > 60)
        throw errors.validation({ type: 'Node type required' });
    const params = op.payload.params;
    if (params !== undefined && (typeof params !== 'object' || Array.isArray(params)))
        throw errors.validation({ params: 'Params must be an object' });
    const x = op.payload.x;
    const y = op.payload.y;
    if (!isFiniteNumber(x) || !isFiniteNumber(y))
        throw errors.validation({ x: 'Position required' });
    await client.query('INSERT INTO graph_nodes (set_id, node_id, type, params, x, y) VALUES ($1,$2,$3,$4,$5,$6)', [setId, op.payload.node_id ?? op.target, type, JSON.stringify(params ?? {}), x, y]);
    await client.query('UPDATE sets SET graph_version = graph_version + 1 WHERE id = $1', [setId]);
    const versionResult = await client.query('SELECT graph_version FROM sets WHERE id = $1', [setId]);
    const graphVersion = versionResult.rows[0].graph_version;
    await writeActivity(client, setId, input.actorId, 'graph.node.add', String(op.payload.node_id ?? op.target), `Added ${type} node`);
    return await finishOp(client, input, graphVersion);
}
async function opGraphNodeUpdate(client, input) {
    const { op, setId } = input;
    const nodeId = op.payload.node_id;
    if (typeof nodeId !== 'string')
        throw errors.validation({ node_id: 'Node id required' });
    const result = await client.query('SELECT * FROM graph_nodes WHERE set_id = $1 AND node_id = $2', [setId, nodeId]);
    const row = result.rows[0];
    if (row === undefined)
        throw errors.notFound();
    const params = op.payload.params !== undefined ? op.payload.params : row.params;
    if (typeof params !== 'object' || params === null || Array.isArray(params))
        throw errors.validation({ params: 'Params must be an object' });
    const x = op.payload.x !== undefined ? op.payload.x : row.x;
    const y = op.payload.y !== undefined ? op.payload.y : row.y;
    if (!isFiniteNumber(x) || !isFiniteNumber(y))
        throw errors.validation({ x: 'Position required' });
    await client.query('UPDATE graph_nodes SET params = $1, x = $2, y = $3 WHERE set_id = $4 AND node_id = $5', [JSON.stringify(params), x, y, setId, nodeId]);
    await client.query('UPDATE sets SET graph_version = graph_version + 1 WHERE id = $1', [setId]);
    const versionResult = await client.query('SELECT graph_version FROM sets WHERE id = $1', [setId]);
    const graphVersion = versionResult.rows[0].graph_version;
    await writeActivity(client, setId, input.actorId, 'graph.node.update', nodeId, `Updated node ${nodeId}`);
    return await finishOp(client, input, graphVersion);
}
async function opGraphNodeRemove(client, input) {
    const { op, setId } = input;
    const nodeId = op.payload.node_id;
    if (typeof nodeId !== 'string')
        throw errors.validation({ node_id: 'Node id required' });
    const result = await client.query('DELETE FROM graph_nodes WHERE set_id = $1 AND node_id = $2', [setId, nodeId]);
    if ((result.rowCount ?? 0) === 0)
        throw errors.notFound();
    await client.query('DELETE FROM graph_wires WHERE set_id = $1 AND (from_node_id = $2 OR to_node_id = $2)', [setId, nodeId]);
    await client.query('UPDATE sets SET graph_version = graph_version + 1 WHERE id = $1', [setId]);
    const versionResult = await client.query('SELECT graph_version FROM sets WHERE id = $1', [setId]);
    const graphVersion = versionResult.rows[0].graph_version;
    await writeActivity(client, setId, input.actorId, 'graph.node.remove', nodeId, `Removed node ${nodeId}`);
    return await finishOp(client, input, graphVersion);
}
async function opGraphWireAdd(client, input) {
    const { op, setId } = input;
    const from = op.payload.from;
    const to = op.payload.to;
    const fromOk = typeof from === 'object' && from !== null && !Array.isArray(from) && typeof from.node_id === 'string' && typeof from.port === 'string';
    const toOk = typeof to === 'object' && to !== null && !Array.isArray(to) && typeof to.node_id === 'string' && typeof to.port === 'string';
    if (!fromOk || !toOk)
        throw errors.validation({ from: 'From and to ports are required' });
    const fromSpec = from;
    const toSpec = to;
    if (fromSpec.node_id === toSpec.node_id)
        throw errors.validation({ to: 'Wires run from an output to an input' });
    const fromNode = await client.query('SELECT * FROM graph_nodes WHERE set_id = $1 AND node_id = $2', [setId, fromSpec.node_id]);
    const toNode = await client.query('SELECT * FROM graph_nodes WHERE set_id = $1 AND node_id = $2', [setId, toSpec.node_id]);
    const fromRow = fromNode.rows[0];
    const toRow = toNode.rows[0];
    if (fromRow === undefined || toRow === undefined)
        throw errors.notFound();
    // Output must be an output port; input must be an input port.
    const fromPorts = await portsOf(client, setId, fromSpec.node_id);
    if (!fromPorts.outputs.includes(fromSpec.port))
        throw errors.validation({ to: 'Wires run from an output to an input' });
    const toPorts = await portsOf(client, setId, toSpec.node_id);
    if (!toPorts.inputs.includes(toSpec.port))
        throw errors.validation({ to: 'Wires run from an output to an input' });
    const occupied = await client.query('SELECT 1 FROM graph_wires WHERE set_id = $1 AND to_node_id = $2 AND to_port = $3', [setId, toSpec.node_id, toSpec.port]);
    if ((occupied.rowCount ?? 0) > 0)
        throw errors.validation({ to: 'This input already has a wire' });
    if (await wouldCreateCycle(client, setId, toSpec.node_id, fromSpec.node_id)) {
        throw errors.validation({ to: 'This wire would make a loop' });
    }
    await client.query('INSERT INTO graph_wires (set_id, wire_id, from_node_id, from_port, to_node_id, to_port) VALUES ($1,$2,$3,$4,$5,$6)', [setId, op.payload.wire_id ?? op.target, fromSpec.node_id, fromSpec.port, toSpec.node_id, toSpec.port]);
    await client.query('UPDATE sets SET graph_version = graph_version + 1 WHERE id = $1', [setId]);
    const versionResult = await client.query('SELECT graph_version FROM sets WHERE id = $1', [setId]);
    const graphVersion = versionResult.rows[0].graph_version;
    await writeActivity(client, setId, input.actorId, 'graph.wire.add', String(op.payload.wire_id ?? op.target), 'Added a wire');
    return await finishOp(client, input, graphVersion);
}
async function portsOf(client, setId, nodeId) {
    const result = await client.query('SELECT type FROM graph_nodes WHERE set_id = $1 AND node_id = $2', [setId, nodeId]);
    const type = result.rows[0].type;
    const builtIn = {
        'Beat clock': { inputs: [], outputs: ['beat', 'phase'] },
        'LFO': { inputs: ['beat'], outputs: ['value'] },
        'Remap': { inputs: ['in'], outputs: ['out'] },
        'Layer property': { inputs: ['value'], outputs: [] },
    };
    return builtIn[type] ?? { inputs: [], outputs: [] };
}
async function wouldCreateCycle(client, setId, downstream, upstream) {
    // Adding wire from -> to. A cycle appears if `from` is already reachable from `to`.
    const edgesResult = await client.query('SELECT from_node_id, to_node_id FROM graph_wires WHERE set_id = $1', [setId]);
    const edges = new Map();
    for (const row of edgesResult.rows) {
        const list = edges.get(row.from_node_id) ?? [];
        list.push(row.to_node_id);
        edges.set(row.from_node_id, list);
    }
    const stack = [upstream];
    const seen = new Set();
    while (stack.length > 0) {
        const current = stack.pop();
        if (current === downstream)
            return true;
        if (seen.has(current))
            continue;
        seen.add(current);
        for (const next of edges.get(current) ?? [])
            stack.push(next);
    }
    return false;
}
async function opGraphWireRemove(client, input) {
    const { op, setId } = input;
    const wireId = op.payload.wire_id;
    if (typeof wireId !== 'string')
        throw errors.validation({ wire_id: 'Wire id required' });
    const result = await client.query('DELETE FROM graph_wires WHERE set_id = $1 AND wire_id = $2', [setId, wireId]);
    if ((result.rowCount ?? 0) === 0)
        throw errors.notFound();
    await client.query('UPDATE sets SET graph_version = graph_version + 1 WHERE id = $1', [setId]);
    const versionResult = await client.query('SELECT graph_version FROM sets WHERE id = $1', [setId]);
    const graphVersion = versionResult.rows[0].graph_version;
    await writeActivity(client, setId, input.actorId, 'graph.wire.remove', wireId, 'Removed a wire');
    return await finishOp(client, input, graphVersion);
}
async function opScriptAdd(client, input) {
    const { op, setId } = input;
    const name = validateName('name', op.payload.name, 60);
    if (name instanceof Error)
        throw errors.validation({ name: name.message });
    const source = op.payload.source;
    if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > 100_000) {
        throw errors.validation({ source: 'Source must be at most 100000 bytes' });
    }
    await client.query('INSERT INTO scripts (id, set_id, name, version, source, asset_ids) VALUES ($1,$2,$3,1,$4,$5)', [op.target, setId, name, source, JSON.stringify([])]);
    await writeActivity(client, setId, input.actorId, 'script.add', op.target, `Added script ${name}`);
    return await finishOp(client, input, 1);
}
async function opScriptSave(client, input) {
    const { op, setId } = input;
    const result = await client.query('SELECT * FROM scripts WHERE id = $1 AND set_id = $2', [op.target, setId]);
    const row = result.rows[0];
    if (row === undefined)
        throw errors.notFound();
    const source = op.payload.source;
    if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > 100_000) {
        throw errors.validation({ source: 'Source must be at most 100000 bytes' });
    }
    let assetIds = op.payload.asset_ids;
    if (assetIds === undefined)
        assetIds = [];
    if (!Array.isArray(assetIds) || !assetIds.every((id) => typeof id === 'string')) {
        throw errors.validation({ asset_ids: 'Asset ids must be strings' });
    }
    for (const assetId of assetIds) {
        await assertScriptAsset(client, setId, assetId);
    }
    await client.query('UPDATE scripts SET source = $1, asset_ids = $2, version = version + 1 WHERE id = $3 AND set_id = $4', [source, JSON.stringify(assetIds), op.target, setId]);
    await writeActivity(client, setId, input.actorId, 'script.save', op.target, `Saved script ${row.name}`);
    return await finishOp(client, input, row.version + 1);
}
async function assertScriptAsset(client, setId, assetId) {
    const result = await client.query('SELECT kind, status FROM assets WHERE id = $1 AND set_id = $2', [assetId, setId]);
    const row = result.rows[0];
    if (row === undefined || row.status !== 'ready' || row.kind !== 'texture') {
        throw errors.validation({ asset_ids: 'Scripts may use ready textures only' });
    }
}
async function opScriptRemove(client, input) {
    const { op, setId } = input;
    const result = await client.query('DELETE FROM scripts WHERE id = $1 AND set_id = $2 RETURNING name', [op.target, setId]);
    const row = result.rows[0];
    if (row === undefined)
        throw errors.notFound();
    await writeActivity(client, setId, input.actorId, 'script.remove', op.target, `Removed script ${row.name}`);
    return await finishOp(client, input, 1);
}
export async function listOps(deps, ctx) {
    const user = await requireUser(deps, sessionCookieValue(ctx));
    await requireMember(deps, ctx.params.setId, user.id);
    const afterRaw = ctx.url.searchParams.get('after');
    const limitRaw = ctx.url.searchParams.get('limit');
    let after = 0;
    if (afterRaw !== null) {
        const parsed = Number(afterRaw);
        if (!Number.isInteger(parsed) || parsed < 0)
            throw errors.validation({ after: 'After must be a sequence number' });
        after = parsed;
    }
    let limit = 500;
    if (limitRaw !== null) {
        const parsed = Number(limitRaw);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500)
            throw errors.validation({ limit: 'Limit must be between 1 and 500' });
        limit = parsed;
    }
    const result = await deps.pool.query(`SELECT o.seq, o.client_op_id, o.actor_id, o.target, o.type, o.payload, o.committed_at, u.display_name
       FROM ops o JOIN users u ON u.id = o.actor_id
      WHERE o.set_id = $1 AND o.seq > $2 ORDER BY o.seq LIMIT $3`, [ctx.params.setId, after, limit]);
    const headResult = await deps.pool.query('SELECT head FROM sets WHERE id = $1', [ctx.params.setId]);
    jsonOk(ctx, 200, {
        ops: result.rows.map((row) => ({
            seq: Number(row.seq),
            client_op_id: row.client_op_id,
            actor: { user_id: row.actor_id, display_name: row.display_name },
            target: row.target,
            type: row.type,
            payload: row.payload,
            committed_at: row.committed_at.toISOString(),
        })),
        head: Number(headResult.rows[0].head),
    });
}
export const opRoutes = (deps) => ([
    { method: 'POST', path: '/api/sets/:setId/ops', handler: (ctx) => postOp(deps, ctx) },
    { method: 'GET', path: '/api/sets/:setId/ops', handler: (ctx) => listOps(deps, ctx) },
]);
