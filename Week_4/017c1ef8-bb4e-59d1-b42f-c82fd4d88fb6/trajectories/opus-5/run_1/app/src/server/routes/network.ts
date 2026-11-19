import {
  blockExists,
  connectionState,
  weeklyInviteCount,
  type ConnectionState,
} from '../../domain/graph';
import { memberById, personCard, type MemberRow } from '../../domain/members';
import { notify, removeNotificationActor } from '../../domain/notifications';
import { businessNow } from '../clock';
import { config } from '../config';
import { query, transact } from '../db';
import { conflict, notFound, validation, weeklyInviteLimit } from '../errors';
import { newId } from '../ids';
import { jsonBody, requireMember, type Ctx } from '../http';
import { pushTo, pushToAll } from '../live';
import { queueMail } from '../mail';

async function visibleMember(viewerId: string, memberId: string): Promise<MemberRow> {
  const member = await memberById(memberId);
  if (!member) throw notFound();
  if (await blockExists(viewerId, member.id)) throw notFound();
  if (member.visibility === 'private' && member.id !== viewerId) {
    const state = await connectionState(viewerId, member.id);
    if (state !== 'connected') throw notFound();
  }
  return member;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function notifyNetwork(ids: string[]): void {
  pushTo(ids, 'network', { changed: true });
  /* Degrees and connection paths change for everyone, not only for the pair. */
  pushToAll('graph', { changed: true });
}

async function latestInvitation(
  senderId: string,
  receiverId: string,
): Promise<{ id: string; state: string; resolved_at: Date | null } | null> {
  const rows = await query<{ id: string; state: string; resolved_at: Date | null }>(
    `SELECT id, state, resolved_at FROM invitations
     WHERE sender_id = $1 AND receiver_id = $2 ORDER BY created_at DESC LIMIT 1`,
    [senderId, receiverId],
  );
  return rows[0] ?? null;
}

async function connectPair(
  senderId: string,
  receiverId: string,
  invitationId: string,
): Promise<void> {
  const [low, high] = senderId < receiverId ? [senderId, receiverId] : [receiverId, senderId];
  const now = businessNow();
  await query(
    `INSERT INTO connections (id, member_a, member_b, connected_at) VALUES ($1,$2,$3,$4)
     ON CONFLICT (member_a, member_b) DO NOTHING`,
    [newId('con'), low, high, now],
  );
  await query(`UPDATE invitations SET state = 'accepted', resolved_at = $2 WHERE id = $1`, [
    invitationId,
    now,
  ]);
  await query(
    `UPDATE invitations SET state = 'accepted', resolved_at = $3
     WHERE state = 'pending' AND ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1))`,
    [senderId, receiverId, now],
  );
}

async function announceAccepted(originalSenderId: string, accepterId: string): Promise<void> {
  const sender = await memberById(originalSenderId);
  const accepter = await memberById(accepterId);
  if (!sender || !accepter) return;
  await notify({
    memberId: sender.id,
    actorId: accepter.id,
    kind: 'invitation_accepted',
    subjectId: accepter.id,
    targetUrl: `/in/${accepter.handle}`,
  });
  await queueMail(
    sender.email,
    `${accepter.name} accepted your invitation`,
    `${accepter.name} accepted your invitation to connect on Plainwork.`,
  );
}

export async function createConnection(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const body = jsonBody(ctx);
  const memberId = String(body.member_id ?? '');
  if (memberId === viewerId) {
    throw validation({ member_id: "You can't connect with yourself." });
  }
  const other = await visibleMember(viewerId, memberId);

  const result = await transact<{ status: number; state: ConnectionState; accepted: string | null }>(
    async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [pairKey(viewerId, other.id)]);
      const state = await connectionState(viewerId, other.id);
      if (state === 'connected') throw conflict('already_connected');
      if (state === 'pending_sent') return { status: 200, state: 'pending_sent', accepted: null };

      const received = await latestInvitation(other.id, viewerId);
      if (received && (received.state === 'pending' || received.state === 'ignored')) {
        await connectPair(other.id, viewerId, received.id);
        return { status: 200, state: 'connected', accepted: other.id };
      }

      const sent = await latestInvitation(viewerId, other.id);
      if (sent && sent.state === 'withdrawn' && sent.resolved_at) {
        const retryAt = new Date(
          sent.resolved_at.getTime() + config.inviteCooldownSeconds * 1000,
        );
        if (businessNow().getTime() < retryAt.getTime()) {
          throw conflict('invite_cooldown', { retry_at: retryAt.toISOString() });
        }
      }

      if ((await weeklyInviteCount(viewerId)) >= config.weeklyInvites) {
        throw weeklyInviteLimit(config.weeklyInvites);
      }

      await client.query(
        `INSERT INTO invitations (id, sender_id, receiver_id, state, created_at)
         VALUES ($1,$2,$3,'pending',$4)`,
        [newId('inv'), viewerId, other.id, businessNow()],
      );
      return { status: 201, state: 'pending_sent', accepted: null };
    },
  );

  const viewer = await memberById(viewerId);
  if (result.state === 'connected' && result.accepted) {
    await announceAccepted(result.accepted, viewerId);
  } else if (result.status === 201 && viewer) {
    await notify({
      memberId: other.id,
      actorId: viewerId,
      kind: 'invitation_received',
      subjectId: viewerId,
      targetUrl: '/network',
    });
    await queueMail(
      other.email,
      `${viewer.name} wants to connect on Plainwork`,
      `${viewer.name} wants to connect with you on Plainwork. Open My network to answer.`,
    );
  }
  notifyNetwork([viewerId, other.id]);
  return { status: result.status, body: { state: result.state } };
}

