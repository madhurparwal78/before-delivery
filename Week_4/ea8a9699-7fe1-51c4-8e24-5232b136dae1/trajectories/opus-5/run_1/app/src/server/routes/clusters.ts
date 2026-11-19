import { randomUUID } from 'node:crypto';
import { one, query, transact } from '../db.js';
import { errors } from '../errors.js';
import { liftLocalPattern, resolveLiftLocal } from '../domain/embargo.js';
import { effectiveStatus } from '../domain/lift.js';
import { appendEntry, lockCluster, markPrivacy, moveEntry, removeEntry } from '../domain/order.js';
import { isLegalEdge, isLocked } from '../../shared/status.js';
import { clusterSheet } from '../domain/sheet.js';
import { jsonResponse, type HttpResponse, type RequestContext } from '../http/context.js';
import type { Router } from '../http/router.js';
import { clusterView, loadEntries, toEntry } from '../repository.js';
import { reviewLinkState, type ReviewLinkRow } from '../domain/reviewLinks.js';
import { reviewLinkMessage, sendMail } from '../services/mail.js';
import { config } from '../config.js';
import { FieldErrors, asBoolean, asString, checkCommentBody, checkEmail, checkExpiresAt, checkLongText, checkTitle } from '../validate.js';
import { fieldMessages, liftLocalGapMessage } from '../../shared/fields.js';
import { requireClusterMembership, requireClusterSeat } from './clusterAccess.js';
import type { ClusterStatus, Comment, ReviewLinkCreated } from '../../shared/types.js';

async function readCluster(context: RequestContext): Promise<HttpResponse> {
  const { cluster } = await requireClusterMembership(context, context.params.id);
  return jsonResponse(200, await clusterView(cluster.id, new Date()));
}

async function updateCluster(context: RequestContext): Promise<HttpResponse> {
  const access = requireClusterSeat(await requireClusterMembership(context, context.params.id));
  const body = context.body as Record<string, unknown>;
  const now = new Date();
  const status = effectiveStatus(access.cluster, now);
  if (body.publicDescription !== undefined && isLocked(status)) {
    throw errors.clusterLocked();
  }
  const fields = new FieldErrors();
  const title = body.title === undefined ? null : checkTitle(fields, body.title);
  const publicDescription =
    body.publicDescription === undefined ? null : checkLongText(fields, body.publicDescription, 'publicDescription');
  const internalNote =
    body.internalNote === undefined ? null : checkLongText(fields, body.internalNote, 'internalNote');
  fields.throwIfAny();

  await query(
    `update clusters
        set title = coalesce($2, title),
            public_description = coalesce($3, public_description),
            internal_note = coalesce($4, internal_note),
            updated_at = now()
      where id = $1`,
    [access.cluster.id, title, publicDescription, internalNote],
  );
  return jsonResponse(200, await clusterView(access.cluster.id, new Date()));
}

async function addEntry(context: RequestContext): Promise<HttpResponse> {
  const access = requireClusterSeat(await requireClusterMembership(context, context.params.id));
  const now = new Date();
  if (isLocked(effectiveStatus(access.cluster, now))) {
    throw errors.clusterLocked();
  }
  const body = context.body as Record<string, unknown>;
  const referenceId = asString(body.referenceId) ?? '';
  const reference = await one<{ id: string }>('select id from refs where id = $1 and workspace_id = $2', [
    /^[0-9a-f-]{36}$/.test(referenceId) ? referenceId : null,
    access.workspace.id,
  ]);
  if (reference === null) {
    throw errors.notFound();
  }
  const isPrivate = asBoolean(body.isPrivate, false);
  const result = await transact((client) =>
    appendEntry(client, access.cluster.id, reference.id, isPrivate, access.viewer.id),
  );
  return jsonResponse(201, {
    entry: { id: result.entryId, position: result.position, isPrivate },
    itemCount: result.itemCount,
    version: result.version,
  });
}

async function updateEntryPrivacy(context: RequestContext): Promise<HttpResponse> {
  const access = requireClusterSeat(await requireClusterMembership(context, context.params.id));
  if (isLocked(effectiveStatus(access.cluster, new Date()))) {
    throw errors.clusterLocked();
  }
  const isPrivate = asBoolean((context.body as Record<string, unknown>).isPrivate, false);
  const result = await transact((client) =>
    markPrivacy(client, access.cluster.id, context.params.entryId, isPrivate),
  );
  return jsonResponse(200, {
    entry: { id: context.params.entryId, position: result.position, isPrivate },
    itemCount: result.itemCount,
    version: result.version,
  });
}

