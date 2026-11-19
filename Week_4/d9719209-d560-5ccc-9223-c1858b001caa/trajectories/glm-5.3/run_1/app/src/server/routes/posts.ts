/* Post endpoints: creation with idempotency, the home and community feeds in
   Hot, New and Top order with opaque cursors, votes with the Valkey counter,
   edit and delete. */
import crypto from 'node:crypto';
import { ApiError, validation } from '../errors.js';
import { route, type Route, type RouteHandler, type Services } from '../routes.js';
import type { Ctx } from '../context.js';
import { hotRank, encodeCursor, decodeCursor } from '../domain.js';
import { loadCommunityByName, memberRole } from '../communities.js';
import { postView, type PostRow, publishScore, publishComments } from '../views.js';
import { renderMarkdown } from '../markdown.js';
import { iso } from '../util.js';

export function registerPostRoutes(services: Services, add: (r: Route) => void): void {
  add(route('GET', '/api/feed', feed(services), 'none'));
  add(route('POST', '/api/communities/:name/posts', createPost(services)));
  add(route('GET', '/api/communities/:name/posts', communityFeed(services), 'none'));
  add(route('GET', '/api/posts/:id', getPost(services), 'none'));
  add(route('PATCH', '/api/posts/:id', editPost(services)));
  add(route('DELETE', '/api/posts/:id', deletePost(services)));
  add(route('PUT', '/api/posts/:id/vote', votePost(services)));
  add(route('POST', '/api/markdown/preview', preview(services)));
  add(route('GET', '/api/users/:username/posts', userPosts(services), 'none'));
}

