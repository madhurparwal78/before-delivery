import type pg from 'pg';
import { pool, one, rows, tx } from '../db.js';
import { config } from '../config.js';
import { now } from '../clock.js';
import { AppError, conflict, forbidden, notFound, validation } from '../errors.js';
import { ok, route, type Ctx, type Reply } from '../http.js';
import { optionalUser, requireModerator, requireUser, requireVerified } from '../guards.js';
import { communityRef, maySubmit, type CommunityRef } from '../community.js';
import { feedPage } from '../feed.js';
import { loadPost, postConflictState } from '../views.js';
import { insertPost } from '../writes.js';
import { once, type Stored } from '../idempotency.js';
import { renderMarkdown } from '../markdown.js';
import { applyMove, moveConflict, type PostMove } from '../postMoves.js';
import { emitPostState } from '../events.js';
import { mails, sendMail } from '../mail.js';
import { objectExists } from '../storage.js';
import { SLOTS } from '../images.js';
import { takeSlot } from '../valkey.js';
import { COPY, asRecord, asString, failIfAny, isWithin, parseId, type Fields } from '../validate.js';
import type { SessionUser } from '../accounts.js';

const MAX_IMAGES = 10;
const BODY_LIMIT = 40_000;

function postId(ctx: Ctx): string {
  const id = parseId(ctx.params.id as string);
  if (id === null) throw notFound('No such post');
  return id;
}

async function feed(ctx: Ctx): Promise<Reply> {
  const viewer = optionalUser(ctx);
  const page = viewer
    ? await feedPage(pool, viewer, ctx.query.get('sort'), ctx.query.get('cursor'),
      'p.community_id IN (SELECT m.community_id FROM memberships m WHERE m.user_id = $4)', [viewer.id])
    : await feedPage(pool, viewer, ctx.query.get('sort'), ctx.query.get('cursor'), 'true', []);
  return ok(page);
}

/** Posts and comments share one rolling counter; it is skipped while Valkey cannot be reached. */
export async function takePostingSlot(user: SessionUser): Promise<void> {
  const decision = await takeSlot('post', user.id, config.limits.postPerMinute).catch(() => null);
  if (decision && !decision.allowed) {
    throw new AppError('RATE_LIMITED', 'You are posting too fast. Try again shortly.', { retryAfter: decision.retryAfter });
  }
}

interface ImageInput { id: string; alt: string | null }

function parseImages(raw: unknown): ImageInput[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  const parsed = raw.map((entry) => {
    const item = asRecord(entry);
    const id = typeof item.id === 'string' || typeof item.id === 'number' ? String(item.id) : null;
    const alt = item.alt === undefined || item.alt === null ? '' : asString(item.alt);
    return id !== null && /^\d{1,18}$/.test(id) && alt !== undefined ? { id, alt: alt.trim() === '' ? null : alt } : null;
  });
  return parsed.every((p) => p !== null) ? (parsed as ImageInput[]) : null;
}

/** Every image must be the caller's own, unattached upload whose objects storage still confirms. */
async function claimImages(client: pg.PoolClient, user: SessionUser, images: ImageInput[]): Promise<{ sha256: string }[]> {
  if (images.length === 0) return [];
  const ids = images.map((i) => i.id);
  const owned = await rows<{ sha256: string }>(client,
    'SELECT sha256 FROM images WHERE id = ANY($1::bigint[]) AND uploader_id = $2 AND post_id IS NULL FOR UPDATE', [ids, user.id]);
  if (owned.length !== new Set(ids).size || owned.length !== ids.length) {
    throw new AppError('IMAGES_NOT_READY', 'Some images are not ready or are already used');
  }
  return owned;
}

async function confirmStored(images: { sha256: string }[]): Promise<void> {
  const keys = [...new Set(images.flatMap((i) => ['original', ...SLOTS].map((slot) => `images/${i.sha256}/${slot}.webp`)))];
  const present = await Promise.all(keys.map((key) => objectExists(key)));
  if (present.includes(false)) throw new AppError('IMAGES_NOT_READY', 'Some images are not ready or are already used');
}