async function deleteEntry(context: RequestContext): Promise<HttpResponse> {
  const access = requireClusterSeat(await requireClusterMembership(context, context.params.id));
  if (isLocked(effectiveStatus(access.cluster, new Date()))) {
    throw errors.clusterLocked();
  }
  const result = await transact((client) => removeEntry(client, access.cluster.id, context.params.entryId));
  return jsonResponse(200, { itemCount: result.itemCount, version: result.version });
}

async function moveClusterEntry(context: RequestContext): Promise<HttpResponse> {
  const access = requireClusterSeat(await requireClusterMembership(context, context.params.id));
  if (isLocked(effectiveStatus(access.cluster, new Date()))) {
    throw errors.clusterLocked();
  }
  const body = context.body as Record<string, unknown>;
  const result = await transact((client) =>
    moveEntry(client, access.cluster.id, context.params.entryId, body.toPosition, body.version),
  );
  return jsonResponse(200, result);
}

async function deactivateReviewLinks(clusterId: string): Promise<void> {
  await query('update review_links set inactive_at = now() where cluster_id = $1 and inactive_at is null', [
    clusterId,
  ]);
}

async function changeStatus(context: RequestContext): Promise<HttpResponse> {
  const access = await requireClusterMembership(context, context.params.id);
  const body = context.body as Record<string, unknown>;
  const requested = (asString(body.status) ?? '') as ClusterStatus;
  if (requested === 'withdrawn' && !access.isOpsLead && access.viewer.id !== access.cluster.owner_id) {
    throw errors.forbidden();
  }
  requireClusterSeat(access);

  await transact(async (client) => {
    await lockCluster(client, access.cluster.id);
    const fresh = await client.query<{
      status: ClusterStatus;
      lifts_at: Date | null;
      published_at: Date | null;
    }>('select status, lifts_at, published_at from clusters where id = $1', [access.cluster.id]);
    const now = new Date();
    const from = effectiveStatus(fresh.rows[0], now);
    if (!isLegalEdge(from, requested)) {
      throw errors.illegalTransition(from, requested);
    }

    if (requested === 'embargoed') {
      const liftLocal = asString(body.liftLocal) ?? '';
      if (!liftLocalPattern.test(liftLocal)) {
        throw errors.validation({ liftLocal: fieldMessages.liftLocalShape });
      }
      const resolved = resolveLiftLocal(liftLocal, access.workspace.time_zone);
      if (resolved.outcome === 'gap') {
        throw errors.validation({ liftLocal: liftLocalGapMessage(access.workspace.time_zone) });
      }
      const liftsAt = resolved.liftsAt;
      if (liftsAt.getTime() <= now.getTime()) {
        throw errors.validation({ liftLocal: fieldMessages.liftLocalFuture });
      }
      await deactivateReviewLinks(access.cluster.id);
      await client.query(
        "update clusters set status = 'embargoed', lift_local = $2, lifts_at = $3, updated_at = now() where id = $1",
        [access.cluster.id, liftLocal, liftsAt],
      );
      return;
    }

    if (requested === 'in_review') {
      await client.query(
        `update clusters set status = 'in_review', lift_local = null, lifts_at = null, updated_at = now()
          where id = $1`,
        [access.cluster.id],
      );
      return;
    }

    if (requested === 'draft') {
      await deactivateReviewLinks(access.cluster.id);
      await client.query(
        `update clusters set status = 'draft', lift_local = null, lifts_at = null, updated_at = now()
          where id = $1`,
        [access.cluster.id],
      );
      return;
    }

    await client.query(
      `update clusters
          set status = 'withdrawn', published_at = coalesce(published_at, lifts_at), updated_at = now()
        where id = $1`,
      [access.cluster.id],
    );
  });

  return jsonResponse(200, await clusterView(access.cluster.id, new Date()));
}

function toComment(row: { id: string; author_name: string; body: string; created_at: Date }): Comment {
  return {
    id: row.id,
    authorName: row.author_name,
    body: row.body,
    createdAt: row.created_at.toISOString(),
  };
}

async function readComments(context: RequestContext): Promise<HttpResponse> {
  const { cluster } = await requireClusterMembership(context, context.params.id);
  const rows = await query<{ id: string; author_name: string; body: string; created_at: Date }>(
    'select id, author_name, body, created_at from comments where cluster_id = $1 order by created_at, id',
    [cluster.id],
  );
  return jsonResponse(200, { comments: rows.map(toComment) });
}