function body(ctx: Ctx): Record<string, unknown> {
  return (ctx.body ?? {}) as Record<string, unknown>;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

async function loadPost(services: Services, id: number): Promise<PostRow> {
  if (!Number.isInteger(id) || id <= 0) throw new ApiError('NOT_FOUND', 'Not found');
  const rows = await services.db.query(
    `SELECT p.*, c.name AS community_name FROM posts p JOIN communities c ON c.id = p.community_id WHERE p.id = $1`,
    [id]
  );
  if (rows.rows.length === 0) throw new ApiError('NOT_FOUND', 'Not found');
  return rows.rows[0] as unknown as PostRow;
}

function parseSort(raw: string | null): 'hot' | 'new' | 'top' {
  if (raw === null || raw === '') return 'hot';
  if (raw === 'hot' || raw === 'new' || raw === 'top') return raw;
  throw validation({ sort: 'This sort is not valid' });
}

/* ---- feeds ---- */

function feed(services: Services): RouteHandler {
  return async (ctx) => {
    const sort = parseSort(ctx.url.searchParams.get('sort'));
    const cursor = ctx.url.searchParams.get('cursor');
    return runFeed(services, ctx, sort, cursor, null);
  };
}

function communityFeed(services: Services): RouteHandler {
  return async (ctx) => {
    const community = await loadCommunityByName(services, ctx.params.name as string);
    const sort = parseSort(ctx.url.searchParams.get('sort'));
    const cursor = ctx.url.searchParams.get('cursor');
    return runFeed(services, ctx, sort, cursor, community.id);
  };
}

async function runFeed(services: Services, ctx: Ctx, sort: 'hot' | 'new' | 'top', cursor: string | null, communityId: number | null): Promise<{ status: number; body: unknown }> {
  let after: { sortKey: string; id: number } | null = null;
  if (cursor !== null && cursor !== '') {
    const decoded = decodeCursor(cursor);
    if (decoded === null || decoded.sort !== sort) throw validation({ cursor: 'This cursor is not valid' });
    after = { sortKey: decoded.sortKey, id: Number(decoded.id) };
  }
  const args: unknown[] = ['published'];
  let where = `p.state = $1`;
  if (communityId !== null) {
    args.push(communityId);
    where += ` AND p.community_id = $2`;
  }
  if (ctx.account !== null && communityId === null) {
    // Home feed for members: posts from joined communities.
    args.push(ctx.account.id);
    where += ` AND EXISTS (SELECT 1 FROM memberships m WHERE m.community_id = p.community_id AND m.account_id = $${args.length})`;
  }
  let orderBy = '';
  let keyExpr = '';
  if (sort === 'hot') {
    keyExpr = 'p.hot_rank';
    orderBy = 'p.hot_rank DESC, p.id DESC';
  } else if (sort === 'new') {
    keyExpr = 'extract(epoch from p.created_at)';
    orderBy = 'p.created_at DESC, p.id DESC';
    // Cursor stores the ISO time; decodeCursor returns the raw sort key.
  } else {
    keyExpr = 'p.score';
    orderBy = 'p.score DESC, p.id DESC';
  }
  if (after !== null) {
    args.push(after.sortKey, after.id);
    where += ` AND (${keyExpr} < $${args.length - 1} OR (${keyExpr} = $${args.length - 1} AND p.id < $${args.length}))`;
  }
  const rows = await services.db.query(
    `SELECT p.*, c.name AS community_name FROM posts p JOIN communities c ON c.id = p.community_id
     WHERE ${where} ORDER BY ${orderBy} LIMIT 26`,
    args
  );
  const items: unknown[] = [];
  const posts = rows.rows as unknown as PostRow[];
  for (const p of posts.slice(0, 25)) {
    items.push(await postView(services, p, ctx.account));
  }
  let nextCursor: string | null = null;
  const last = posts[24];
  if (posts.length > 25 && last !== undefined) {
    const sortKey = sort === 'hot' ? String(last.hot_rank) : sort === 'new' ? iso(new Date(last.created_at)) : String(last.score);
    nextCursor = encodeCursor(sort, sortKey, last.id);
  }
  let pinned: unknown[] | null = null;
  if (communityId !== null && after === null) {
    pinned = await loadPinned(services, communityId);
  }
  return { status: 200, body: communityId === null ? { items, nextCursor } : { pinned: pinned ?? [], items, nextCursor } };
}

async function loadPinned(services: Services, communityId: number): Promise<unknown[]> {
  const rows = await services.db.query(
    `SELECT p.*, c.name AS community_name FROM posts p JOIN communities c ON c.id = p.community_id
     WHERE p.community_id = $1 AND p.pinned AND p.state = 'published' ORDER BY p.pinned_at ASC, p.id ASC`,
    [communityId]
  );
  const out: unknown[] = [];
  for (const p of rows.rows as unknown as PostRow[]) {
    out.push(await postView(services, p, null));
  }
  return out;
}

function userPosts(services: Services): RouteHandler {
  return async (ctx) => {
    const username = (ctx.params.username as string).toLowerCase();
    const userRows = await services.db.query(`SELECT id FROM accounts WHERE username_lc = $1`, [username]);
    if (userRows.rows.length === 0) throw new ApiError('NOT_FOUND', 'Not found');
    const userId = Number((userRows.rows[0] as { id: string }).id);
    const rows = await services.db.query(
      `SELECT p.*, c.name AS community_name FROM posts p JOIN communities c ON c.id = p.community_id
       WHERE p.author_id = $1 AND p.state = 'published' ORDER BY p.created_at DESC, p.id DESC LIMIT 25`,
      [userId]
    );
    const items: unknown[] = [];
    for (const p of rows.rows as unknown as PostRow[]) {
      items.push(await postView(services, p, ctx.account));
    }
    return { status: 200, body: { items, nextCursor: null } };
  };
}

/* ---- creation ---- */

function createPost(services: Services): RouteHandler {
  return async (ctx) => {
    if (ctx.account === null) throw new ApiError('UNAUTHENTICATED', 'Sign in to continue');
    const account = ctx.account;
    const community = await loadCommunityByName(services, ctx.params.name as string);
    const role = await memberRole(services, community.id, account.id);
    if (!account.emailVerified) throw new ApiError('EMAIL_UNVERIFIED', 'Verify your email to post');
    if (community.type === 'restricted' && !role.isModerator && !role.isApprovedPoster) {
      throw new ApiError('NOT_APPROVED', 'Approved posters only');
    }

    const b = body(ctx);
    const title = str(b.title).trim();
    const bodyMd = str(b.bodyMd);
    const spoiler = b.spoiler === true;
    const rawImages = Array.isArray(b.images) ? (b.images as Record<string, unknown>[]) : [];
    const fields: Record<string, string> = {};
    if (title.length < 1 || title.length > 300) fields.title = 'Titles are 1 to 300 characters';
    if (bodyMd.length > 40_000) fields.bodyMd = 'Bodies are at most 40,000 characters';
    const images: { id: number; alt: string | null }[] = [];
    if (rawImages.length > 10) fields.images = 'Posts have at most 10 images';
    for (const img of rawImages) {
      const id = Number(img.id);
      const altRaw = str(img.alt).trim();
      if (altRaw.length > 300) fields.alt = 'Alt text is at most 300 characters';
      images.push({ id, alt: altRaw === '' ? null : altRaw });
    }
    if (Object.keys(fields).length > 0) throw new ApiError('VALIDATION', 'Check the fields', { fields });

    // Idempotency: the replay check comes before every later check.
    const key = idempotencyKey(ctx);
    if (key === null) throw validation({ idempotencyKey: 'Idempotency-Key header is required' });
    if (!/^[\x20-\x7E]{1,100}$/.test(key)) throw validation({ idempotencyKey: 'Idempotency-Key must be 1 to 100 visible ASCII characters' });
    const stored = await idempotentStart(services, ctx, key, IDEMPOTENCY_ENDPOINT);
    if (stored !== null) return stored;

    // Verify each image: uploaded by the caller, not yet attached, confirmed.
    for (const img of images) {
      const rows = await services.db.query(
        `SELECT id, post_id FROM images WHERE id = $1 AND owner_id = $2`,
        [img.id, account.id]
      );
      if (rows.rows.length === 0 || (rows.rows[0] as { post_id: number | null }).post_id !== null) {
        throw new ApiError('IMAGES_NOT_READY', 'Images are not ready');
      }
    }
    // Confirm every object with HEAD before inserting the post.
    try {
      const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
      for (const img of images) {
        const shaRows = await services.db.query(`SELECT sha256 FROM images WHERE id = $1`, [img.id]);
        const sha = (shaRows.rows[0] as { sha256: string }).sha256;
        await services.storage.send(new HeadObjectCommand({ Bucket: services.cfg.s3.bucket, Key: `images/${sha}/original.webp` }));
      }
    } catch {
      throw new ApiError('STORAGE_UNAVAILABLE', 'Image uploads are unavailable right now. Your draft is kept.');
    }

    // Posting rate limit, in Valkey, skipped when Valkey is unreachable.
    if (services.valkey.isUp) {
      try {
        const r = await services.valkey.consumeSlot(`rl:post:${account.id}`, services.cfg.limits.postRate, 60_000);
        if (!r.ok) throw new ApiError('RATE_LIMITED', 'Slow down', { retryAfter: r.retryAfter });
      } catch (err) {
        if (err instanceof ApiError) throw err;
      }
    }


    const bodyHtml = bodyMd === '' ? '' : renderMarkdown(bodyMd);
    const inserted = await services.db.query(
      `INSERT INTO posts (community_id, author_id, title, body_md, body_html, spoiler, score, hot_rank, state)
       VALUES ($1,$2,$3,$4,$5,$6,0,$7,'published') RETURNING *`,
      [community.id, account.id, title, bodyMd === '' ? null : bodyMd, bodyHtml === '' ? null : bodyHtml, spoiler, hotRank(0, new Date())]
    );
    const post = inserted.rows[0] as unknown as PostRow;
    await attachImages(services, post, images);
    const fresh = await loadPost(services, Number(post.id));
    const view = await postView(services, fresh, ctx.account);
    await idempotentFinish(services, ctx, key, `POST /api/communities/${community.name}/posts`, 201, view);
    return { status: 201, body: view };
  };
}

async function attachImages(services: Services, post: PostRow, images: { id: number; alt: string | null }[]): Promise<void> {
  if (images.length === 0) return;
  await services.db.query(`BEGIN`);
  try {
    for (let i = 0; i < images.length; i++) {
      const img = images[i] as { id: number; alt: string | null };
      await services.db.query(`UPDATE images SET post_id = $2, position = $3, alt = $4 WHERE id = $1`, [img.id, Number(post.id), i, img.alt]);
    }
    await services.db.query(`COMMIT`);
  } catch (err) {
    await services.db.query(`ROLLBACK`);
    throw err;
  }
}

function idempotencyKey(ctx: Ctx): string | null {
  const raw = ctx.req.headers['idempotency-key'];
  if (typeof raw !== 'string') return null;
  return raw;
}

const IDEMPOTENCY_ENDPOINT = 'create-post';

async function idempotentStart(services: Services, ctx: Ctx, key: string, endpoint: string): Promise<{ status: number; body: unknown } | null> {
  void ctx;
  void endpoint;
  const raw = ctx.rawBody;
  const fingerprint = crypto.createHash('sha256').update(raw ?? '').digest('hex');
  const existing = await services.db.query(
    `SELECT status, response, fingerprint FROM idempotency WHERE account_id = $1 AND endpoint = $2 AND key = $3`,
    [ctx.account?.id ?? 0, IDEMPOTENCY_ENDPOINT, key]
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0] as { status: number; response: string; fingerprint: string };
    const storedFingerprint = row.fingerprint;
    if (storedFingerprint !== fingerprint) {
      throw validation({ idempotencyKey: 'This key was already used for a different request' });
    }
    return { status: row.status, body: JSON.parse(row.response) as unknown };
  }
  await services.db.query(
    `INSERT INTO idempotency (key, account_id, endpoint, fingerprint, status, response) VALUES ($1,$2,$3,$4,0,'')
     ON CONFLICT (account_id, endpoint, key) DO NOTHING`,
    [key, ctx.account?.id ?? 0, IDEMPOTENCY_ENDPOINT, fingerprint]
  );
  return null;
}

