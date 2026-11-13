import { randomUUID } from 'node:crypto';
import { pool, query, transaction } from '../db.js';
import { errors } from '../errors.js';
import { accountByDisplayName, accountById } from '../accounts.js';
import { readJsonBody, requireAccount, requireVerified, type Ctx, type Reply } from '../http.js';
import { onlineAmong } from '../presence.js';
import { appendEvent } from '../realtime/streams.js';
import type { FriendEntry, FriendRequest } from '../../shared/types.js';
import {
  acceptInvite,
  createInvite,
  createParty,
  declineInvite,
  handoffLeader,
  inviteByToken,
  leaveParty,
  loadParty,
  partyIdOf,
  requireLeader,
  requireMembership,
  respondReadyCheck,
  returnToLobby,
  setPartyStory,
  startReadyCheck,
} from '../domain/party.js';

interface RequestRow {
  id: string;
  from_id: string;
  to_id: string;
  from_name: string;
  to_name: string;
  created_at: Date;
}

const SELECT_REQUEST = `
  SELECT r.id, r.from_id, r.to_id, f.display_name AS from_name, tgt.display_name AS to_name,
         r.created_at
  FROM friend_requests r
  JOIN accounts f ON f.id = r.from_id
  JOIN accounts tgt ON tgt.id = r.to_id`;

function toRequest(row: RequestRow): FriendRequest {
  return {
    id: row.id,
    from: { account_id: row.from_id, display_name: row.from_name },
    to: { account_id: row.to_id, display_name: row.to_name },
    created_at: row.created_at.toISOString(),
  };
}

