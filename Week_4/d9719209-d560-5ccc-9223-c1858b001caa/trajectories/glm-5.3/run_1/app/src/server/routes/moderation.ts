/* Moderator actions on posts: removal, restore, lock, pin, each versioned so
   that of simultaneous conflicting actions exactly one succeeds. The mod log
   entry is written in the same transaction as the action. */
import { ApiError, validation } from '../errors.js';
import { route, type Route, type RouteHandler, type Services } from '../routes.js';
import type { Ctx } from '../context.js';
import { postView, isLocked, type PostRow } from '../views.js';
import { memberRole, requiresTwoFactor } from '../communities.js';
import { iso } from '../util.js';

type Current = { version: number; state: string; locked: boolean; lockedUntil: string | null; pinned: { id: number; title: string }[] };

export function registerModerationRoutes(services: Services, add: (r: Route) => void): void {
  add(route('POST', '/api/posts/:id/removal', removePost(services)));
  add(route('DELETE', '/api/posts/:id/removal', restorePost(services)));
  add(route('POST', '/api/posts/:id/lock', lockPost(services)));
  add(route('DELETE', '/api/posts/:id/lock', unlockPost(services)));
  add(route('POST', '/api/posts/:id/pin', pinPost(services)));
  add(route('DELETE', '/api/posts/:id/pin', unpinPost(services)));
  add(route('POST', '/api/comments/:id/removal', removeComment(services)));
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
    `SELECT p.*, c.name AS community_name FROM posts p JOIN communities c ON c.id = p.community_id WHERE p.id = $1 FOR UPDATE`,
    [id]
  );
  if (rows.rows.length === 0) throw new ApiError('NOT_FOUND', 'Not found');
  return rows.rows[0] as unknown as PostRow;
}

/* Moderator gate: permission, then the two-factor requirement. */
async function requireModerator(services: Services, ctx: Ctx, communityId: number): Promise<void> {
  if (ctx.account === null) throw new ApiError('UNAUTHENTICATED', 'Sign in to continue');
  const role = await memberRole(services, communityId, ctx.account.id);
  if (!role.isModerator) throw new ApiError('FORBIDDEN', 'Moderators only');
  const need2fa = await requiresTwoFactor(services, ctx.account);
  if (need2fa) throw new ApiError('TOTP_REQUIRED', 'Enter the 6-digit code from your authenticator app');
}

async function currentState(services: Services, postId: number): Promise<Current> {
  const rows = await services.db.query(
    `SELECT p.version, p.state, p.locked, p.locked_until FROM posts p WHERE p.id = $1`,
    [postId]
  );
  const p = rows.rows[0] as { version: number; state: string; locked: boolean; locked_until: Date | null };
  const pinned = await services.db.query(
    `SELECT id, title FROM posts WHERE community_id = (SELECT community_id FROM posts WHERE id = $1) AND pinned AND state = 'published' ORDER BY pinned_at ASC, id ASC`,
    [postId]
  );
  return {
    version: p.version,
    state: p.state,
    locked: p.locked,
    lockedUntil: p.locked_until === null ? null : iso(new Date(p.locked_until)),
    pinned: (pinned.rows as unknown as { id: string; title: string }[]).map((r) => ({ id: Number(r.id), title: r.title })),
  };
}

function versionConflict(services: Services, postId: number): Promise<ApiError> {
  return currentState(services, postId).then((current) =>
    new ApiError('CONFLICT', 'Another moderator acted first', { current: { ...current, pinned: current.pinned } as unknown as Record<string, unknown> })
  );
}

async function checkVersion(services: Services, post: PostRow, sent: unknown): Promise<void> {
  if (sent !== Number(post.version)) {
    const current = await currentState(services, Number(post.id));
    throw new ApiError('CONFLICT', 'Another moderator acted first', {
      current: { ...current, pinned: current.pinned },
    });
  }
}

/* Removal reasons: rule (with a community rule id), spam, or other with a
   public note. The private note is stored only on the mod log entry. */
