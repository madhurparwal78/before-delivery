import { randomBytes, randomUUID } from 'node:crypto';
import { guideAccess, requireUser } from './access';
import { limits } from './config';
import {
  countsOf, forkSource, insertContent, guideById, latestVersion, loadSnapshot, loadWorking, readingContent, readingJson, roleOf, type Content,
} from './content';
import { one, pool, transaction, type Db } from './db';
import { conflict, invalid, notFound, storageUnavailable, tooLong, unprocessable } from './errors';
import { RawBody, type Ctx } from './http';
import { emitGuide } from './live';
import { objectLength, modelKey, deleteObject } from './s3';
import { setSearchText } from './search';
import { renderStill } from './still';
import { insertVersion } from './versions';
import { syncFieldPaths } from './working';
import { transition } from '../shared/guide-state';
import { codePointLength } from '../shared/text';
import { CURRENCIES, type Currency } from '../shared/types';

export function slugify(title: string): string {
  const base = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return `${base || 'guide'}-${randomBytes(3).toString('hex')}`;
}

/** Inserts an empty guide with its field-revision rows. */
export async function insertGuide(db: Db, owner: string, title: string, currency: Currency, slug = slugify(title)): Promise<{ id: string; slug: string }> {
  const id = randomUUID();
  await db.query('INSERT INTO guides (id, slug, owner_id, title, currency) VALUES ($1, $2, $3, $4, $5)', [id, slug, owner, title, currency]);
  await syncFieldPaths(db, id);
  return { id, slug };
}

export async function createGuide(ctx: Ctx): Promise<unknown> {
  const user = requireUser(ctx, true);
  const { title, currency } = await ctx.json();
  if (typeof title !== 'string' || codePointLength(title) < 1) throw invalid('title');
  if (codePointLength(title) > limits.guide_title_max) throw tooLong('title', limits.guide_title_max);
  if (!CURRENCIES.includes(currency as Currency)) throw invalid('currency');
  return transaction((db) => insertGuide(db, user.id, title, currency as Currency));
}

export async function readGuide(ctx: Ctx): Promise<unknown> {
  const { guide, role } = await guideAccess(ctx, ctx.params.id!);
  const content = (await readingContent(pool, guide)) ?? (role === 'none' ? null : await loadWorking(pool, guide));
  if (!content) throw notFound();
  const liked = ctx.user ? !!(await one(pool, 'SELECT 1 FROM likes WHERE guide_id = $1 AND user_id = $2', [guide.id, ctx.user.id])) : false;
  const source = await forkSource(pool, guide, async (g) => roleOf(pool, g, ctx.user));
  return readingJson(pool, guide, content, liked, source);
}

export async function readStill(ctx: Ctx): Promise<unknown> {
  const { guide } = await guideAccess(ctx, ctx.params.id!);
  const content = await readingContent(pool, guide);
  const n = Number(ctx.params.n);
  if (!content || !Number.isInteger(n) || n < 1 || n > content.steps.length) throw notFound();
  return new RawBody(await renderStill(content, n), 'image/png', { 'Cache-Control': 'private, max-age=60' });
}

async function publishChecks(number: number | null, content: Content | null): Promise<void> {
  if (number === null || !content) throw unprocessable('no_version');
  const model = content.model_id ? await one<{ bytes: number }>(pool, 'SELECT bytes FROM models WHERE id = $1', [content.model_id]) : undefined;
  if (!model) throw unprocessable('model_not_stored');
  if ((await objectLength(modelKey(content.model_id!))) !== model.bytes) throw storageUnavailable();
  const unbound = content.parts.filter((p) => p.unbound).map((p) => p.name);
  if (unbound.length) throw unprocessable('unbound_parts', { parts: unbound });
  if (!content.model_scale_confirmed) throw unprocessable('scale_unconfirmed');
}

export async function publishGuide(ctx: Ctx): Promise<unknown> {
  const { guide } = await guideAccess(ctx, ctx.params.id!, { session: true, role: 'owner', confirmed: true });
  const body = await ctx.json();
  if (body.version !== undefined && !Number.isInteger(body.version)) throw invalid('version');
  const published = await transaction(async (db) => {
    await db.query('SELECT 1 FROM guides WHERE id = $1 FOR UPDATE', [guide.id]);
    const fresh = (await guideById(db, guide.id))!;
    const target = (body.version as number | undefined) ?? (await latestVersion(db, guide.id));
    const step = transition(fresh.state, 'publish', target === fresh.publishedVersion);
    if (!step.ok) throw conflict('illegal_transition', { from: step.from, to: step.to });
    const snapshot = target === null ? null : await loadSnapshot(db, guide.id, target);
    if (target !== null && !snapshot) throw notFound();
    await publishChecks(target, snapshot?.content ?? null);
    await db.query(
      `UPDATE guides SET state = $3, published_version = $1, published_at = date_trunc('milliseconds', clock_timestamp()) WHERE id = $2`,
      [target, guide.id, step.to]);
    await setSearchText(db, fresh.id, fresh.title, fresh.tags, snapshot!.content);
    return { version: target!, state: step.to };
  });
  emitGuide(guide.id, { type: 'state', state: published.state, published_version: published.version });
  return { state: published.state, published_version: published.version };
}