async function idempotentFinish(services: Services, ctx: Ctx, key: string, endpoint: string, status: number, body: unknown): Promise<void> {
  void ctx;
  void endpoint;
  await services.db.query(
    `UPDATE idempotency SET status = $3, response = $4 WHERE account_id = $1 AND endpoint = $2 AND key = $5`,
    [ctx.account?.id ?? 0, IDEMPOTENCY_ENDPOINT, status, JSON.stringify(body), key]
  );
}

function preview(services: Services): RouteHandler {
  return async (ctx) => {
    const bodyMd = str(body(ctx).bodyMd);
    if (bodyMd.length > 40_000) throw validation({ bodyMd: 'Bodies are at most 40,000 characters' });
    return { status: 200, body: { html: renderMarkdown(bodyMd) } };
  };
}

/* ---- single post ---- */

function getPost(services: Services): RouteHandler {
  return async (ctx) => {
    const post = await loadPost(services, Number(ctx.params.id));
    return { status: 200, body: await postView(services, post, ctx.account) };
  };
}

function editPost(services: Services): RouteHandler {
  return async (ctx) => {
    if (ctx.account === null) throw new ApiError('UNAUTHENTICATED', 'Sign in to continue');
    const post = await loadPost(services, Number(ctx.params.id));
    if (post.author_id === null || Number(post.author_id) !== ctx.account.id) {
      throw new ApiError('FORBIDDEN', 'Only the author can edit');
    }
    const b = body(ctx);
    if (b.title !== undefined) throw validation({ title: "Titles can't be edited" });
    if (post.state === 'deleted') throw new ApiError('CONFLICT', 'Deleted posts cannot be edited');
    if (post.state === 'removed') throw new ApiError('REMOVED', 'Removed posts cannot be edited');
    if (isArchived(services, post)) throw new ApiError('ARCHIVED', 'This thread is archived. Voting and replies are closed.');
    const bodyMd = str(b.bodyMd);
    if (bodyMd.length > 40_000) throw validation({ bodyMd: 'Bodies are at most 40,000 characters' });
    await services.db.query(`UPDATE posts SET body_md = $2, body_html = $3, edited_at = now() WHERE id = $1`, [
      Number(post.id),
      bodyMd === '' ? null : bodyMd,
      bodyMd === '' ? null : renderMarkdown(bodyMd),
    ]);
    const fresh = await loadPost(services, Number(post.id));
    return { status: 200, body: await postView(services, fresh, ctx.account) };
  };
}

