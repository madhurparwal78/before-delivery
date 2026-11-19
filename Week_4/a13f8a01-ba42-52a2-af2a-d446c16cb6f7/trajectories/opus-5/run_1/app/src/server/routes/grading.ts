import type { Visibility } from '../../shared/api';
import {
  createSession,
  findUserByEmail,
  findUserByHandle,
  insertUser,
  serializeSessionCookie,
  userShape,
} from '../auth';
import { query } from '../db';

import { requireFiles, requireLibraries, requireTags, requireTitle, isVisibility } from '../domain/validate';
import { appendVersion } from '../domain/versions';
import { apiError, notFound } from '../errors';
import { json, type Ctx, type Reply, type Router } from '../http';
import { hashPassword, newId } from '../util';

interface SeedVersion {
  files: unknown;
  libraries?: unknown;
  created_at?: string;
}

interface SeedPen {
  key: string;
  owner: string;
  title?: string;
  visibility?: string;
  tags?: unknown;
  versions?: SeedVersion[];
  forked_from?: { key: string; version: number };
}

interface SeedBody {
  users?: { handle: string; email: string; password?: string; verified?: boolean }[];
  pens?: SeedPen[];
  likes?: { user: string; pen: string }[];
  collections?: { key: string; owner: string; title?: string; pens?: string[] }[];
}

const fail = (field: string, message: string): never => {
  throw apiError('validation', { fields: { [field]: message } });
};

const seed = async (ctx: Ctx): Promise<Reply> => {
  const body = (ctx.body ?? {}) as SeedBody;
  const userIds: Record<string, string> = {};
  const penIds: Record<string, string> = {};
  const collectionIds: Record<string, string> = {};

  for (const definition of body.users ?? []) {
    if (await findUserByHandle(definition.handle)) throw apiError('duplicate');
    if (await findUserByEmail(definition.email)) throw apiError('duplicate');
    const user = await insertUser({
      handle: definition.handle,
      email: definition.email,
      passwordHash: definition.password ? hashPassword(definition.password) : null,
      verified: definition.verified ?? false,
    });
    userIds[user.handle] = user.id;
  }

  const ownerId = async (handle: string): Promise<string> => {
    const known = userIds[handle];
    if (known) return known;
    const user = await findUserByHandle(handle);
    if (!user) fail('owner', `No user with handle ${handle}.`);
    return user!.id;
  };

  for (const definition of body.pens ?? []) {
    if (typeof definition.key !== 'string') fail('pens', 'Every pen needs a key.');
    const id = newId();
    const visibility: Visibility = isVisibility(definition.visibility)
      ? definition.visibility
      : 'private';
    const tags = definition.tags === undefined ? [] : requireTags(definition.tags);
    const title = definition.title === undefined ? 'Untitled pen' : requireTitle(definition.title);

    let sourcePenId: string | null = null;
    let sourceVersion: number | null = null;
    if (definition.forked_from) {
      const source = penIds[definition.forked_from.key];
      if (!source) fail('forked_from', 'A fork source must appear earlier in this call.');
      sourcePenId = source!;
      sourceVersion = definition.forked_from.version;
    }

    await query(
      `insert into pens (id, owner_id, title, visibility, tags, source_pen_id, source_version)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, await ownerId(definition.owner), title, visibility, tags, sourcePenId, sourceVersion],
    );
    penIds[definition.key] = id;

    let previous = 0;
    let base = 0;
    for (const version of definition.versions ?? []) {
      let createdAt: Date | undefined;
      if (version.created_at !== undefined) {
        const stamp = Date.parse(version.created_at);
        if (!Number.isFinite(stamp)) fail('created_at', 'Send an ISO 8601 time.');
        if (stamp <= previous) fail('created_at', 'Version times must increase along the list.');
        previous = stamp;
        createdAt = new Date(stamp);
      }
      const row = await appendVersion({
        penId: id,
        baseVersion: base,
        files: requireFiles(version.files),
        libraries: requireLibraries(version.libraries ?? []),
        restoredFrom: null,
        createdAt,
      });
      base = row.number;
    }
  }

  for (const like of body.likes ?? []) {
    const penId = penIds[like.pen] ?? like.pen;
    await query('insert into likes (user_id, pen_id) values ($1, $2) on conflict do nothing', [
      await ownerId(like.user),
      penId,
    ]);
  }

  for (const definition of body.collections ?? []) {
    const id = newId();
    const owner = await ownerId(definition.owner);
    await query('insert into collections (id, owner_id, title) values ($1, $2, $3)', [
      id,
      owner,
      definition.title === undefined ? 'Untitled collection' : requireTitle(definition.title),
    ]);
    collectionIds[definition.key] = id;
    let position = 0;
    for (const key of definition.pens ?? []) {
      const penId = penIds[key] ?? key;
      await query(
        'insert into collection_pens (collection_id, pen_id, position) values ($1, $2, $3)',
        [id, penId, position],
      );
      position += 1;
    }
  }

  return json(201, { users: userIds, pens: penIds, collections: collectionIds });
};

const session = async (ctx: Ctx): Promise<Reply> => {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const handle = typeof body.handle === 'string' ? body.handle : '';
  const user = await findUserByHandle(handle);
  if (!user) throw notFound();
  return {
    status: 200,
    body: { user: userShape(user) },
    cookie: serializeSessionCookie(await createSession(user.id)),
  };
};

export const registerGradingRoutes = (router: Router): void => {
  router.add('POST', '/api/grading/seed', seed);
  router.add('POST', '/api/grading/session', session);
};