async function parseReason(services: Services, ctx: Ctx, communityId: number): Promise<{ publicReason: string; ruleId: number | null; publicNote: string | null; privateNote: string | null }> {
  const b = body(ctx);
  const reason = str(b.reason);
  const publicNote = str(b.publicNote).trim();
  const privateNote = str(b.privateNote);
  const fields: Record<string, string> = {};
  if (privateNote.length > 1000) fields.privateNote = 'Private notes are at most 1,000 characters';
  if (reason === '') {
    throw validation({ reason: 'Choose a reason' });
  }
  if (reason === 'rule') {
    const ruleId = Number(b.ruleId);
    if (!Number.isInteger(ruleId)) throw validation({ ruleId: 'Choose a reason' });
    const rows = await services.db.query(`SELECT title FROM rules WHERE id = $1 AND community_id = $2`, [ruleId, communityId]);
    if (rows.rows.length === 0) throw validation({ ruleId: 'Choose a reason' });
    return { publicReason: (rows.rows[0] as { title: string }).title, ruleId, publicNote: null, privateNote: privateNote === '' ? null : privateNote };
  }
  if (reason === 'spam') {
    return { publicReason: 'Spam', ruleId: null, publicNote: null, privateNote: privateNote === '' ? null : privateNote };
  }
  if (reason === 'other') {
    if (publicNote.length < 1 || publicNote.length > 300) throw validation({ publicNote: 'Add a public note for Other' });
    return { publicReason: publicNote, ruleId: null, publicNote, privateNote: privateNote === '' ? null : privateNote };
  }
  throw validation({ reason: 'Choose a reason' });
}

function removePost(services: Services): RouteHandler {
  return async (ctx) => {
    const post = await loadPost(services, Number(ctx.params.id));
    await requireModerator(services, ctx, Number(post.community_id));
    await checkVersion(services, post, body(ctx).version);
    if (post.state !== 'published') throw await versionConflict(services, Number(post.id));
    const reason = await parseReason(services, ctx, Number(post.community_id));
    await services.db.query(`BEGIN`);
    try {
      await services.db.query(
        `UPDATE posts SET state = 'removed', removal_public_reason = $2, removal_at = now(), pinned = false, version = version + 1 WHERE id = $1`,
        [Number(post.id), reason.publicReason]
      );
      await insertModLog(services, Number(post.community_id), 'remove_post', 'post', String(post.id), `Post ${post.id}`, ctx.account?.id ?? null, reason.publicReason, reason.privateNote);
      await services.db.query(`COMMIT`);
    } catch (err) {
      await services.db.query(`ROLLBACK`);
      throw err;
    }
    const authorId = post.author_id;
    if (authorId !== null) {
      const authorRows = await services.db.query(`SELECT email, username FROM accounts WHERE id = $1`, [Number(authorId)]);
      if (authorRows.rows.length > 0) {
        const author = authorRows.rows[0] as { email: string; username: string };
        services.mailer.statement(author.email, post.community_name, post.title, reason.publicReason, `/c/${post.community_name}/post/${Number(post.id)}`);
      }
    }
    await publishPostState(services, post);
    const fresh = await loadPostRow(services, Number(post.id));
    return { status: 200, body: await postView(services, fresh, ctx.account) };
  };
}

async function loadPostRow(services: Services, id: number): Promise<PostRow> {
  const rows = await services.db.query(
    `SELECT p.*, c.name AS community_name FROM posts p JOIN communities c ON c.id = p.community_id WHERE p.id = $1`,
    [id]
  );
  return rows.rows[0] as unknown as PostRow;
}

