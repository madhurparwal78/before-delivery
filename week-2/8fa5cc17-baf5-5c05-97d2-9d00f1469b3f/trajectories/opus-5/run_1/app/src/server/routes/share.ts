import { Reply, RequestContext, Route, errorReply, isUuid, json, route, statusOnly } from '../http/core';
import { withTransaction } from '../db/pool';
import { loadSettings } from '../domain/commit';
import {
  loadLinkByToken,
  scopeObjectIds,
  shareObjectPayload,
  statusOf,
  writeShareCache,
} from '../domain/share';
import { expiresDisplay } from '../../shared/homeclock';
import { getObject, StorageUnavailable } from '../storage/s3';
import { isImageType } from '../../shared/rules';

export const SHARE_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

async function requireLink(token: string): Promise<{
  id: string;
  collectionId: string;
  status: 'active' | 'expired' | 'revoked';
  expiresDisplay: string;
}> {
  const settings = await loadSettings();
  const link = await withTransaction((tx) => loadLinkByToken(tx, token));
  if (link === null) throw statusOnly(404, 'unknown');
  return {
    id: link.id,
    collectionId: link.collection_id,
    status: statusOf(link),
    expiresDisplay: expiresDisplay(link.expires_at_utc, settings.homeTimeZone),
  };
}

export const shareRoutes: Route[] = [
  route('GET', '/s/:token/api/status', async (context: RequestContext): Promise<Reply> => {
    const link = await requireLink(context.params['token']);
    return json({ status: link.status, expires_at_display: link.expiresDisplay }, 200, SHARE_HEADERS);
  }),

  route('GET', '/s/:token/api/collection', async (context: RequestContext): Promise<Reply> => {
    const link = await requireLink(context.params['token']);
    if (link.status !== 'active') throw statusOnly(410, link.status);
    const payload = await withTransaction(async (tx) => {
      const collection = await tx.one<{ name: string }>('select name from collection where id = $1', [
        link.collectionId,
      ]);
      const scope = await scopeObjectIds(tx, link.collectionId);
      const objects =
        scope.length === 0
          ? []
          : await tx.query<{ id: string; title: string; type_name: string }>(
              `select o.id, o.title, t.name as type_name
                 from object_note o join object_type t on t.id = o.type_id
                where o.id = any($1::uuid[]) order by lower(o.title) asc`,
              [scope],
            );
      return { name: collection === null ? '' : collection.name, objects };
    });
    return json(
      {
        status: 'active',
        collection: { name: payload.name },
        expires_at_display: link.expiresDisplay,
        objects: payload.objects,
      },
      200,
      SHARE_HEADERS,
    );
  }),

  route('GET', '/s/:token/api/objects/:objectId', async (context: RequestContext): Promise<Reply> => {
    const link = await requireLink(context.params['token']);
    if (link.status !== 'active') throw statusOnly(410, link.status);
    const objectId = context.params['objectId'];
    if (!isUuid(objectId)) throw errorReply(404, 'not_in_share');
    const payload = await withTransaction((tx) => shareObjectPayload(tx, link.collectionId, objectId));
    if (payload === null) throw errorReply(404, 'not_in_share');
    await writeShareCache(link.id, objectId, payload.markup);
    return json(payload.json, 200, SHARE_HEADERS);
  }),

  route('GET', '/s/:token/api/attachments/:attachmentId', async (context: RequestContext): Promise<Reply> => {
    const link = await requireLink(context.params['token']);
    if (link.status !== 'active') throw statusOnly(410, link.status);
    const attachmentId = context.params['attachmentId'];
    const attachment = await withTransaction(async (tx) => {
      if (!isUuid(attachmentId)) return null;
      const row = await tx.one<{ object_id: string; content_type: string; storage_key: string }>(
        'select object_id, content_type, storage_key from attachment where id = $1',
        [attachmentId],
      );
      if (row === null) return null;
      const scope = await scopeObjectIds(tx, link.collectionId);
      return scope.includes(row.object_id) ? row : null;
    });
    if (attachment === null) throw errorReply(404, 'not_in_share');
    try {
      const stored = await getObject(attachment.storage_key);
      if (stored === null) throw errorReply(404, 'not_in_share');
      return {
        status: 200,
        raw: stored.bytes,
        contentType: attachment.content_type,
        headers: {
          ...SHARE_HEADERS,
          'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': isImageType(attachment.content_type) ? 'inline' : 'attachment',
        },
      };
    } catch (error) {
      if (error instanceof StorageUnavailable) throw errorReply(503, 'storage_unavailable');
      throw error;
    }
  }),
];
