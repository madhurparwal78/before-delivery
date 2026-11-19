import { randomUUID } from 'node:crypto';
import { hasSeat, isMemberOf, requireViewer, workspaceBySlug } from '../auth.js';
import { one, query, transact, lock } from '../db.js';
import { errors } from '../errors.js';
import { assertLinkUsable, reviewLinkById, reviewLinkByToken } from '../domain/reviewLinks.js';
import { jsonResponse, noContent, type HttpResponse, type RequestContext } from '../http/context.js';
import type { Router } from '../http/router.js';
import { loadEntries } from '../repository.js';
import { reviewLinkMessage, sendMail } from '../services/mail.js';
import { config } from '../config.js';
import { FieldErrors, checkCommentBody, checkDisplayName } from '../validate.js';
import { limits } from '../../shared/limits.js';
import type { Comment, ReviewEntry, ReviewLinkCreated } from '../../shared/types.js';

async function requireLinkOwner(context: RequestContext, linkId: string) {
  const viewer = await requireViewer(context);
  const link = await reviewLinkById(linkId);
  if (link === null) {
    throw errors.notFound();
  }
  const row = await one<{ slug: string }>('select slug from workspaces where id = $1', [link.workspace_id]);
  const workspace = row === null ? null : await workspaceBySlug(row.slug);
  if (workspace === null || !isMemberOf(workspace, viewer)) {
    throw errors.notFound();
  }
  if (viewer.role !== 'ops_lead' && !(await hasSeat(workspace.id, viewer.id))) {
    throw errors.seatRequired();
  }
  return { link, workspace };
}

async function regenerateLink(context: RequestContext): Promise<HttpResponse> {
  const { link, workspace } = await requireLinkOwner(context, context.params.id);
  assertLinkUsable(link, new Date());

  const token = randomUUID().replace(/-/g, '');
  const url = `${config.publicUrl}/review/${token}`;
  await sendMail(
    reviewLinkMessage({
      to: link.email,
      clusterTitle: link.cluster_title,
      workspaceName: workspace.name,
      url,
      expiresAt: link.expires_at,
    }),
  );
  const id = randomUUID();
  await transact(async (client) => {
    await client.query('update review_links set revoked_at = now() where id = $1', [link.id]);
    await client.query(
      `insert into review_links (id, cluster_id, email, token, expires_at, can_comment)
            values ($1, $2, $3, $4, $5, $6)`,
      [id, link.cluster_id, link.email, token, link.expires_at, link.can_comment],
    );
  });
  const body: ReviewLinkCreated = {
    id,
    email: link.email,
    url,
    expiresAt: link.expires_at.toISOString(),
    canComment: link.can_comment,
  };
  return jsonResponse(200, body);
}

async function revokeLink(context: RequestContext): Promise<HttpResponse> {
  const { link } = await requireLinkOwner(context, context.params.id);
  await query('update review_links set revoked_at = coalesce(revoked_at, now()) where id = $1', [link.id]);
  return noContent();
}

function toComment(row: { id: string; author_name: string; body: string; created_at: Date }): Comment {
  return { id: row.id, authorName: row.author_name, body: row.body, createdAt: row.created_at.toISOString() };
}

async function readReview(context: RequestContext): Promise<HttpResponse> {
  const token = context.params.token;
  const link = await reviewLinkByToken(token);
  if (link === null) {
    throw errors.notFound();
  }
  assertLinkUsable(link, new Date());

  const cluster = await one<{ title: string; public_description: string }>(
    'select title, public_description from clusters where id = $1',
    [link.cluster_id],
  );
  if (cluster === null) {
    throw errors.notFound();
  }
  const entries = await loadEntries(link.cluster_id);
  const comments = await query<{ id: string; author_name: string; body: string; created_at: Date }>(
    'select id, author_name, body, created_at from comments where cluster_id = $1 order by created_at, id',
    [link.cluster_id],
  );
  const reviewEntries: ReviewEntry[] = entries.map((entry) => ({
    id: entry.entry_id,
    position: entry.position,
    title: entry.title,
    kind: entry.kind,
    mediaUrl: `/media/${entry.id}?review=${token}`,
    timecode: entry.timecode,
    sourceClipTitle: entry.source_clip_title,
    isPrivate: entry.is_private,
  }));
  return jsonResponse(200, {
    cluster: {
      title: cluster.title,
      publicDescription: cluster.public_description,
      itemCount: reviewEntries.length,
      entries: reviewEntries,
    },
    comments: comments.map(toComment),
    link: { expiresAt: link.expires_at.toISOString(), canComment: link.can_comment },
  });
}

async function postReviewComment(context: RequestContext): Promise<HttpResponse> {
  const token = context.params.token;
  const link = await reviewLinkByToken(token);
  if (link === null) {
    throw errors.notFound();
  }
  const now = new Date();
  assertLinkUsable(link, now);
  if (!link.can_comment) {
    throw errors.readOnlyLink();
  }
  const body = context.body as Record<string, unknown>;
  const fields = new FieldErrors();
  const authorName = checkDisplayName(fields, body.authorName, 'authorName');
  const text = checkCommentBody(fields, body.body);
  fields.throwIfAny();

  const id = randomUUID();
  const created = await transact(async (client) => {
    await lock(client, 'review-comments', `${link.cluster_id}:${link.email.toLowerCase()}`);
    const counted = await client.query<{ created_at: Date; server_now: Date }>(
      `select created_at, now() as server_now from comments
        where cluster_id = $1 and lower(author_email) = lower($2)
          and created_at > now() - ($3::int * interval '1 millisecond')
        order by created_at`,
      [link.cluster_id, link.email, limits.reviewCommentWindowMs],
    );
    if (counted.rows.length >= limits.reviewCommentsPerMinute) {
      const oldest = counted.rows[0];
      const waitMs = oldest.created_at.getTime() + limits.reviewCommentWindowMs - oldest.server_now.getTime();
      throw errors.rateLimited(Math.min(60, Math.max(1, Math.ceil(waitMs / 1000))));
    }
    const inserted = await client.query<{ id: string; author_name: string; body: string; created_at: Date }>(
      `insert into comments (id, cluster_id, author_name, author_email, body)
            values ($1, $2, $3, $4, $5)
         returning id, author_name, body, created_at`,
      [id, link.cluster_id, authorName, link.email, text],
    );
    return inserted.rows[0];
  });
  return jsonResponse(201, toComment(created));
}

export function registerReviewRoutes(router: Router): void {
  router.post('/api/review-links/:id/regenerate', 'none', regenerateLink);
  router.delete('/api/review-links/:id', revokeLink);
  router.get('/api/review/:token', readReview);
  router.post('/api/review/:token/comments', 'json', postReviewComment);
}
