import { errors } from '../errors.js';
import { sha256Hex } from '../crypto.js';
import { withTransaction } from '../db.js';
import { requireMember, requireUser, requireOwner } from '../access.js';
import { jsonOk, readBody } from './api.js';
import { sessionCookieValue } from './auth.js';
import { objectKeyForAsset, objectKeyForBundle } from '../storage.js';
import { writeActivity } from './activity.js';
import { readSetDocument } from './sets.js';
export async function publishShow(deps, ctx) {
    const user = await requireUser(deps, sessionCookieValue(ctx));
    const role = await requireMember(deps, ctx.params.setId, user.id);
    requireOwner(role);
    const body = await readBody(ctx, 1_000_000);
    if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 200)) {
        throw errors.validation({ note: 'Note must be at most 200 characters' });
    }
    const setId = ctx.params.setId;
    const doc = await readSetDocument(deps, setId);
    const assetRows = await deps.pool.query('SELECT id FROM assets WHERE set_id = $1 AND status = $2', [setId, 'ready']);
    const referencedAssets = await collectReferencedAssets(deps, setId, doc);
    for (const assetId of referencedAssets) {
        const ready = assetRows.rows.some((row) => row.id === assetId);
        if (!ready)
            throw errors.assetNotReady();
    }
    const number = await nextShowNumber(deps, setId);
    const bundle = await buildBundle(deps, setId, number);
    await deps.pool.query("INSERT INTO show_versions (set_id, number, status, note, published_by) VALUES ($1,$2,'storing',$3,$4)", [setId, number, typeof body.note === 'string' ? body.note : null, user.id]);
    const objectKey = objectKeyForBundle(setId, number);
    let sha;
    let size;
    try {
        await deps.storage.store(objectKey, bundle, 'application/json');
        sha = shaOf(bundle);
        size = bundle.byteLength;
    }
    catch {
        await withTransaction(deps.pool, async (client) => {
            await client.query("UPDATE show_versions SET status = 'store failed' WHERE set_id = $1 AND number = $2", [setId, number]);
            await writeActivity(client, setId, user.id, 'show.store_failed', String(number), `Publish of version ${number} failed`);
        });
        const liveRow = await deps.pool.query('SELECT live_number FROM live_pointer WHERE set_id = $1', [setId]);
        const live = liveRow.rows[0];
        throw new (await import('../errors.js')).ApiError(503, 'storage_unavailable', live?.live_number != null
            ? `Publish failed. Version ${live.live_number} is still live.`
            : 'Publish failed. Nothing is live yet.', { show_version: { number, status: 'store failed', live: false } });
    }
    const publishedAt = new Date();
    await withTransaction(deps.pool, async (client) => {
        await client.query("UPDATE show_versions SET status = 'published', sha256 = $1, size = $2, published_at = $3 WHERE set_id = $4 AND number = $5", [sha, size, publishedAt, setId, number]);
        await client.query('INSERT INTO live_pointer (set_id, live_number) VALUES ($1,$2) ON CONFLICT (set_id) DO UPDATE SET live_number = $2', [setId, number]);
        for (const assetId of referencedAssets) {
            await client.query('INSERT INTO show_assets (set_id, version_number, asset_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [setId, number, assetId]);
        }
        await writeActivity(client, setId, user.id, 'show.publish', String(number), `Published version ${number}`);
    });
    await publishShowEvent(deps, setId, number);
    jsonOk(ctx, 201, {
        show_version: {
            number,
            status: 'published',
            live: true,
            sha256: sha,
            size,
            published_at: publishedAt.toISOString(),
            published_by: { user_id: user.id, display_name: user.display_name },
            note: typeof body.note === 'string' ? body.note : null,
        },
    });
}
function shaOf(bytes) {
    return sha256Hex(bytes);
}
async function nextShowNumber(deps, setId) {
    const result = await deps.pool.query('SELECT COALESCE(MAX(number), 0) AS max FROM show_versions WHERE set_id = $1', [setId]);
    return Number(result.rows[0].max) + 1;
}
async function collectReferencedAssets(deps, setId, doc) {
    const ids = new Set();
    for (const layer of doc.layers) {
        if (layer.model_asset_id !== null)
            ids.add(layer.model_asset_id);
        if (layer.material?.albedo_texture_id != null)
            ids.add(layer.material.albedo_texture_id);
        if (layer.material?.emissive_texture_id != null)
            ids.add(layer.material.emissive_texture_id);
    }
    for (const script of doc.scripts) {
        for (const assetId of script.asset_ids)
            ids.add(assetId);
    }
    return [...ids];
}
async function buildBundle(deps, setId, number) {
    void number;
    const doc = await readSetDocument(deps, setId);
    const shaders = [];
    for (const layer of doc.layers) {
        if (layer.kind === 'shader') {
            const result = await deps.pool.query('SELECT source FROM shader_versions WHERE set_id = $1 AND layer_id = $2 ORDER BY number DESC LIMIT 1', [setId, layer.id]);
            const row = result.rows[0];
            shaders.push({ layer_id: layer.id, version: layer.shader_version ?? 1, source: row?.source ?? '' });
        }
    }
    const referenced = await collectReferencedAssets(deps, setId, doc);
    const assets = [];
    for (const assetId of referenced) {
        const result = await deps.pool.query('SELECT id, name, kind, size, sha256 FROM assets WHERE id = $1 AND set_id = $2 AND status = $3', [assetId, setId, 'ready']);
        const row = result.rows[0];
        if (row !== undefined)
            assets.push({ id: row.id, name: row.name, kind: row.kind, size: Number(row.size), sha256: row.sha256 });
    }
    const bundle = {
        format: 'afterglass-show/1',
        set: { name: doc.set.name, bpm: doc.set.bpm, active_camera_id: doc.set.active_camera_id },
        layers: doc.layers,
        keys: doc.keys,
        graph: doc.graph,
        shaders,
        scripts: doc.scripts,
        assets,
    };
    return Buffer.from(JSON.stringify(bundle), 'utf8');
}
export async function listShows(deps, ctx) {
    const user = await requireUser(deps, sessionCookieValue(ctx));
    await requireMember(deps, ctx.params.setId, user.id);
    const setResult = await deps.pool.query('SELECT show_token FROM sets WHERE id = $1', [ctx.params.setId]);
    const versions = await deps.pool.query(`SELECT v.number, v.status, v.sha256, v.size, v.published_at, v.note, u.id AS user_id, u.display_name,
            (SELECT live_number FROM live_pointer WHERE set_id = v.set_id) AS live_number
       FROM show_versions v LEFT JOIN users u ON u.id = v.published_by
      WHERE v.set_id = $1 ORDER BY v.number DESC`, [ctx.params.setId]);
    const live = versions.rows[0]?.live_number ?? null;
    jsonOk(ctx, 200, {
        show_url: `/show/${setResult.rows[0].show_token}`,
        live_number: live,
        versions: versions.rows.map((row) => ({
            number: row.number,
            status: row.status,
            live: row.number === live,
            sha256: row.sha256,
            size: row.size === null ? null : Number(row.size),
            published_at: row.published_at === null ? null : row.published_at.toISOString(),
            published_by: row.user_id === null ? null : { user_id: row.user_id, display_name: row.display_name },
            note: row.note,
        })),
    });
}
async function moveLivePointer(client, setId, target, previous) {
    await client.query('INSERT INTO live_pointer (set_id, live_number) VALUES ($1,$2) ON CONFLICT (set_id) DO UPDATE SET live_number = $2', [setId, target]);
}
export async function rollbackShow(deps, ctx) {
    const user = await requireUser(deps, sessionCookieValue(ctx));
    const role = await requireMember(deps, ctx.params.setId, user.id);
    requireOwner(role);
    const setId = ctx.params.setId;
    const current = await deps.pool.query('SELECT live_number FROM live_pointer WHERE set_id = $1', [setId]);
    const liveNumber = current.rows[0]?.live_number ?? null;
    const candidates = await deps.pool.query("SELECT number FROM show_versions WHERE set_id = $1 AND status = 'published' AND number < $2 ORDER BY number DESC LIMIT 1", [setId, liveNumber ?? Number.MAX_SAFE_INTEGER]);
    const target = candidates.rows[0]?.number;
    if (target === undefined)
        throw errors.noPreviousVersion();
    await withTransaction(deps.pool, async (client) => {
        await moveLivePointer(client, setId, target, liveNumber);
        await writeActivity(client, setId, user.id, 'show.rollback', String(target), `Rolled back to version ${target}`);
    });
    await publishShowEvent(deps, setId, target);
    jsonOk(ctx, 200, { live_number: target, previous_live_number: liveNumber });
}
export async function activateShow(deps, ctx) {
    const user = await requireUser(deps, sessionCookieValue(ctx));
    const role = await requireMember(deps, ctx.params.setId, user.id);
    requireOwner(role);
    const setId = ctx.params.setId;
    const number = Number(ctx.params.number);
    if (!Number.isInteger(number))
        throw errors.notFound();
    const version = await deps.pool.query("SELECT status FROM show_versions WHERE set_id = $1 AND number = $2", [setId, number]);
    const row = version.rows[0];
    if (row === undefined)
        throw errors.notFound();
    if (row.status !== 'published')
        throw errors.notPublished();
    const current = await deps.pool.query('SELECT live_number FROM live_pointer WHERE set_id = $1', [setId]);
    const liveNumber = current.rows[0]?.live_number ?? null;
    await withTransaction(deps.pool, async (client) => {
        await moveLivePointer(client, setId, number, liveNumber);
        await writeActivity(client, setId, user.id, 'show.activate', String(number), `Made version ${number} live`);
    });
    await publishShowEvent(deps, setId, number);
    jsonOk(ctx, 200, { live_number: number, previous_live_number: liveNumber });
}
async function publishShowEvent(deps, setId, liveNumber) {
    const message = JSON.stringify({ kind: 'show', body: { live_number: liveNumber } });
    await deps.collab.publish(`afterglass:set:${setId}`, message).catch(() => { });
    const result = await deps.pool.query('SELECT show_token FROM sets WHERE id = $1', [setId]);
    const token = result.rows[0]?.show_token;
    if (token !== undefined) {
        await deps.collab.publish(`afterglass:show:${token}`, message).catch(() => { });
    }
}
export async function showInfo(deps, ctx) {
    const result = await deps.pool.query(`SELECT s.name, s.bpm, v.number, v.sha256, v.size, v.published_at
       FROM sets s
       JOIN live_pointer p ON p.set_id = s.id
       JOIN show_versions v ON v.set_id = s.id AND v.number = p.live_number
      WHERE s.show_token = $1`, [ctx.params.token]);
    const row = result.rows[0];
    if (row === undefined)
        throw errors.notFound();
    jsonOk(ctx, 200, {
        set_name: row.name,
        bpm: Number(row.bpm),
        version: { number: row.number, sha256: row.sha256, size: Number(row.size), published_at: row.published_at.toISOString() },
    });
}
export async function showBundle(deps, ctx) {
    const found = await findLiveVersion(deps, ctx.params.token);
    if (found === null)
        throw errors.notFound();
    const { setId, number, sha } = found;
    let bytes;
    try {
        bytes = await deps.storage.fetch(objectKeyForBundle(setId, number));
    }
    catch {
        throw errors.storageUnavailable();
    }
    ctx.res.writeHead(200, { 'Content-Type': 'application/json', 'X-Bundle-SHA256': sha, 'X-Show-Version': String(number) });
    ctx.res.end(bytes);
}
export async function showAsset(deps, ctx) {
    const found = await findLiveVersion(deps, ctx.params.token);
    if (found === null)
        throw errors.notFound();
    const listed = await deps.pool.query('SELECT 1 FROM show_assets WHERE set_id = $1 AND version_number = $2 AND asset_id = $3', [found.setId, found.number, ctx.params.assetId]);
    if ((listed.rowCount ?? 0) === 0)
        throw errors.notFound();
    const assetRow = await deps.pool.query('SELECT kind, sha256, status FROM assets WHERE id = $1 AND set_id = $2', [ctx.params.assetId, found.setId]);
    const asset = assetRow.rows[0];
    if (asset === undefined)
        throw errors.notFound();
    let bytes;
    try {
        bytes = await deps.storage.fetch(objectKeyForAsset(found.setId, ctx.params.assetId));
    }
    catch {
        throw errors.storageUnavailable();
    }
    ctx.res.writeHead(200, { 'Content-Type': asset.kind === 'model' ? 'model/gltf-binary' : 'image/png', 'X-Content-SHA256': asset.sha256 });
    ctx.res.end(bytes);
}
async function findLiveVersion(deps, token) {
    const result = await deps.pool.query(`SELECT s.id AS set_id, v.number, v.sha256
       FROM sets s
       JOIN live_pointer p ON p.set_id = s.id
       JOIN show_versions v ON v.set_id = s.id AND v.number = p.live_number
      WHERE s.show_token = $1 AND v.status = 'published'`, [token]);
    const row = result.rows[0];
    if (row === undefined)
        return null;
    return { setId: row.set_id, number: row.number, sha: row.sha256 };
}
// The show page follows the live pointer through this stream.
export function makeShowEventStream(deps, ctx) {
    const token = ctx.params.token;
    ctx.res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
    });
    const write = (data) => {
        ctx.res.write(`event: show\ndata: ${data}\n\n`);
    };
    const onMessage = (message) => {
        try {
            const parsed = JSON.parse(message);
            if (parsed.kind === 'show')
                write(JSON.stringify(parsed.body));
        }
        catch {
            // A malformed relay message is dropped; the stream stays open.
        }
    };
    void deps.collab.subscribe(`afterglass:show:${token}`, onMessage).catch(() => {
        // Without Valkey the stream stays open but silent; the page polls.
    });
}
export const showRoutes = (deps) => ([
    { method: 'POST', path: '/api/sets/:setId/shows', handler: (ctx) => publishShow(deps, ctx) },
    { method: 'GET', path: '/api/sets/:setId/shows', handler: (ctx) => listShows(deps, ctx) },
    { method: 'POST', path: '/api/sets/:setId/shows/rollback', handler: (ctx) => rollbackShow(deps, ctx) },
    { method: 'POST', path: '/api/sets/:setId/shows/:number/activate', handler: (ctx) => activateShow(deps, ctx) },
    { method: 'GET', path: '/api/show/:token', handler: (ctx) => showInfo(deps, ctx) },
    { method: 'GET', path: '/api/show/:token/bundle', handler: (ctx) => showBundle(deps, ctx) },
    { method: 'GET', path: '/api/show/:token/assets/:assetId', handler: (ctx) => showAsset(deps, ctx) },
    { method: 'GET', path: '/api/show/:token/events', handler: (ctx) => makeShowEventStream(deps, ctx) },
]);