function body(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

async function areFriends(a: string, b: string): Promise<boolean> {
  const [low, high] = a < b ? [a, b] : [b, a];
  const rows = await query<{ low_id: string }>(
    'SELECT low_id FROM friendships WHERE low_id = $1 AND high_id = $2',
    [low, high],
  );
  return rows.length > 0;
}

export async function listFriends(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  const friendRows = await query<{ account_id: string; display_name: string }>(
    `SELECT CASE WHEN low_id = $1 THEN high_id ELSE low_id END AS account_id, a.display_name
     FROM friendships f
     JOIN accounts a ON a.id = CASE WHEN f.low_id = $1 THEN f.high_id ELSE f.low_id END
     WHERE f.low_id = $1 OR f.high_id = $1
     ORDER BY a.display_name`,
    [account.id],
  );
  const online = await onlineAmong(friendRows.map((row) => row.account_id));
  const friends: FriendEntry[] = friendRows.map((row) => ({
    account_id: row.account_id,
    display_name: row.display_name,
    presence: online.has(row.account_id) ? 'online' : 'offline',
  }));
  const incoming = await query<RequestRow>(
    `${SELECT_REQUEST} WHERE r.to_id = $1 AND r.state = 'pending' ORDER BY r.created_at`,
    [account.id],
  );
  const outgoing = await query<RequestRow>(
    `${SELECT_REQUEST} WHERE r.from_id = $1 AND r.state = 'pending' ORDER BY r.created_at`,
    [account.id],
  );
  return {
    status: 200,
    body: {
      friends,
      incoming: incoming.map(toRequest),
      outgoing: outgoing.map(toRequest),
    },
  };
}

export async function sendFriendRequest(ctx: Ctx): Promise<Reply> {
  const account = requireVerified(ctx);
  const input = body(await readJsonBody(ctx.req));
  const displayName = typeof input.display_name === 'string' ? input.display_name.trim() : '';
  const clientRequestId = input.client_request_id;
  if (typeof clientRequestId !== 'string' || clientRequestId === '') {
    throw errors.invalidField('client_request_id', { key: 'fb.generic' });
  }

  const stored = await query<RequestRow & { stored_name: string }>(
    `${SELECT_REQUEST} WHERE r.from_id = $1 AND r.client_request_id = $2`,
    [account.id, clientRequestId],
  );
  if (stored[0] !== undefined) {
    if (stored[0].to_name.toLowerCase() !== displayName.toLowerCase()) {
      throw errors.conflict('idempotency_conflict', { key: 'fb.generic' });
    }
    return { status: 201, body: { request: toRequest(stored[0]) } };
  }

  if (displayName.toLowerCase() === account.display_name.toLowerCase()) {
    throw errors.invalidField('display_name', { key: 'fb.selfRequest' });
  }
  const target = await accountByDisplayName(displayName);
  if (target === null) throw errors.invalidField('display_name', { key: 'fb.noSuchPlayer' });
  if (await areFriends(account.id, target.id)) {
    throw errors.conflict('already_friends', { key: 'fb.alreadyFriends' });
  }
  const open = await query<{ id: string }>(
    `SELECT id FROM friend_requests
     WHERE state = 'pending' AND ((from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1))`,
    [account.id, target.id],
  );
  if (open.length > 0) {
    throw errors.conflict('request_pending', { key: 'fb.requestPending' });
  }

  const id = randomUUID();
  await pool.query(
    `INSERT INTO friend_requests (id, from_id, to_id, client_request_id, state)
     VALUES ($1, $2, $3, $4, 'pending')`,
    [id, account.id, target.id, clientRequestId],
  );
  await appendEvent(`me:${target.id}`, {
    kind: 'friend_request',
    request_id: id,
    from: { account_id: account.id, display_name: account.display_name },
  });
  const created = await query<RequestRow>(`${SELECT_REQUEST} WHERE r.id = $1`, [id]);
  return { status: 201, body: { request: toRequest(created[0]) } };
}

async function requestForAddressee(ctx: Ctx): Promise<RequestRow & { state: string }> {
  const account = requireAccount(ctx);
  const rows = await query<RequestRow & { state: string }>(
    `${SELECT_REQUEST.replace('r.created_at', 'r.created_at, r.state')} WHERE r.id = $1`,
    [ctx.params.id],
  );
  const row = rows[0];
  if (row === undefined || row.to_id !== account.id) throw errors.notFound();
  if (row.state !== 'pending') throw errors.conflict('request_closed', { key: 'fb.generic' });
  return row;
}

export async function acceptFriendRequest(ctx: Ctx): Promise<Reply> {
  requireVerified(ctx);
  const request = await requestForAddressee(ctx);
  const [low, high] =
    request.from_id < request.to_id
      ? [request.from_id, request.to_id]
      : [request.to_id, request.from_id];
  await transaction(async (client) => {
    await client.query(`UPDATE friend_requests SET state = 'accepted' WHERE id = $1`, [request.id]);
    await client.query(
      'INSERT INTO friendships (low_id, high_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [low, high],
    );
  });
  await appendEvent(`me:${request.from_id}`, {
    kind: 'friend_added',
    account_id: request.to_id,
    display_name: request.to_name,
  });
  await appendEvent(`me:${request.to_id}`, {
    kind: 'friend_added',
    account_id: request.from_id,
    display_name: request.from_name,
  });
  const online = await onlineAmong([request.from_id]);
  return {
    status: 200,
    body: {
      friend: {
        account_id: request.from_id,
        display_name: request.from_name,
        presence: online.has(request.from_id) ? 'online' : 'offline',
      },
    },
  };
}

export async function declineFriendRequest(ctx: Ctx): Promise<Reply> {
  const request = await requestForAddressee(ctx);
  await pool.query(`UPDATE friend_requests SET state = 'declined' WHERE id = $1`, [request.id]);
  return { status: 204 };
}

export async function removeFriend(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  const other = ctx.params.accountId;
  if (!(await areFriends(account.id, other))) throw errors.notFound();
  const [low, high] = account.id < other ? [account.id, other] : [other, account.id];
  await pool.query('DELETE FROM friendships WHERE low_id = $1 AND high_id = $2', [low, high]);
  return { status: 204 };
}

// --- parties -----------------------------------------------------------------

export async function postParty(ctx: Ctx): Promise<Reply> {
  const account = requireVerified(ctx);
  const input = body(await readJsonBody(ctx.req));
  const party = await createParty(account.id, account.display_name, input.story_id);
  return { status: 201, body: { party } };
}

export async function getParty(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  await requireMembership(ctx.params.id, account.id);
  const party = await loadParty(ctx.params.id);
  if (party === null) throw errors.notFound();
  return { status: 200, body: { party } };
}

export async function getCurrentParty(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  const partyId = await partyIdOf(account.id);
  return {
    status: 200,
    body: { party: partyId === null ? null : await loadParty(partyId) },
  };
}

export async function patchParty(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  await requireLeader(ctx.params.id, account.id);
  const input = body(await readJsonBody(ctx.req));
  return { status: 200, body: { party: await setPartyStory(ctx.params.id, input.story_id) } };
}

export async function postInvite(ctx: Ctx): Promise<Reply> {
  const account = requireVerified(ctx);
  const row = await requireLeader(ctx.params.id, account.id);
  if (row.status !== 'forming') throw errors.conflict('wrong_state', { key: 'fb.generic' });
  const input = body(await readJsonBody(ctx.req));
  const accountId = input.account_id;
  if (typeof accountId !== 'string') {
    throw errors.invalidField('account_id', { key: 'fb.notAFriend' });
  }
  if (!(await areFriends(account.id, accountId))) {
    throw errors.invalidField('account_id', { key: 'fb.notAFriend' });
  }
  const invite = await createInvite(ctx.params.id, accountId);
  return { status: 201, body: { invite } };
}

export async function listInvites(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  const rows = await query<{
    token: string;
    party_id: string;
    from_name: string;
    story_id: string;
    member_count: string;
  }>(
    `SELECT i.token, i.party_id, a.display_name AS from_name, p.story_id,
            (SELECT count(*) FROM party_members m WHERE m.party_id = p.id) AS member_count
     FROM party_invites i
     JOIN parties p ON p.id = i.party_id
     JOIN accounts a ON a.id = p.leader_id
     WHERE i.to_id = $1 AND i.state = 'open'
     ORDER BY i.created_at`,
    [account.id],
  );
  return {
    status: 200,
    body: {
      invites: rows.map((row) => ({
        token: row.token,
        party_id: row.party_id,
        from: row.from_name,
        story_id: row.story_id,
        member_count: Number(row.member_count),
      })),
    },
  };
}

export async function postInviteAccept(ctx: Ctx): Promise<Reply> {
  const account = requireVerified(ctx);
  const party = await acceptInvite(ctx.params.token, account.id, account.display_name);
  return { status: 200, body: { party } };
}

export async function postInviteDecline(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  await declineInvite(ctx.params.token, account.id);
  return { status: 204 };
}

export async function postPartyLeave(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  await requireMembership(ctx.params.id, account.id);
  await leaveParty(ctx.params.id, account.id, account.display_name);
  return { status: 204 };
}

export async function postPartyLeader(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  await requireLeader(ctx.params.id, account.id);
  const input = body(await readJsonBody(ctx.req));
  if (typeof input.account_id !== 'string') throw errors.notFound();
  return { status: 200, body: { party: await handoffLeader(ctx.params.id, input.account_id) } };
}

export async function postReadyCheck(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  await requireLeader(ctx.params.id, account.id);
  return { status: 201, body: { party: await startReadyCheck(ctx.params.id) } };
}

export async function postReadyResponse(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  await requireMembership(ctx.params.id, account.id);
  const input = body(await readJsonBody(ctx.req));
  if (typeof input.ready !== 'boolean') throw errors.invalidField('ready', { key: 'fb.generic' });
  return {
    status: 200,
    body: { party: await respondReadyCheck(ctx.params.id, account.id, input.ready) },
  };
}

export async function postPartyReturn(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  await requireLeader(ctx.params.id, account.id);
  return { status: 200, body: { party: await returnToLobby(ctx.params.id) } };
}

export async function inviteDetails(token: string): Promise<{
  token: string;
  party_id: string;
  from: string;
  story_id: string;
  member_count: number;
} | null> {
  const invite = await inviteByToken(token);
  if (invite === null) return null;
  const rows = await query<{
    from_name: string;
    story_id: string;
    member_count: string;
  }>(
    `SELECT a.display_name AS from_name, p.story_id,
            (SELECT count(*) FROM party_members m WHERE m.party_id = p.id) AS member_count
     FROM parties p JOIN accounts a ON a.id = p.leader_id WHERE p.id = $1`,
    [invite.party_id],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    token,
    party_id: invite.party_id,
    from: row.from_name,
    story_id: row.story_id,
    member_count: Number(row.member_count),
  };
}

export async function accountNameById(accountId: string): Promise<string | null> {
  const account = await accountById(accountId);
  return account?.display_name ?? null;
}