async function postComment(context: RequestContext): Promise<HttpResponse> {
  const access = requireClusterSeat(await requireClusterMembership(context, context.params.id));
  const fields = new FieldErrors();
  const body = checkCommentBody(fields, (context.body as Record<string, unknown>).body);
  fields.throwIfAny();
  const id = randomUUID();
  await query(
    `insert into comments (id, cluster_id, author_name, author_account_id, body)
          values ($1, $2, $3, $4, $5)`,
    [id, access.cluster.id, access.viewer.display_name, access.viewer.id, body],
  );
  const row = await one<{ id: string; author_name: string; body: string; created_at: Date }>(
    'select id, author_name, body, created_at from comments where id = $1',
    [id],
  );
  if (row === null) {
    throw errors.notFound();
  }
  return jsonResponse(201, toComment(row));
}

async function exportSheet(context: RequestContext): Promise<HttpResponse> {
  const { cluster } = await requireClusterMembership(context, context.params.id);
  const entries = (await loadEntries(cluster.id)).map(toEntry);
  return {
    status: 200,
    body: clusterSheet(entries),
    contentType: 'text/csv; charset=utf-8',
    headers: { 'Content-Disposition': `attachment; filename="cluster-${cluster.id}.csv"` },
  };
}

async function readReviewLinks(context: RequestContext): Promise<HttpResponse> {
  const { cluster } = await requireClusterMembership(context, context.params.id);
  const rows = await query<ReviewLinkRow>(
    'select * from review_links where cluster_id = $1 order by created_at, id',
    [cluster.id],
  );
  const now = new Date();
  return jsonResponse(200, {
    links: rows.map((row) => ({
      id: row.id,
      email: row.email,
      expiresAt: row.expires_at.toISOString(),
      canComment: row.can_comment,
      state: reviewLinkState(row, now),
    })),
  });
}

async function createReviewLink(context: RequestContext): Promise<HttpResponse> {
  const access = requireClusterSeat(await requireClusterMembership(context, context.params.id));
  const now = new Date();
  if (effectiveStatus(access.cluster, now) !== 'in_review') {
    throw errors.clusterNotInReview();
  }
  const body = context.body as Record<string, unknown>;
  const fields = new FieldErrors();
  const email = checkEmail(fields, body.email);
  const expiresAt = checkExpiresAt(fields, body.expiresAt, now);
  const canComment = asBoolean(body.canComment, false);
  fields.throwIfAny();
  if (expiresAt === null) {
    throw errors.validation({ expiresAt: fieldMessages.expiresAtFuture });
  }

  const id = randomUUID();
  const token = randomUUID().replace(/-/g, '');
  await sendMail(
    reviewLinkMessage({
      to: email,
      clusterTitle: access.cluster.title,
      workspaceName: access.workspace.name,
      url: `${config.publicUrl}/review/${token}`,
      expiresAt,
    }),
  );
  await query(
    `insert into review_links (id, cluster_id, email, token, expires_at, can_comment)
          values ($1, $2, $3, $4, $5, $6)`,
    [id, access.cluster.id, email, token, expiresAt, canComment],
  );
  const created: ReviewLinkCreated = {
    id,
    email,
    url: `${config.publicUrl}/review/${token}`,
    expiresAt: expiresAt.toISOString(),
    canComment,
  };
  return jsonResponse(201, created);
}

export function registerClusterRoutes(router: Router): void {
  router.get('/api/clusters/:id', readCluster);
  router.patch('/api/clusters/:id', updateCluster);
  router.post('/api/clusters/:id/entries', 'json', addEntry);
  router.patch('/api/clusters/:id/entries/:entryId', updateEntryPrivacy);
  router.delete('/api/clusters/:id/entries/:entryId', deleteEntry);
  router.post('/api/clusters/:id/entries/:entryId/move', 'json', moveClusterEntry);
  router.post('/api/clusters/:id/status', 'json', changeStatus);
  router.get('/api/clusters/:id/comments', readComments);
  router.post('/api/clusters/:id/comments', 'json', postComment);
  router.get('/api/clusters/:id/export.csv', exportSheet);
  router.get('/api/clusters/:id/review-links', readReviewLinks);
  router.post('/api/clusters/:id/review-links', 'json', createReviewLink);
}
