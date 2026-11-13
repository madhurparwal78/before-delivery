import type { Queryable } from '../db/pool.js';
import { appendAuditEntry } from './audit.js';
import {
  loadContentBySlug,
  publishContentRow,
  withdrawContentRow,
  type ContentRow,
} from './content.js';

export const SCHEDULER_ACTOR = 'system:scheduler';

/**
 * Publishes an item and its linked announcement on every surface at once. The caller has
 * already raised the item's own version, which is how the write is made conditional.
 */
export async function releaseContentItem(
  tx: Queryable,
  row: ContentRow,
  publishedAt: Date,
  actor: string,
): Promise<void> {
  await publishContentRow(tx, row, publishedAt);
  await appendAuditEntry(tx, {
    actor,
    action: 'content.release',
    targetType: 'content',
    targetId: row.id,
    detail: {
      kind: row.kind,
      slug: row.slug,
      scheduled_by: row.scheduled_by ?? '',
      published_at: publishedAt.toISOString(),
    },
  });

  if (row.kind !== 'model' || row.linked_news_slug === null) return;
  const linked = await loadContentBySlug(tx, 'news', row.linked_news_slug);
  if (linked === undefined || linked.status !== 'scheduled') return;
  await publishContentRow(tx, linked, publishedAt);
  await tx.query('UPDATE content_items SET version = version + 1 WHERE id = $1', [linked.id]);
  await appendAuditEntry(tx, {
    actor,
    action: 'content.release',
    targetType: 'content',
    targetId: linked.id,
    detail: {
      kind: linked.kind,
      slug: linked.slug,
      scheduled_by: row.scheduled_by ?? '',
      linked_model: row.slug,
      published_at: publishedAt.toISOString(),
    },
  });
}

/**
 * Withdraws an item, and its linked announcement when the item is a model route. The caller
 * has already raised the item's own version.
 */
export async function withdrawContentItem(
  tx: Queryable,
  row: ContentRow,
  actor: string,
): Promise<void> {
  const at = new Date();
  await withdrawContentRow(tx, row, at);
  await appendAuditEntry(tx, {
    actor,
    action: 'content.withdraw',
    targetType: 'content',
    targetId: row.id,
    detail: { kind: row.kind, slug: row.slug, from: row.status },
  });

  if (row.kind !== 'model' || row.linked_news_slug === null) return;
  const linked = await loadContentBySlug(tx, 'news', row.linked_news_slug);
  if (linked === undefined) return;
  if (linked.status !== 'scheduled' && linked.status !== 'published') return;
  await withdrawContentRow(tx, linked, at);
  await tx.query('UPDATE content_items SET version = version + 1 WHERE id = $1', [linked.id]);
  await appendAuditEntry(tx, {
    actor,
    action: 'content.withdraw',
    targetType: 'content',
    targetId: linked.id,
    detail: { kind: linked.kind, slug: linked.slug, from: linked.status, linked_model: row.slug },
  });
}
