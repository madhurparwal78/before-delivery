import { Tx, query, withTransaction } from '../db/pool';
import { shareLinkStatus, ShareLinkStatus } from '../../shared/rules';
import { expiresDisplay, localMinuteInZone } from '../../shared/homeclock';
import { renderBody } from '../../shared/richtext';
import { loadTypes } from './types';
import { COPY } from '../../shared/copy';
import {
  deleteObjectEventually,
  listKeys,
  putObject,
  shareCacheKey,
  shareCachePrefix,
} from '../storage/s3';

export type ShareLinkRow = {
  id: string;
  collection_id: string;
  token: string;
  expires_at_utc: Date;
  time_zone: string;
  created_at: Date;
  revoked_at: Date | null;
};

export const SHARE_LINK_COLUMNS =
  'id, collection_id, token, expires_at_utc, time_zone, created_at, revoked_at';

export function statusOf(link: ShareLinkRow, now: Date = new Date()): ShareLinkStatus {
  return shareLinkStatus({ expiresAtUtc: link.expires_at_utc, revokedAt: link.revoked_at }, now);
}

export function shareLinkJson(link: ShareLinkRow, homeZone: string): Record<string, unknown> {
  return {
    id: link.id,
    collection_id: link.collection_id,
    url: `/s/${link.token}`,
    status: statusOf(link),
    expires_at: localMinuteInZone(link.expires_at_utc, homeZone),
    expires_at_display: expiresDisplay(link.expires_at_utc, homeZone),
    expires_at_utc: link.expires_at_utc.toISOString(),
    time_zone: homeZone,
    created_at: link.created_at.toISOString(),
    revoked_at: link.revoked_at === null ? null : link.revoked_at.toISOString(),
  };
}

export async function loadLinkByToken(tx: Tx, token: string): Promise<ShareLinkRow | null> {
  return tx.one<ShareLinkRow>(`select ${SHARE_LINK_COLUMNS} from share_link where token = $1`, [token]);
}

export async function loadLinkById(tx: Tx, id: string): Promise<ShareLinkRow | null> {
  return tx.one<ShareLinkRow>(`select ${SHARE_LINK_COLUMNS} from share_link where id = $1`, [id]);
}

/** The share scope: the objects of the link's collection whose sharing follows collections. */
export async function scopeObjectIds(tx: Tx, collectionId: string): Promise<string[]> {
  const rows = await tx.query<{ object_id: string }>(
    `select m.object_id
       from collection_member m
       join object_note o on o.id = m.object_id
      where m.collection_id = $1 and o.share_visibility = 'follow'`,
    [collectionId],
  );
  return rows.map((row) => row.object_id);
}

export type ShareObjectPayload = {
  json: Record<string, unknown>;
  markup: string;
};

