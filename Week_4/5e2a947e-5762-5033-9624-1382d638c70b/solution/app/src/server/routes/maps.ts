import { ApiError } from '../../shared/errors.ts';
import type { ActivityEntry, MapDoc, Role } from '../../shared/model.ts';
import { LIMITS, can } from '../../shared/rules.ts';
import { requirePrincipal } from '../auth.ts';
import { serverNow, toIso } from '../clock.ts';
import { instanceId } from '../config.ts';
import { database, query } from '../db.ts';
import { followerCount } from '../hub.ts';
import { bodyObject, empty, json, route, type Ctx } from '../http.ts';
import { randomId } from '../ids.ts';
import { accessMap, buildPayload, titleOf, visibleDoc, type MapRow } from '../mapStore.ts';
import { TEMPLATES, buildDoc, type TemplateName } from '../templates.ts';

interface Scope {
  map: MapRow;
  role: Role;
}

export const resolveMap = async (ctx: Ctx): Promise<void> => {
  ctx.scope.access = await accessMap(database(), ctx.params.id ?? '', ctx.principal as NonNullable<Ctx['principal']>);
};

export const scopeOf = (ctx: Ctx): Scope => ctx.scope.access as Scope;

route('GET', '/api/maps', {
  stages: { authenticate: requirePrincipal },
  handle: async (ctx) => {
    const principal = ctx.principal as NonNullable<Ctx['principal']>;
    const rows = principal.guest
      ? await query<MapRow & { role: Role }>(database(), "SELECT m.*, $2::text AS role FROM maps m WHERE m.id = $1", [principal.guestMap, principal.guestRole])
      : await query<MapRow & { role: Role }>(
          database(),
          `SELECT m.*, CASE WHEN m.owner_id = $1 THEN 'owner' ELSE x.role END AS role
           FROM maps m LEFT JOIN members x ON x.map_id = m.id AND x.user_id = $1
           WHERE m.owner_id = $1 OR x.user_id = $1 ORDER BY m.updated_at DESC, m.created_at DESC`,
          [principal.id],
        );
    return json(200, {
      maps: rows.map((m) => ({
        id: m.id,
        title: titleOf(m.doc),
        role: m.role,
        updated_at: toIso(m.updated_at.getTime()),
        revision: m.revision,
        topic_count: Object.keys(visibleDoc(m.doc, m.role).topics).length,
      })),
    });
  },
});

const TITLE_PROBLEM = 'Title must be 1 to 200 characters.';

route('POST', '/api/maps', {
  body: 'json',
  stages: {
    authenticate: async (ctx) => {
      await requirePrincipal(ctx);
      if (ctx.principal?.guest) throw new ApiError('unauthenticated', 'Sign in to continue.');
    },
    validate: (ctx) => {
      const body = bodyObject(ctx);
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (title.length < 1 || Array.from(title).length > LIMITS.map_title_chars) {
        throw new ApiError('invalid', TITLE_PROBLEM, { fields: { title: TITLE_PROBLEM } });
      }
      if (body.template !== null && !(TEMPLATES as readonly unknown[]).includes(body.template)) {
        throw new ApiError('invalid', 'Unknown template.', { fields: { template: 'Unknown template.' } });
      }
    },
  },
  handle: async (ctx) => {
    const body = bodyObject(ctx);
    const id = randomId();
    const now = toIso(serverNow());
    const title = String(body.title).trim();
    const doc = buildDoc(title, body.template as TemplateName | null);
    await query(database(), 'INSERT INTO maps (id, title, owner_id, revision, seq, doc, version_baseline, created_at, updated_at, home) VALUES ($1, $2, $3, 1, 0, $4, $5, $5, $5, $6)', [
      id,
      title,
      ctx.principal?.id,
      JSON.stringify(doc),
      now,
      instanceId,
    ]);
    const payload = await buildPayload(id, ctx.principal as NonNullable<Ctx['principal']>, followerCount);
    return json(201, { map: payload.map });
  },
});

route('GET', '/api/maps/:id', {
  stages: { authenticate: requirePrincipal, resolve: resolveMap },
  handle: async (ctx) => json(200, await buildPayload(ctx.params.id ?? '', ctx.principal as NonNullable<Ctx['principal']>, followerCount)),
});

route('DELETE', '/api/maps/:id', {
  stages: {
    authenticate: requirePrincipal,
    resolve: resolveMap,
    authorize: (ctx) => {
      if (!can(scopeOf(ctx).role, 'delete_map')) throw new ApiError('forbidden', 'Only the owner can delete a map.');
    },
  },
  handle: async (ctx) => {
    await query(database(), 'DELETE FROM maps WHERE id = $1', [ctx.params.id]);
    return empty();
  },
});

route('PUT', '/api/maps/:id/collapse', {
  body: 'json',
  stages: {
    authenticate: requirePrincipal,
    resolve: resolveMap,
    validate: (ctx) => {
      const body = bodyObject(ctx);
      const doc: MapDoc = visibleDoc(scopeOf(ctx).map.doc, scopeOf(ctx).role);
      if (typeof body.topic_id !== 'string' || !doc.topics[body.topic_id]) throw new ApiError('not_found', 'That topic no longer exists.');
      if (typeof body.collapsed !== 'boolean') throw new ApiError('invalid', 'collapsed must be true or false.');
    },
  },
  handle: async (ctx) => {
    const body = bodyObject(ctx);
    const mapId = ctx.params.id ?? '';
    const personId = ctx.principal?.id ?? '';
    if (body.collapsed === true) {
      await query(database(), 'INSERT INTO collapse (map_id, user_id, topic_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [mapId, personId, body.topic_id]);
    } else {
      await query(database(), 'DELETE FROM collapse WHERE map_id = $1 AND user_id = $2 AND topic_id = $3', [mapId, personId, body.topic_id]);
    }
    return empty();
  },
});

route('GET', '/api/maps/:id/activity', {
  stages: { authenticate: requirePrincipal, resolve: resolveMap },
  handle: async (ctx) => {
    const { role } = scopeOf(ctx);
    const person = ctx.query.get('person');
    const rows = await query<{ revision: number; author: string; sentence: string; topic_id: string | null; at: Date; restricted: boolean }>(
      database(),
      `SELECT revision, author, sentence, topic_id, at, restricted FROM ops_log
       WHERE map_id = $1 AND ($2::text IS NULL OR author = $2) ORDER BY revision DESC LIMIT 500`,
      [ctx.params.id, person],
    );
    const entries: ActivityEntry[] = rows
      .filter((r) => can(role, 'see_restricted') || !r.restricted)
      .map((r) => ({ seq: r.revision, user: r.author, sentence: r.sentence, topic_id: r.topic_id, at: toIso(r.at.getTime()) }));
    return json(200, { entries });
  },
});