async function makePost(ctx: Ctx, user: SessionUser, community: CommunityRef, client: pg.PoolClient, keyFields: Fields): Promise<Stored> {
  requireVerified(user);
  if (!(await maySubmit(client, user, community))) throw new AppError('NOT_APPROVED', 'Approved posters only');
  await takePostingSlot(user);
  const input = asRecord(ctx.body);
  const images = parseImages(input.images);
  const claimed = images ? await claimImages(client, user, images) : [];
  const fields: Fields = { ...keyFields };
  const title = asString(input.title)?.trim() ?? '';
  const bodyMd = input.bodyMd === undefined ? '' : asString(input.bodyMd);
  if (!isWithin(title, 1, 300)) fields.title = COPY.title;
  if (bodyMd === undefined || bodyMd.length > BODY_LIMIT) fields.bodyMd = COPY.body;
  if (images === null || images.length > MAX_IMAGES) fields.images = 'Posts take 0 to 10 images';
  else if (images.some((i) => (i.alt?.length ?? 0) > 300)) fields.alt = COPY.alt;
  failIfAny(fields);
  await confirmStored(claimed);
  const id = await insertPost(client, {
    communityId: community.id, authorId: user.id, title, bodyMd: bodyMd as string, spoiler: input.spoiler === true,
    score: 0, createdAt: now(), images: images as ImageInput[],
  });
  return { status: 201, body: await loadPost(client, user, id) };
}

async function createPost(ctx: Ctx): Promise<Reply> {
  const user = requireUser(ctx);
  const header = ctx.headers['idempotency-key'];
  const key = typeof header === 'string' && /^[\x21-\x7e]{1,100}$/.test(header) ? header : null;
  const keyFields: Fields = key === null
    ? { idempotencyKey: header === undefined ? COPY.idempotencyMissing : COPY.idempotencyFormat } : {};
  const name = ctx.params.name as string;
  const result = await tx(async (client) => {
    const run = async (): Promise<Stored> => makePost(ctx, user, await communityRef(client, name), client, keyFields);
    return key === null ? run() : once(client, user.id, `POST ${ctx.path.toLowerCase()}`, key, ctx.body, run);
  });
  return { status: result.status, body: result.body };
}

async function readPost(ctx: Ctx): Promise<Reply> {
  const post = await loadPost(pool, optionalUser(ctx), postId(ctx));
  if (!post) throw notFound('No such post');
  return ok(post);
}

interface PostHead { community_id: string; author_id: string }

async function postHead(id: string): Promise<PostHead> {
  const head = await one<PostHead>(pool, 'SELECT community_id, author_id FROM posts WHERE id = $1', [id]);
  if (!head) throw notFound('No such post');
  return head;
}

async function editPost(ctx: Ctx): Promise<Reply> {
  const user = requireUser(ctx);
  const id = postId(ctx);
  const head = await postHead(id);
  if (head.author_id !== user.id) throw forbidden('Only the author can edit this post');
  const input = asRecord(ctx.body);
  await tx(async (client) => {
    const row = await one<{ state: string; archived: boolean }>(client,
      'SELECT state, (created_at < $2) AS archived FROM posts WHERE id = $1 FOR UPDATE', [id, new Date(now().getTime() - config.limits.archiveAfterDays * 86_400_000)]);
    if (row?.state === 'removed') throw new AppError('REMOVED', 'This post was removed by moderators');
    if (row?.state === 'deleted') throw conflict('This post was deleted');
    if (row?.archived) throw new AppError('ARCHIVED', 'This thread is archived. Voting and replies are closed.');
    const fields: Fields = {};
    if ('title' in input) fields.title = COPY.titleEdit;
    const bodyMd = asString(input.bodyMd);
    if (bodyMd === undefined || bodyMd.length > BODY_LIMIT) fields.bodyMd = COPY.body;
    failIfAny(fields);
    await client.query('UPDATE posts SET body_md = $2, body_html = $3, edited_at = $4 WHERE id = $1',
      [id, bodyMd, renderMarkdown(bodyMd as string), now()]);
  });
  return ok(await loadPost(pool, user, id));
}

async function communityOfPost(id: string): Promise<CommunityRef> {
  const row = await one<{ name: string }>(pool, 'SELECT c.name FROM posts p JOIN communities c ON c.id = p.community_id WHERE p.id = $1', [id]);
  if (!row) throw notFound('No such post');
  return communityRef(pool, row.name);
}

