import { db } from '../db/pool';
import { postedMonth } from '../domain/anonymity';
import { claimPost, decidePost, postHistory, renewClaim } from '../domain/moderation';
import { postContent, postLabel, type PostRow } from '../domain/posts';
import { COPY, FieldErrors, rejectionReason, textBetween } from '../domain/validate';
import { ApiError } from '../errors';
import type { Context } from '../http/context';
import type { Router } from '../http/router';

async function queueRows(viewerId: string): Promise<PostRow[]> {
  return db.query<PostRow>(
    `SELECT p.id, p.kind, p.company_id, c.name AS company_name, c.slug AS company_slug, p.author_id, p.state,
            p.created_at, p.deleted_at, p.claimed_by, p.claimed_at, p.lease_started_at, p.last_lapsed_by,
            p.decided_by, p.reason, p.overall, p.work_life, p.pay, p.management, p.title, p.pros, p.cons,
            p.role_family, p.city, p.annual_pay, p.years_experience, p.difficulty, p.outcome, p.body_text
       FROM posts p JOIN companies c ON c.id = p.company_id
      WHERE p.state IN ('pending', 'claimed') AND p.deleted_at IS NULL
        AND (p.author_id IS NULL OR p.author_id <> $1)
      ORDER BY p.created_at, p.id`,
    [viewerId],
  );
}

export function registerModerationRoutes(router: Router): void {
  router.get('/api/moderation/queue', async (ctx: Context) => {
    const moderator = ctx.requireRole('moderator', 'founder');
    const rows = await queueRows(moderator.id);
    const names = new Map<string, string>();
    for (const row of rows) {
      if (row.claimed_by && !names.has(row.claimed_by)) {
        const user = await db.one<{ display_name: string }>('SELECT display_name FROM users WHERE id = $1', [
          row.claimed_by,
        ]);
        names.set(row.claimed_by, user?.display_name ?? '');
      }
    }
    return {
      posts: rows.map((post) => ({
        id: post.id,
        kind: post.kind,
        label: postLabel(post),
        company_name: post.company_name,
        posted_month: postedMonth(post.created_at),
        state: post.state,
        claimed_by_name: post.claimed_by ? (names.get(post.claimed_by) ?? null) : null,
        ...postContent(post),
      })),
    };
  });

  router.post('/api/moderation/:id/claim', async (ctx: Context) => {
    const moderator = ctx.requireRole('moderator', 'founder');
    return claimPost(moderator, ctx.param('id'), await ctx.now());
  });

  router.post('/api/moderation/:id/renew', async (ctx: Context) => {
    const moderator = ctx.requireRole('moderator', 'founder');
    return renewClaim(moderator, ctx.param('id'), await ctx.now());
  });

  router.get('/api/moderation/:id/history', async (ctx: Context) => {
    const moderator = ctx.requireRole('moderator', 'founder');
    const post = await db.one<{ id: string; author_id: string | null; deleted_at: Date | null }>(
      'SELECT id, author_id, deleted_at FROM posts WHERE id = $1',
      [ctx.param('id')],
    );
    if (!post || post.deleted_at || post.author_id === moderator.id) throw new ApiError('not_found');
    return { events: await postHistory(post.id) };
  });

  router.post('/api/moderation/:id/decision', async (ctx: Context) => {
    const moderator = ctx.requireRole('moderator', 'founder');
    const body = ctx.json();
    const decision = body['decision'] === 'approve' || body['decision'] === 'reject' ? body['decision'] : null;
    const now = await ctx.now();

    /** The published reason is the chosen reason, or the typed details for `Other`. */
    const validate = (): string | null => {
      const errors = new FieldErrors();
      if (!decision) errors.add('decision', COPY.decision);
      if (decision !== 'reject') {
        errors.throwIfAny();
        return null;
      }
      const reason = rejectionReason(body['reason']);
      if (!reason) errors.add('reason', COPY.reason);
      let details: string | null = null;
      if (reason === 'Other') {
        details = textBetween(body['details'], 5, 200);
        if (details === null) errors.add('details', COPY.details);
      }
      errors.throwIfAny();
      return reason === 'Other' ? (details as string) : (reason as string);
    };

    return decidePost(moderator, ctx.param('id'), decision === 'reject' ? 'reject' : 'approve', now, validate);
  });
}
