import { requireViewer } from '../auth.js';
import { one, query } from '../db.js';
import { decodeCursor, encodeCursor } from '../cursors.js';
import { errors } from '../errors.js';
import { publicClusterSql, publicPublishedAtSql } from '../domain/lift.js';
import { toPublicCluster } from '../domain/publicProjection.js';
import { jsonResponse, type HttpResponse, type RequestContext } from '../http/context.js';
import type { Router } from '../http/router.js';
import { clusterSelect, loadEntries, type ClusterRow } from '../repository.js';
import { checkLimit } from '../validate.js';
import { fieldMessages } from '../../shared/fields.js';
import { limits } from '../../shared/limits.js';
import type { CuratorProfileCluster, FeedCard } from '../../shared/types.js';

interface FeedRow {
  id: string;
  title: string;
  public_description: string;
  owner_display_name: string;
  owner_handle: string;
  published_at: Date;
  public_item_count: number;
  cover_reference_id: string | null;
}

const publicItemCountSql = `(select count(*)::int from cluster_entries e
                              where e.cluster_id = c.id and e.is_private = false)`;

const coverSql = `(select e.reference_id from cluster_entries e
                    where e.cluster_id = c.id and e.is_private = false
                    order by e.position limit 1)`;

function toFeedCard(row: FeedRow): FeedCard {
  return {
    id: row.id,
    title: row.title,
    publicDescription: row.public_description,
    curator: { displayName: row.owner_display_name, handle: row.owner_handle },
    publicItemCount: row.public_item_count,
    publishedAt: row.published_at.toISOString(),
    coverUrl: row.cover_reference_id === null ? null : `/media/${row.cover_reference_id}`,
  };
}

async function readFeed(context: RequestContext): Promise<HttpResponse> {
  const limit = checkLimit(context.url.searchParams.get('limit'), limits.feedPageSize, limits.feedPageSizeMax);
  const cursorValue = context.url.searchParams.get('cursor');
  const cursor = cursorValue === null ? null : await decodeCursor('feed', 'global', cursorValue);

  const rows = await query<FeedRow>(
    `select c.id, c.title, c.public_description,
            o.display_name as owner_display_name, o.handle as owner_handle,
            ${publicPublishedAtSql} as published_at,
            ${publicItemCountSql} as public_item_count,
            ${coverSql} as cover_reference_id
       from clusters c join accounts o on o.id = c.owner_id
      where ${publicClusterSql}
        and ($1::timestamptz is null
             or (${publicPublishedAtSql}, lower(c.id::text)) < ($1::timestamptz, $2::text))
      order by ${publicPublishedAtSql} desc, lower(c.id::text) desc
      limit $3`,
    [cursor === null ? null : cursor.at, cursor === null ? null : cursor.id, limit + 1],
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last !== undefined
      ? await encodeCursor('feed', 'global', { at: last.published_at.toISOString(), id: last.id.toLowerCase() })
      : null;
  return jsonResponse(200, { items: page.map(toFeedCard), nextCursor });
}

async function readPublicCluster(context: RequestContext): Promise<HttpResponse> {
  const row = await one<ClusterRow>(`${clusterSelect} where c.id = $1 and ${publicClusterSql}`, [
    /^[0-9a-f-]{36}$/.test(context.params.id) ? context.params.id : null,
  ]);
  if (row === null) {
    throw errors.notFound();
  }
  const publishedAt = row.published_at ?? row.lifts_at;
  if (publishedAt === null) {
    throw errors.notFound();
  }
  return jsonResponse(200, toPublicCluster(row, await loadEntries(row.id), publishedAt));
}

async function readCurator(context: RequestContext): Promise<HttpResponse> {
  const handle = context.params.handle;
  const account = await one<{ id: string; display_name: string; handle: string }>(
    'select id, display_name, handle from accounts where handle = $1',
    [handle],
  );
  if (account === null) {
    throw errors.notFound();
  }
  const followers = await one<{ count: number }>(
    'select count(*)::int as count from follows where curator_id = $1',
    [account.id],
  );
  const clusters = await query<{
    id: string;
    title: string;
    published_at: Date;
    public_item_count: number;
    cover_reference_id: string | null;
  }>(
    `select c.id, c.title, ${publicPublishedAtSql} as published_at,
            ${publicItemCountSql} as public_item_count,
            ${coverSql} as cover_reference_id
       from clusters c
      where c.owner_id = $1 and ${publicClusterSql}
      order by ${publicPublishedAtSql} desc, lower(c.id::text) desc`,
    [account.id],
  );
  const profileClusters: CuratorProfileCluster[] = clusters.map((cluster) => ({
    id: cluster.id,
    title: cluster.title,
    publishedAt: cluster.published_at.toISOString(),
    publicItemCount: cluster.public_item_count,
    coverUrl: cluster.cover_reference_id === null ? null : `/media/${cluster.cover_reference_id}`,
  }));
  return jsonResponse(200, {
    displayName: account.display_name,
    handle: account.handle,
    followerCount: followers?.count ?? 0,
    clusters: profileClusters,
  });
}

async function followerCountOf(curatorId: string): Promise<number> {
  const row = await one<{ count: number }>('select count(*)::int as count from follows where curator_id = $1', [
    curatorId,
  ]);
  return row?.count ?? 0;
}

async function followCurator(context: RequestContext): Promise<HttpResponse> {
  const viewer = await requireViewer(context);
  const curator = await one<{ id: string; handle: string }>('select id, handle from accounts where handle = $1', [
    context.params.handle,
  ]);
  if (curator === null) {
    throw errors.notFound();
  }
  if (curator.id === viewer.id) {
    throw errors.validation({ handle: fieldMessages.handleSelf });
  }
  await query('insert into follows (follower_id, curator_id) values ($1, $2) on conflict do nothing', [
    viewer.id,
    curator.id,
  ]);
  return jsonResponse(200, { following: true, followerCount: await followerCountOf(curator.id) });
}

async function unfollowCurator(context: RequestContext): Promise<HttpResponse> {
  const viewer = await requireViewer(context);
  const curator = await one<{ id: string }>('select id from accounts where handle = $1', [context.params.handle]);
  if (curator === null) {
    throw errors.notFound();
  }
  await query('delete from follows where follower_id = $1 and curator_id = $2', [viewer.id, curator.id]);
  return jsonResponse(200, { following: false, followerCount: await followerCountOf(curator.id) });
}

export function registerPublicRoutes(router: Router): void {
  router.get('/api/feed', readFeed);
  router.get('/api/public/clusters/:id', readPublicCluster);
  router.get('/api/curators/:handle', readCurator);
  router.post('/api/curators/:handle/follow', 'none', followCurator);
  router.delete('/api/curators/:handle/follow', unfollowCurator);
}