/** Version and state conflicts answer 409 with the post's current moderation state. */
async function currentState(client: pg.PoolClient, id: string): Promise<Record<string, unknown>> {
  return postConflictState((await loadPost(client, null, id)) as NonNullable<Awaited<ReturnType<typeof loadPost>>>);
}

async function deletePost(ctx: Ctx): Promise<Reply> {
  const user = requireUser(ctx);
  const id = postId(ctx);
  const head = await postHead(id);
  if (head.author_id !== user.id) throw forbidden('Only the author can delete this post');
  await tx(async (client) => {
    const row = await one<{ state: 'published' | 'removed' | 'deleted'; locked: boolean; pinned: boolean }>(client,
      'SELECT state, locked, pinned FROM posts WHERE id = $1 FOR UPDATE', [id]);
    const why = moveConflict(row as NonNullable<typeof row>, 'delete');
    if (why) throw conflict(why);
    await applyMove('delete', { client, postId: id, communityId: head.community_id, moderatorId: user.id, body: undefined });
  });
  await emitPostState(id);
  return ok(await loadPost(pool, user, id));
}

async function moderate(ctx: Ctx, move: PostMove): Promise<Reply> {
  const user = requireUser(ctx);
  const id = postId(ctx);
  const community = await communityOfPost(id);
  await requireModerator(pool, user, community);
  const touched = await tx(async (client) => {
    const row = await one<{ version: number; state: 'published' | 'removed' | 'deleted'; locked_now: boolean; pinned: boolean }>(client,
      `SELECT version, state, (locked AND (locked_until IS NULL OR locked_until > $2)) AS locked_now, pinned
       FROM posts WHERE id = $1 FOR UPDATE`, [id, now()]);
    const post = row as NonNullable<typeof row>;
    const sent = asRecord(ctx.body).version;
    const version = typeof sent === 'number' && Number.isInteger(sent) ? sent : null;
    if (version !== null && version !== post.version) throw conflict('Another moderator acted first', await currentState(client, id));
    const why = moveConflict({ state: post.state, locked: post.locked_now, pinned: post.pinned }, move);
    if (why) throw conflict(why, await currentState(client, id));
    if (version === null) throw validation({ version: COPY.version });
    return (await applyMove(move, { client, postId: id, communityId: community.id, moderatorId: user.id, body: ctx.body })).touched;
  });
  for (const touchedId of touched) await emitPostState(touchedId);
  if (move === 'remove') await mailStatementOfReasons(id, community.name);
  return ok(await loadPost(pool, user, id));
}

async function mailStatementOfReasons(id: string, communityName: string): Promise<void> {
  const row = await one<{ email: string; title: string; removal_reason: string }>(pool,
    'SELECT u.email, p.title, p.removal_reason FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = $1', [id]);
  if (row) await sendMail(mails.statementOfReasons(row.email, communityName, id, row.title, row.removal_reason));
}

async function preview(ctx: Ctx): Promise<Reply> {
  requireUser(ctx);
  const bodyMd = asString(asRecord(ctx.body).bodyMd);
  if (bodyMd === undefined || bodyMd.length > BODY_LIMIT) throw validation({ bodyMd: COPY.body });
  return ok({ html: renderMarkdown(bodyMd) });
}

export function registerPostRoutes(): void {
  route('GET', '/api/feed', feed);
  route('POST', '/api/communities/:name/posts', createPost);
  route('GET', '/api/posts/:id', readPost);
  route('PATCH', '/api/posts/:id', editPost);
  route('DELETE', '/api/posts/:id', deletePost);
  route('POST', '/api/posts/:id/removal', (ctx) => moderate(ctx, 'remove'));
  route('DELETE', '/api/posts/:id/removal', (ctx) => moderate(ctx, 'restore'));
  route('POST', '/api/posts/:id/lock', (ctx) => moderate(ctx, 'lock'));
  route('DELETE', '/api/posts/:id/lock', (ctx) => moderate(ctx, 'unlock'));
  route('POST', '/api/posts/:id/pin', (ctx) => moderate(ctx, 'pin'));
  route('DELETE', '/api/posts/:id/pin', (ctx) => moderate(ctx, 'unpin'));
  route('POST', '/api/markdown/preview', preview);
}

