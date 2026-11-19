// Media access: members, review tokens and public-cluster entries.

import http from 'node:http';
import type { URL } from 'node:url';
import type { App, Ctx, Handler } from '../app.js';
import { isUuid } from '../ids.js';
import { one } from '../db.js';
import { E } from '../e.js';
import { notFound } from '../errors.js';
import { effectiveStatusOf, nowDate } from '../time.js';
import { resolveToken } from './review.js';
import { objectKey } from '../objects.js';

export function mediaRoutes(method: string, pathname: string): Handler | null {
  const m = /^\/media\/([^/?]+)$/.exec(pathname);
  if (method === 'GET' && m) {
    const id = m[1]!;
    if (!isUuid(id)) return notFoundHandler;
    return (app, req, res, ctx, url) => mediaGet(id, app, req, res, ctx, url);
  }
  return null;
}

const notFoundHandler: Handler = async () => {
  throw notFound();
};

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

async function mediaGet(referenceId: string, app: App, _req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, url: URL): Promise<void> {
  const ref = await one<{
    id: string;
    workspace_id: string;
    kind: string;
    ext: string;
    content_type: string;
    title: string;
  }>(ctx.db, `select id, workspace_id, kind, ext, content_type, title from reference_items where id = $1`, [referenceId]);
  if (!ref) throw E.notFound();

  const reviewToken = url.searchParams.get('review');
  let allowed = false;

  if (ctx.account) {
    // A member of the reference's workspace.
    const ws = await one<{ id: string; slug: string; group_id: string }>(ctx.db, `select id, slug, group_id from workspaces where id = $1`, [ref.workspace_id]);
    if (ws) {
      if (ctx.account.role === 'ops_lead' && ctx.account.group_id === ws.group_id) allowed = true;
      if (ctx.account.role === 'designer' && ctx.account.workspace_id === ws.id) allowed = true;
    }
  }

  if (!allowed && reviewToken) {
    // The token must be accepted at this same millisecond, and the reference must
    // be an entry of the link's cluster.
    try {
      const { link, cluster } = await resolveToken(ctx, reviewToken);
      const entry = await one<{ id: string }>(
        ctx.db,
        `select e.id from entries e join reference_items r on r.id = e.reference_id where e.cluster_id = $1 and r.id = $2`,
        [cluster.id, referenceId],
      );
      if (entry) {
        void link;
        allowed = true;
      }
    } catch (e) {
      if (e instanceof E.ApiError && (e.code === 'link_expired' || e.code === 'link_revoked' || e.code === 'link_inactive' || e.code === 'not_found')) {
        // fall through to the public check
      } else {
        throw e;
      }
    }
  }

  if (!allowed) {
    // Public while a non-private entry of at least one public cluster.
    const pub = await one<{ id: string }>(
      ctx.db,
      `select e.id
         from entries e
         join clusters c on c.id = e.cluster_id
        where e.reference_id = $1 and not e.is_private
          and (c.status = 'public' or (c.status = 'embargoed' and c.lifts_at is not null and c.lifts_at <= $2))
        limit 1`,
      [referenceId, nowDate()],
    );
    if (pub) allowed = true;
  }

  if (!allowed) throw E.notFound();

  const ws = (await one<{ slug: string }>(ctx.db, `select slug from workspaces where id = $1`, [ref.workspace_id]))!;
  const key = objectKey(ws.slug, ref.id, ref.ext);
  const body = await app.storage.get(key);
  if (!body) throw E.notFound();
  const ext = EXT_BY_TYPE[ref.content_type] ?? ref.ext;
  res.writeHead(200, {
    'Content-Type': ref.content_type,
    'Content-Length': body.length,
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `inline; filename="${ref.id}.${ext}"`,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}
