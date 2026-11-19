import { query, withTransaction, PoolClient } from './db.js';
import { config } from './config.js';
import { businessMs } from './clock.js';
import { ApiError, conflict, errors } from './errors.js';
import { pushTo } from './live.js';
import { sendMail } from './mail.js';

export type ConnectionState =
  | 'none' | 'pending_sent' | 'pending_received' | 'connected'
  | 'withdrawn' | 'ignored' | 'blocked';

type Row = {
  requester_id: string; addressee_id: string; state: string;
  requested_at: Date; connected_at: Date | null; withdrawn_at: Date | null; ignored_at: Date | null;
};

/** The state of an ordered pair as seen by the viewer. */
export const stateBetween = (viewerId: string, row: Row | undefined, blocked: boolean): ConnectionState => {
  if (blocked) return 'blocked';
  if (!row) return 'none';
  const { requester_id, state } = row;
  if (requester_id === viewerId) {
    if (state === 'pending') return 'pending_sent';
    if (state === 'connected') return 'connected';
    if (state === 'withdrawn') return 'withdrawn';
    return 'none';
  }
  // The other member is the requester.
  if (state === 'pending') return 'pending_received';
  if (state === 'connected') return 'connected';
  if (state === 'ignored') return 'ignored';
  return 'none';
};

export const findPair = async (a: string, b: string): Promise<Row | undefined> => {
  const result = await query<Row>(
    `SELECT requester_id, addressee_id, state, requested_at, connected_at, withdrawn_at, ignored_at
     FROM connections WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
    [a, b],
  );
  return result.rows[0];
};

const isBlocked = async (a: string, b: string): Promise<boolean> => {
  const result = await query(
    `SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`,
    [a, b],
  );
  return result.rows.length > 0;
};

export const buttonsFor = (state: ConnectionState): string[] => {
  switch (state) {
    case 'none': return ['Connect'];
    case 'pending_sent': return ['Withdraw'];
    case 'pending_received': return ['Accept', 'Ignore'];
    case 'withdrawn': return ['Connect'];
    case 'ignored': return ['Connect'];
    case 'connected': return ['Message', 'Remove connection'];
    case 'blocked': return [];
  }
};

const sqlNow = (): string => new Date(businessMs()).toISOString();

/** A withdrawal cooldown: retry_at = withdrawal time + configured seconds. */
export const cooldownFor = (withdrawnAt: Date): Date =>
  new Date(withdrawnAt.getTime() + config.inviteCooldownSeconds * 1000);

type ConnectOutcome =
  | { status: 201; state: 'pending_sent' }
  | { status: 200; state: 'pending_sent' | 'connected' };

/**
 * Connect, Withdraw, Accept and Ignore move a pair only along the published table.
 * Cross requests end with exactly one connection and no pending request.
 */
export const connect = async (viewerId: string, otherId: string): Promise<ConnectOutcome & { retryAt?: Date }> => {
  if (viewerId === otherId) throw errors.validation({ member_id: "You can't connect with yourself." });
  const blocked = await isBlocked(viewerId, otherId);
  if (blocked) throw errors.notFound();

  return withTransaction(async (client) => {
    const existing = await pairRow(client, viewerId, otherId);
    if (existing) {
      const { requester_id, state } = existing;
      if (state === 'connected') throw conflict({ error: 'already_connected' });
      if (requester_id === viewerId && state === 'pending') return { status: 200, state: 'pending_sent' as const };
      if (requester_id === otherId && state === 'pending') {
        await connectPair(client, existing, true);
        return { status: 200, state: 'connected' as const };
      }
      if (state === 'ignored' && requester_id === otherId) {
        await connectPair(client, existing, true);
        return { status: 200, state: 'connected' as const };
      }
      if (state === 'withdrawn' && requester_id === viewerId) {
        const withdrawnAt = existing.withdrawn_at ?? existing.requested_at;
        const retryAt = cooldownFor(withdrawnAt);
        if (businessMs() < retryAt.getTime()) {
          throw conflict({ error: 'invite_cooldown', retry_at: retryAt.toISOString() });
        }
      }
    }
    const count = await countRequestsInWindow(client, viewerId);
    if (count >= config.weeklyInvites) {
      throw new ApiError(429, { error: 'weekly_invite_limit', limit: config.weeklyInvites });
    }

    const nowDate = new Date(businessMs());
    if (existing) {
      await client.query(
        `UPDATE connections SET state = 'pending', requested_at = $1, connected_at = NULL,
         withdrawn_at = NULL, ignored_at = NULL WHERE requester_id = $2 AND addressee_id = $3`,
        [nowDate, viewerId, otherId],
      );
      pushTo(otherId, 'connection', { member_id: viewerId, state: 'pending_received' });
      pushTo(viewerId, 'connection', { member_id: otherId, state: 'pending_sent' });
      return { status: 201, state: 'pending_sent' as const };
    }
    await client.query(
      `INSERT INTO connections (requester_id, addressee_id, state, requested_at)
       VALUES ($1, $2, 'pending', $3)`,
      [viewerId, otherId, nowDate],
    );
    return { status: 201, state: 'pending_sent' as const };
  });
};

const pairRow = async (client: PoolClient, a: string, b: string): Promise<Row | undefined> => {
  const result = await client.query<Row>(
    `SELECT requester_id, addressee_id, state, requested_at, connected_at, withdrawn_at, ignored_at
     FROM connections WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
    [a, b],
  );
  return result.rows[0];
};