function deletePost(services: Services): RouteHandler {
  return async (ctx) => {
    if (ctx.account === null) throw new ApiError('UNAUTHENTICATED', 'Sign in to continue');
    const post = await loadPost(services, Number(ctx.params.id));
    if (post.author_id === null || Number(post.author_id) !== ctx.account.id) {
      throw new ApiError('FORBIDDEN', 'Only the author can delete');
    }
    if (post.state === 'deleted') throw new ApiError('CONFLICT', 'Already deleted');
    await services.db.query(`BEGIN`);
    try {
      await services.db.query(
        `UPDATE posts SET state = 'deleted', pinned = false, version = version + 1 WHERE id = $1`,
        [Number(post.id)]
      );
      await services.db.query(`COMMIT`);
    } catch (err) {
      await services.db.query(`ROLLBACK`);
      throw err;
    }
    const fresh = await loadPost(services, Number(post.id));
    return { status: 200, body: await postView(services, fresh, ctx.account) };
  };
}

export function isArchived(services: Services, post: PostRow): boolean {
  const age = (Date.now() - new Date(post.created_at).getTime()) / 1000;
  return age > services.cfg.limits.archiveAfterDays * 86_400;
}

/* ---- votes ---- */

function votePost(services: Services): RouteHandler {
  return async (ctx) => {
    if (ctx.account === null) throw new ApiError('UNAUTHENTICATED', 'Sign in to continue');
    const account = ctx.account;
    if (!account.emailVerified) throw new ApiError('EMAIL_UNVERIFIED', 'Verify your email to vote');
    const post = await loadPost(services, Number(ctx.params.id));
    const value = body(ctx).value;
    if (value !== 1 && value !== 0 && value !== -1) throw validation({ value: 'Value must be 1, 0 or -1' });
    if (post.state === 'deleted') throw new ApiError('CONFLICT', 'Deleted posts cannot be voted');
    if (post.state === 'removed') throw new ApiError('REMOVED', 'Removed posts cannot be voted');
    if (isArchived(services, post)) throw new ApiError('ARCHIVED', 'This thread is archived. Voting and replies are closed.');

    let limit: { ok: boolean; retryAfter: number };
    try {
      limit = await services.valkey.consumeSlot(`rl:vote:${account.id}`, services.cfg.limits.voteRate, 60_000);
    } catch {
      throw new ApiError('SERVICE_UNAVAILABLE', "Vote didn't save");
    }
    if (!limit.ok) throw new ApiError('RATE_LIMITED', 'Slow down — try again later', { retryAfter: limit.retryAfter });

    const result = await applyVote(services, 'post', Number(post.id), account.id, value as number);
    await publishScore(services, "post", Number(post.id), post.community_name, result.score);
    return { status: 200, body: { score: result.score, myVote: result.myVote } };
  };
}

