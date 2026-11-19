import type { Pen } from '../../shared/api';
import { requireUser, requireVerified, type UserRow } from '../auth';
import { one, query } from '../db';
import { parseSnapshot, snapshotKey, snapshotPrefix } from '../domain/canonical';
import { diffFiles } from '../domain/diff';
import {
  findPen,
  listVersions,
  penShape,
  penSummary,
  PEN_SELECT,
  requireOwnedPen,
  requireVersion,
  requireVisiblePen,
  versionEntry,
  versionShape,
  type PenRow,
} from '../domain/pens';
import { searchPens } from '../domain/search';
import {
  requireFiles,
  requireLibraries,
  requireTags,
  requireTitle,
  requireVersionNumber,
  isVisibility,
  validationError,
} from '../domain/validate';
import { appendVersion } from '../domain/versions';
import { apiError, raiseFirst } from '../errors';
import { emitCounts, emitHead } from '../events';
import { json, noContent, type Ctx, type Reply, type Router } from '../http';
import { idempotencyKey, replayIdempotent, storeIdempotent } from '../idempotency';
import { queueForkNotice } from '../mail';
import { deletePrefix, getObject } from '../storage';
import { newId } from '../util';
import { buildZip } from '../zip';

const reloadPen = async (id: string, viewerId: string | null): Promise<Pen> => {
  const pen = await findPen(id);
  if (!pen) throw apiError('not_found');
  return penShape(pen, viewerId);
};

/**
 * Runs a write that may be replayed: a stored 201 for the same caller, route and key is returned
 * before every check but the body limit and the sign-in check.
 */
const withIdempotency = async (
  ctx: Ctx,
  user: UserRow,
  route: string,
  run: () => Promise<Reply>,
): Promise<Reply> => {
  const key = idempotencyKey(ctx.idempotencyKey);
  if (!key) return run();
  const stored = await replayIdempotent(user.id, route, key, ctx.body);
  if (stored) return json(stored.status, stored.body);
  const reply = await run();
  if (reply.status === 201) {
    await storeIdempotent(user.id, route, key, ctx.body, { status: 201, body: reply.body });
  }
  return reply;
};

const listPens = async (ctx: Ctx): Promise<Reply> => {
  const user = requireUser(ctx.user);
  const rows = await query<PenRow>(`${PEN_SELECT} where p.owner_id = $1 order by p.updated_at desc`, [
    user.id,
  ]);
  return json(200, { pens: rows.map(penSummary) });
};

const createPen = async (ctx: Ctx): Promise<Reply> => {
  const user = requireUser(ctx.user);
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const title = body.title === undefined ? 'Untitled pen' : requireTitle(body.title);
  const id = newId();
  await query('insert into pens (id, owner_id, title, visibility) values ($1, $2, $3, $4)', [
    id,
    user.id,
    title,
    'private',
  ]);
  return json(201, await reloadPen(id, user.id));
};

const getPen = async (ctx: Ctx): Promise<Reply> => {
  const viewerId = ctx.user?.id ?? null;
  const pen = await requireVisiblePen(ctx.params.id!, viewerId);
  return json(200, await penShape(pen, viewerId));
};

const patchPen = async (ctx: Ctx): Promise<Reply> => {
  const user = requireUser(ctx.user);
  const pen = await requireOwnedPen(ctx.params.id!, user.id);
  const body = (ctx.body ?? {}) as Record<string, unknown>;

  if (body.visibility !== undefined) requireVerified(user);

  const updates: string[] = [];
  const values: unknown[] = [pen.id];
  if (body.title !== undefined) {
    values.push(requireTitle(body.title));
    updates.push(`title = $${values.length}`);
  }
  if (body.visibility !== undefined) {
    if (!isVisibility(body.visibility)) validationError({ visibility: 'Pick private, unlisted or public.' });
    values.push(body.visibility);
    updates.push(`visibility = $${values.length}`);
  }
  if (body.tags !== undefined) {
    values.push(requireTags(body.tags));
    updates.push(`tags = $${values.length}`);
  }
  if (updates.length > 0) {
    await query(
      `update pens set ${updates.join(', ')}, updated_at = now() where id = $1`,
      values,
    );
  }
  return json(200, await reloadPen(pen.id, user.id));
};

