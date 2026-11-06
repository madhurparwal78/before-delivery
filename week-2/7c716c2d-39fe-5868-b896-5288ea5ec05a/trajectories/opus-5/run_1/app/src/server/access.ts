import { createHash, randomBytes } from 'node:crypto';
import { nowDate } from './clock.js';
import { db, tx, type Queryable } from './db.js';
import { ApiError } from './errors.js';
import { appendEvent } from './events.js';
import type { Person, Role } from '../shared/types.js';

export type Actor = {
  id: string;
  name: string;
  email: string;
  handle: string | null;
  role: Role | null;
  workspaceId: string | null;
  removed: boolean;
  away: boolean;
};

export type PersonRow = {
  id: string;
  name: string;
  email: string;
  handle: string | null;
  role: Role | null;
  workspace_id: string | null;
  removed: boolean;
  away: boolean;
};

export function toActor(row: PersonRow): Actor {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    handle: row.handle,
    role: row.removed ? null : row.role,
    workspaceId: row.removed ? null : row.workspace_id,
    removed: row.removed,
    away: row.away,
  };
}

export function personBody(row: PersonRow): Person {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    handle: row.handle,
    role: row.removed ? null : row.role,
  };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function createSession(client: Queryable, personId: string): Promise<string> {
  const token = newSessionToken();
  await client.query('insert into sessions (token_hash, person_id, created_at) values ($1, $2, $3)', [
    hashToken(token),
    personId,
    nowDate().toISOString(),
  ]);
  return token;
}

export async function actorFromToken(token: string | undefined): Promise<Actor | undefined> {
  if (token === undefined) return undefined;
  const row = await db.one<PersonRow>(
    `select p.id, p.name, p.email, p.handle, p.role, p.workspace_id, p.removed, p.away
       from sessions s join people p on p.id = s.person_id
      where s.token_hash = $1 and s.revoked_at is null`,
    [hashToken(token)],
  );
  if (row === undefined || row.removed) return undefined;
  return toActor(row);
}

export function requireWorkspace(actor: Actor): string {
  if (actor.workspaceId === null) throw new ApiError('forbidden');
  return actor.workspaceId;
}

export function requireOwner(actor: Actor): string {
  const workspaceId = requireWorkspace(actor);
  if (actor.role !== 'owner') throw new ApiError('forbidden');
  return workspaceId;
}

export function requireEditor(actor: Actor): string {
  const workspaceId = requireWorkspace(actor);
  if (actor.role !== 'owner' && actor.role !== 'member') throw new ApiError('forbidden');
  return workspaceId;
}

export async function visibleProjectIds(actor: Actor, client: Queryable = db): Promise<string[]> {
  const workspaceId = requireWorkspace(actor);
  if (actor.role === 'guest') {
    const rows = await client.query<{ project_id: string }>(
      `select g.project_id from project_guests g
         join projects p on p.id = g.project_id
        where g.person_id = $1 and p.workspace_id = $2`,
      [actor.id, workspaceId],
    );
    return rows.map((row) => row.project_id);
  }
  const rows = await client.query<{ id: string }>('select id from projects where workspace_id = $1', [
    workspaceId,
  ]);
  return rows.map((row) => row.id);
}

export async function ownChannelIds(actor: Actor, client: Queryable = db): Promise<string[]> {
  const workspaceId = requireWorkspace(actor);
  const rows = await client.query<{ channel_id: string }>(
    `select cm.channel_id from channel_members cm
       join channels c on c.id = cm.channel_id
      where cm.person_id = $1 and c.workspace_id = $2
      order by c.name asc`,
    [actor.id, workspaceId],
  );
  return rows.map((row) => row.channel_id);
}

export async function canSeeProject(actor: Actor, projectId: string, client: Queryable = db): Promise<boolean> {
  return (await visibleProjectIds(actor, client)).includes(projectId);
}

export async function canSeeChannel(actor: Actor, channelId: string, client: Queryable = db): Promise<boolean> {
  return (await ownChannelIds(actor, client)).includes(channelId);
}

/** The people a viewer can see, by name A to Z. */
export async function visiblePeople(actor: Actor, client: Queryable = db): Promise<PersonRow[]> {
  const workspaceId = requireWorkspace(actor);
  if (actor.role === 'guest') {
    return client.query<PersonRow>(
      `select distinct p.id, p.name, p.email, p.handle, p.role, p.workspace_id, p.removed, p.away
         from people p
        where p.workspace_id = $1 and p.removed = false
          and (p.role in ('owner','member')
               or p.id = $2
               or exists (select 1 from project_guests g1
                            join project_guests g2 on g2.project_id = g1.project_id
                           where g1.person_id = $2 and g2.person_id = p.id)
               or exists (select 1 from channel_members c1
                            join channel_members c2 on c2.channel_id = c1.channel_id
                           where c1.person_id = $2 and c2.person_id = p.id))
        order by p.name asc, p.id asc`,
      [workspaceId, actor.id],
    );
  }
  return client.query<PersonRow>(
    `select p.id, p.name, p.email, p.handle, p.role, p.workspace_id, p.removed, p.away
       from people p
      where p.workspace_id = $1 and p.removed = false
      order by p.name asc, p.id asc`,
    [workspaceId],
  );
}

export async function activeMemberCount(workspaceId: string, client: Queryable = db): Promise<number> {
  const row = await client.one<{ count: number }>(
    'select count(*)::int as count from people where workspace_id = $1 and removed = false',
    [workspaceId],
  );
  return row?.count ?? 0;
}

const touched = new Map<string, number>();

/** Activity marks a person active; the turn to away is timed by the away job. */
export async function touchPresence(actor: Actor): Promise<void> {
  const last = touched.get(actor.id) ?? 0;
  if (Date.now() - last < 5000 && !actor.away) return;
  touched.set(actor.id, Date.now());
  const at = nowDate().toISOString();
  if (!actor.away) {
    await db.query('update people set last_seen_at = $2 where id = $1', [actor.id, at]);
    return;
  }
  await tx(async (client) => {
    const row = await client.one<{ id: string }>(
      'update people set last_seen_at = $2, away = false where id = $1 and away = true returning id',
      [actor.id, at],
    );
    if (row !== undefined && actor.workspaceId !== null) {
      await appendEvent(
        client,
        actor.workspaceId,
        'presence',
        { person_id: actor.id, status: 'active' },
        { type: 'workspace' },
        at,
      );
    }
  });
}
