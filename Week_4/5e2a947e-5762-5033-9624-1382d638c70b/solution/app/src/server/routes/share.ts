import { ApiError } from '../../shared/errors.ts';
import { LIMITS, can } from '../../shared/rules.ts';
import { GUEST_COOKIE, createGuestSession, findUser, requirePrincipal, sessionCookie, type UserRow } from '../auth.ts';
import { serverNow } from '../clock.ts';
import { database, query, withMapLock } from '../db.ts';
import { Effects, emitEvent } from '../groups.ts';
import { dropPerson, setRole } from '../hub.ts';
import { bodyObject, empty, json, route, type Ctx } from '../http.ts';
import {
  assertCanRevoke,
  assertLive,
  createShareLink,
  describeLink,
  findLink,
  findLinkByCode,
  linksOf,
  revokeLink,
  type GrantableRole,
  type LinkRow,
} from '../links.ts';
import { ownerName } from '../members.ts';
import { resolveMap, scopeOf } from './maps.ts';

const GRANTABLE: readonly GrantableRole[] = ['editor', 'commenter', 'viewer'];

const authorizeManage = (ctx: Ctx): void => {
  if (!can(scopeOf(ctx).role, 'manage')) throw new ApiError('forbidden', 'Only the owner can manage who has access.');
};

/** The role a request body asks for, or a 422. */
function requestedRole(ctx: Ctx): GrantableRole {
  const role = bodyObject(ctx).role;
  const found = GRANTABLE.find((candidate) => candidate === role);
  if (!found) throw new ApiError('invalid', 'Role must be editor, commenter or viewer.', { fields: { role: 'Role must be editor, commenter or viewer.' } });
  return found;
}

/** The expiry a request body asks for: no expiry, or an instant after the server's now. */
function requestedExpiry(ctx: Ctx): number | null {
  const value = bodyObject(ctx).expires_at;
  if (value === null || value === undefined) return null;
  const instant = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!(instant > serverNow())) {
    throw new ApiError('invalid', 'The expiry must be a time in the future.', { fields: { expires_at: 'The expiry must be a time in the future.' } });
  }
  return instant;
}

// ------------------------------------------------------------------ members

interface Member {
  username: string;
  role: GrantableRole | 'owner';
}

route('GET', '/api/maps/:id/members', {
  stages: { authenticate: requirePrincipal, resolve: resolveMap, authorize: authorizeManage },
  handle: async (ctx) => {
    const { map } = scopeOf(ctx);
    const others = await query<Member>(
      database(),
      'SELECT u.username, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.map_id = $1 ORDER BY u.username',
      [map.id],
    );
    const owner: Member = { username: await ownerName(database(), map.owner_id), role: 'owner' };
    return json(200, { members: [owner, ...others] });
  },
});

route('PUT', '/api/maps/:id/members/:username', {
  body: 'json',
  stages: {
    authenticate: requirePrincipal,
    resolve: resolveMap,
    authorize: authorizeManage,
    validate: async (ctx) => {
      requestedRole(ctx);
      const person = await findUser(ctx.params.username ?? '');
      if (!person) throw new ApiError('invalid', 'No one has that username.', { fields: { username: 'No one has that username.' } });
      if (person.id === scopeOf(ctx).map.owner_id) {
        throw new ApiError('invalid', 'The owner already holds every role.', { fields: { username: 'The owner already holds every role.' } });
      }
      ctx.scope.person = person;
    },
  },
  handle: async (ctx) => {
    const { map } = scopeOf(ctx);
    const person = ctx.scope.person as UserRow;
    const role = requestedRole(ctx);
    const fx = new Effects();
    await withMapLock(map.id, async (client) => {
      const before = await query<{ role: GrantableRole }>(client, 'SELECT role FROM members WHERE map_id = $1 AND user_id = $2', [map.id, person.id]);
      await client.query(
        'INSERT INTO members (map_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (map_id, user_id) DO UPDATE SET role = EXCLUDED.role',
        [map.id, person.id, role],
      );
      if (before[0] && before[0].role !== role) {
        await emitEvent(client, map.id, { type: 'role', role }, 'user', person.id, fx);
        fx.add(() => setRole(map.id, person.id, role));
      }
    });
    fx.run();
    return json(200, { member: { username: person.username, role } });
  },
});