export async function insertModLog(services: Services, communityId: number, action: string, targetType: string, targetId: string, targetLabel: string, moderatorId: number | null, publicReason: string | null, privateNote: string | null): Promise<void> {
  await services.db.query(
    `INSERT INTO mod_log (community_id, action, target_type, target_id, target_label, moderator_id, public_reason, private_note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [communityId, action, targetType, targetId, targetLabel, moderatorId, publicReason, privateNote]
  );
}

async function publishPostState(services: Services, post: PostRow): Promise<void> {
  const fresh = await loadPostRow(services, Number(post.id));
  await services.valkey.publish({
    topics: ['home', `community:${post.community_name.toLowerCase()}`, `post:${Number(post.id)}`],
    event: 'post-state',
    data: {
      postId: Number(post.id),
      communityName: post.community_name,
      state: fresh.state,
      publicReason: fresh.removal_public_reason,
      locked: fresh.locked,
      lockedUntil: fresh.locked_until === null ? null : iso(new Date(fresh.locked_until)),
      pinned: fresh.pinned,
      version: fresh.version,
    },
  });
}

function restorePost(services: Services): RouteHandler {
  return async (ctx) => {
    const post = await loadPost(services, Number(ctx.params.id));
    await requireModerator(services, ctx, Number(post.community_id));
    await checkVersion(services, post, body(ctx).version);
    if (post.state !== 'removed') throw await versionConflict(services, Number(post.id));
    await services.db.query(`BEGIN`);
    try {
      await services.db.query(`UPDATE posts SET state = 'published', removal_public_reason = NULL, removal_at = NULL, version = version + 1 WHERE id = $1`, [Number(post.id)]);
      await insertModLog(services, Number(post.community_id), 'restore_post', 'post', String(post.id), `Post ${post.id}`, ctx.account?.id ?? null, null, null);
      await services.db.query(`COMMIT`);
    } catch (err) {
      await services.db.query(`ROLLBACK`);
      throw err;
    }
    await publishPostState(services, post);
    const fresh = await loadPostRow(services, Number(post.id));
    return { status: 200, body: await postView(services, fresh, ctx.account) };
  };
}

const LOCK_DURATIONS: Record<string, number> = { indefinite: 0, '1h': 1, '24h': 24, '7d': 168 };
const LOCK_REASON: Record<string, string> = { '1h': '1 hour', '24h': '24 hours', '7d': '7 days' };

function lockPost(services: Services): RouteHandler {
  return async (ctx) => {
    const post = await loadPost(services, Number(ctx.params.id));
    await requireModerator(services, ctx, Number(post.community_id));
    await checkVersion(services, post, body(ctx).version);
    if (post.state !== 'published' || post.locked) throw await versionConflict(services, Number(post.id));
    const duration = str(body(ctx).duration);
    const hours = LOCK_DURATIONS[duration];
    if (hours === undefined) throw validation({ duration: 'Duration must be indefinite, 1h, 24h or 7d' });
    const lockSeconds = hours * services.cfg.limits.lockHourSeconds;
    const until = hours === 0 ? null : new Date(Date.now() + lockSeconds * 1000);
    const publicReason = LOCK_REASON[duration] ?? null;
    await services.db.query(`BEGIN`);
    try {
      await services.db.query(
        `UPDATE posts SET locked = true, locked_until = $2, version = version + 1 WHERE id = $1`,
        [Number(post.id), until]
      );
      await insertModLog(services, Number(post.community_id), 'lock', 'post', String(post.id), `Post ${post.id}`, ctx.account?.id ?? null, publicReason, null);
      await services.db.query(`COMMIT`);
    } catch (err) {
      await services.db.query(`ROLLBACK`);
      throw err;
    }
    await publishPostState(services, post);
    const fresh = await loadPostRow(services, Number(post.id));
    return { status: 200, body: await postView(services, fresh, ctx.account) };
  };
}

function unlockPost(services: Services): RouteHandler {
  return async (ctx) => {
    const post = await loadPost(services, Number(ctx.params.id));
    await requireModerator(services, ctx, Number(post.community_id));
    await checkVersion(services, post, body(ctx).version);
    if (post.state !== 'published' || !isLocked(post)) throw await versionConflict(services, Number(post.id));
    await services.db.query(`BEGIN`);
    try {
      await services.db.query(`UPDATE posts SET locked = false, locked_until = NULL, version = version + 1 WHERE id = $1`, [Number(post.id)]);
      await insertModLog(services, Number(post.community_id), 'unlock', 'post', String(post.id), `Post ${post.id}`, ctx.account?.id ?? null, null, null);
      await services.db.query(`COMMIT`);
    } catch (err) {
      await services.db.query(`ROLLBACK`);
      throw err;
    }
    await publishPostState(services, post);
    const fresh = await loadPostRow(services, Number(post.id));
    return { status: 200, body: await postView(services, fresh, ctx.account) };
  };
}

function pinPost(services: Services): RouteHandler {
  return async (ctx) => {
    const post = await loadPost(services, Number(ctx.params.id));
    await requireModerator(services, ctx, Number(post.community_id));
    await checkVersion(services, post, body(ctx).version);
    if (post.state !== 'published' || post.pinned) throw await versionConflict(services, Number(post.id));
    const b = body(ctx);
    const replacePostId = b.replacePostId === undefined || b.replacePostId === null ? null : Number(b.replacePostId);
    const existing = await services.db.query(
      `SELECT id, title, pinned_at FROM posts WHERE community_id = $1 AND pinned AND state = 'published' ORDER BY pinned_at ASC, id ASC`,
      [Number(post.community_id)]
    );
    const pins = existing.rows as unknown as { id: string; title: string; pinned_at: Date }[];
    if (pins.length >= 2 && replacePostId === null) {
      const current = await currentState(services, Number(post.id));
      throw new ApiError('SLOT_TAKEN', 'Replace a pin', { current: { ...current, pinned: current.pinned } as unknown as Record<string, unknown> });
    }
    if (replacePostId !== null) {
      const target = pins.find((p) => Number(p.id) === replacePostId);
      if (target === undefined) throw await versionConflict(services, Number(post.id));
    }
    await services.db.query(`BEGIN`);
    try {
      if (replacePostId !== null) {
        await services.db.query(`UPDATE posts SET pinned = false, pinned_at = NULL, version = version + 1 WHERE id = $1`, [replacePostId]);
        await insertModLog(services, Number(post.community_id), 'unpin', 'post', String(replacePostId), `Post ${replacePostId}`, ctx.account?.id ?? null, null, null);
      }
      await services.db.query(`UPDATE posts SET pinned = true, pinned_at = now(), version = version + 1 WHERE id = $1`, [Number(post.id)]);
      await insertModLog(services, Number(post.community_id), 'pin', 'post', String(post.id), `Post ${post.id}`, ctx.account?.id ?? null, null, null);
      await services.db.query(`COMMIT`);
    } catch (err) {
      await services.db.query(`ROLLBACK`);
      throw err;
    }
    await publishPostState(services, post);
    const fresh = await loadPostRow(services, Number(post.id));
    return { status: 200, body: await postView(services, fresh, ctx.account) };
  };
}

function unpinPost(services: Services): RouteHandler {
  return async (ctx) => {
    const post = await loadPost(services, Number(ctx.params.id));
    await requireModerator(services, ctx, Number(post.community_id));
    await checkVersion(services, post, body(ctx).version);
    if (post.state !== 'published' || !post.pinned) throw await versionConflict(services, Number(post.id));
    await services.db.query(`BEGIN`);
    try {
      await services.db.query(`UPDATE posts SET pinned = false, pinned_at = NULL, version = version + 1 WHERE id = $1`, [Number(post.id)]);
      await insertModLog(services, Number(post.community_id), 'unpin', 'post', String(post.id), `Post ${post.id}`, ctx.account?.id ?? null, null, null);
      await services.db.query(`COMMIT`);
    } catch (err) {
      await services.db.query(`ROLLBACK`);
      throw err;
    }
    await publishPostState(services, post);
    const fresh = await loadPostRow(services, Number(post.id));
    return { status: 200, body: await postView(services, fresh, ctx.account) };
  };
}

function removeComment(services: Services): RouteHandler {
  return async (ctx) => {
    const commentRows = await services.db.query(`SELECT * FROM comments WHERE id = $1 FOR UPDATE`, [Number(ctx.params.id)]);
    if (commentRows.rows.length === 0) throw new ApiError('NOT_FOUND', 'Not found');
    const comment = commentRows.rows[0] as unknown as { id: string; post_id: string; state: string };
    const post = await loadPostRow(services, Number(comment.post_id));
    await requireModerator(services, ctx, Number(post.community_id));
    if (comment.state !== 'published') throw new ApiError('CONFLICT', 'Only published comments can be removed');
    const reason = await parseReason(services, ctx, Number(post.community_id));
    await services.db.query(`BEGIN`);
    try {
      await services.db.query(`UPDATE comments SET state = 'removed', removal_public_reason = $2 WHERE id = $1`, [Number(comment.id), reason.publicReason]);
      await services.db.query(`UPDATE posts SET comment_count = comment_count - 1 WHERE id = $1`, [Number(comment.post_id)]);
      await insertModLog(services, Number(post.community_id), 'remove_comment', 'comment', String(comment.id), `Comment ${comment.id}`, ctx.account?.id ?? null, reason.publicReason, reason.privateNote);
      await services.db.query(`COMMIT`);
    } catch (err) {
      await services.db.query(`ROLLBACK`);
      throw err;
    }
    const { commentView } = await import('../views.js');
    const fresh = await services.db.query(`SELECT * FROM comments WHERE id = $1`, [Number(comment.id)]);
    const view = await commentView(services, fresh.rows[0] as unknown as import('../views.js').CommentRow, ctx.account, Number(post.community_id), false);
    return { status: 200, body: view };
  };
}
