import { randomUUID } from 'node:crypto';
import { requireMembership, requireSeat } from '../auth.js';
import { one, query, transact } from '../db.js';
import { decodeCursor, encodeCursor } from '../cursors.js';
import { errors } from '../errors.js';
import { effectiveStatus } from '../domain/lift.js';
import { isLocked } from '../../shared/status.js';
import { mediaExtensions, removeMetadata } from '../domain/media.js';
import { appendEntry, removeReferenceEntries } from '../domain/order.js';
import { formatTimecode, totalFramesFor } from '../../shared/timecode.js';
import { jsonResponse, noContent, type HttpResponse, type RequestContext } from '../http/context.js';
import type { Router } from '../http/router.js';
import { deleteObject, putObject } from '../services/storage.js';
import { clusterView, refSelect, toReference, type ClusterRow, type RefRow } from '../repository.js';
import { FieldErrors, asString, checkLimit, checkQuery, checkTitle } from '../validate.js';
import { fieldMessages, frameIndexMessage } from '../../shared/fields.js';
import { limits } from '../../shared/limits.js';
import type { ClusterSummary, Reference } from '../../shared/types.js';

const frameRates = [24, 25, 30];

interface ClusterSummaryRow {
  id: string;
  title: string;
  status: ClusterRow['status'];
  lifts_at: Date | null;
  published_at: Date | null;
  item_count: number;
  total: number;
}

const clusterSummarySql = `select c.id, c.title, c.status, c.lifts_at, c.published_at,
                                  (select count(*)::int from cluster_entries e where e.cluster_id = c.id) as item_count,
                                  count(*) over ()::int as total
                             from clusters c
                            where c.workspace_id = $1
                              and ($2::text is null or position(lower($2) in lower(c.title)) > 0)
                            order by c.updated_at desc
                            limit $3`;

function toClusterSummary(row: ClusterSummaryRow, now: Date): ClusterSummary {
  return {
    id: row.id,
    title: row.title,
    status: effectiveStatus(row, now),
    itemCount: row.item_count,
  };
}

async function listReferences(context: RequestContext): Promise<HttpResponse> {
  const { workspace } = await requireMembership(context, context.params.ws);
  const limit = checkLimit(context.url.searchParams.get('limit'), limits.referencePageSize, limits.referencePageSizeMax);
  const cursorValue = context.url.searchParams.get('cursor');
  const cursor = cursorValue === null ? null : await decodeCursor('references', workspace.id, cursorValue);

  const rows = await query<RefRow>(
    `${refSelect}
      where r.workspace_id = $1
        and ($2::timestamptz is null or (r.created_at, r.id) < ($2::timestamptz, $3::uuid))
      order by r.created_at desc, r.id desc
      limit $4`,
    [workspace.id, cursor === null ? null : cursor.at, cursor === null ? null : cursor.id, limit + 1],
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last !== undefined
      ? await encodeCursor('references', workspace.id, { at: last.created_at.toISOString(), id: last.id })
      : null;
  return jsonResponse(200, { items: page.map(toReference), nextCursor });
}

function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, '');
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