export async function withdrawConnection(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const other = await visibleMember(viewerId, ctx.params.member_id);
  const sent = await latestInvitation(viewerId, other.id);
  if (!sent || (sent.state !== 'pending' && sent.state !== 'ignored')) {
    throw conflict('no_pending_request');
  }
  const now = businessNow();
  await query(`UPDATE invitations SET state = 'withdrawn', resolved_at = $2 WHERE id = $1`, [
    sent.id,
    now,
  ]);
  await removeNotificationActor(other.id, 'invitation_received', viewerId, viewerId);
  notifyNetwork([viewerId, other.id]);
  const retryAt = new Date(now.getTime() + config.inviteCooldownSeconds * 1000);
  return { status: 200, body: { state: 'withdrawn', retry_at: retryAt.toISOString() } };
}

export async function withdrawInvitations(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const body = jsonBody(ctx);
  const raw = Array.isArray(body.member_ids) ? body.member_ids.map((id) => String(id)) : [];
  const ids = [...new Set(raw)];
  if (ids.length !== raw.length || ids.length < 1 || ids.length > 50) {
    throw validation({ member_ids: 'Choose 1 to 50 invitations.' });
  }
  for (const id of ids) await visibleMember(viewerId, id);

  const now = businessNow();
  await transact(async (client) => {
    for (const id of ids) {
      const sent = await latestInvitation(viewerId, id);
      if (!sent || (sent.state !== 'pending' && sent.state !== 'ignored')) {
        throw conflict('not_pending', { member_id: id });
      }
      await client.query(
        `UPDATE invitations SET state = 'withdrawn', resolved_at = $2 WHERE id = $1`,
        [sent.id, now],
      );
    }
  });
  for (const id of ids) await removeNotificationActor(id, 'invitation_received', viewerId, viewerId);
  notifyNetwork([viewerId, ...ids]);
  const retryAt = new Date(now.getTime() + config.inviteCooldownSeconds * 1000);
  return { status: 200, body: { withdrawn: ids, retry_at: retryAt.toISOString() } };
}

export async function acceptConnection(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const other = await visibleMember(viewerId, ctx.params.member_id);
  await transact(async () => {
    const received = await latestInvitation(other.id, viewerId);
    if (!received || received.state !== 'pending') throw conflict('no_pending_request');
    await connectPair(other.id, viewerId, received.id);
  });
  await announceAccepted(other.id, viewerId);
  notifyNetwork([viewerId, other.id]);
  return { status: 200, body: { state: 'connected' } };
}

export async function ignoreConnection(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const other = await visibleMember(viewerId, ctx.params.member_id);
  const received = await latestInvitation(other.id, viewerId);
  if (!received || received.state !== 'pending') throw conflict('no_pending_request');
  await query(`UPDATE invitations SET state = 'ignored', resolved_at = $2 WHERE id = $1`, [
    received.id,
    businessNow(),
  ]);
  await removeNotificationActor(viewerId, 'invitation_received', other.id, other.id);
  notifyNetwork([viewerId, other.id]);
  return { status: 200, body: { state: 'ignored' } };
}

export async function removeConnection(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const other = await visibleMember(viewerId, ctx.params.member_id);
  const [low, high] = viewerId < other.id ? [viewerId, other.id] : [other.id, viewerId];
  const removed = await query<{ id: string }>(
    'DELETE FROM connections WHERE member_a = $1 AND member_b = $2 RETURNING id',
    [low, high],
  );
  if (removed.length === 0) throw conflict('no_connection');
  notifyNetwork([viewerId, other.id]);
  return { status: 200, body: { state: 'none' } };
}

