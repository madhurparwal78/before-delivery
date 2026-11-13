import { query, transaction } from './db.js';
import { ApiError, json, readJsonBody, notFound, unauthenticated } from './http.js';
import { contextFrom, type Ctx } from './context.js';
import { route } from './api-core.js';
import { countChars } from '../shared/domain.js';
import { isAccountOnline } from './presence.js';
import { appendChatMessage, messagesAfter, findStoredClientMessage, checkRate, bodyLengthOk, messageJson, channelExists } from './chat.js';
import {
  partyById, partyMembers, partyJson, isMember, partyForAccount, startReadyCheck, answerReadyCheck,
  handoffLeadership, leaveParty, partyChannel,
} from './parties.js';
import { progressFor, progressJson } from './progress.js';
import { stories, storyById, PARTY_MAX_MEMBERS } from '../shared/domain.js';

export const extraRoutes = [
  // Friends
  route('GET', '/api/friends', async (ctx: Ctx, _m, res) => {
    if (!ctx.account) throw unauthenticated();
    const accountId = ctx.account.id;
    const friends = await query<{ account_id: string; display_name: string }>(
      `select f.friend_id as account_id, a.display_name from friendships f join accounts a on a.id = f.friend_id
        where f.account_id = $1 order by a.display_name`,
      [accountId],
    );
    type RequestRow = { id: string; created_at: Date; from_id: string; from_name: string; to_name: string };
    const incoming = await query<RequestRow>(
      `select r.id, r.created_at, af.display_name as from_name, af.id as from_id, at.display_name as to_name
         from friend_requests r join accounts af on af.id = r.from_account join accounts at on at.id = r.to_account
        where r.to_account = $1 and r.status = 'pending' order by r.created_at`,
      [accountId],
    );
    const outgoing = await query<RequestRow>(
      `select r.id, r.created_at, af.display_name as from_name, af.id as from_id, at.display_name as to_name
         from friend_requests r join accounts af on af.id = r.from_account join accounts at on at.id = r.to_account
        where r.from_account = $1 and r.status = 'pending' order by r.created_at`,
      [accountId],
    );
    const requestJson = (row: { id: string; created_at: Date; from_id: string; from_name: string; to_name: string }) => ({
      id: row.id,
      from: { account_id: row.from_id, display_name: row.from_name },
      to: { account_id: accountId, display_name: row.to_name },
      created_at: row.created_at.toISOString(),
    });
    json(res, 200, {
      friends: friends.rows.map((f) => ({ account_id: f.account_id, display_name: f.display_name, presence: isAccountOnline(f.account_id) ? 'online' : 'offline' })),
      incoming: incoming.rows.map(requestJson),
      outgoing: outgoing.rows.map(requestJson),
    });
  }),

  route('POST', '/api/friends/requests', async (ctx: Ctx, _m, res, req) => {
    if (!ctx.account) throw unauthenticated();
    if (!ctx.account.email_verified) throw new ApiError(403, 'email_unverified');
    const accountId = ctx.account.id;
    const body = (await readJsonBody(req)) as { display_name?: unknown; client_request_id?: unknown };
    const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : '';
    const clientRequestId = typeof body.client_request_id === 'string' ? body.client_request_id : '';
    if (clientRequestId === '') throw new ApiError(422, 'invalid_field', { fields: { client_request_id: ['invalid_field'] } });
    const stored = await query<{ from_account: string; to_account: string; display_name: string; id: string; status: string; created_at: Date }>(
      `select r.from_account, r.to_account, a.display_name, r.id, r.status, r.created_at
         from friend_requests r join accounts a on a.id = r.to_account
        where r.client_request_id = $1`,
      [clientRequestId],
    );
    if (stored.rows.length > 0) {
      const existing = stored.rows[0];
      if (!existing) throw new ApiError(409, 'idempotency_conflict');
      if (existing.status !== 'pending') {
        throw new ApiError(409, 'idempotency_conflict');
      }
      if (existing.from_account === accountId) {
        json(res, 201, {
          request: {
            id: existing.id,
            from: { account_id: existing.from_account, display_name: ctx.account.display_name },
            to: { account_id: existing.to_account, display_name: existing.display_name },
            created_at: existing.created_at.toISOString(),
          },
        });
        return;
      }
      throw new ApiError(409, 'idempotency_conflict');
    }
    if (countChars(displayName) < 3 || countChars(displayName) > 20) {
      throw new ApiError(422, 'invalid_field', { fields: { display_name: ['display_name_limit'] } });
    }
    const targetRow = await query<{ id: string; display_name: string }>(
      'select id, display_name from accounts where lower(display_name) = lower($1)',
      [displayName],
    ).then((res) => res.rows[0]);
    if (!targetRow) throw new ApiError(422, 'invalid_field', { fields: { display_name: ['display_name_missing'] } });
    if (targetRow.id === accountId) throw new ApiError(422, 'invalid_field', { fields: { display_name: ['self_request'] } });
    const alreadyFriends = await query('select 1 from friendships where account_id = $1 and friend_id = $2', [accountId, targetRow.id]);
    if (alreadyFriends.rows.length > 0) throw new ApiError(409, 'already_friends');
    const pending = await query(
      `select 1 from friend_requests where status = 'pending' and ((from_account = $1 and to_account = $2) or (from_account = $2 and to_account = $1))`,
      [accountId, targetRow.id],
    );
    if (pending.rows.length > 0) throw new ApiError(409, 'request_pending');
    const requestId = crypto.randomUUID();
    const inserted = await query(
      `insert into friend_requests (id, from_account, to_account, status, client_request_id)
       select $1, $2, $3, 'pending', $4
        where not exists (
          select 1 from friend_requests
           where (from_account = $2 and to_account = $3) or (from_account = $3 and to_account = $2)
        )
       returning id`,
      [requestId, accountId, targetRow.id, clientRequestId],
    );
    if (inserted.rows.length === 0) throw new ApiError(409, 'request_pending');
    const { publishMe } = await import('./realtime.js');
    await publishMe(accountId, { kind: 'friend_request_sent', display_name: targetRow.display_name });
    await publishMe(targetRow.id, { kind: 'friend_request', from: { account_id: accountId, display_name: ctx.account.display_name } });
    json(res, 201, {
      request: {
        id: requestId,
        from: { account_id: accountId, display_name: ctx.account.display_name },
        to: { account_id: targetRow.id, display_name: targetRow.display_name },
        created_at: new Date().toISOString(),
      },
    });
  }),

  route('POST', '/api/friends/requests/([^/]+)/accept', async (ctx: Ctx, m, res) => {
    if (!ctx.account) throw unauthenticated();
    const accountId = ctx.account.id;
    const requestId = m[1] ?? '';
    const found = await query<{ from_account: string; to_account: string; status: string; display_name: string }>(
      `select r.from_account, r.to_account, r.status, a.display_name
         from friend_requests r join accounts a on a.id = r.from_account where r.id = $1`,
      [requestId],
    );
    const request = found.rows[0];
    if (!request) throw notFound();
    if (request.to_account !== accountId) throw notFound();
    if (request.status !== 'pending') throw new ApiError(409, 'request_closed');
    await transaction(async (client) => {
      await client.query("update friend_requests set status = 'accepted' where id = $1", [requestId]);
      await client.query('insert into friendships (account_id, friend_id) values ($1, $2), ($2, $1) on conflict do nothing', [request.from_account, request.to_account]);
    });
    const { publishMe } = await import('./realtime.js');
    await publishMe(accountId, { kind: 'friend_added', account_id: request.from_account, display_name: request.display_name });
    await publishMe(request.from_account, { kind: 'friend_added', account_id: accountId, display_name: ctx.account.display_name });
    json(res, 200, { friend: { account_id: request.from_account, display_name: request.display_name, presence: isAccountOnline(request.from_account) ? 'online' : 'offline' } });
  }),

  route('POST', '/api/friends/requests/([^/]+)/decline', async (ctx: Ctx, m, res) => {
    if (!ctx.account) throw unauthenticated();
    const accountId = ctx.account.id;
    const requestId = m[1] ?? '';
    const found = await query<{ to_account: string; status: string }>('select to_account, status from friend_requests where id = $1', [requestId]);
    const request = found.rows[0];
    if (!request) throw notFound();
    if (request.to_account !== accountId) throw notFound();
    if (request.status !== 'pending') throw new ApiError(409, 'request_closed');
    await query("update friend_requests set status = 'declined' where id = $1", [requestId]);
    json(res, 204, '');
  }),

  route('DELETE', '/api/friends/([^/]+)', async (ctx: Ctx, m, res) => {
    if (!ctx.account) throw unauthenticated();
    const accountId = ctx.account.id;
    const friendId = m[1] ?? '';
    const exists = await query('select 1 from friendships where account_id = $1 and friend_id = $2', [accountId, friendId]);
    if (exists.rows.length === 0) throw notFound();
    await transaction(async (client) => {
      await client.query('delete from friendships where (account_id = $1 and friend_id = $2) or (account_id = $2 and friend_id = $1)', [accountId, friendId]);
    });
    const { publishMe } = await import('./realtime.js');
    await publishMe(accountId, { kind: 'friend_removed', account_id: friendId });
    await publishMe(friendId, { kind: 'friend_removed', account_id: accountId });
    json(res, 204, '');
  }),

  // Parties
  route('POST', '/api/parties', async (ctx: Ctx, _m, res, req) => {
    if (!ctx.account) throw unauthenticated();
    if (!ctx.account.email_verified) throw new ApiError(403, 'email_unverified');
    const accountId = ctx.account.id;
    const body = (await readJsonBody(req)) as { story_id?: unknown };
    const story = storyById(typeof body.story_id === 'string' ? body.story_id : '');
    if (!story || story.mode !== 'coop') throw new ApiError(422, 'invalid_field', { fields: { story_id: ['invalid_field'] } });
    const existing = await partyForAccount(accountId);
    if (existing) throw new ApiError(409, 'already_in_party');
    const partyId = crypto.randomUUID();
    await transaction(async (client) => {
      await client.query("insert into parties (id, status, leader_id, story_id) values ($1, 'forming', $2, $3)", [partyId, accountId, story.id]);
      await client.query('insert into party_members (party_id, account_id) values ($1, $2)', [partyId, accountId]);
      await appendChatMessage(client, partyChannel(partyId), { kind: 'system', code: 'joined', params: { name: ctx.account?.display_name ?? '' } });
    });
    const party = await partyById(partyId);
    const members = await partyMembers(partyId);
    const { ensureProgress } = await import('./progress.js');
    await ensureProgress('party', partyId, story.id);
    const progress = await progressFor('party', partyId, story.id);
    if (!party) throw notFound();
    json(res, 201, { party: { ...partyJson(party, members), progress: progress ? progressJson(progress) : null } });
  }),

  route('GET', '/api/parties/current', async (ctx: Ctx, _m, res) => {
    if (!ctx.account) throw unauthenticated();
    const party = await partyForAccount(ctx.account.id);
    if (!party) {
      json(res, 200, { party: null });
      return;
    }
    const members = await partyMembers(party.id);
    const progress = await progressFor('party', party.id, party.story_id);
    json(res, 200, { party: { ...partyJson(party, members), progress: progress ? progressJson(progress) : null } });
  }),

  route('GET', '/api/parties/([^/]+)', async (ctx: Ctx, m, res) => {
    if (!ctx.account) throw unauthenticated();
    const accountId = ctx.account.id;
    const partyId = m[1] ?? '';
    const party = await partyById(partyId);
    if (!party) throw notFound();
    if (!(await isMember(partyId, accountId))) throw notFound();
    const members = await partyMembers(partyId);
    const progress = await progressFor('party', partyId, party.story_id);
    json(res, 200, { party: { ...partyJson(party, members), progress: progress ? progressJson(progress) : null } });
  }),

  route('PATCH', '/api/parties/([^/]+)', async (ctx: Ctx, m, res, req) => {
    if (!ctx.account) throw unauthenticated();
    const accountId = ctx.account.id;
    const partyId = m[1] ?? '';
    const party = await partyById(partyId);
    if (!party) throw notFound();
    if (!(await isMember(partyId, accountId))) throw notFound();
    if (party.leader_id !== accountId) throw new ApiError(403, 'not_leader');
    if (party.status !== 'forming') throw new ApiError(409, 'wrong_state');
    const body = (await readJsonBody(req)) as { story_id?: unknown };
    const story = storyById(typeof body.story_id === 'string' ? body.story_id : '');
    if (!story || story.mode !== 'coop') throw new ApiError(422, 'invalid_field', { fields: { story_id: ['invalid_field'] } });
    await query('update parties set story_id = $1 where id = $2', [story.id, partyId]);
    const updated = await partyById(partyId);
    const members = await partyMembers(partyId);
    const progress = await progressFor('party', partyId, story.id);
    if (!updated) throw notFound();
    json(res, 200, { party: { ...partyJson(updated, members), progress: progress ? progressJson(progress) : null } });
  }),

  route('POST', '/api/parties/([^/]+)/invites', async (ctx: Ctx, m, res, req) => {
    if (!ctx.account) throw unauthenticated();
    if (!ctx.account.email_verified) throw new ApiError(403, 'email_unverified');
    const accountId = ctx.account.id;
    const partyId = m[1] ?? '';
    const party = await partyById(partyId);
    if (!party) throw notFound();
    if (!(await isMember(partyId, accountId))) throw notFound();
    if (party.leader_id !== accountId) throw new ApiError(403, 'not_leader');
    if (party.status !== 'forming') throw new ApiError(409, 'wrong_state');
    const body = (await readJsonBody(req)) as { account_id?: unknown };
    const targetId = typeof body.account_id === 'string' ? body.account_id : '';
    const friendship = await query('select 1 from friendships where account_id = $1 and friend_id = $2', [accountId, targetId]);
    if (friendship.rows.length === 0) throw new ApiError(422, 'invalid_field', { fields: { account_id: ['invalid_field'] } });
    const members = await partyMembers(partyId);
    if (members.length >= PARTY_MAX_MEMBERS) throw new ApiError(409, 'party_full');
    const token = (await import('./auth.js')).randomToken();
    const inviteId = crypto.randomUUID();
    await query("insert into invites (id, token, party_id, to_account, status) values ($1, $2, $3, $4, 'open')", [inviteId, token, partyId, targetId]);
    const { publishMe } = await import('./realtime.js');
    await publishMe(targetId, { kind: 'party_invite', party_id: partyId, token });
    json(res, 201, { invite: { id: inviteId, token, to: targetId } });
  }),

  route('GET', '/api/invites', async (ctx: Ctx, _m, res) => {
    if (!ctx.account) throw unauthenticated();
    const accountId = ctx.account.id;
    const res_ = await query(
      `select i.token, i.party_id, p.story_id, a.display_name as from_name, p.leader_id,
              (select count(*) from party_members pm where pm.party_id = p.id) as member_count
         from invites i join parties p on p.id = i.party_id join accounts a on a.id = p.leader_id
        where i.to_account = $1 and i.status = 'open' order by i.created_at`,
      [accountId],
    );
    json(res, 200, {
      invites: res_.rows.map((row) => ({
        token: row.token,
        party_id: row.party_id,
        from: { account_id: row.leader_id, display_name: row.from_name },
        story_id: row.story_id,
        member_count: Number(row.member_count),
      })),
    });
  }),

  route('POST', '/api/invites/([^/]+)/accept', async (ctx: Ctx, m, res) => {
    if (!ctx.account) throw unauthenticated();
    if (!ctx.account.email_verified) throw new ApiError(403, 'email_unverified');
    const accountId = ctx.account.id;
    const token = m[1] ?? '';
    const found = await query<{ id: string; party_id: string; status: string }>('select id, party_id, status from invites where token = $1', [token]);
    const invite = found.rows[0];
    if (!invite || invite.status !== 'open') throw new ApiError(410, 'invite_closed');
    const existingParty = await partyForAccount(accountId);
    if (existingParty) throw new ApiError(409, 'already_in_party');
    const party = await partyById(invite.party_id);
    if (!party) throw new ApiError(410, 'invite_closed');
    if (party.status !== 'forming') throw new ApiError(409, 'wrong_state');
    // The seat count check and the member insert are one indivisible step: the party row is
    // locked first so only one accept at a time can take a seat.
    const inserted = await transaction(async (client) => {
      await client.query('select id from parties where id = $1 for update', [invite.party_id]);
      const res = await client.query<{ account_id: string }>(
        `insert into party_members (party_id, account_id)
         select $1, $2
          where (select count(*) from party_members where party_id = $1) < $3
           and not exists (select 1 from party_members where party_id = $1 and account_id = $2)
         returning account_id`,
        [invite.party_id, accountId, PARTY_MAX_MEMBERS],
      );
      return res.rows;
    });
    if (inserted.length === 0) throw new ApiError(409, 'party_full');
    await query("update invites set status = 'used' where id = $1", [invite.id]);
    await query("update invites set status = 'closed' where to_account = $1 and status = 'open'", [accountId]);
    const { appendChatMessage } = await import('./chat.js');
    await appendChatMessage(null, partyChannel(invite.party_id), { kind: 'system', code: 'joined', params: { name: ctx.account?.display_name ?? '' } });
    const { publishPartyState } = await import('./realtime.js');
    publishPartyState(invite.party_id);
    const members = await partyMembers(invite.party_id);
    const progress = await progressFor('party', invite.party_id, party.story_id);
    json(res, 200, { party: { ...partyJson(party, members), progress: progress ? progressJson(progress) : null } });
  }),

  route('POST', '/api/invites/([^/]+)/decline', async (ctx: Ctx, m, res) => {
    if (!ctx.account) throw unauthenticated();
    const accountId = ctx.account.id;
    const token = m[1] ?? '';
    const updated = await query("update invites set status = 'declined' where token = $1 and to_account = $2 returning id", [token, accountId]);
    if (updated.rows.length === 0) throw new ApiError(410, 'invite_closed');
    json(res, 204, '');
  }),

  route('POST', '/api/parties/([^/]+)/leave', async (ctx: Ctx, m, res) => {
    if (!ctx.account) throw unauthenticated();
    const accountId = ctx.account.id;
    const partyId = m[1] ?? '';
    if (!(await isMember(partyId, accountId))) throw notFound();
    const displayName = ctx.account.display_name;
    const { appendChatMessage } = await import('./chat.js');
    await appendChatMessage(null, partyChannel(partyId), { kind: 'system', code: 'left', params: { name: displayName } });
    await leaveParty(partyId, accountId, displayName);
    json(res, 204, '');
  }),

  route('POST', '/api/parties/([^/]+)/leader', async (ctx: Ctx, m, res, req) => {
    if (!ctx.account) throw unauthenticated();
    const accountId = ctx.account.id;
    const partyId = m[1] ?? '';
    const party = await partyById(partyId);
    if (!party) throw notFound();
    if (!(await isMember(partyId, accountId))) throw notFound();
    if (party.leader_id !== accountId) throw new ApiError(403, 'not_leader');
    const body = (await readJsonBody(req)) as { account_id?: unknown };
    const targetId = typeof body.account_id === 'string' ? body.account_id : '';
    if (!(await isMember(partyId, targetId))) throw notFound();
    await handoffLeadership(partyId, targetId);
    const nameRes = await query<{ display_name: string }>('select display_name from accounts where id = $1', [targetId]);
    await appendChatMessage(null, partyChannel(partyId), { kind: 'system', code: 'leader', params: { name: nameRes.rows[0]?.display_name ?? '' } });
    const updated = await partyById(partyId);
    const members = await partyMembers(partyId);
    const progress = await progressFor('party', partyId, party.story_id);
    if (!updated) throw notFound();
    json(res, 200, { party: { ...partyJson(updated, members), progress: progress ? progressJson(progress) : null } });
  }),

  route('POST', '/api/parties/([^/]+)/ready-check', async (ctx: Ctx, m, res) => {
    if (!ctx.account) throw unauthenticated();
    const accountId = ctx.account.id;
    const partyId = m[1] ?? '';
    const party = await partyById(partyId);
    if (!party) throw notFound();
    if (!(await isMember(partyId, accountId))) throw notFound();
    if (party.leader_id !== accountId) throw new ApiError(403, 'not_leader');
    if (party.status !== 'forming') throw new ApiError(409, 'wrong_state');
    const members = await partyMembers(partyId);
    if (members.length < 2) throw new ApiError(409, 'not_enough_members');
    await startReadyCheck(party);
    await appendChatMessage(null, partyChannel(partyId), { kind: 'system', code: 'ready_started', params: {} });
    const updated = await partyById(partyId);
    const refreshedMembers = await partyMembers(partyId);
    const { publishPartyState } = await import('./realtime.js');
    publishPartyState(partyId);
    const progress = await progressFor('party', partyId, party.story_id);
    if (!updated) throw notFound();
    json(res, 201, { party: { ...partyJson(updated, refreshedMembers), progress: progress ? progressJson(progress) : null } });
  }),

  route('POST', '/api/parties/([^/]+)/ready-check/response', async (ctx: Ctx, m, res, req) => {
    if (!ctx.account) throw unauthenticated();
    const accountId = ctx.account.id;
    const partyId = m[1] ?? '';
    const party = await partyById(partyId);
    if (!party) throw notFound();
    if (!(await isMember(partyId, accountId))) throw notFound();
    if (party.status !== 'ready_check' || !party.ready_check) throw new ApiError(409, 'no_ready_check');
    const body = (await readJsonBody(req)) as { ready?: unknown };
    if (typeof body.ready !== 'boolean') throw new ApiError(422, 'invalid_field', { fields: { ready: ['invalid_field'] } });
    await answerReadyCheck(partyId, accountId, body.ready);
    const updated = await partyById(partyId);
    const members = await partyMembers(partyId);
    const progress = await progressFor('party', partyId, party.story_id);
    const { publishPartyState } = await import('./realtime.js');
    publishPartyState(partyId);
    if (!updated) throw notFound();
    json(res, 200, { party: { ...partyJson(updated, members), progress: progress ? progressJson(progress) : null } });
  }),

  route('POST', '/api/parties/([^/]+)/return', async (ctx: Ctx, m, res) => {
    if (!ctx.account) throw unauthenticated();
    const accountId = ctx.account.id;
    const partyId = m[1] ?? '';
    const party = await partyById(partyId);
    if (!party) throw notFound();
    if (!(await isMember(partyId, accountId))) throw notFound();
    if (party.leader_id !== accountId) throw new ApiError(403, 'not_leader');
    if (party.status !== 'chapter_complete') throw new ApiError(409, 'wrong_state');
    await query("update parties set status = 'forming', session_id = null where id = $1", [partyId]);
    const updated = await partyById(partyId);
    const members = await partyMembers(partyId);
    const progress = await progressFor('party', partyId, party.story_id);
    const { publishPartyState } = await import('./realtime.js');
    publishPartyState(partyId);
    if (!updated) throw notFound();
    json(res, 200, { party: { ...partyJson(updated, members), progress: progress ? progressJson(progress) : null } });
  }),

  // Chat
  route('GET', '/api/chat/([^/]+)/messages', async (ctx: Ctx, m, res, req) => {
    if (!ctx.account) throw unauthenticated();
    const accountId = ctx.account.id;
    const channel = m[1] ?? '';
    if (!(await channelAllowed(accountId, channel))) throw notFound();
    const url = new URL(req.url ?? '/', 'http://local');
    const afterSeqRaw = url.searchParams.get('after_seq') ?? '0';
    if (!/^\d+$/.test(afterSeqRaw)) throw new ApiError(422, 'invalid_field', { fields: { after_seq: ['invalid_field'] } });
    const afterSeq = parseInt(afterSeqRaw, 10);
    const rows = await messagesAfter(channel, afterSeq);
    json(res, 200, { messages: rows.map((row) => messageJson(row, ctx.locale)) });
  }),

  route('POST', '/api/chat/([^/]+)/messages', async (ctx: Ctx, m, res, req) => {
    if (!ctx.account) throw unauthenticated();
    const accountId = ctx.account.id;
    const channel = m[1] ?? '';
    if (!(await channelAllowed(accountId, channel))) throw notFound();
    const body = (await readJsonBody(req)) as { client_message_id?: unknown; body?: unknown };
    const clientMessageId = typeof body.client_message_id === 'string' ? body.client_message_id : '';
    const text = typeof body.body === 'string' ? body.body : '';
    if (clientMessageId === '') throw new ApiError(422, 'invalid_field', { fields: { client_message_id: ['invalid_field'] } });
    if (!bodyLengthOk(text)) throw new ApiError(422, 'invalid_field', { fields: { body: ['invalid_field'] } });
    const stored = await findStoredClientMessage(channel, clientMessageId);
    if (stored) {
      if (stored.body !== text) throw new ApiError(409, 'idempotency_conflict');
      // An idempotent replay answers the stored 201 and is never charged to the limit.
      json(res, 201, { message: messageJson(stored, ctx.locale) });
      return;
    }
    const rate = await checkRate(accountId, channel);
    if (!rate.allowed) throw new ApiError(429, 'rate_limited', { retryAfter: rate.retryAfter });
    const row = await appendChatMessage(null, channel, {
      kind: 'user',
      authorId: accountId,
      authorName: ctx.account.display_name,
      body: text,
      clientMessageId,
    });
    json(res, 201, { message: messageJson(row, ctx.locale) });
  }),
];

export async function channelAllowed(accountId: string, channel: string): Promise<boolean> {
  if (channel === 'lobby') return true;
  if (channel.startsWith('party-')) {
    const partyId = channel.slice('party-'.length);
    return isMember(partyId, accountId);
  }
  if (channel.startsWith('session-')) {
    const { sessionState } = await import('./world.js');
    const state = sessionState(channel.slice('session-'.length));
    if (!state || state.status !== 'running') return false;
    return state.members.some((mm) => mm.account_id === accountId);
  }
  return false;
}