export async function applyVote(services: Services, targetType: 'post' | 'comment', targetId: number, memberId: number, value: number): Promise<{ score: number; myVote: number }> {
  await services.db.query(`BEGIN`);
  try {
    const existing = await services.db.query(
      `SELECT value FROM votes WHERE member_id = $1 AND target_type = $2 AND target_id = $3`,
      [memberId, targetType, targetId]
    );
    const previous = existing.rows.length > 0 ? Number((existing.rows[0] as { value: number }).value) : 0;
    if (value === 0) {
      await services.db.query(`DELETE FROM votes WHERE member_id = $1 AND target_type = $2 AND target_id = $3`, [memberId, targetType, targetId]);
    } else if (previous === value) {
      // repeat: no-op
    } else {
      await services.db.query(
        `INSERT INTO votes (member_id, target_type, target_id, value) VALUES ($1,$2,$3,$4)
         ON CONFLICT (member_id, target_type, target_id) DO UPDATE SET value = $4`,
        [memberId, targetType, targetId, value]
      );
    }
    const delta = value - previous;
    const table = targetType === 'post' ? 'posts' : 'comments';
    let score: number;
    if (delta !== 0) {
      const updated = await services.db.query(
        `UPDATE ${table} SET score = score + $2 WHERE id = $1 RETURNING score`,
        [targetId, delta]
      );
      score = Number((updated.rows[0] as { score: number }).score);
      if (targetType === 'post') {
        const fresh = await services.db.query(`SELECT score, created_at FROM posts WHERE id = $1`, [targetId]);
        const row = fresh.rows[0] as { score: number; created_at: Date };
        await services.db.query(`UPDATE posts SET hot_rank = $2 WHERE id = $1`, [targetId, hotRank(row.score, new Date(row.created_at))]);
      }
    } else {
      const current = await services.db.query(`SELECT score FROM ${table} WHERE id = $1`, [targetId]);
      score = Number((current.rows[0] as { score: number }).score);
    }
    await services.db.query(`COMMIT`);
    return { score, myVote: value };
  } catch (err) {
    await services.db.query(`ROLLBACK`);
    throw err;
  }
}
