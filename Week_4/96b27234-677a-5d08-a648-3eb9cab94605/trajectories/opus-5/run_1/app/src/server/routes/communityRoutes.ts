import { randomUUID } from 'node:crypto';
import { one, query, transact } from '../db.js';
import { conflict, invalid, notFound } from '../errors.js';
import { personOrThrow, readJsonBody, route, sendJson } from '../http.js';
import { worldNow } from '../clock.js';
import type { PersonRow } from '../auth.js';
import { publishPersonEvent } from '../events.js';
import { isAllowedZone } from '../domain/zones.js';
import type { Recurrence } from '../domain/gatherings.js';
import { isRecurrence, occurrencesOf, viewOccurrence } from '../domain/gatherings.js';
import { getOpenSession, leaveSession } from '../sessions.js';

export const COMMUNITY_TEXT = {
  name: 'Give the community a name of 1 to 80 characters.',
  timeZone: 'Choose a time zone from the list.',
  role: 'Choose owner, steward or member.',
  needsOwner: 'A community needs an owner.',
  title: 'Give the gathering a title of 1 to 120 characters.',
  starts: 'Enter the start as a local date and time.',
  duration: 'Duration must be 15 to 480 minutes.',
  recurrence: 'Choose none or weekly.',
  limit: 'Limit must be 1 to 500.',
  full: 'This gathering is full.',
  ended: 'This gathering has ended.'
} as const;

type Role = 'owner' | 'steward' | 'member';

interface CommunityRow {
  id: string;
  world_id: string;
  name: string;
  time_zone: string;
}

interface GatheringRow {
  id: string;
  community_id: string;
  title: string;
  starts_local: string;
  duration_minutes: number;
  recurrence: Recurrence;
  attend_limit: number;
}

async function membership(person: PersonRow, communityId: string): Promise<{ community: CommunityRow; role: Role }> {
  const community = await one<CommunityRow>('select * from communities where id = $1 and world_id = $2', [
    communityId,
    person.world_id
  ]);
  if (community === null) throw notFound();
  const row = await one<{ role: Role }>(
    'select role from community_members where community_id = $1 and person_id = $2',
    [community.id, person.id]
  );
  if (row === null) throw notFound();
  return { community, role: row.role };
}

async function gatheringOf(community: CommunityRow, gatheringId: string): Promise<GatheringRow> {
  const row = await one<GatheringRow>('select * from gatherings where id = $1 and community_id = $2', [
    gatheringId,
    community.id
  ]);
  if (row === null) throw notFound();
  return row;
}

async function gatheringView(
  person: PersonRow,
  community: CommunityRow,
  gathering: GatheringRow
): Promise<Record<string, unknown>> {
  const now = await worldNow(person.world_id);
  const occurrences = occurrencesOf(
    {
      startsLocal: gathering.starts_local,
      durationMinutes: gathering.duration_minutes,
      recurrence: gathering.recurrence,
      zone: community.time_zone
    },
    now
  ).map((occurrence) => viewOccurrence(occurrence, person.time_zone));
  const counts = await one<{ total: string }>(
    'select count(*)::text as total from gathering_attendees where gathering_id = $1',
    [gathering.id]
  );
  const mine = await one('select 1 from gathering_attendees where gathering_id = $1 and person_id = $2', [
    gathering.id,
    person.id
  ]);
  const first = occurrences[0];
  return {
    id: gathering.id,
    communityId: gathering.community_id,
    title: gathering.title,
    durationMinutes: gathering.duration_minutes,
    recurrence: gathering.recurrence,
    limit: gathering.attend_limit,
    attendingCount: Number(counts?.total ?? '0'),
    attending: mine !== null,
    status: first?.status ?? 'ended',
    display: first?.display ?? '',
    occurrences
  };
}

route('GET', '/api/communities', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const rows = await query<{ id: string; name: string; time_zone: string; role: Role }>(
    `select c.id, c.name, c.time_zone, m.role from communities c
       join community_members m on m.community_id = c.id
      where m.person_id = $1 and c.world_id = $2
      order by c.name asc`,
    [person.id, person.world_id]
  );
  sendJson(ctx.res, 200, {
    communities: rows.map((row) => ({ id: row.id, name: row.name, timeZone: row.time_zone, role: row.role }))
  });
});

