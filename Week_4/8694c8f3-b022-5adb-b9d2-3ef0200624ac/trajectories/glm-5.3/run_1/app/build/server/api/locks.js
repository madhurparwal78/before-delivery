import { errors } from '../errors.js';
import { requireMember, requireUser, requireWrite, membership } from '../access.js';
import { jsonOk, readBody } from './api.js';
import { sessionCookieValue } from './auth.js';
import { colourForJoinOrder } from '../collab.js';
const LOCK_TTL_SECONDS = 30;
async function holderName(deps, userId) {
    const result = await deps.pool.query('SELECT id, display_name FROM users WHERE id = $1', [userId]);
    const row = result.rows[0];
    return { user_id: userId, display_name: row?.display_name ?? 'Someone' };
}
async function assertCollab(deps) {
    if (!(await deps.collab.probe()))
        throw errors.collabOffline();
}
export async function takeLock(deps, ctx) {
    const user = await requireUser(deps, sessionCookieValue(ctx));
    const role = await requireMember(deps, ctx.params.setId, user.id);
    requireWrite(role);
    const { setId, layerId } = ctx.params;
    await assertLayerExists(deps, setId, layerId);
    await assertCollab(deps);
    const existing = await deps.collab.getLock(setId, layerId);
    const serverTime = new Date().toISOString();
    if (existing !== null && existing.holder !== user.id) {
        const holder = await holderName(deps, existing.holder);
        const expiresAt = new Date(Date.now() + existing.pttl).toISOString();
        throw errors.lockHeld(holder, expiresAt);
    }
    if (existing !== null && existing.holder === user.id) {
        await deps.collab.renewLock(setId, layerId, user.id);
        const expiresAt = new Date(Date.now() + LOCK_TTL_SECONDS * 1000).toISOString();
        const holder = await holderName(deps, user.id);
        await publishLock(deps, setId, { layer_id: layerId, holder, expires_at: expiresAt, reason: 'renewed' });
        jsonOk(ctx, 200, { layer_id: layerId, holder, expires_at: expiresAt, server_time: serverTime, ttl_seconds: LOCK_TTL_SECONDS });
        return;
    }
    const granted = await deps.collab.setLock(setId, layerId, user.id);
    if (!granted) {
        const nowExisting = await deps.collab.getLock(setId, layerId);
        const holderId = nowExisting?.holder ?? user.id;
        const holder = await holderName(deps, holderId);
        const expiresAt = new Date(Date.now() + (nowExisting?.pttl ?? LOCK_TTL_SECONDS * 1000)).toISOString();
        throw errors.lockHeld(holder, expiresAt);
    }
    const expiresAt = new Date(Date.now() + LOCK_TTL_SECONDS * 1000).toISOString();
    const holder = await holderName(deps, user.id);
    await publishLock(deps, setId, { layer_id: layerId, holder, expires_at: expiresAt, reason: 'granted' });
    jsonOk(ctx, 201, { layer_id: layerId, holder, expires_at: expiresAt, server_time: serverTime, ttl_seconds: LOCK_TTL_SECONDS });
}
async function assertLayerExists(deps, setId, layerId) {
    const result = await deps.pool.query('SELECT 1 FROM layers WHERE id = $1 AND set_id = $2 AND NOT removed', [layerId, setId]);
    if ((result.rowCount ?? 0) === 0)
        throw errors.notFound();
}
async function publishLock(deps, setId, body) {
    await deps.collab.publish(`afterglass:set:${setId}`, JSON.stringify({ kind: 'lock', body })).catch(() => { });
}
export async function heartbeatLock(deps, ctx) {
    const user = await requireUser(deps, sessionCookieValue(ctx));
    const role = await requireMember(deps, ctx.params.setId, user.id);
    requireWrite(role);
    const { setId, layerId } = ctx.params;
    await assertCollab(deps);
    const renewed = await deps.collab.renewLock(setId, layerId, user.id);
    if (!renewed)
        throw errors.lockNotHeld();
    const expiresAt = new Date(Date.now() + LOCK_TTL_SECONDS * 1000).toISOString();
    const holder = await holderName(deps, user.id);
    await publishLock(deps, setId, { layer_id: layerId, holder, expires_at: expiresAt, reason: 'renewed' });
    jsonOk(ctx, 200, { layer_id: layerId, expires_at: expiresAt, server_time: new Date().toISOString() });
}
export async function releaseLock(deps, ctx) {
    const user = await requireUser(deps, sessionCookieValue(ctx));
    const role = await requireMember(deps, ctx.params.setId, user.id);
    const { setId, layerId } = ctx.params;
    const isOwner = role === 'owner';
    if (!isOwner)
        requireWrite(role);
    await assertCollab(deps);
    const existing = await deps.collab.getLock(setId, layerId);
    if (existing === null)
        throw errors.lockNotHeld();
    if (existing.holder !== user.id && !isOwner)
        throw errors.forbidden();
    if (existing.holder === user.id) {
        await deps.collab.releaseLock(setId, layerId, user.id);
    }
    else {
        await deps.collab.removeLock(setId, layerId);
        await recordForceRelease(deps, setId, layerId, existing.holder, user.id);
    }
    const holder = await holderName(deps, existing.holder);
    await publishLock(deps, setId, { layer_id: layerId, holder: null, expires_at: null, reason: 'released' });
    ctx.res.writeHead(204);
    ctx.res.end();
}
async function recordForceRelease(deps, setId, layerId, heldBy, actorId) {
    const { writeActivityRecord } = await import('./activity.js');
    await writeActivityRecord(deps, setId, actorId, 'lock.force_release', layerId, `Force released lock held by ${heldBy}`);
}
export async function listLocks(deps, ctx) {
    const user = await requireUser(deps, sessionCookieValue(ctx));
    await requireMember(deps, ctx.params.setId, user.id);
    await assertCollab(deps);
    const layers = await deps.pool.query('SELECT id FROM layers WHERE set_id = $1 AND NOT removed', [ctx.params.setId]);
    const locks = [];
    for (const row of layers.rows) {
        const existing = await deps.collab.getLock(ctx.params.setId, row.id);
        if (existing !== null) {
            locks.push({ layer_id: row.id, holder: await holderName(deps, existing.holder), expires_at: new Date(Date.now() + existing.pttl).toISOString() });
        }
    }
    jsonOk(ctx, 200, { server_time: new Date().toISOString(), locks });
}
export async function postPresence(deps, ctx) {
    const user = await requireUser(deps, sessionCookieValue(ctx));
    const role = await requireMember(deps, ctx.params.setId, user.id);
    requireWrite(role);
    const body = await readBody(ctx, 1_000_000);
    let selection = null;
    if (body.selection !== undefined && body.selection !== null) {
        if (typeof body.selection !== 'string')
            throw errors.validation({ selection: 'Selection must be a layer id or null' });
        selection = body.selection;
    }
    await assertCollab(deps);
    const order = await joinOrder(deps, ctx.params.setId, user.id);
    const colour = colourForJoinOrder(order);
    const value = JSON.stringify({ display_name: user.display_name, colour, selection });
    await deps.collab.postPresence(ctx.params.setId, user.id, value);
    const members = await presenceMembers(deps, ctx.params.setId);
    await publishPresence(deps, ctx.params.setId, members);
    jsonOk(ctx, 200, { members });
}
export async function getPresence(deps, ctx) {
    const user = await requireUser(deps, sessionCookieValue(ctx));
    await requireMember(deps, ctx.params.setId, user.id);
    await assertCollab(deps);
    const members = await presenceMembers(deps, ctx.params.setId);
    jsonOk(ctx, 200, { members });
}
async function joinOrder(deps, setId, userId) {
    const result = await deps.pool.query('SELECT user_id FROM members WHERE set_id = $1 ORDER BY joined_at', [setId]);
    const order = result.rows.findIndex((row) => row.user_id === userId);
    return order === -1 ? 0 : order;
}
export async function presenceMembers(deps, setId) {
    const keys = await deps.collab.presenceKeys(setId);
    const members = [];
    for (const key of keys) {
        const value = await deps.collab.presenceGet(key);
        if (value === null)
            continue;
        const parsed = JSON.parse(value);
        const userId = key.slice(`afterglass:presence:${setId}:`.length);
        members.push({ user_id: userId, display_name: parsed.display_name, colour: parsed.colour, selection: parsed.selection });
    }
    return members;
}
async function publishPresence(deps, setId, members) {
    await deps.collab.publish(`afterglass:set:${setId}`, JSON.stringify({ kind: 'presence', body: { members } })).catch(() => { });
}
export const lockRoutes = (deps) => ([
    { method: 'POST', path: '/api/sets/:setId/layers/:layerId/lock', handler: (ctx) => takeLock(deps, ctx) },
    { method: 'POST', path: '/api/sets/:setId/layers/:layerId/lock/heartbeat', handler: (ctx) => heartbeatLock(deps, ctx) },
    { method: 'DELETE', path: '/api/sets/:setId/layers/:layerId/lock', handler: (ctx) => releaseLock(deps, ctx) },
    { method: 'GET', path: '/api/sets/:setId/locks', handler: (ctx) => listLocks(deps, ctx) },
    { method: 'POST', path: '/api/sets/:setId/presence', handler: (ctx) => postPresence(deps, ctx) },
    { method: 'GET', path: '/api/sets/:setId/presence', handler: (ctx) => getPresence(deps, ctx) },
]);
export { membership };
