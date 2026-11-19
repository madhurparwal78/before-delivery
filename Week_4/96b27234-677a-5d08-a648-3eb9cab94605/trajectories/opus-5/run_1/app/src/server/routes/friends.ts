import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { one, query } from '../db.js';
import { invalid, notFound } from '../errors.js';
import { personOrThrow, readJsonBody, route, sendJson } from '../http.js';
import { worldNow } from '../clock.js';
import type { PersonRow } from '../auth.js';
import { publishPersonEvent } from '../events.js';
import { presenceFor } from '../presence.js';
import { enqueueMail, flushOutbox, linkBase } from '../services/mail.js';
import { ACCOUNT_TEXT, looksLikeEmail } from './accounts.js';

const SELF_TEXT = 'You cannot do that to yourself.';

async function blockedPair(a: string, b: string): Promise<boolean> {
  const row = await one(
    `select 1 from blocks where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1)`,
    [a, b]
  );
  return row !== null;
}

async function friendIds(personId: string): Promise<string[]> {
  const rows = await query<{ other: string }>(
    `select person_b as other from friendships where person_a = $1
     union select person_a as other from friendships where person_b = $1`,
    [personId]
  );
  return rows.map((row) => row.other);
}

async function visibleFriends(person: PersonRow): Promise<Array<{ id: string; display_name: string }>> {
  const ids = await friendIds(person.id);
  if (ids.length === 0) return [];
  const rows = await query<{ id: string; display_name: string }>(
    'select id, display_name from people where id = any($1) and world_id = $2 order by display_name asc, id asc',
    [ids, person.world_id]
  );
  const result: Array<{ id: string; display_name: string }> = [];
  for (const row of rows) {
    if (await blockedPair(person.id, row.id)) continue;
    result.push(row);
  }
  return result;
}

route('GET', '/api/friends', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const friends = await visibleFriends(person);
  const presence = await presenceFor(
    person,
    friends.map((friend) => friend.id)
  );
  sendJson(ctx.res, 200, {
    friends: friends.map((friend) => ({
      personId: friend.id,
      displayName: friend.display_name,
      presence: presence.get(friend.id)?.presence ?? 'offline',
      session: presence.get(friend.id)?.session ?? null
    }))
  });
});

route('GET', '/api/safety', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const blocked = await query<{ other: string }>(
    `select blocked_id as other from blocks where blocker_id = $1
     union select blocker_id as other from blocks where blocked_id = $1`,
    [person.id]
  );
  const muted = await query<{ muted_id: string }>('select muted_id from mutes where muter_id = $1', [person.id]);
  sendJson(ctx.res, 200, {
    blocked: blocked.map((row) => row.other),
    muted: muted.map((row) => row.muted_id)
  });
});

route('DELETE', '/api/friends/:personId', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const other = ctx.params['personId'] ?? '';
  const ids = await friendIds(person.id);
  if (!ids.includes(other)) throw notFound();
  await query(
    `delete from friendships where (person_a = $1 and person_b = $2) or (person_a = $2 and person_b = $1)`,
    [person.id, other]
  );
  await publishPersonEvent(other, { type: 'friend-presence' });
  sendJson(ctx.res, 200, { status: 'removed' });
});

route('POST', '/api/friends/invites', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const body = await readJsonBody(ctx);
  if (!looksLikeEmail(body['email'])) throw invalid(ACCOUNT_TEXT.email);
  const now = await worldNow(person.world_id);
  const token = randomUUID().replace(/-/g, '');
  await query(
    `insert into friend_invites (id, token, from_id, email, state, created_at, expires_at)
     values ($1, $2, $3, $4, 'pending', $5, $6)`,
    [
      randomUUID(),
      token,
      person.id,
      body['email'],
      now,
      new Date(now.getTime() + config.inviteTtlSeconds * 1000)
    ]
  );
  await enqueueMail(
    body['email'] as string,
    `${person.display_name} invited you to Hearthtile`,
    `${person.display_name} invited you to Hearthtile.\n${linkBase(ctx.origin === '' ? null : ctx.origin)}/invites/${token}\n`
  );
  void flushOutbox();
  sendJson(ctx.res, 202, { status: 'sent' });
});

interface InviteRow {
  id: string;
  token: string;
  from_id: string;
  email: string;
  state: string;
  expires_at: Date;
}

function inviteState(invite: InviteRow, now: Date): string {
  if (invite.state === 'pending' && now.getTime() >= invite.expires_at.getTime()) return 'expired';
  return invite.state;
}

