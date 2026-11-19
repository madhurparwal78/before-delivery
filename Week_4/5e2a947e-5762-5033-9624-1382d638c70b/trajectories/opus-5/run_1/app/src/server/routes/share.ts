import { randomBytes, randomUUID } from 'node:crypto';
import { copy } from '../../shared/copy.js';
import { ApiError } from '../../shared/errors.js';
import { can, isGrantableRole } from '../../shared/permissions.js';
import { canShareLinkMove } from '../../shared/states.js';
import type { Role, ShareLinkState } from '../../shared/types.js';
import { cookieHeader, GUEST_COOKIE, optionalActor, requireActor } from '../auth.js';
import { connectionsFor, publish, sendTo } from '../bus.js';
import { now, nowMs } from '../clock.js';
import { db } from '../db.js';
import { readJson, route } from '../http.js';
import { requireRole } from '../mapstore.js';

interface LinkRow {
  id: string;
  map_id: string;
  code: string;
  role: Exclude<Role, 'owner'>;
  expires_at: Date | null;
  state: ShareLinkState;
}

function linkJson(row: LinkRow): Record<string, unknown> {
  return {
    id: row.id,
    code: row.code,
    role: row.role,
    expires_at: row.expires_at ? row.expires_at.toISOString() : null,
    state: row.state,
    url: `/s/${row.code}`,
  };
}

function newCode(): string {
  return randomBytes(9).toString('base64url');
}

/** Expires a link as soon as server time passes its instant. */
export async function settleLink(row: LinkRow): Promise<LinkRow> {
  if (row.state === 'active' && row.expires_at && row.expires_at.getTime() <= nowMs()) {
    await db.query("update share_links set state = 'expired' where id = $1", [row.id]);
    await endLinkSessions(row.map_id, row.id, 'link_expired');
    return { ...row, state: 'expired' };
  }
  return row;
}

export async function endLinkSessions(
  mapId: string,
  linkId: string,
  type: 'link_expired' | 'link_revoked',
): Promise<void> {
  const guests = await db.query<{ id: string }>('select id from guests where link_id = $1', [linkId]);
  const keys = new Set(guests.rows.map((row) => `g:${row.id}`));
  for (const conn of connectionsFor(mapId)) {
    if (keys.has(conn.actorKey)) sendTo(conn, { seq: 0, type });
  }
}

route('GET', '/api/maps/:id/members', async (ctx) => {
  const actor = await requireActor(ctx);
  const { map, role } = await requireRole(db, ctx.params.id, actor);
  const rows = await db.query<{ username: string; role: Role }>(
    'select username, role from members where map_id = $1 order by username asc',
    [map.id],
  );
  void role;
  return {
    status: 200,
    json: {
      members: [
        { username: map.owner, role: 'owner' },
        ...rows.rows.map((row) => ({ username: row.username, role: row.role })),
      ],
    },
  };
});

route('PUT', '/api/maps/:id/members/:username', async (ctx) => {
  const actor = await requireActor(ctx);
  const { map, role } = await requireRole(db, ctx.params.id, actor);
  if (!can(role, 'manage')) throw new ApiError('forbidden', 'Only the owner manages roles.');
  const body = readJson(ctx);
  if (!isGrantableRole(body.role)) throw new ApiError('invalid', 'That role cannot be granted.');
  const username = ctx.params.username;
  if (username === map.owner) throw new ApiError('invalid', "The owner's role cannot change.");
  const user = await db.query('select 1 from users where username = $1', [username]);
  if (user.rows.length === 0) throw new ApiError('invalid', 'There is no such person.');
  await db.query(
    `insert into members (map_id, username, role) values ($1, $2, $3)
     on conflict (map_id, username) do update set role = $3`,
    [map.id, username, body.role],
  );
  await publish(map.id, {
    type: 'role',
    recipient: username,
    payload: { role: body.role, notice: copy.roleChange(body.role as Role) },
  });
  for (const conn of connectionsFor(map.id)) {
    if (conn.actorKey === username) {
      conn.role = body.role as Role;
      conn.canSeeRestricted = body.role === 'editor';
    }
  }
  return { status: 200, json: { member: { username, role: body.role } } };
});

route('DELETE', '/api/maps/:id/members/:username', async (ctx) => {
  const actor = await requireActor(ctx);
  const { map, role } = await requireRole(db, ctx.params.id, actor);
  if (!can(role, 'manage')) throw new ApiError('forbidden', 'Only the owner manages roles.');
  await db.query('delete from members where map_id = $1 and username = $2', [
    map.id,
    ctx.params.username,
  ]);
  await publish(map.id, {
    type: 'access_removed',
    recipient: ctx.params.username,
    payload: { message: copy.accessRemoved },
  });
  return { status: 204 };
});

route('POST', '/api/maps/:id/links', async (ctx) => {
  const actor = await requireActor(ctx);
  const { map, role } = await requireRole(db, ctx.params.id, actor);
  if (!can(role, 'manage')) throw new ApiError('forbidden', 'Only the owner shares this map.');
  const body = readJson(ctx);
  if (!isGrantableRole(body.role)) throw new ApiError('invalid', 'That role cannot be granted.');
  let expiresAt: Date | null = null;
  if (body.expires_at !== null && body.expires_at !== undefined) {
    const parsed = new Date(String(body.expires_at));
    if (Number.isNaN(parsed.getTime())) throw new ApiError('invalid', 'That expiry is not a time.');
    if (parsed.getTime() <= nowMs()) throw new ApiError('invalid', 'An expiry must be in the future.');
    expiresAt = parsed;
  }
  const row: LinkRow = {
    id: randomUUID(),
    map_id: map.id,
    code: newCode(),
    role: body.role,
    expires_at: expiresAt,
    state: 'active',
  };
  await db.query(
    `insert into share_links (id, map_id, code, role, expires_at, state, created_at)
     values ($1, $2, $3, $4, $5, 'active', $6)`,
    [row.id, row.map_id, row.code, row.role, row.expires_at, now()],
  );
  return { status: 201, json: { link: linkJson(row) } };
});

