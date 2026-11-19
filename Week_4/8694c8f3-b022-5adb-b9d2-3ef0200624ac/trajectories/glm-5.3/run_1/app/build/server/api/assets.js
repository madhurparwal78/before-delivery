import { errors } from '../errors.js';
import { newId, sha256Hex } from '../crypto.js';
import { requireMember, requireUser, requireWrite, requireOwner } from '../access.js';
import { jsonOk } from './api.js';
import { sessionCookieValue } from './auth.js';
import { objectKeyForAsset } from '../storage.js';
import { writeActivityRecord } from './activity.js';
const MODEL_LIMIT = 20_000_000;
const TEXTURE_LIMIT = 8_000_000;
export function sniffKind(bytes) {
    if (bytes.length >= 4 && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46)
        return 'glb';
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
        return 'png';
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
        return 'jpeg';
    return null;
}
const CONTENT_TYPES = {
    glb: 'model/gltf-binary',
    png: 'image/png',
    jpeg: 'image/jpeg',
};
export async function uploadAsset(deps, ctx) {
    const user = await requireUser(deps, sessionCookieValue(ctx));
    const role = await requireMember(deps, ctx.params.setId, user.id);
    requireWrite(role);
    const parsed = await readMultipart(ctx);
    if (parsed.kind === undefined)
        throw errors.validation({ kind: 'Kind must be model or texture' });
    const limit = parsed.kind === 'model' ? MODEL_LIMIT : TEXTURE_LIMIT;
    if (parsed.bytes.byteLength > limit)
        throw errors.tooLarge(limit);
    const sniffed = sniffKind(parsed.bytes);
    if (sniffed === null
        || (parsed.kind === 'model' && sniffed !== 'glb')
        || (parsed.kind === 'texture' && sniffed !== 'png' && sniffed !== 'jpeg')) {
        throw errors.validation({ file: `Not a valid ${parsed.kind}` });
    }
    const assetId = newId();
    const sha = sha256Hex(parsed.bytes);
    try {
        await deps.storage.store(objectKeyForAsset(ctx.params.setId, assetId), parsed.bytes, CONTENT_TYPES[sniffed]);
    }
    catch {
        // The store failed: the asset row stays as upload failed so the shelf can show it.
        await deps.pool.query('INSERT INTO assets (id, set_id, name, kind, size, sha256, status) VALUES ($1,$2,$3,$4,$5,$6,$7)', [assetId, ctx.params.setId, parsed.name, parsed.kind, parsed.bytes.byteLength, sha, 'upload failed']);
        await writeActivityRecord(deps, ctx.params.setId, user.id, 'asset.upload', assetId, `Uploaded ${parsed.name}`);
        const failed = new (await import('../errors.js')).ApiError(503, 'storage_unavailable', 'Asset storage is unreachable. Uploads and publishing are paused.', { asset: await assetDoc(deps, ctx.params.setId, assetId) });
        throw failed;
    }
    await deps.pool.query('INSERT INTO assets (id, set_id, name, kind, size, sha256, status) VALUES ($1,$2,$3,$4,$5,$6,$7)', [assetId, ctx.params.setId, parsed.name, parsed.kind, parsed.bytes.byteLength, sha, 'ready']);
    await writeActivityRecord(deps, ctx.params.setId, user.id, 'asset.upload', assetId, `Uploaded ${parsed.name}`);
    jsonOk(ctx, 201, { asset: await assetDoc(deps, ctx.params.setId, assetId) });
}
async function readMultipart(ctx) {
    const busboy = (await import('busboy')).default;
    const contentType = ctx.req.headers['content-type'] ?? '';
    const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
    if (match === null)
        throw errors.unsupportedMediaType(contentType);
    const bb = busboy({ headers: { 'content-type': contentType } });
    const fields = new Map();
    const files = new Map();
    const failure = new Promise((_, reject) => {
        bb.on('error', reject);
        ctx.req.on('error', reject);
    });
    const finished = new Promise((resolve, reject) => {
        bb.on('field', (name, value) => { fields.set(name, value); });
        bb.on('file', (name, stream, info) => {
            const chunks = [];
            stream.on('data', (chunk) => chunks.push(chunk));
            stream.on('end', () => { files.set(name, { name: info.filename, bytes: chunks }); });
        });
        bb.on('close', resolve);
        bb.on('finish', resolve);
        ctx.req.pipe(bb);
        bb.on('error', reject);
    });
    await Promise.race([finished, failure]);
    const kindText = fields.get('kind');
    const kind = kindText === 'model' || kindText === 'texture' ? kindText : undefined;
    const file = files.get('file');
    if (file === undefined)
        throw errors.validation({ file: 'Choose a GLB or texture file' });
    return { kind, name: file.name, bytes: Buffer.concat(file.bytes) };
}
export async function listAssets(deps, ctx) {
    const user = await requireUser(deps, sessionCookieValue(ctx));
    await requireMember(deps, ctx.params.setId, user.id);
    const result = await deps.pool.query('SELECT id FROM assets WHERE set_id = $1 ORDER BY created_at', [ctx.params.setId]);
    const assets = [];
    for (const row of result.rows) {
        assets.push(await assetDoc(deps, ctx.params.setId, row.id));
    }
    jsonOk(ctx, 200, { assets });
}
export async function assetDoc(deps, setId, assetId) {
    const result = await deps.pool.query('SELECT * FROM assets WHERE id = $1 AND set_id = $2', [assetId, setId]);
    const row = result.rows[0];
    if (row === undefined)
        throw errors.notFound();
    const dependents = await dependentsOf(deps, setId, assetId);
    return {
        id: row.id,
        name: row.name,
        kind: row.kind,
        size: Number(row.size),
        sha256: row.sha256,
        status: row.status,
        created_at: row.created_at.toISOString(),
        dependents,
    };
}
export async function dependentsOf(deps, setId, assetId) {
    const layers = await deps.pool.query('SELECT id, name FROM layers WHERE set_id = $1 AND NOT removed AND model_asset_id = $2', [setId, assetId]);
    const materials = await deps.pool.query(`SELECT id, name FROM layers WHERE set_id = $1 AND NOT removed
      AND (material->>'albedo_texture_id' = $2 OR material->>'emissive_texture_id' = $2)`, [setId, assetId]);
    const scripts = await deps.pool.query(`SELECT id, name FROM scripts WHERE set_id = $1 AND asset_ids @> $2::jsonb`, [setId, JSON.stringify([assetId])]);
    const layerRows = layers.rows;
    const materialRows = materials.rows;
    const scriptRows = scripts.rows;
    return {
        count: layerRows.length + materialRows.length + scriptRows.length,
        layers: layerRows,
        materials: materialRows.map((row) => ({ layer_id: row.id, name: row.name })),
        scripts: scriptRows,
    };
}
export async function assetContent(deps, ctx) {
    const user = await requireUser(deps, sessionCookieValue(ctx));
    const result = await deps.pool.query('SELECT a.*, s.id AS set_id FROM assets a JOIN sets s ON s.id = a.set_id WHERE a.id = $1', [ctx.params.assetId]);
    const row = result.rows[0];
    if (row === undefined)
        throw errors.notFound();
    await requireMember(deps, row.set_id, user.id);
    if (row.status !== 'ready')
        throw errors.assetNotReady();
    let bytes;
    try {
        bytes = await deps.storage.fetch(objectKeyForAsset(row.set_id, row.id));
    }
    catch {
        throw errors.storageUnavailable();
    }
    ctx.res.writeHead(200, { 'Content-Type': row.kind === 'model' ? 'model/gltf-binary' : row.kind === 'texture' ? guessTextureType(bytes) : 'application/octet-stream', 'X-Content-SHA256': row.sha256 });
    ctx.res.end(bytes);
}
function guessTextureType(bytes) {
    const sniffed = sniffKind(bytes);
    return sniffed === 'png' ? 'image/png' : sniffed === 'jpeg' ? 'image/jpeg' : 'application/octet-stream';
}
export async function deleteAsset(deps, ctx) {
    const user = await requireUser(deps, sessionCookieValue(ctx));
    const role = await requireMember(deps, ctx.params.setId, user.id);
    requireOwner(role);
    const { setId, assetId } = ctx.params;
    const result = await deps.pool.query('SELECT * FROM assets WHERE id = $1 AND set_id = $2', [assetId, setId]);
    const row = result.rows[0];
    if (row === undefined)
        throw errors.notFound();
    if (row.status === 'ready') {
        const dependents = await dependentsOf(deps, setId, assetId);
        if (dependents.count > 0)
            throw errors.assetInUse(dependents);
        const shows = await deps.pool.query(`SELECT DISTINCT v.number FROM show_versions v JOIN show_assets sa ON sa.set_id = v.set_id AND sa.version_number = v.number
        WHERE v.set_id = $1 AND sa.asset_id = $2 AND v.status IN ('published', 'storing')`, [setId, assetId]);
        const versions = shows.rows.map((r) => r.number).sort((a, b) => a - b);
        if (versions.length > 0)
            throw errors.assetInShows(versions);
    }
    try {
        await deps.storage.remove(objectKeyForAsset(setId, assetId));
    }
    catch {
        throw errors.storageUnavailable();
    }
    await deps.pool.query('DELETE FROM assets WHERE id = $1 AND set_id = $2', [assetId, setId]);
    await writeActivityRecord(deps, setId, user.id, 'asset.delete', assetId, `Deleted ${row.name}`);
    ctx.res.writeHead(204);
    ctx.res.end();
}
export const assetRoutes = (deps) => ([
    { method: 'POST', path: '/api/sets/:setId/assets', handler: (ctx) => uploadAsset(deps, ctx) },
    { method: 'GET', path: '/api/sets/:setId/assets', handler: (ctx) => listAssets(deps, ctx) },
    { method: 'GET', path: '/api/assets/:assetId/content', handler: (ctx) => assetContent(deps, ctx) },
    { method: 'DELETE', path: '/api/sets/:setId/assets/:assetId', handler: (ctx) => deleteAsset(deps, ctx) },
]);