/** A block, in one transaction: it ends the connection, the requests and the follows. */
export async function createBlock(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const body = jsonBody(ctx);
  const memberId = String(body.member_id ?? '');
  if (memberId === viewerId) throw validation({ member_id: "You can't block yourself." });
  const other = await visibleMember(viewerId, memberId);

  const already = await query<{ one: number }>(
    'SELECT 1 AS one FROM blocks WHERE blocker_id = $1 AND blocked_id = $2',
    [viewerId, other.id],
  );
  if (already.length > 0) return { status: 200, body: { blocked: true } };

  await transact(async (client) => {
    const [low, high] = viewerId < other.id ? [viewerId, other.id] : [other.id, viewerId];
    await client.query('INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES ($1,$2,$3)', [
      viewerId,
      other.id,
      businessNow(),
    ]);
    await client.query('DELETE FROM connections WHERE member_a = $1 AND member_b = $2', [low, high]);
    await client.query(
      `DELETE FROM invitations WHERE state = 'pending'
       AND ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1))`,
      [viewerId, other.id],
    );
    await client.query(
      `DELETE FROM follows WHERE (follower_id = $1 AND target_id = $2) OR (follower_id = $2 AND target_id = $1)`,
      [viewerId, other.id],
    );
  });
  notifyNetwork([viewerId, other.id]);
  return { status: 201, body: { blocked: true } };
}

export async function removeBlock(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  await query('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [
    viewerId,
    ctx.params.member_id,
  ]);
  notifyNetwork([viewerId, ctx.params.member_id]);
  return { status: 200, body: { blocked: false } };
}

export async function listBlocks(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const rows = await query<{ id: string; name: string; handle: string; created_at: Date }>(
    `SELECT m.id, m.name, m.handle, b.created_at FROM blocks b JOIN members m ON m.id = b.blocked_id
     WHERE b.blocker_id = $1 ORDER BY b.created_at DESC`,
    [viewerId],
  );
  return {
    status: 200,
    body: {
      blocked: rows.map((row) => ({
        id: row.id,
        name: row.name,
        handle: row.handle,
        blocked_at: row.created_at.toISOString(),
      })),
    },
  };
}

export async function createFollow(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const body = jsonBody(ctx);
  const targetId = String(body.target_id ?? '');
  if (targetId === viewerId) throw validation({ target_id: "You can't follow yourself." });
  const member = await memberById(targetId);
  if (member) await visibleMember(viewerId, targetId);
  else {
    const company = await query<{ id: string }>('SELECT id FROM companies WHERE id = $1', [targetId]);
    if (company.length === 0) throw notFound();
  }
  const existing = await query<{ one: number }>(
    'SELECT 1 AS one FROM follows WHERE follower_id = $1 AND target_id = $2',
    [viewerId, targetId],
  );
  if (existing.length > 0) return { status: 200, body: { following: true } };
  await query('INSERT INTO follows (follower_id, target_id, created_at) VALUES ($1,$2,$3)', [
    viewerId,
    targetId,
    businessNow(),
  ]);
  return { status: 201, body: { following: true } };
}

export async function removeFollow(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  await query('DELETE FROM follows WHERE follower_id = $1 AND target_id = $2', [
    viewerId,
    ctx.params.target_id,
  ]);
  return { status: 200, body: { following: false } };
}

export async function networkLists(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const receivedRows = await query<{ sender_id: string; created_at: Date }>(
    `SELECT sender_id, created_at FROM invitations i
     WHERE receiver_id = $1 AND state = 'pending'
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = i.sender_id) OR (b.blocker_id = i.sender_id AND b.blocked_id = $1))
     ORDER BY created_at DESC`,
    [viewerId],
  );
  const sentRows = await query<{ receiver_id: string; created_at: Date }>(
    `SELECT receiver_id, created_at FROM invitations i
     WHERE sender_id = $1 AND state IN ('pending','ignored')
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = i.receiver_id) OR (b.blocker_id = i.receiver_id AND b.blocked_id = $1))
     ORDER BY created_at DESC`,
    [viewerId],
  );
  const connectionRows = await query<{ other: string; connected_at: Date }>(
    `SELECT CASE WHEN member_a = $1 THEN member_b ELSE member_a END AS other, connected_at
     FROM connections WHERE member_a = $1 OR member_b = $1 ORDER BY connected_at DESC`,
    [viewerId],
  );

  const cardFor = async (
    memberId: string,
    extra: Record<string, string>,
  ): Promise<Record<string, unknown> | null> => {
    const member = await memberById(memberId);
    if (!member) return null;
    if (await blockExists(viewerId, memberId)) return null;
    return { ...(await personCard(viewerId, member)), ...extra };
  };

  const received: Record<string, unknown>[] = [];
  for (const row of receivedRows) {
    const card = await cardFor(row.sender_id, { requested_at: row.created_at.toISOString() });
    if (card) received.push(card);
  }
  const sent: Record<string, unknown>[] = [];
  for (const row of sentRows) {
    const card = await cardFor(row.receiver_id, { requested_at: row.created_at.toISOString() });
    if (card) sent.push(card);
  }
  const connections: Record<string, unknown>[] = [];
  for (const row of connectionRows) {
    const card = await cardFor(row.other, { connected_at: row.connected_at.toISOString() });
    if (card) connections.push(card);
  }
  return { status: 200, body: { received, sent, connections } };
}