const deletePen = async (ctx: Ctx): Promise<Reply> => {
  const user = requireUser(ctx.user);
  const pen = await requireOwnedPen(ctx.params.id!, user.id);
  await deletePrefix(snapshotPrefix(pen.id));
  await query('delete from pens where id = $1', [pen.id]);
  return noContent();
};

const ownedForWrite = async (ctx: Ctx, user: UserRow): Promise<PenRow> => {
  const pen = await requireVisiblePen(ctx.params.id!, user.id);
  raiseFirst(
    pen.owner_id === user.id ? null : apiError('forbidden'),
    user.verified ? null : apiError('unverified'),
  );
  return pen;
};

const saveVersion = async (ctx: Ctx): Promise<Reply> => {
  const user = requireUser(ctx.user);
  return withIdempotency(ctx, user, 'versions', async () => {
    const pen = await ownedForWrite(ctx, user);
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const baseVersion = requireVersionNumber(body.base_version, 'base_version');
    if (baseVersion !== pen.head) throw apiError('version_conflict', { head: pen.head });
    const files = requireFiles(body.files);
    const libraries = requireLibraries(body.libraries ?? []);

    const row = await appendVersion({
      penId: pen.id,
      baseVersion,
      files,
      libraries,
      restoredFrom: null,
    });
    emitHead(pen.id, row.number);
    return json(201, versionShape(row));
  });
};

const getVersions = async (ctx: Ctx): Promise<Reply> => {
  const pen = await requireVisiblePen(ctx.params.id!, ctx.user?.id ?? null);
  const rows = await listVersions(pen.id);
  return json(200, { versions: rows.map(versionEntry) });
};

const getVersion = async (ctx: Ctx): Promise<Reply> => {
  const pen = await requireVisiblePen(ctx.params.id!, ctx.user?.id ?? null);
  const number = Number.parseInt(ctx.params.number!, 10);
  if (!Number.isInteger(number)) throw apiError('not_found');
  return json(200, versionShape(await requireVersion(pen.id, number)));
};

const getDiff = async (ctx: Ctx): Promise<Reply> => {
  const pen = await requireVisiblePen(ctx.params.id!, ctx.user?.id ?? null);
  const rawA = ctx.url.searchParams.get('a');
  const rawB = ctx.url.searchParams.get('b');
  const fields: Record<string, string> = {};
  if (rawA === null || !/^\d+$/.test(rawA)) fields.a = 'Send a whole version number.';
  if (rawB === null || !/^\d+$/.test(rawB)) fields.b = 'Send a whole version number.';
  if (Object.keys(fields).length > 0) validationError(fields);

  const a = await requireVersion(pen.id, Number.parseInt(rawA!, 10));
  const b = await requireVersion(pen.id, Number.parseInt(rawB!, 10));
  const result = diffFiles(
    { html: a.html, css: a.css, js: a.js },
    { html: b.html, css: b.css, js: b.js },
  );
  return json(200, {
    a: a.number,
    b: b.number,
    added: result.added,
    removed: result.removed,
    panes: result.panes,
  });
};

const restoreVersion = async (ctx: Ctx): Promise<Reply> => {
  const user = requireUser(ctx.user);
  return withIdempotency(ctx, user, 'restore', async () => {
    const pen = await ownedForWrite(ctx, user);
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const number = requireVersionNumber(body.version, 'version');
    const baseVersion = requireVersionNumber(body.base_version, 'base_version');
    const source = await requireVersion(pen.id, number);
    if (baseVersion !== pen.head) throw apiError('version_conflict', { head: pen.head });

    const row = await appendVersion({
      penId: pen.id,
      baseVersion,
      files: { html: source.html, css: source.css, js: source.js },
      libraries: source.libraries,
      restoredFrom: source.number,
    });
    emitHead(pen.id, row.number);
    return json(201, versionShape(row));
  });
};