route('GET', '/api/maps/:id/links', async (ctx) => {
  const actor = await requireActor(ctx);
  const { map, role } = await requireRole(db, ctx.params.id, actor);
  if (!can(role, 'manage')) throw new ApiError('forbidden', 'Only the owner shares this map.');
  const rows = await db.query<LinkRow>(
    'select id, map_id, code, role, expires_at, state from share_links where map_id = $1 order by created_at asc',
    [map.id],
  );
  const settled = await Promise.all(rows.rows.map((row) => settleLink(row)));
  return { status: 200, json: { links: settled.map(linkJson) } };
});

route('POST', '/api/maps/:id/links/:lid/regenerate', async (ctx) => {
  const actor = await requireActor(ctx);
  const { map, role } = await requireRole(db, ctx.params.id, actor);
  if (!can(role, 'manage')) throw new ApiError('forbidden', 'Only the owner shares this map.');
  const rows = await db.query<LinkRow>(
    'select id, map_id, code, role, expires_at, state from share_links where id = $1 and map_id = $2',
    [ctx.params.lid, map.id],
  );
  const row = rows.rows[0];
  if (!row) throw new ApiError('not_found', 'That link is gone.');
  const settled = await settleLink(row);
  if (!canShareLinkMove(settled.state, 'revoked')) {
    throw new ApiError('invalid_transition', 'That link has already ended.');
  }
  await db.query("update share_links set state = 'revoked' where id = $1", [row.id]);
  await endLinkSessions(map.id, row.id, 'link_revoked');
  const replacement: LinkRow = { ...row, id: randomUUID(), code: newCode(), state: 'active' };
  await db.query(
    `insert into share_links (id, map_id, code, role, expires_at, state, created_at)
     values ($1, $2, $3, $4, $5, 'active', $6)`,
    [replacement.id, map.id, replacement.code, replacement.role, replacement.expires_at, now()],
  );
  return { status: 200, json: { link: linkJson(replacement) } };
});

route('DELETE', '/api/maps/:id/links/:lid', async (ctx) => {
  const actor = await requireActor(ctx);
  const { map, role } = await requireRole(db, ctx.params.id, actor);
  if (!can(role, 'manage')) throw new ApiError('forbidden', 'Only the owner shares this map.');
  const rows = await db.query<LinkRow>(
    'select id, map_id, code, role, expires_at, state from share_links where id = $1 and map_id = $2',
    [ctx.params.lid, map.id],
  );
  const row = rows.rows[0];
  if (!row) throw new ApiError('not_found', 'That link is gone.');
  const settled = await settleLink(row);
  if (!canShareLinkMove(settled.state, 'revoked')) {
    throw new ApiError('invalid_transition', 'That link has already ended.');
  }
  await db.query("update share_links set state = 'revoked' where id = $1", [row.id]);
  await endLinkSessions(map.id, row.id, 'link_revoked');
  return { status: 204 };
});

async function linkByCode(code: string): Promise<LinkRow> {
  const rows = await db.query<LinkRow & { title: string }>(
    `select l.id, l.map_id, l.code, l.role, l.expires_at, l.state, m.title
       from share_links l join maps m on m.id = l.map_id
      where l.code = $1`,
    [code],
  );
  const row = rows.rows[0];
  if (!row) throw new ApiError('not_found', copy.unknownPage);
  const settled = await settleLink(row);
  if (settled.state === 'expired') throw new ApiError('link_expired', copy.expiredLink);
  if (settled.state === 'revoked') throw new ApiError('link_revoked', copy.turnedOffLink);
  return settled;
}

route('GET', '/api/share/:code', async (ctx) => {
  const row = await linkByCode(ctx.params.code);
  const map = await db.query<{ title: string }>('select title from maps where id = $1', [row.map_id]);
  return {
    status: 200,
    json: {
      map_id: row.map_id,
      map_title: map.rows[0]?.title ?? '',
      role: row.role,
      expires_at: row.expires_at ? row.expires_at.toISOString() : null,
      state: 'active',
    },
  };
});

route('POST', '/api/share/:code/join', async (ctx) => {
  const row = await linkByCode(ctx.params.code);
  const body = readJson(ctx);
  const name = typeof body.display_name === 'string' ? body.display_name.trim() : '';
  if (name.length < 1 || name.length > 30) {
    throw new ApiError('invalid', 'A name is 1 to 30 characters.', {
      fields: { display_name: 'A name is 1 to 30 characters.' },
    });
  }
  const actor = await optionalActor(ctx).catch(() => null);
  if (actor && actor.kind === 'user') {
    const owner = await db.query<{ owner_id: string }>('select owner_id from maps where id = $1', [
      row.map_id,
    ]);
    if (owner.rows[0]?.owner_id !== actor.userId) {
      await db.query(
        `insert into members (map_id, username, role) values ($1, $2, $3)
         on conflict (map_id, username) do nothing`,
        [row.map_id, actor.name, row.role],
      );
    }
    return { status: 200, json: { map_id: row.map_id, role: row.role } };
  }
  const id = randomUUID();
  await db.query(
    `insert into guests (id, map_id, link_id, display_name, role, created_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [id, row.map_id, row.id, name, row.role, now()],
  );
  ctx.setCookie(cookieHeader(GUEST_COOKIE, id, 7 * 24 * 60 * 60 * 1000));
  return { status: 200, json: { map_id: row.map_id, role: row.role } };
});