export async function withdrawGuide(ctx: Ctx): Promise<unknown> {
  const { guide } = await guideAccess(ctx, ctx.params.id!, { session: true, role: 'owner', confirmed: true });
  await ctx.json();
  const state = await transaction(async (db) => {
    await db.query('SELECT 1 FROM guides WHERE id = $1 FOR UPDATE', [guide.id]);
    const fresh = (await guideById(db, guide.id))!;
    const step = transition(fresh.state, 'withdraw', false);
    if (!step.ok) throw conflict('illegal_transition', { from: step.from, to: step.to });
    await db.query('UPDATE guides SET state = $1 WHERE id = $2', [step.to, guide.id]);
    return step.to;
  });
  emitGuide(guide.id, { type: 'state', state, published_version: guide.publishedVersion });
  return { state };
}

export async function deleteGuide(ctx: Ctx): Promise<unknown> {
  const { guide } = await guideAccess(ctx, ctx.params.id!, { session: true, role: 'owner', confirmed: true });
  const models = await pool.query<{ id: string }>(
    'SELECT model_id AS id FROM guides WHERE id = $1 AND model_id IS NOT NULL UNION SELECT model_id FROM versions WHERE guide_id = $1 AND model_id IS NOT NULL', [guide.id]);
  await pool.query('DELETE FROM guides WHERE id = $1', [guide.id]);
  for (const { id } of models.rows) {
    const used = await one(pool, 'SELECT 1 FROM guides WHERE model_id = $1 UNION SELECT 1 FROM versions WHERE model_id = $1', [id]);
    if (used) continue;
    await deleteObject(modelKey(id)).catch(() => undefined);
    await pool.query('DELETE FROM models WHERE id = $1', [id]);
  }
  return undefined;
}

async function setLike(ctx: Ctx, liked: boolean): Promise<unknown> {
  const { guide } = await guideAccess(ctx, ctx.params.id!, { session: true, confirmed: true });
  const user = ctx.user!;
  await pool.query(liked ? 'INSERT INTO likes (guide_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING' : 'DELETE FROM likes WHERE guide_id = $1 AND user_id = $2', [guide.id, user.id]);
  const counts = await countsOf(pool, guide.id);
  emitGuide(guide.id, { type: 'counts', ...counts });
  return { liked, like_count: counts.like_count };
}

export const likeGuide = (ctx: Ctx) => setLike(ctx, true);
export const unlikeGuide = (ctx: Ctx) => setLike(ctx, false);

export async function forkGuide(ctx: Ctx): Promise<unknown> {
  const { guide } = await guideAccess(ctx, ctx.params.id!, { session: true, confirmed: true });
  const user = ctx.user!;
  if (guide.visibility !== 'public' || guide.state !== 'published' || guide.publishedVersion === null) throw notFound();
  const created = await transaction(async (db) => {
    const pinned = (await loadSnapshot(db, guide.id, guide.publishedVersion!))!.content;
    const title = `${[...guide.title].slice(0, limits.guide_title_max - ' (fork)'.length).join('')} (fork)`;
    const { id, slug } = await insertGuide(db, user.id, title, guide.currency);
    await db.query(
      `UPDATE guides SET tags = $1, model_id = $2, model_scale = $3, model_scale_confirmed = $4, source_guide_id = $5, source_title = $6,
              source_author = $7, source_version = $8 WHERE id = $9`,
      [JSON.stringify(guide.tags), pinned.model_id, pinned.model_scale, pinned.model_scale_confirmed, guide.id, guide.title, guide.ownerName, guide.publishedVersion, id]);
    const remap = new Map<string, string>();
    for (const part of pinned.parts) remap.set(part.id, randomUUID());
    for (const step of pinned.steps) remap.set(step.id, randomUUID());
    const copy: Content = {
      ...pinned,
      parts: pinned.parts.map((p) => ({ ...p, id: remap.get(p.id)!, fitted_at: p.fitted_at ? remap.get(p.fitted_at) ?? null : null })),
      steps: pinned.steps.map((s) => ({
        ...s, id: remap.get(s.id)!, focus_parts: s.focus_parts.map((p) => remap.get(p)!),
        callouts: s.callouts.map((c) => ({ ...c, part_id: remap.get(c.part_id)! })),
      })),
    };
    await insertContent(db, id, copy);
    await syncFieldPaths(db, id);
    await insertVersion(db, id, 1, user.id, copy, null);
    return { id, slug, counts: await countsOf(db, guide.id) };
  });
  emitGuide(guide.id, { type: 'counts', ...created.counts });
  return {
    id: created.id, slug: created.slug,
    forked_from: { guide_id: guide.id, title: guide.title, author_name: guide.ownerName, version: guide.publishedVersion },
  };
}

