import { errors } from '../errors.js';
import { newId, sha256Hex } from '../crypto.js';
import { requireMember, requireUser, requireWrite } from '../access.js';
import { jsonOk } from './api.js';
import { sessionCookieValue } from './auth.js';
import { objectKeyForExport, objectKeyForImport } from '../storage.js';
import { writeActivityRecord } from './activity.js';
import { withTransaction } from '../db.js';
import { readSetDocument } from './sets.js';
import { buildZip, parseZip, sha256Hex as zipSha } from '../zip.js';
import { insertLayer } from './sets.js';
export async function createExport(deps, ctx) {
    const user = await requireUser(deps, sessionCookieValue(ctx));
    const role = await requireMember(deps, ctx.params.setId, user.id);
    requireWrite(role);
    const setId = ctx.params.setId;
    const doc = await readSetDocument(deps, setId);
    const exportId = newId();
    const entries = await exportEntries(deps, setId, doc);
    const zip = buildZip(entries);
    try {
        await deps.storage.store(objectKeyForExport(setId, exportId), zip, 'application/zip');
    }
    catch {
        throw errors.storageUnavailable();
    }
    const sha = sha256Hex(zip);
    await deps.pool.query('INSERT INTO exports (id, set_id, sha256, size) VALUES ($1,$2,$3,$4)', [exportId, setId, sha, zip.byteLength]);
    await writeActivityRecord(deps, setId, user.id, 'set.export', exportId, 'Exported the set');
    jsonOk(ctx, 201, { export: { id: exportId, sha256: sha, size: zip.byteLength, download_url: `/api/exports/${exportId}/download` } });
}
async function exportEntries(deps, setId, doc) {
    const setJson = {
        format: 'afterglass-export/1',
        set: doc.set,
        layers: doc.layers,
        keys: doc.keys,
        graph: doc.graph,
        scripts: doc.scripts,
        shaders: [],
    };
    const shaders = [];
    for (const layer of doc.layers) {
        if (layer.kind !== 'shader')
            continue;
        const rows = await deps.pool.query('SELECT number, source, sha256, size, author_id, restored_from, created_at FROM shader_versions WHERE set_id = $1 AND layer_id = $2 ORDER BY number', [setId, layer.id]);
        for (const row of rows.rows) {
            shaders.push({ layer_id: layer.id, version: row.number, source: row.source, sha256: row.sha256, size: Number(row.size), author_id: row.author_id, restored_from: row.restored_from, created_at: row.created_at.toISOString() });
        }
    }
    setJson.shaders = shaders;
    const entries = [{ name: 'set.json', data: Buffer.from(JSON.stringify(setJson), 'utf8') }];
    const assets = await deps.pool.query('SELECT id, name, kind, size, sha256, status FROM assets WHERE set_id = $1 AND status = $2', [setId, 'ready']);
    for (const row of assets.rows) {
        const bytes = await deps.storage.fetch(`sets/${setId}/assets/${row.id}`);
        entries.push({ name: `assets/${row.id}`, data: bytes });
    }
    return entries;
}
export async function exportDownload(deps, ctx) {
    const user = await requireUser(deps, sessionCookieValue(ctx));
    const result = await deps.pool.query('SELECT e.*, s.name AS set_name FROM exports e JOIN sets s ON s.id = e.set_id WHERE e.id = $1', [ctx.params.exportId]);
    const row = result.rows[0];
    if (row === undefined)
        throw errors.notFound();
    await requireMember(deps, row.set_id, user.id);
    let bytes;
    try {
        bytes = await deps.storage.fetch(objectKeyForExport(row.set_id, ctx.params.exportId));
    }
    catch {
        throw errors.storageUnavailable();
    }
    const filename = `${row.set_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.afterglass.zip`;
    ctx.res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Content-SHA256': row.sha256,
    });
    ctx.res.end(bytes);
}
const IMPORT_LIMIT = 50_000_000;
export async function importSet(deps, ctx) {
    const user = await requireUser(deps, sessionCookieValue(ctx));
    const bytes = await readUploadBytes(ctx, IMPORT_LIMIT);
    const importId = newId();
    try {
        await deps.storage.store(objectKeyForImport(importId), bytes, 'application/zip');
    }
    catch {
        throw errors.storageUnavailable();
    }
    const parsed = parseZip(bytes);
    const setJsonBytes = parsed?.entries.get('set.json');
    if (parsed === null || setJsonBytes === undefined) {
        throw errors.validation({ file: 'Not an Afterglass export' });
    }
    let parsedJson;
    try {
        parsedJson = JSON.parse(setJsonBytes.toString('utf8'));
    }
    catch {
        throw errors.validation({ file: 'Not an Afterglass export' });
    }
    const doc = parsedJson;
    if (doc?.format !== 'afterglass-export/1' || !Array.isArray(doc.layers)) {
        throw errors.validation({ file: 'Not an Afterglass export' });
    }
    const idMap = new Map();
    const setId = newId();
    const name = `${doc.set?.name ?? 'Imported set'} (imported)`;
    await withTransaction(deps.pool, async (client) => {
        await client.query('INSERT INTO sets (id, owner_id, name, bpm, show_token) VALUES ($1,$2,$3,$4,$5)', [setId, user.id, name, (doc.set?.bpm ?? 120).toFixed(1), newId().replace(/-/g, '')]);
        await client.query('INSERT INTO members (set_id, user_id, role) VALUES ($1,$2,$3)', [setId, user.id, 'owner']);
        for (const layer of doc.layers ?? []) {
            const newLayerId = newId();
            idMap.set(layer.id, newLayerId);
        }
        for (const layer of doc.layers ?? []) {
            const newLayer = { ...layer, id: idMap.get(layer.id), parent_id: layer.parent_id === null ? null : idMap.get(layer.parent_id) ?? null };
            await insertLayer(client, setId, newLayer);
        }
        const cameraId = doc.set?.active_camera_id !== undefined && doc.set.active_camera_id !== null ? idMap.get(doc.set.active_camera_id) ?? null : null;
        await client.query('UPDATE sets SET active_camera_id = $1 WHERE id = $2', [cameraId, setId]);
        for (const key of doc.keys ?? []) {
            await client.query('INSERT INTO keys (set_id, layer_id, property, tick, value) VALUES ($1,$2,$3,$4,$5)', [setId, idMap.get(key.layer_id) ?? key.layer_id, key.property, key.tick, JSON.stringify(key.value)]);
        }
        for (const node of doc.graph?.nodes ?? []) {
            const nodeId = newId();
            idMap.set(node.node_id, nodeId);
            await client.query('INSERT INTO graph_nodes (set_id, node_id, type, params, x, y) VALUES ($1,$2,$3,$4,$5,$6)', [setId, nodeId, node.type, JSON.stringify(node.params), node.x, node.y]);
        }
        for (const wire of doc.graph?.wires ?? []) {
            await client.query('INSERT INTO graph_wires (set_id, wire_id, from_node_id, from_port, to_node_id, to_port) VALUES ($1,$2,$3,$4,$5,$6)', [setId, newId(), idMap.get(wire.from.node_id) ?? wire.from.node_id, wire.from.port, idMap.get(wire.to.node_id) ?? wire.to.node_id, wire.to.port]);
        }
        for (const script of doc.scripts ?? []) {
            await client.query('INSERT INTO scripts (id, set_id, name, version, source, asset_ids) VALUES ($1,$2,$3,$4,$5,$6)', [newId(), setId, script.name, script.version, script.source, JSON.stringify(script.asset_ids)]);
        }
        for (const shader of doc.shaders ?? []) {
            const layerId = idMap.get(shader.layer_id);
            if (layerId === undefined)
                continue;
            await client.query('INSERT INTO shader_versions (set_id, layer_id, number, sha256, size, source, author_id, restored_from, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [setId, layerId, shader.version, shader.sha256, shader.size, shader.source, user.id, shader.restored_from, new Date(shader.created_at)]);
        }
    });
    // Copy assets into the new set, confirming each write the same way as an upload.
    for (const [name, data] of parsed.entries) {
        if (!name.startsWith('assets/'))
            continue;
        const originalId = name.slice('assets/'.length);
        const newAssetId = newId();
        try {
            const sniff = await detectKind(data);
            await deps.storage.store(`sets/${setId}/assets/${newAssetId}`, data, sniff);
            await deps.pool.query('INSERT INTO assets (id, set_id, name, kind, size, sha256, status) VALUES ($1,$2,$3,$4,$5,$6,$7)', [newAssetId, setId, originalId, sniff === 'model/gltf-binary' ? 'model' : 'texture', data.byteLength, zipSha(data), 'ready']);
        }
        catch {
            // An asset that cannot be stored stays out of the imported set.
        }
    }
    await writeActivityRecord(deps, setId, user.id, 'set.import', setId, `Imported set ${name}`);
    const result = await readSetDocument(deps, setId);
    jsonOk(ctx, 201, result);
}
async function detectKind(data) {
    if (data.length >= 4 && data[0] === 0x67 && data[1] === 0x6c && data[2] === 0x54 && data[3] === 0x66)
        return 'model/gltf-binary';
    if (data.length >= 4 && data[0] === 0x89 && data[1] === 0x50)
        return 'image/png';
    return 'image/jpeg';
}
async function readUploadBytes(ctx, limit) {
    const busboy = (await import('busboy')).default;
    const contentType = ctx.req.headers['content-type'] ?? '';
    const bb = busboy({ headers: { 'content-type': contentType } });
    const files = [];
    const finished = new Promise((resolve, reject) => {
        bb.on('file', (_name, stream, info) => {
            const entry = { name: info.filename, chunks: [] };
            files.push(entry);
            stream.on('data', (chunk) => { entry.chunks.push(chunk); });
            stream.on('end', () => { });
        });
        bb.on('close', () => resolve());
        bb.on('error', reject);
        ctx.req.pipe(bb);
    });
    await finished;
    if (files.length === 0 || files[0].name === '')
        throw errors.validation({ file: 'Choose an export zip' });
    const bytes = Buffer.concat(files[0].chunks);
    if (bytes.byteLength > limit)
        throw errors.tooLarge(limit);
    return bytes;
}
export const exportRoutes = (deps) => ([
    { method: 'POST', path: '/api/sets/:setId/exports', handler: (ctx) => createExport(deps, ctx) },
    { method: 'GET', path: '/api/exports/:exportId/download', handler: (ctx) => exportDownload(deps, ctx) },
    { method: 'POST', path: '/api/sets/import', handler: (ctx) => importSet(deps, ctx) },
]);