route('POST', '/api/communities', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const body = await readJsonBody(ctx);
  const name = body['name'];
  if (typeof name !== 'string' || name.length < 1 || name.length > 80) throw invalid(COMMUNITY_TEXT.name);
  if (!isAllowedZone(body['timeZone'])) throw invalid(COMMUNITY_TEXT.timeZone);
  const now = await worldNow(person.world_id);
  const id = randomUUID();
  await transact(async (client) => {
    await client.query('insert into communities (id, world_id, name, time_zone) values ($1, $2, $3, $4)', [
      id,
      person.world_id,
      name,
      body['timeZone']
    ]);
    await client.query(
      `insert into community_members (community_id, person_id, role, joined_at) values ($1, $2, 'owner', $3)`,
      [id, person.id, now]
    );
  });
  sendJson(ctx.res, 201, { id, name, timeZone: body['timeZone'], role: 'owner' });
});

route('GET', '/api/communities/:id/members', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const { community, role } = await membership(person, ctx.params['id'] ?? '');
  const rows = await query<{ person_id: string; display_name: string; role: Role; joined_at: Date; email: string }>(
    `select m.person_id, p.display_name, m.role, m.joined_at, p.email
       from community_members m join people p on p.id = m.person_id
      where m.community_id = $1 order by m.joined_at asc, m.person_id asc`,
    [community.id]
  );
  const members = rows.map((row) => {
    const base: Record<string, unknown> = {
      personId: row.person_id,
      displayName: row.display_name,
      role: row.role
    };
    if (role === 'steward' || role === 'owner') base['joinedAt'] = row.joined_at.toISOString();
    if (role === 'owner') base['email'] = row.email;
    return base;
  });
  sendJson(ctx.res, 200, { members, total: members.length });
});

route('POST', '/api/communities/:id/members', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const { community, role } = await membership(person, ctx.params['id'] ?? '');
  if (role === 'member') throw notFound();
  const body = await readJsonBody(ctx);
  const personId = typeof body['personId'] === 'string' ? body['personId'] : '';
  const joiner = await one<{ id: string }>('select id from people where id = $1 and world_id = $2', [
    personId,
    person.world_id
  ]);
  if (joiner === null) throw notFound();
  const now = await worldNow(person.world_id);
  await query(
    `insert into community_members (community_id, person_id, role, joined_at) values ($1, $2, 'member', $3)
     on conflict (community_id, person_id) do nothing`,
    [community.id, joiner.id, now]
  );
  sendJson(ctx.res, 201, { personId: joiner.id, role: 'member' });
});

route('PUT', '/api/communities/:id/members/:personId', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const { community, role } = await membership(person, ctx.params['id'] ?? '');
  if (role !== 'owner') throw notFound();
  const targetId = ctx.params['personId'] ?? '';
  const target = await one<{ role: Role }>(
    'select role from community_members where community_id = $1 and person_id = $2',
    [community.id, targetId]
  );
  if (target === null) throw notFound();
  const body = await readJsonBody(ctx);
  const wanted = body['role'];
  if (wanted !== 'owner' && wanted !== 'steward' && wanted !== 'member') throw invalid(COMMUNITY_TEXT.role);
  if (target.role === 'owner' && wanted !== 'owner') {
    const owners = await one<{ total: string }>(
      `select count(*)::text as total from community_members where community_id = $1 and role = 'owner'`,
      [community.id]
    );
    if (Number(owners?.total ?? '0') <= 1) throw conflict(COMMUNITY_TEXT.needsOwner);
  }
  await query('update community_members set role = $3 where community_id = $1 and person_id = $2', [
    community.id,
    targetId,
    wanted
  ]);
  await publishPersonEvent(targetId, { type: 'role-changed', communityId: community.id });
  sendJson(ctx.res, 200, { personId: targetId, role: wanted });
});

route('DELETE', '/api/communities/:id/members/:personId', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const { community, role } = await membership(person, ctx.params['id'] ?? '');
  if (role === 'member') throw notFound();
  const targetId = ctx.params['personId'] ?? '';
  if (targetId === person.id) throw notFound();
  const target = await one<{ role: Role }>(
    'select role from community_members where community_id = $1 and person_id = $2',
    [community.id, targetId]
  );
  if (target === null) throw notFound();
  if (role === 'steward' && target.role !== 'member') throw notFound();
  if (target.role === 'owner') {
    const owners = await one<{ total: string }>(
      `select count(*)::text as total from community_members where community_id = $1 and role = 'owner'`,
      [community.id]
    );
    if (Number(owners?.total ?? '0') <= 1) throw conflict(COMMUNITY_TEXT.needsOwner);
  }
  await query('delete from community_members where community_id = $1 and person_id = $2', [community.id, targetId]);
  const memberships = await query<{ session_id: string; display_name: string }>(
    `select m.session_id, p.display_name from session_members m
       join sessions s on s.id = m.session_id
       join people p on p.id = m.person_id
      where m.person_id = $1 and m.active = true and s.status = 'open' and s.community_id = $2`,
    [targetId, community.id]
  );
  await publishPersonEvent(targetId, { type: 'removed-from-community', communityId: community.id });
  for (const entry of memberships) {
    const session = await getOpenSession(entry.session_id);
    if (session === null) continue;
    await leaveSession(session, targetId, entry.display_name);
  }
  sendJson(ctx.res, 200, { status: 'removed' });
});