route('GET', '/api/friends/invites', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const now = await worldNow(person.world_id);
  const invites = await query<InviteRow>(
    'select * from friend_invites where from_id = $1 order by created_at desc',
    [person.id]
  );
  sendJson(ctx.res, 200, {
    invites: invites.map((invite) => ({
      id: invite.id,
      email: invite.email,
      state: inviteState(invite, now),
      expiresAt: invite.expires_at.toISOString()
    }))
  });
});

route('DELETE', '/api/friends/invites/:id', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const invite = await one<InviteRow>('select * from friend_invites where id = $1 and from_id = $2', [
    ctx.params['id'] ?? '',
    person.id
  ]);
  if (invite === null) throw notFound();
  await query(`update friend_invites set state = 'revoked' where id = $1 and state = 'pending'`, [invite.id]);
  sendJson(ctx.res, 200, { status: 'revoked' });
});

async function liveInvite(token: string): Promise<{ invite: InviteRow; from: PersonRow }> {
  const invite = await one<InviteRow>('select * from friend_invites where token = $1', [token]);
  if (invite === null) throw notFound();
  const from = await one<PersonRow>('select * from people where id = $1', [invite.from_id]);
  if (from === null) throw notFound();
  const now = await worldNow(from.world_id);
  if (inviteState(invite, now) !== 'pending') throw notFound();
  return { invite, from };
}

route('GET', '/api/invites/:token', 'open', async (ctx) => {
  const { from } = await liveInvite(ctx.params['token'] ?? '');
  sendJson(ctx.res, 200, { from: from.display_name });
});

route('POST', '/api/invites/:token/accept', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const { invite, from } = await liveInvite(ctx.params['token'] ?? '');
  if (from.id === person.id) throw notFound();
  if (from.world_id !== person.world_id) throw notFound();
  if (await blockedPair(person.id, from.id)) throw notFound();
  const [first, second] = [person.id, from.id].sort();
  await query('insert into friendships (person_a, person_b) values ($1, $2) on conflict do nothing', [first, second]);
  await query(`update friend_invites set state = 'used' where id = $1`, [invite.id]);
  await publishPersonEvent(from.id, { type: 'friend-presence' });
  sendJson(ctx.res, 200, { status: 'friends' });
});

async function personInWorld(viewer: PersonRow, personId: string): Promise<PersonRow> {
  const person = await one<PersonRow>('select * from people where id = $1 and world_id = $2', [
    personId,
    viewer.world_id
  ]);
  if (person === null) throw notFound();
  return person;
}

route('POST', '/api/blocks/:personId', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const target = ctx.params['personId'] ?? '';
  if (target === person.id) throw invalid(SELF_TEXT);
  const other = await personInWorld(person, target);
  await query('insert into blocks (blocker_id, blocked_id) values ($1, $2) on conflict do nothing', [
    person.id,
    other.id
  ]);
  await publishPersonEvent(person.id, { type: 'safety-changed' });
  await publishPersonEvent(other.id, { type: 'safety-changed' });
  sendJson(ctx.res, 200, { blocked: true });
});

route('DELETE', '/api/blocks/:personId', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const target = ctx.params['personId'] ?? '';
  if (target === person.id) throw invalid(SELF_TEXT);
  const other = await personInWorld(person, target);
  await query('delete from blocks where blocker_id = $1 and blocked_id = $2', [person.id, other.id]);
  await publishPersonEvent(person.id, { type: 'safety-changed' });
  await publishPersonEvent(other.id, { type: 'safety-changed' });
  sendJson(ctx.res, 200, { blocked: false });
});

route('POST', '/api/mutes/:personId', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const target = ctx.params['personId'] ?? '';
  if (target === person.id) throw invalid(SELF_TEXT);
  const other = await personInWorld(person, target);
  await query('insert into mutes (muter_id, muted_id) values ($1, $2) on conflict do nothing', [person.id, other.id]);
  await publishPersonEvent(person.id, { type: 'safety-changed' });
  sendJson(ctx.res, 200, { muted: true });
});

route('DELETE', '/api/mutes/:personId', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const target = ctx.params['personId'] ?? '';
  if (target === person.id) throw invalid(SELF_TEXT);
  const other = await personInWorld(person, target);
  await query('delete from mutes where muter_id = $1 and muted_id = $2', [person.id, other.id]);
  await publishPersonEvent(person.id, { type: 'safety-changed' });
  sendJson(ctx.res, 200, { muted: false });
});
