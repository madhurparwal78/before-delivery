// Public endpoints: the feed, public cluster pages, curator profiles and follows.

import http from 'node:http';
import type { URL } from 'node:url';
import type { App, Ctx, Handler } from '../app.js';
import { isUuid } from '../ids.js';
import { sendJson } from '../http-helpers.js';
import { one, many } from '../db.js';
import { E } from '../e.js';
import { notFound } from '../errors.js';
import { effectiveStatusOf, nowDate } from '../time.js';
import type { ClusterStatus } from '../../shared/types.js';
import { encodeCursor, decodeCursor } from '../cursors.js';
import { validHandle, type FieldErrors } from '../validate.js';

export function publicRoutes(method: string, pathname: string): Handler | null {
  if (method === 'GET' && pathname === '/api/feed') return feed;
  const pc = /^\/api\/public\/clusters\/([^/]+)$/.exec(pathname);
  if (method === 'GET' && pc) {
    const id = pc[1]!;
    if (!isUuid(id)) return notFoundHandler;
    return (app, req, res, ctx, url) => publicCluster(id, app, req, res, ctx, url);
  }
  const cu = /^\/api\/curators\/([^/]+)$/.exec(pathname);
  if (method === 'GET' && cu) {
    const handle = cu[1]!;
    return (app, req, res, ctx, url) => curatorProfile(handle, app, req, res, ctx, url);
  }
  const fo = /^\/api\/curators\/([^/]+)\/follow$/.exec(pathname);
  if (fo && method === 'POST') {
    const handle = fo[1]!;
    return (app, req, res, ctx, url) => followToggle(handle, true, app, req, res, ctx, url);
  }
  if (fo && method === 'DELETE') {
    const handle = fo[1]!;
    return (app, req, res, ctx, url) => followToggle(handle, false, app, req, res, ctx, url);
  }
  return null;
}

const notFoundHandler: Handler = async () => {
  throw notFound();
};

async function feed(_app: App, _req: http.IncomingMessage, res: http.ServerResponse, _ctx: Ctx, url: URL): Promise<void> {
  const limitRaw = url.searchParams.get('limit');
  let limit = 20;
  if (limitRaw !== null && limitRaw !== '') {
    if (!/^\d+$/.test(limitRaw) || Number(limitRaw) < 1) throw E.validation({ limit: 'Use a whole number of 1 or more.' });
    limit = Math.min(50, Number(limitRaw));
  }
  const cursor = url.searchParams.get('cursor');
  const payload = decodeCursor({ surface: 'feed', workspace: 'public' }, cursor);
  const beforePublished = typeof payload.publishedAt === 'string' ? new Date(payload.publishedAt) : null;
  const beforeId = typeof payload.id === 'string' ? payload.id : null;
  const now = nowDate();
  const rows = await many<{
    id: string;
    title: string;
    public_description: string;
    published_at: Date;
    owner_name: string;
    owner_handle: string;
    public_count: string;
    cover: string | null;
  }>(
    _ctx.db,
    `with public_now as (
       select c.id from clusters c
        where c.status = 'public' or (c.status = 'embargoed' and c.lifts_at is not null and c.lifts_at <= $3)
     )
     select c.id, c.title, c.public_description, c.published_at,
            a.display_name as owner_name, a.handle as owner_handle,
            (select count(*)::text from entries e where e.cluster_id = c.id and not e.is_private) as public_count,
            (select '/media/' || r.id from entries e join reference_items r on r.id = e.reference_id
              where e.cluster_id = c.id and not e.is_private order by e.position limit 1) as cover
       from clusters c
       join accounts a on a.id = c.owner_id
      where c.id in (select id from public_now)
        and ($1::timestamptz is null or (c.published_at, c.id) < ($1::timestamptz, $2::uuid))
      order by c.published_at desc, c.id desc
      limit $4`,
    [beforePublished, beforeId, now, limit + 1],
  );
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const nextCursor =
    rows.length > limit && last ? encodeCursor({ surface: 'feed', workspace: 'public' }, { publishedAt: last.published_at.toISOString(), id: last.id }) : null;
  sendJson(res, 200, {
    items: items.map((r) => ({
      id: r.id,
      title: r.title,
      publicDescription: r.public_description,
      curator: { displayName: r.owner_name, handle: r.owner_handle },
      publicItemCount: Number(r.public_count),
      publishedAt: r.published_at.toISOString(),
      coverUrl: r.cover,
    })),
    nextCursor,
  });
}

