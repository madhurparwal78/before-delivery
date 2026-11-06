import type { Page, PlinthDocument, PublishState } from '../shared/types.js';
import { config } from './config.js';
import { one, query } from './db.js';
import { ApiError } from './errors.js';
import { newId } from './ids.js';
import { renderPublishedPage } from './published.js';
import {
  getObject,
  imageKey,
  putObject,
  snapshotAssetKey,
  snapshotKey,
  storageUnavailable,
} from './storage.js';

export interface PublishStatus {
  state: PublishState;
  publishId: string | null;
  publishedSeq: number | null;
  url: string | null;
}

const running = new Set<string>();

export function liveUrl(workspaceSlug: string, pageSlug: string): string {
  return `${config.publicUrl}/p/${workspaceSlug}/${pageSlug}`;
}

export async function publishStatus(
  doc: PlinthDocument,
  page: Page,
): Promise<PublishStatus> {
  const row = await one<{ state: PublishState; publish_id: string | null; published_seq: string | null }>(
    'select state, publish_id, published_seq from page_publish where page_id = $1',
    [page.id],
  );
  if (!row) return { state: 'not_published', publishId: null, publishedSeq: null, url: null };
  const live = row.state === 'live' || row.state === 'live_changed';
  return {
    state: row.state,
    publishId: row.publish_id,
    publishedSeq: row.published_seq === null ? null : Number(row.published_seq),
    url: live ? liveUrl(doc.slug, page.slug) : null,
  };
}

export async function publishPage(
  doc: PlinthDocument,
  page: Page,
  idempotencyKey: string | undefined,
): Promise<PublishStatus> {
  if (idempotencyKey !== undefined) {
    const stored = await one<{ page_id: string; status: string; response: PublishStatus | null }>(
      'select page_id, status, response from idempotency where key = $1',
      [idempotencyKey],
    );
    if (stored) {
      if (stored.page_id !== page.id) {
        throw new ApiError(422, 'idempotency_key_reused', 'That idempotency key is in use.', {
          'Idempotency-Key': 'That key already published another page.',
        });
      }
      if (stored.status === 'running') {
        throw new ApiError(409, 'publish_in_progress', 'That page is being published.');
      }
      if (stored.response) return stored.response;
    }
  }
  if (running.has(page.id)) {
    throw new ApiError(409, 'publish_in_progress', 'That page is being published.');
  }
  running.add(page.id);
  if (idempotencyKey !== undefined) {
    await query(
      `insert into idempotency (key, page_id, status) values ($1, $2, 'running')
       on conflict (key) do nothing`,
      [idempotencyKey, page.id],
    );
  }
  try {
    const publishId = newId('pub');
    const assetBase = `/p/${doc.slug}/${page.slug}/assets`;
    const rendered = renderPublishedPage(doc, page, assetBase);
    for (const imageId of rendered.imageIds) {
      const source = await getObject(doc.id, imageKey(doc.id, imageId));
      await putObject(
        doc.id,
        snapshotAssetKey(page.id, publishId, imageId),
        source.body,
        source.contentType,
      );
    }
    const key = snapshotKey(page.id, publishId);
    const body = Buffer.from(rendered.html, 'utf8');
    await putObject(doc.id, key, body, 'text/html; charset=utf-8');
    const readBack = await getObject(doc.id, key);
    if (!readBack.body.equals(body)) throw storageUnavailable();
    await query(
      `insert into publishes (id, workspace_id, page_id, snapshot_key, published_seq)
       values ($1, $2, $3, $4, $5)`,
      [publishId, doc.id, page.id, key, doc.seq],
    );
    await query(
      `insert into page_publish (page_id, workspace_id, state, publish_id, published_seq)
       values ($1, $2, 'live', $3, $4)
       on conflict (page_id) do update set state = 'live', publish_id = $3, published_seq = $4`,
      [page.id, doc.id, publishId, doc.seq],
    );
    const status: PublishStatus = {
      state: 'live',
      publishId,
      publishedSeq: doc.seq,
      url: liveUrl(doc.slug, page.slug),
    };
    if (idempotencyKey !== undefined) {
      await query(
        `update idempotency set status = 'done', response = $2 where key = $1`,
        [idempotencyKey, JSON.stringify(status)],
      );
    }
    return status;
  } catch (error) {
    if (idempotencyKey !== undefined) {
      await query('delete from idempotency where key = $1', [idempotencyKey]);
    }
    throw error;
  } finally {
    running.delete(page.id);
  }
}

export async function unpublishPage(doc: PlinthDocument, page: Page): Promise<PublishStatus> {
  const status = await publishStatus(doc, page);
  if (status.state !== 'live' && status.state !== 'live_changed') {
    throw new ApiError(409, 'not_live', 'That page is not live.');
  }
  await query(`update page_publish set state = 'unpublished' where page_id = $1`, [page.id]);
  return { state: 'unpublished', publishId: status.publishId, publishedSeq: status.publishedSeq, url: null };
}

export interface LiveSnapshot {
  workspaceId: string;
  pageId: string;
  publishId: string;
  snapshotKey: string;
}

export async function liveSnapshotOf(
  workspaceId: string,
  pageId: string,
): Promise<LiveSnapshot | undefined> {
  const row = await one<{ state: string; publish_id: string | null }>(
    'select state, publish_id from page_publish where page_id = $1 and workspace_id = $2',
    [pageId, workspaceId],
  );
  if (!row || row.publish_id === null) return undefined;
  if (row.state !== 'live' && row.state !== 'live_changed') return undefined;
  return {
    workspaceId,
    pageId,
    publishId: row.publish_id,
    snapshotKey: snapshotKey(pageId, row.publish_id),
  };
}