route('GET', '/api/communities/:id/gatherings', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const { community } = await membership(person, ctx.params['id'] ?? '');
  const rows = await query<GatheringRow>(
    'select * from gatherings where community_id = $1 order by starts_local asc',
    [community.id]
  );
  const gatherings = [];
  for (const row of rows) gatherings.push(await gatheringView(person, community, row));
  sendJson(ctx.res, 200, { gatherings, total: gatherings.length });
});

route('POST', '/api/communities/:id/gatherings', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const { community, role } = await membership(person, ctx.params['id'] ?? '');
  if (role === 'member') throw notFound();
  const body = await readJsonBody(ctx);
  const title = body['title'];
  if (typeof title !== 'string' || title.length < 1 || title.length > 120) throw invalid(COMMUNITY_TEXT.title);
  const startsLocal = body['startsLocal'];
  if (typeof startsLocal !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startsLocal)) {
    throw invalid(COMMUNITY_TEXT.starts);
  }
  const duration = body['durationMinutes'];
  if (!Number.isInteger(duration) || (duration as number) < 15 || (duration as number) > 480) {
    throw invalid(COMMUNITY_TEXT.duration);
  }
  if (!isRecurrence(body['recurrence'])) throw invalid(COMMUNITY_TEXT.recurrence);
  const limit = body['limit'];
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 500) throw invalid(COMMUNITY_TEXT.limit);
  const now = await worldNow(person.world_id);
  const id = randomUUID();
  await query(
    `insert into gatherings (id, community_id, title, starts_local, duration_minutes, recurrence, attend_limit, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, community.id, title, startsLocal, duration, body['recurrence'], limit, now]
  );
  const row = await gatheringOf(community, id);
  sendJson(ctx.res, 201, await gatheringView(person, community, row));
});

route('GET', '/api/gatherings/:id', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const row = await one<GatheringRow>('select * from gatherings where id = $1', [ctx.params['id'] ?? '']);
  if (row === null) throw notFound();
  const { community } = await membership(person, row.community_id);
  sendJson(ctx.res, 200, await gatheringView(person, community, row));
});

route('POST', '/api/communities/:id/gatherings/:gatheringId/attend', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const { community } = await membership(person, ctx.params['id'] ?? '');
  const gathering = await gatheringOf(community, ctx.params['gatheringId'] ?? '');
  const now = await worldNow(person.world_id);
  const occurrences = occurrencesOf(
    {
      startsLocal: gathering.starts_local,
      durationMinutes: gathering.duration_minutes,
      recurrence: gathering.recurrence,
      zone: community.time_zone
    },
    now
  );
  if (gathering.recurrence === 'none' && occurrences[0]?.status === 'ended') throw conflict(COMMUNITY_TEXT.ended);
  const count = await transact(async (client) => {
    await client.query('select 1 from gatherings where id = $1 for update', [gathering.id]);
    const mine = await client.query('select 1 from gathering_attendees where gathering_id = $1 and person_id = $2', [
      gathering.id,
      person.id
    ]);
    const total = await client.query<{ total: string }>(
      'select count(*)::text as total from gathering_attendees where gathering_id = $1',
      [gathering.id]
    );
    const current = Number(total.rows[0]?.total ?? '0');
    if (mine.rowCount !== null && mine.rowCount > 0) return current;
    if (current >= gathering.attend_limit) throw conflict(COMMUNITY_TEXT.full);
    await client.query('insert into gathering_attendees (gathering_id, person_id) values ($1, $2)', [
      gathering.id,
      person.id
    ]);
    return current + 1;
  });
  sendJson(ctx.res, 200, { attending: true, count });
});

route('DELETE', '/api/communities/:id/gatherings/:gatheringId/attend', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const { community } = await membership(person, ctx.params['id'] ?? '');
  const gathering = await gatheringOf(community, ctx.params['gatheringId'] ?? '');
  await query('delete from gathering_attendees where gathering_id = $1 and person_id = $2', [gathering.id, person.id]);
  const total = await one<{ total: string }>(
    'select count(*)::text as total from gathering_attendees where gathering_id = $1',
    [gathering.id]
  );
  sendJson(ctx.res, 200, { attending: false, count: Number(total?.total ?? '0') });
});