async function publicCluster(clusterId: string, _app: App, _req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, _url: URL): Promise<void> {
  const row = await one<{
    id: string;
    title: string;
    public_description: string;
    published_at: Date;
    owner_id: string;
    owner_name: string;
    owner_handle: string;
  }>(
    ctx.db,
    `select c.id, c.title, c.public_description, c.published_at, c.owner_id,
            a.display_name as owner_name, a.handle as owner_handle
       from clusters c join accounts a on a.id = c.owner_id
      where c.id = $1`,
    [clusterId],
  );
  if (!row) throw E.notFound();
  const clusterRow = await one<{ status: ClusterStatus; lifts_at: Date | null }>(
    ctx.db,
    `select status, lifts_at from clusters where id = $1`,
    [clusterId],
  );
  const eff = effectiveStatusOf(clusterRow!.status, clusterRow!.lifts_at, nowDate());
  if (eff !== 'public') throw E.notFound();
  const entries = await many<{
    id: string;
    position: number;
    is_private: boolean;
    kind: string;
    title: string;
    reference_id: string;
    timecode: string | null;
    source_clip_title: string | null;
    added_by: string;
  }>(
    ctx.db,
    `select e.id, e.position, e.is_private, r.kind, r.title, r.id as reference_id, r.timecode, r.source_clip_title, e.added_by
       from entries e join reference_items r on r.id = e.reference_id
      where e.cluster_id = $1
      order by e.position`,
    [clusterId],
  );
  const publicEntries = entries.filter((e) => !e.is_private);
  // Credits: the owner first, then every other designer who added a non-private entry.
  const creditIds: string[] = [row.owner_id];
  for (const e of publicEntries) {
    if (!creditIds.includes(e.added_by)) creditIds.push(e.added_by);
  }
  const credits = await many<{ id: string; display_name: string; handle: string }>(
    ctx.db,
    `select id, display_name, handle from accounts where id = any($1::uuid[])`,
    [creditIds],
  );
  const creditById = new Map(credits.map((c) => [c.id, c]));
  const orderedCredits = creditIds
    .map((id) => creditById.get(id))
    .filter((c): c is { id: string; display_name: string; handle: string } => Boolean(c));
  sendJson(res, 200, {
    id: row.id,
    title: row.title,
    publicDescription: row.public_description,
    curator: { displayName: row.owner_name, handle: row.owner_handle },
    credits: orderedCredits.map((c) => ({ displayName: c.display_name, handle: c.handle })),
    publishedAt: row.published_at!.toISOString(),
    publicItemCount: publicEntries.length,
    items: publicEntries.map((e, i) => ({
      id: e.id,
      position: i + 1,
      title: e.title,
      kind: e.kind,
      mediaUrl: `/media/${e.reference_id}`,
      timecode: e.kind === 'still' ? e.timecode : null,
      sourceClipTitle: e.kind === 'still' ? e.source_clip_title : null,
    })),
  });
}

async function curatorProfile(handle: string, _app: App, _req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, _url: URL): Promise<void> {
  const account = await one<{ id: string; display_name: string; handle: string }>(
    ctx.db,
    `select id, display_name, handle from accounts where handle = $1`,
    [handle],
  );
  if (!account) throw E.notFound();
  const followerCount = await one<{ n: string }>(
    ctx.db,
    `select count(*)::text as n from follows where curator_id = $1`,
    [account.id],
  );
  const now = nowDate();
  const clusters = await many<{
    id: string;
    title: string;
    published_at: Date;
    public_count: string;
    cover: string | null;
  }>(
    ctx.db,
    `select c.id, c.title, c.published_at,
            (select count(*)::text from entries e where e.cluster_id = c.id and not e.is_private) as public_count,
            (select '/media/' || r.id from entries e join reference_items r on r.id = e.reference_id
              where e.cluster_id = c.id and not e.is_private order by e.position limit 1) as cover
       from clusters c
      where c.owner_id = $1
        and (c.status = 'public' or (c.status = 'embargoed' and c.lifts_at is not null and c.lifts_at <= $2))
      order by c.published_at desc`,
    [account.id, now],
  );
  sendJson(res, 200, {
    displayName: account.display_name,
    handle: account.handle,
    followerCount: Number(followerCount?.n ?? 0),
    clusters: clusters.map((c) => ({
      id: c.id,
      title: c.title,
      publishedAt: c.published_at.toISOString(),
      publicItemCount: Number(c.public_count),
      coverUrl: c.cover,
    })),
  });
}

async function followToggle(handle: string, following: boolean, _app: App, _req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, _url: URL): Promise<void> {
  if (!ctx.account) throw E.unauthenticated();
  const errors: FieldErrors = {};
  const targetHandle = validHandle(handle, errors);
  if (Object.keys(errors).length > 0) throw E.validation(errors);
  const target = await one<{ id: string; handle: string }>(ctx.db, `select id, handle from accounts where handle = $1`, [targetHandle]);
  if (!target) throw E.notFound();
  if (target.id === ctx.account.id) {
    throw E.validation({ handle: 'You cannot follow yourself.' });
  }
  if (following) {
    await ctx.db.query(
      `insert into follows (follower_id, curator_id) values ($1,$2) on conflict (follower_id, curator_id) do nothing`,
      [ctx.account.id, target.id],
    );
  } else {
    await ctx.db.query(`delete from follows where follower_id = $1 and curator_id = $2`, [ctx.account.id, target.id]);
  }
  const count = await one<{ n: string }>(ctx.db, `select count(*)::text as n from follows where curator_id = $1`, [target.id]);
  sendJson(res, 200, { following, followerCount: Number(count?.n ?? 0) });
}