export async function shareObjectPayload(
  tx: Tx,
  collectionId: string,
  objectId: string,
): Promise<ShareObjectPayload | null> {
  const scope = await scopeObjectIds(tx, collectionId);
  if (!scope.includes(objectId)) return null;
  const object = await tx.one<{ id: string; title: string; type_id: string }>(
    'select id, title, type_id from object_note where id = $1',
    [objectId],
  );
  if (object === null) return null;
  const types = await loadTypes(tx);
  const type = types.find((candidate) => candidate.id === object.type_id);
  const properties: Record<string, unknown> = {};
  if (type !== undefined) {
    const rows = await tx.query<{ field_id: string; value: unknown }>(
      'select field_id, value from property_value where object_id = $1',
      [objectId],
    );
    for (const field of type.fields) {
      const hit = rows.find((row) => row.field_id === field.id);
      const value = hit === undefined ? null : hit.value;
      if (field.kind === 'relation') {
        if (typeof value !== 'string' || !scope.includes(value)) continue;
        const target = await tx.one<{ title: string }>('select title from object_note where id = $1', [value]);
        properties[field.name] = target === null ? null : target.title;
        continue;
      }
      properties[field.name] = value === null ? null : value;
    }
  }
  const blockRows = await tx.query<{
    id: string;
    kind: string;
    body: string | null;
    origin_block_id: string | null;
    attachment_id: string | null;
  }>('select id, kind, body, origin_block_id, attachment_id from block where object_id = $1 order by position asc', [
    objectId,
  ]);
  const blocks: Record<string, unknown>[] = [];
  const markupParts: string[] = [];
  for (const row of blockRows) {
    if (row.kind === 'text') {
      const markup = renderBody(row.body ?? '');
      blocks.push({ kind: 'text', id: row.id, body: markup });
      markupParts.push(`<div class="share-block">${markup}</div>`);
      continue;
    }
    if (row.kind === 'quote' && row.origin_block_id !== null) {
      const origin = await tx.one<{ body: string | null; object_id: string; title: string }>(
        `select b.body, b.object_id, o.title from block b join object_note o on o.id = b.object_id where b.id = $1`,
        [row.origin_block_id],
      );
      if (origin === null || !scope.includes(origin.object_id)) {
        blocks.push({ kind: 'quote', hidden: true });
        markupParts.push(`<div class="share-block share-quote-hidden">${COPY.shareQuoteOutOfScope}</div>`);
        continue;
      }
      const markup = renderBody(origin.body ?? '');
      blocks.push({ kind: 'quote', id: row.id, body: markup, origin_title: origin.title });
      markupParts.push(
        `<figure class="share-block share-quote">${markup}<figcaption>${escapeHtml(origin.title)}</figcaption></figure>`,
      );
      continue;
    }
    if (row.kind === 'attachment' && row.attachment_id !== null) {
      const attachment = await tx.one<{ id: string; filename: string; content_type: string }>(
        'select id, filename, content_type from attachment where id = $1',
        [row.attachment_id],
      );
      if (attachment === null) continue;
      blocks.push({
        kind: 'attachment',
        id: row.id,
        attachment: { id: attachment.id, filename: attachment.filename, content_type: attachment.content_type },
      });
      markupParts.push(`<div class="share-block share-attachment">${escapeHtml(attachment.filename)}</div>`);
      continue;
    }
  }
  const backlinkRows = await tx.query<{ from_object_id: string; from_title: string; kind: string }>(
    `select e.from_object_id, o.title as from_title, e.kind
       from link_edge e join object_note o on o.id = e.from_object_id
      where e.to_object_id = $1 order by e.created_at desc`,
    [objectId],
  );
  const backlinks = backlinkRows.filter((row) => scope.includes(row.from_object_id));
  return {
    json: {
      id: object.id,
      title: object.title,
      type_name: type === undefined ? '' : type.name,
      properties,
      blocks,
      backlinks,
    },
    markup: markupParts.join(''),
  };
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Each served share object page is cached as sanitised markup under the published key. */
export async function writeShareCache(shareLinkId: string, objectId: string, markup: string): Promise<void> {
  try {
    await putObject(shareCacheKey(shareLinkId, objectId), Buffer.from(markup, 'utf8'), 'text/html; charset=utf-8');
  } catch {
    // Share pages are served without writing the cache while the store is unreachable.
  }
}

export async function deleteShareCacheForLink(shareLinkId: string): Promise<void> {
  try {
    const keys = await listKeys(shareCachePrefix(shareLinkId));
    await Promise.all(keys.map((key) => deleteObjectEventually(key)));
  } catch {
    // retried by the caller's next scope change
  }
}

/** Every cached rendering that shows this object, for every link. */
export async function deleteShareCacheForObject(objectId: string): Promise<void> {
  const affected = await withTransaction(async (tx) => {
    const hosts = await tx.query<{ object_id: string }>(
      `select distinct b.object_id
         from block b
         join block origin on origin.id = b.origin_block_id
        where b.kind = 'quote' and origin.object_id = $1`,
      [objectId],
    );
    const links = await tx.query<{ id: string }>('select id from share_link');
    return { objectIds: [objectId, ...hosts.map((row) => row.object_id)], linkIds: links.map((row) => row.id) };
  });
  for (const linkId of affected.linkIds) {
    for (const id of affected.objectIds) {
      try {
        await deleteObjectEventually(shareCacheKey(linkId, id));
      } catch {
        // the delete is retried until the store answers
      }
    }
  }
}