route('DELETE', '/api/maps/:id/members/:username', {
  stages: {
    authenticate: requirePrincipal,
    resolve: async (ctx) => {
      await resolveMap(ctx);
      const rows = await query<{ id: string }>(
        database(),
        'SELECT u.id FROM members m JOIN users u ON u.id = m.user_id WHERE m.map_id = $1 AND u.username = $2',
        [scopeOf(ctx).map.id, ctx.params.username],
      );
      const member = rows[0];
      if (!member) throw new ApiError('not_found', 'That person has no role on this map.');
      ctx.scope.memberId = member.id;
    },
    authorize: authorizeManage,
  },
  handle: async (ctx) => {
    const { map } = scopeOf(ctx);
    const memberId = ctx.scope.memberId as string;
    const fx = new Effects();
    await withMapLock(map.id, async (client) => {
      await client.query('DELETE FROM members WHERE map_id = $1 AND user_id = $2', [map.id, memberId]);
      await emitEvent(client, map.id, { type: 'access_removed' }, 'user', memberId, fx);
      fx.add(() => dropPerson(map.id, memberId));
    });
    fx.run();
    return empty();
  },
});

// -------------------------------------------------------------------- links

const resolveLink = async (ctx: Ctx): Promise<void> => {
  await resolveMap(ctx);
  ctx.scope.link = await findLink(database(), scopeOf(ctx).map.id, ctx.params.lid ?? '');
};

route('POST', '/api/maps/:id/links', {
  body: 'json',
  stages: {
    authenticate: requirePrincipal,
    resolve: resolveMap,
    authorize: authorizeManage,
    validate: (ctx) => {
      requestedRole(ctx);
      requestedExpiry(ctx);
    },
  },
  handle: async (ctx) => {
    const link = await createShareLink(database(), { mapId: scopeOf(ctx).map.id, role: requestedRole(ctx), expiresAt: requestedExpiry(ctx) });
    return json(201, { link });
  },
});

route('GET', '/api/maps/:id/links', {
  stages: { authenticate: requirePrincipal, resolve: resolveMap, authorize: authorizeManage },
  handle: async (ctx) => json(200, { links: (await linksOf(database(), scopeOf(ctx).map.id)).map(describeLink) }),
});

route('POST', '/api/maps/:id/links/:lid/regenerate', {
  stages: {
    authenticate: requirePrincipal,
    resolve: resolveLink,
    authorize: authorizeManage,
    state: (ctx) => assertCanRevoke(ctx.scope.link as LinkRow),
  },
  handle: async (ctx) => {
    const { map } = scopeOf(ctx);
    const fx = new Effects();
    const link = await withMapLock(map.id, async (client) => {
      const old = await findLink(client, map.id, ctx.params.lid ?? '', true);
      assertCanRevoke(old);
      await revokeLink(client, old, fx);
      return createShareLink(client, { mapId: map.id, role: old.role, expiresAt: old.expires_at?.getTime() ?? null });
    });
    fx.run();
    return json(200, { link });
  },
});

route('DELETE', '/api/maps/:id/links/:lid', {
  stages: {
    authenticate: requirePrincipal,
    resolve: resolveLink,
    authorize: authorizeManage,
    state: (ctx) => assertCanRevoke(ctx.scope.link as LinkRow),
  },
  handle: async (ctx) => {
    const { map } = scopeOf(ctx);
    const fx = new Effects();
    await withMapLock(map.id, async (client) => {
      const link = await findLink(client, map.id, ctx.params.lid ?? '', true);
      assertCanRevoke(link);
      await revokeLink(client, link, fx);
    });
    fx.run();
    return empty();
  },
});

// ------------------------------------------------------------- public links

const resolveCode = async (ctx: Ctx): Promise<void> => {
  const link = await findLinkByCode(database(), ctx.params.code ?? '');
  assertLive(link);
  ctx.scope.link = link;
};

route('GET', '/api/share/:code', {
  stages: { resolve: resolveCode },
  handle: async (ctx) => {
    const link = ctx.scope.link as LinkRow;
    const { expires_at, state } = describeLink(link);
    return json(200, { map_id: link.map_id, map_title: link.map_title, role: link.role, expires_at, state });
  },
});

/** The display name a guest asks to join with, or a 422. */
function requestedName(ctx: Ctx): string {
  const value = bodyObject(ctx).display_name;
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length < 1 || Array.from(name).length > LIMITS.display_name_chars) {
    throw new ApiError('invalid', 'Your name must be 1 to 30 characters.', { fields: { display_name: 'Your name must be 1 to 30 characters.' } });
  }
  return name;
}

route('POST', '/api/share/:code/join', {
  body: 'json',
  stages: { resolve: resolveCode, validate: (ctx) => void requestedName(ctx) },
  handle: async (ctx) => {
    const link = ctx.scope.link as LinkRow;
    const token = await createGuestSession(link.map_id, link.id, requestedName(ctx), link.role);
    return json(200, { map_id: link.map_id, role: link.role }, { 'set-cookie': sessionCookie(GUEST_COOKIE, token, null) });
  },
});