const forkPen = async (ctx: Ctx): Promise<Reply> => {
  const user = requireUser(ctx.user);
  return withIdempotency(ctx, user, 'fork', async () => {
    const source = await requireVisiblePen(ctx.params.id!, user.id);
    requireVerified(user);
    if (source.head < 1) throw apiError('nothing_to_fork');
    const head = await requireVersion(source.id, source.head);

    const forkId = newId();
    await query(
      `insert into pens (id, owner_id, title, visibility, tags, source_pen_id, source_version)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        forkId,
        user.id,
        source.title,
        source.visibility === 'private' ? 'private' : 'unlisted',
        source.tags,
        source.id,
        source.head,
      ],
    );

    try {
      await appendVersion({
        penId: forkId,
        baseVersion: 0,
        files: { html: head.html, css: head.css, js: head.js },
        libraries: head.libraries,
        restoredFrom: null,
      });
    } catch (error) {
      await query('delete from pens where id = $1', [forkId]);
      throw error;
    }

    if (source.visibility === 'public' && source.owner_id !== user.id) {
      const owner = await one<{ email: string }>('select email from users where id = $1', [
        source.owner_id,
      ]);
      if (owner) {
        await queueForkNotice({
          email: owner.email,
          forker: user.handle,
          title: source.title,
          forkId,
        });
      }
    }
    await emitCounts(source.id);
    return json(201, await reloadPen(forkId, user.id));
  });
};

const likeablePen = async (ctx: Ctx, user: UserRow): Promise<PenRow> => {
  const pen = await requireVisiblePen(ctx.params.id!, user.id);
  raiseFirst(
    pen.visibility === 'private' ? apiError('forbidden') : null,
    user.verified ? null : apiError('unverified'),
  );
  return pen;
};

const addLike = async (ctx: Ctx): Promise<Reply> => {
  const user = requireUser(ctx.user);
  const pen = await likeablePen(ctx, user);
  await query(
    'insert into likes (user_id, pen_id) values ($1, $2) on conflict do nothing',
    [user.id, pen.id],
  );
  await emitCounts(pen.id);
  const count = await one<{ likes: number }>(
    'select count(*)::int as likes from likes where pen_id = $1',
    [pen.id],
  );
  return json(200, { liked: true, likes: count?.likes ?? 0 });
};

const removeLike = async (ctx: Ctx): Promise<Reply> => {
  const user = requireUser(ctx.user);
  const pen = await requireVisiblePen(ctx.params.id!, user.id);
  requireVerified(user);
  await query('delete from likes where user_id = $1 and pen_id = $2', [user.id, pen.id]);
  await emitCounts(pen.id);
  const count = await one<{ likes: number }>(
    'select count(*)::int as likes from likes where pen_id = $1',
    [pen.id],
  );
  return json(200, { liked: false, likes: count?.likes ?? 0 });
};

const exportPen = async (ctx: Ctx): Promise<Reply> => {
  const pen = await requireVisiblePen(ctx.params.id!, ctx.user?.id ?? null);
  if (pen.head < 1) throw apiError('nothing_to_export');
  const bytes = await getObject(snapshotKey(pen.id, pen.head));
  if (!bytes) throw apiError('storage_unavailable');
  const snapshot = parseSnapshot(bytes);
  const zip = buildZip(
    [
      { name: 'index.html', body: Buffer.from(snapshot.files.html, 'utf8') },
      { name: 'style.css', body: Buffer.from(snapshot.files.css, 'utf8') },
      { name: 'script.js', body: Buffer.from(snapshot.files.js, 'utf8') },
    ],
    new Date(),
  );
  return {
    status: 200,
    raw: zip,
    contentType: 'application/zip',
    headers: { 'content-disposition': `attachment; filename="${pen.id}-v${pen.head}.zip"` },
  };
};

const search = async (ctx: Ctx): Promise<Reply> =>
  json(200, await searchPens(ctx.url.searchParams.get('q') ?? ''));

export const registerPenRoutes = (router: Router): void => {
  router.add('GET', '/api/pens', listPens);
  router.add('POST', '/api/pens', createPen);
  router.add('GET', '/api/pens/:id', getPen);
  router.add('PATCH', '/api/pens/:id', patchPen);
  router.add('DELETE', '/api/pens/:id', deletePen);
  router.add('POST', '/api/pens/:id/versions', saveVersion);
  router.add('GET', '/api/pens/:id/versions', getVersions);
  router.add('GET', '/api/pens/:id/versions/:number', getVersion);
  router.add('GET', '/api/pens/:id/diff', getDiff);
  router.add('POST', '/api/pens/:id/restore', restoreVersion);
  router.add('POST', '/api/pens/:id/fork', forkPen);
  router.add('PUT', '/api/pens/:id/like', addLike);
  router.add('DELETE', '/api/pens/:id/like', removeLike);
  router.add('GET', '/api/pens/:id/export', exportPen);
  router.add('GET', '/api/search', search);
};
