import { pool } from '../db.js';
import { ApiError, Err, fieldError } from '../errors.js';
import { asString } from '../input.js';
import type { Ctx, Reply } from '../http.js';
import { requireEditor, requireMembership, type Membership } from '../access.js';
import {
  acquireLease,
  listLeases,
  readLease,
  readPresence,
  releaseLease,
  renewLease,
  writePresence,
} from '../collab.js';
import { emit } from '../events.js';
import { readLayer } from '../domain/document.js';
import { writeActivity } from '../domain/activitylog.js';
import { LOCK_TTL_SECONDS, presenceColour } from '../../shared/domain.js';
import type { Actor, PresenceMember } from '../../shared/types.js';

async function actorFor(userId: string): Promise<Actor> {
  const result = await pool.query<Actor>(`select id as user_id, display_name from users where id = $1`, [
    userId,
  ]);
  return result.rows[0] ?? { user_id: userId, display_name: 'Editor' };
}

async function layerOr404(membership: Membership, layerId: string): Promise<string> {
  const layer = await readLayer(pool, membership.setId, layerId);
  if (layer === null) throw Err.notFound();
  return layer.name;
}

export async function takeLock(ctx: Ctx): Promise<Reply> {
  const membership = requireEditor(await requireMembership(ctx, ctx.params['id'] ?? ''));
  const layerId = ctx.params['layerId'] ?? '';
  await layerOr404(membership, layerId);
  const existing = await readLease(membership.setId, layerId);
  const alreadyMine = existing !== null && existing.userId === membership.user.id;
  const lease = await acquireLease(membership.setId, layerId, membership.user.id);
  if (lease === null) {
    const held = await readLease(membership.setId, layerId);
    const holder = await actorFor(held?.userId ?? '');
    throw new ApiError(409, 'lock_held', `Locked by ${holder.display_name}`, {
      holder,
      expires_at: held?.expiresAt.toISOString() ?? null,
    });
  }
  const holder: Actor = { user_id: membership.user.id, display_name: membership.user.display_name };
  const body = {
    layer_id: layerId,
    holder,
    expires_at: lease.expiresAt.toISOString(),
    server_time: new Date().toISOString(),
    ttl_seconds: LOCK_TTL_SECONDS,
  };
  emit(membership.setId, {
    event: 'lock',
    data: {
      layer_id: layerId,
      holder,
      expires_at: body.expires_at,
      reason: alreadyMine ? 'renewed' : 'granted',
    },
  });
  return { status: alreadyMine ? 200 : 201, json: body };
}

export async function heartbeatLock(ctx: Ctx): Promise<Reply> {
  const membership = requireEditor(await requireMembership(ctx, ctx.params['id'] ?? ''));
  const layerId = ctx.params['layerId'] ?? '';
  await layerOr404(membership, layerId);
  const expiresAt = await renewLease(membership.setId, layerId, membership.user.id);
  if (expiresAt === null) throw new ApiError(409, 'lock_not_held', 'You do not hold this lock');
  emit(membership.setId, {
    event: 'lock',
    data: {
      layer_id: layerId,
      holder: { user_id: membership.user.id, display_name: membership.user.display_name },
      expires_at: expiresAt.toISOString(),
      reason: 'renewed',
    },
  });
  return {
    status: 200,
    json: {
      layer_id: layerId,
      expires_at: expiresAt.toISOString(),
      server_time: new Date().toISOString(),
    },
  };
}

export async function releaseLock(ctx: Ctx): Promise<Reply> {
  const membership = requireEditor(await requireMembership(ctx, ctx.params['id'] ?? ''));
  const layerId = ctx.params['layerId'] ?? '';
  await layerOr404(membership, layerId);
  const lease = await readLease(membership.setId, layerId);
  if (lease === null) throw new ApiError(409, 'lock_not_held', 'This layer is not locked');
  const isHolder = lease.userId === membership.user.id;
  if (!isHolder && membership.role !== 'owner') throw Err.forbidden();
  await releaseLease(membership.setId, layerId, isHolder ? membership.user.id : null);
  if (!isHolder) {
    const holder = await actorFor(lease.userId);
    await writeActivity(
      pool,
      membership.setId,
      membership.user.id,
      'lock.force_release',
      layerId,
      `Released ${holder.display_name}'s lock`,
    );
  }
  emit(membership.setId, {
    event: 'lock',
    data: { layer_id: layerId, holder: null, expires_at: null, reason: 'released' },
  });
  return { status: 204 };
}

export async function listLocks(ctx: Ctx): Promise<Reply> {
  const membership = await requireMembership(ctx, ctx.params['id'] ?? '');
  const leases = await listLeases(membership.setId);
  const locks = await Promise.all(
    leases.map(async (lease) => ({
      layer_id: lease.layerId,
      holder: await actorFor(lease.userId),
      expires_at: lease.expiresAt.toISOString(),
    })),
  );
  return { status: 200, json: { server_time: new Date().toISOString(), locks } };
}

async function presenceMembers(setId: string): Promise<PresenceMember[]> {
  const records = await readPresence(setId);
  const order = await pool.query<{ user_id: string; join_order: number }>(
    `select user_id, join_order from set_members where set_id = $1`,
    [setId],
  );
  const joinOrder = new Map(order.rows.map((row) => [row.user_id, row.join_order]));
  return records
    .map((entry) => ({
      user_id: entry.userId,
      display_name: entry.record.display_name,
      colour: entry.record.colour,
      selection: entry.record.selection,
    }))
    .sort((a, b) => (joinOrder.get(a.user_id) ?? 0) - (joinOrder.get(b.user_id) ?? 0));
}

export async function postPresence(ctx: Ctx): Promise<Reply> {
  const membership = requireEditor(await requireMembership(ctx, ctx.params['id'] ?? ''));
  const raw = ctx.json['selection'];
  const selection = raw === null || raw === undefined ? null : asString(raw);
  if (raw !== null && raw !== undefined && selection === null) {
    throw fieldError('selection', 'Selection is a layer id or null');
  }
  if (selection !== null && (await readLayer(pool, membership.setId, selection)) === null) {
    throw fieldError('selection', 'Selection is a layer id or null');
  }
  const order = await pool.query<{ join_order: number }>(
    `select join_order from set_members where set_id = $1 and user_id = $2`,
    [membership.setId, membership.user.id],
  );
  await writePresence(membership.setId, membership.user.id, {
    display_name: membership.user.display_name,
    colour: presenceColour(order.rows[0]?.join_order ?? 0),
    selection,
  });
  const members = await presenceMembers(membership.setId);
  emit(membership.setId, { event: 'presence', data: { members } });
  return { status: 200, json: { members } };
}

export async function getPresence(ctx: Ctx): Promise<Reply> {
  const membership = await requireMembership(ctx, ctx.params['id'] ?? '');
  return { status: 200, json: { members: await presenceMembers(membership.setId) } };
}
