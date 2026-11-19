// Review link endpoints: the freelancer's view of exactly one cluster.

import http from 'node:http';
import type { URL } from 'node:url';
import type { App, Ctx, Handler } from '../app.js';
import { isUuid } from '../ids.js';
import { sendJson, readJsonBody } from '../http-helpers.js';
import { one, many } from '../db.js';
import { E } from '../e.js';
import { effectiveStatusOf, nowDate } from '../time.js';
import { commentBody, nameField, type FieldErrors } from '../validate.js';
import { newId } from '../passwords.js';
import type { ClusterRow } from '../projections.js';
import { linkState } from './clusters.js';

export function reviewRoutes(method: string, pathname: string): Handler | null {
  const m = /^\/api\/review\/([^/]+)$/.exec(pathname);
  if (m && method === 'GET') {
    const token = m[1]!;
    return (app, req, res, ctx, url) => reviewGet(token, app, req, res, ctx, url);
  }
  const c = /^\/api\/review\/([^/]+)\/comments$/.exec(pathname);
  if (c && method === 'POST') {
    const token = c[1]!;
    return (app, req, res, ctx, url) => reviewComment(token, app, req, res, ctx, url);
  }
  return null;
}

export interface LinkContext {
  link: {
    id: string;
    token: string;
    cluster_id: string;
    workspace_id: string;
    email: string;
    expires_at: Date;
    can_comment: boolean;
    state: string;
  };
  cluster: ClusterRow;
}

/** Resolve a review token to its link and cluster, applying the server clock. */
export async function resolveToken(ctx: Ctx, token: string): Promise<LinkContext> {
  const link = await one<LinkContext['link']>(ctx.db, `select * from review_links where token = $1`, [token]);
  if (!link) throw E.notFound();
  const cluster = await one<ClusterRow>(ctx.db, `select * from clusters where id = $1`, [link.cluster_id]);
  if (!cluster) throw E.notFound();
  const now = nowDate();
  const eff = effectiveStatusOf(cluster.status, cluster.lifts_at, now);
  const state = linkState(link.state, link.expires_at, now, eff === 'in_review');
  if (state === 'expired') throw E.linkExpired();
  if (state === 'revoked') throw E.linkRevoked();
  if (state === 'inactive') throw E.linkInactive();
  return { link, cluster };
}

async function reviewGet(token: string, _app: App, _req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, _url: URL): Promise<void> {
  const { link, cluster } = await resolveToken(ctx, token);
  const entries = await many<{
    id: string;
    position: number;
    is_private: boolean;
    kind: string;
    title: string;
    reference_id: string;
    timecode: string | null;
    source_clip_title: string | null;
  }>(
    ctx.db,
    `select e.id, e.position, e.is_private, r.kind, r.title, r.id as reference_id, r.timecode, r.source_clip_title
       from entries e join reference_items r on r.id = e.reference_id
      where e.cluster_id = $1
      order by e.position`,
    [cluster.id],
  );
  const comments = await many<{ id: string; author_name: string; body: string; created_at: Date }>(
    ctx.db,
    `select id, author_name, body, created_at from comments where cluster_id = $1 order by created_at asc, id asc`,
    [cluster.id],
  );
  sendJson(res, 200, {
    cluster: {
      title: cluster.title,
      publicDescription: cluster.public_description,
      itemCount: entries.length,
      entries: entries.map((e) => ({
        id: e.id,
        position: e.position,
        title: e.title,
        kind: e.kind,
        mediaUrl: `/media/${e.reference_id}?review=${encodeURIComponent(token)}`,
        timecode: e.kind === 'still' ? e.timecode : null,
        sourceClipTitle: e.kind === 'still' ? e.source_clip_title : null,
        isPrivate: e.is_private,
      })),
    },
    comments: comments.map((c) => ({ id: c.id, authorName: c.author_name, body: c.body, createdAt: c.created_at.toISOString() })),
    link: { expiresAt: link.expires_at.toISOString(), canComment: link.can_comment },
  });
}

async function reviewComment(token: string, app: App, req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, _url: URL): Promise<void> {
  const { link, cluster } = await resolveToken(ctx, token);
  if (!link.can_comment) throw E.readOnlyLink();
  const body = await readJsonBody(req);
  const errors: FieldErrors = {};
  const authorName = nameField(body.authorName, errors, 'authorName');
  const text = commentBody(body.body, errors);
  if (Object.keys(errors).length > 0) throw E.validation(errors);

  // Rate limit: 5 accepted comments per cluster and freelancer email per rolling 60s.
  const now = nowDate();
  const cutoff = new Date(now.getTime() - 60_000);
  const before = await ctx.db.query<{ accepted_at: Date }>(
    `select accepted_at from review_comment_events
      where cluster_id = $1 and lower(email) = $2 and accepted_at > $3
      order by accepted_at asc`,
    [cluster.id, link.email.toLowerCase(), cutoff],
  );
  if (before.rows.length >= 5) {
    const oldest = before.rows[0]!.accepted_at;
    const retryMs = oldest.getTime() + 60_000 - now.getTime();
    const retryAfter = Math.max(1, Math.min(60, Math.ceil(retryMs / 1000)));
    throw E.rateLimited(retryAfter);
  }
  const id = newId();
  await ctx.db.query(`insert into comments (id, cluster_id, author_name, body) values ($1,$2,$3,$4)`, [
    id,
    cluster.id,
    authorName,
    text,
  ]);
  await ctx.db.query(`insert into review_comment_events (cluster_id, email, accepted_at) values ($1,$2,$3)`, [
    cluster.id,
    link.email.toLowerCase(),
    now,
  ]);
  const row = (await one<{ id: string; author_name: string; body: string; created_at: Date }>(
    ctx.db,
    `select id, author_name, body, created_at from comments where id = $1`,
    [id],
  ))!;
  void app;
  sendJson(res, 201, { id: row.id, authorName: row.author_name, body: row.body, createdAt: row.created_at.toISOString() });
}