const countRequestsInWindow = async (client: PoolClient, senderId: string): Promise<number> => {
  const result = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM connections
     WHERE requester_id = $1 AND requested_at > $2::timestamptz - interval '604800 seconds'`,
    [senderId, sqlNow()],
  );
  return Number(result.rows[0].n);
};

const connectPair = async (client: PoolClient, row: Row, notify: boolean): Promise<void> => {
  await client.query(
    `UPDATE connections SET state = 'connected', connected_at = $1 WHERE requester_id = $2 AND addressee_id = $3`,
    [new Date(businessMs()), row.requester_id, row.addressee_id],
  );
  if (notify) {
    pushTo(row.requester_id, 'connection', { member_id: row.addressee_id, state: 'connected' });
    pushTo(row.addressee_id, 'connection', { member_id: row.requester_id, state: 'connected' });
  }
};

export const withdraw = async (viewerId: string, otherId: string): Promise<{ retryAt: Date }> => {
  return withTransaction(async (client) => {
    const row = await pairRow(client, viewerId, otherId);
    if (!row || row.requester_id !== viewerId || row.state !== 'pending') {
      throw conflict({ error: 'no_pending_request' });
    }
    const nowDate = new Date(businessMs());
    await client.query(
      `UPDATE connections SET state = 'withdrawn', withdrawn_at = $1 WHERE requester_id = $2 AND addressee_id = $3`,
      [nowDate, viewerId, otherId],
    );
    pushTo(otherId, 'connection', { member_id: viewerId, state: 'none' });
    return { retryAt: cooldownFor(nowDate) };
  });
};

export const accept = async (viewerId: string, otherId: string): Promise<void> => {
  await withTransaction(async (client) => {
    const row = await pairRow(client, viewerId, otherId);
    if (!row || row.addressee_id !== viewerId || row.state !== 'pending') {
      throw conflict({ error: 'no_pending_request' });
    }
    await connectPair(client, row, true);
  });
};

export const ignore = async (viewerId: string, otherId: string): Promise<void> => {
  await withTransaction(async (client) => {
    const row = await pairRow(client, viewerId, otherId);
    if (!row || row.addressee_id !== viewerId || row.state !== 'pending') {
      throw conflict({ error: 'no_pending_request' });
    }
    await client.query(
      `UPDATE connections SET state = 'ignored', ignored_at = $1 WHERE requester_id = $2 AND addressee_id = $3`,
      [new Date(businessMs()), row.requester_id, row.addressee_id],
    );
  });
};

export const removeConnection = async (viewerId: string, otherId: string): Promise<void> => {
  await withTransaction(async (client) => {
    const row = await pairRow(client, viewerId, otherId);
    if (!row || row.state !== 'connected') throw conflict({ error: 'no_connection' });
    await client.query(
      `DELETE FROM connections WHERE requester_id = $1 AND addressee_id = $2`,
      [row.requester_id, row.addressee_id],
    );
    pushTo(row.requester_id, 'connection', { member_id: row.addressee_id, state: 'none' });
    pushTo(row.addressee_id, 'connection', { member_id: row.requester_id, state: 'none' });
  });
};

/** A block cascades in one transaction: connection, requests and follows end both ways. */
export const block = async (blockerId: string, blockedId: string): Promise<void> => {
  if (blockerId === blockedId) throw errors.validation({ member_id: "You can't block yourself." });
  await withTransaction(async (client) => {
    const existing = await client.query(
      `SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2`, [blockerId, blockedId]);
    const already = existing.rows.length > 0;
    await client.query(
      `INSERT INTO blocks (blocker_id, blocked_id, at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [blockerId, blockedId, new Date(businessMs())]);
    await client.query(
      `DELETE FROM connections WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
      [blockerId, blockedId]);
    await client.query(
      `DELETE FROM follows WHERE (follower_id = $1 AND target_id = $2) OR (follower_id = $2 AND target_id = $1)`,
      [blockerId, blockedId]);
    if (!already) {
      pushTo(blockerId, 'blocked', { member_id: blockedId });
      pushTo(blockedId, 'blocked_by', { member_id: blockerId });
    }
  });
};

export const unblock = async (blockerId: string, blockedId: string): Promise<void> => {
  await query(`DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2`, [blockerId, blockedId]);
};

export const requestEmails = {
  created: (receiverEmail: string, senderName: string): void =>
    sendMail(receiverEmail, `${senderName} wants to connect on Plainwork`, `${senderName} wants to connect with you on Plainwork.`),
  accepted: (senderEmail: string, receiverName: string): void =>
    sendMail(senderEmail, `${receiverName} accepted your invitation`, `${receiverName} accepted your invitation.`),
};