async function uploadReference(context: RequestContext): Promise<HttpResponse> {
  const access = await requireSeat(await requireMembership(context, context.params.ws));
  const { workspace, viewer } = access;
  const part = context.multipart?.files.get('file');
  const uploadType = context.uploadType;
  if (part === undefined || uploadType === null) {
    throw errors.validation({ file: fieldMessages.file });
  }
  const isClip = uploadType === 'video/mp4' || uploadType === 'video/webm';
  const fields = new FieldErrors();
  const providedTitle = context.multipart?.fields.get('title');
  const title = checkTitle(
    fields,
    providedTitle === undefined || (providedTitle === '' && !isClip) ? titleFromFileName(part.fileName) : providedTitle,
  );

  let frameRate: number | null = null;
  let durationMs: number | null = null;
  if (isClip) {
    const rate = Number(context.multipart?.fields.get('frameRate') ?? '');
    if (!frameRates.includes(rate)) {
      fields.add('frameRate', fieldMessages.frameRate);
    } else {
      frameRate = rate;
    }
    const duration = Number(context.multipart?.fields.get('durationMs') ?? '');
    if (!Number.isInteger(duration) || duration < 1 || duration > 3_600_000) {
      fields.add('durationMs', fieldMessages.durationMs);
    } else {
      durationMs = duration;
    }
  }
  fields.throwIfAny();

  const id = randomUUID();
  const key = `references/${workspace.slug}/${id}.${mediaExtensions[uploadType]}`;
  await putObject(key, removeMetadata(part.content, uploadType), uploadType);

  const totalFrames = frameRate !== null && durationMs !== null ? totalFramesFor(durationMs, frameRate) : null;
  await query(
    `insert into refs (id, workspace_id, kind, title, object_key, content_type, created_by,
                       frame_rate, duration_ms, total_frames)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, workspace.id, isClip ? 'clip' : 'image', title, key, uploadType, viewer.id, frameRate, durationMs, totalFrames],
  );
  const row = await one<RefRow>(`${refSelect} where r.id = $1`, [id]);
  if (row === null) {
    throw errors.notFound();
  }
  return jsonResponse(201, toReference(row));
}

async function deleteReference(context: RequestContext): Promise<HttpResponse> {
  const access = await requireSeat(await requireMembership(context, context.params.ws));
  const row = await one<RefRow>(`${refSelect} where r.id = $1 and r.workspace_id = $2`, [
    context.params.id,
    access.workspace.id,
  ]);
  if (row === null) {
    throw errors.notFound();
  }
  const now = new Date();
  const holders = await query<{ status: ClusterRow['status']; lifts_at: Date | null; published_at: Date | null }>(
    `select c.status, c.lifts_at, c.published_at
       from cluster_entries e join clusters c on c.id = e.cluster_id
      where e.reference_id = $1`,
    [row.id],
  );
  if (holders.some((holder) => isLocked(effectiveStatus(holder, now)))) {
    throw errors.clusterLocked();
  }
  await deleteObject(row.object_key);
  await transact(async (client) => {
    await removeReferenceEntries(client, row.id);
    await client.query('delete from refs where id = $1', [row.id]);
  });
  return noContent();
}

async function pluckStill(context: RequestContext): Promise<HttpResponse> {
  const access = await requireSeat(await requireMembership(context, context.params.ws));
  const { workspace, viewer } = access;
  const clip = await one<RefRow>(`${refSelect} where r.id = $1 and r.workspace_id = $2 and r.kind = 'clip'`, [
    /^[0-9a-f-]{36}$/.test(context.params.clipId) ? context.params.clipId : null,
    workspace.id,
  ]);
  if (clip === null || clip.frame_rate === null || clip.total_frames === null) {
    throw errors.notFound();
  }
  const clusterId = context.multipart?.fields.get('clusterId') ?? '';
  const cluster = await one<ClusterRow>(
    `select c.*, w.slug from clusters c join workspaces w on w.id = c.workspace_id
      where c.id = $1 and c.workspace_id = $2`,
    [/^[0-9a-f-]{36}$/.test(clusterId) ? clusterId : null, workspace.id],
  );
  if (cluster === null) {
    throw errors.notFound();
  }
  const now = new Date();
  if (isLocked(effectiveStatus(cluster, now))) {
    throw errors.clusterLocked();
  }
  const part = context.multipart?.files.get('still');
  if (part === undefined || context.uploadType !== 'image/png') {
    throw errors.validation({ file: fieldMessages.file });
  }
  const frameIndex = Number(context.multipart?.fields.get('frameIndex') ?? '');
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex > clip.total_frames - 1) {
    throw errors.validation({ frameIndex: frameIndexMessage(clip.total_frames - 1) });
  }

  const timecode = formatTimecode(frameIndex, clip.frame_rate);
  const id = randomUUID();
  const key = `references/${workspace.slug}/${id}.png`;
  await putObject(key, removeMetadata(part.content, 'image/png'), 'image/png', {
    'source-clip': clip.id,
    timecode,
  });

  const result = await transact(async (client) => {
    await client.query(
      `insert into refs (id, workspace_id, kind, title, object_key, content_type, created_by,
                         source_clip_id, source_clip_title, frame_index, timecode)
            values ($1, $2, 'still', $3, $4, 'image/png', $5, $6, $7, $8, $9)`,
      [id, workspace.id, `${clip.title} @ ${timecode}`, key, viewer.id, clip.id, clip.title, frameIndex, timecode],
    );
    return appendEntry(client, cluster.id, id, false, viewer.id);
  });

  const row = await one<RefRow>(`${refSelect} where r.id = $1`, [id]);
  if (row === null) {
    throw errors.notFound();
  }
  return jsonResponse(201, {
    reference: toReference(row),
    entry: { id: result.entryId, position: result.position, isPrivate: false },
    cluster: { id: cluster.id, itemCount: result.itemCount, version: result.version },
  });
}

async function searchWorkspace(context: RequestContext): Promise<HttpResponse> {
  const { workspace } = await requireMembership(context, context.params.ws);
  const fields = new FieldErrors();
  const text = checkQuery(fields, context.url.searchParams.get('q'));
  fields.throwIfAny();

  const clusterRows = await query<ClusterSummaryRow>(clusterSummarySql, [workspace.id, text, limits.searchListSize]);
  const referenceRows = await query<RefRow & { total: number }>(
    `select count(*) over ()::int as total, r.*, a.display_name as creator_display_name, a.handle as creator_handle
       from refs r join accounts a on a.id = r.created_by
      where r.workspace_id = $1
        and (position(lower($2) in lower(r.title)) > 0
             or (r.kind = 'still' and position(lower($2) in lower(coalesce(r.source_clip_title, ''))) > 0))
      order by r.created_at desc, r.id desc
      limit $3`,
    [workspace.id, text, limits.searchListSize],
  );

  const now = new Date();
  const clusters: ClusterSummary[] = clusterRows.map((row) => toClusterSummary(row, now));
  const references: Reference[] = referenceRows.map(toReference);
  return jsonResponse(200, {
    query: text,
    counts: {
      clusters: clusterRows[0]?.total ?? 0,
      references: referenceRows[0]?.total ?? 0,
    },
    clusters,
    references,
  });
}

async function listClusters(context: RequestContext): Promise<HttpResponse> {
  const { workspace } = await requireMembership(context, context.params.ws);
  const rawQuery = context.url.searchParams.get('q');
  if (rawQuery !== null) {
    const fields = new FieldErrors();
    checkQuery(fields, rawQuery);
    fields.throwIfAny();
  }
  const rows = await query<ClusterSummaryRow>(clusterSummarySql, [workspace.id, rawQuery, limits.searchListSize]);
  const now = new Date();
  return jsonResponse(200, {
    total: rows[0]?.total ?? 0,
    clusters: rows.map((row) => toClusterSummary(row, now)),
  });
}

async function createCluster(context: RequestContext): Promise<HttpResponse> {
  const access = await requireSeat(await requireMembership(context, context.params.ws));
  const body = context.body as Record<string, unknown>;
  const fields = new FieldErrors();
  const title = checkTitle(fields, body.title);
  const publicDescription = asString(body.publicDescription) ?? '';
  const internalNote = asString(body.internalNote) ?? '';
  if (Array.from(publicDescription).length > 2000) {
    fields.add('publicDescription', fieldMessages.longText);
  }
  if (Array.from(internalNote).length > 2000) {
    fields.add('internalNote', fieldMessages.longText);
  }
  fields.throwIfAny();

  const id = randomUUID();
  await query(
    `insert into clusters (id, workspace_id, title, public_description, internal_note, status, owner_id)
          values ($1, $2, $3, $4, $5, 'draft', $6)`,
    [id, access.workspace.id, title, publicDescription, internalNote, access.viewer.id],
  );
  return jsonResponse(201, await clusterView(id, new Date()));
}

export function registerReferenceRoutes(router: Router): void {
  router.get('/api/workspaces/:ws/references', listReferences);
  router.post('/api/workspaces/:ws/references', 'multipart', uploadReference);
  router.delete('/api/workspaces/:ws/references/:id', deleteReference);
  router.post('/api/workspaces/:ws/clips/:clipId/stills', 'multipart', pluckStill);
  router.get('/api/workspaces/:ws/search', searchWorkspace);
  router.get('/api/workspaces/:ws/clusters', listClusters);
  router.post('/api/workspaces/:ws/clusters', 'json', createCluster);
}
