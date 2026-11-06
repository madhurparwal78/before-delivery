import { randomBytes, randomUUID } from 'node:crypto';
import {
  Reply,
  RequestContext,
  Route,
  errorReply,
  isUuid,
  json,
  noContent,
  notFound,
  route,
  validationError,
} from '../http/core';
import { Tx, withTransaction } from '../db/pool';
import { commitWithEvents, loadSettings } from '../domain/commit';
import { LiveEvent } from '../events';
import { loadTypes } from '../domain/types';
import { ObjectRow, objectJson } from '../domain/objects';
import { BOARD_MAX_POSITIONS, defaultCardPosition, isBoardCoordinate } from '../../shared/board';
import { SHARE_LINK_MAX_DAYS, localMinuteToInstant, localMinuteInZone } from '../../shared/homeclock';
import {
  SHARE_LINK_COLUMNS,
  ShareLinkRow,
  deleteShareCacheForLink,
  deleteShareCacheForObject,
  loadLinkById,
  shareLinkJson,
  statusOf,
} from '../domain/share';

const COLLECTION_MESSAGES = {
  name: 'Give the collection a name.',
  nameTaken: 'A collection with this name already exists.',
  objectMissing: 'That note no longer exists.',
  positions: 'Send 1 to 200 positions.',
  coordinate: 'Use a multiple of 8 between -8000 and 8000.',
  notInCollection: 'That note is not in this collection.',
  expiresFormat: 'Use a date and time.',
  expiresPast: 'Choose a time after the current minute.',
  expiresTooFar: 'Links can last at most 90 days.',
  expiresGap: 'That time does not exist in your home clock.',
} as const;

async function requireCollection(tx: Tx, id: string): Promise<{ id: string; name: string }> {
  if (!isUuid(id)) throw notFound();
  const row = await tx.one<{ id: string; name: string }>('select id, name from collection where id = $1', [id]);
  if (row === null) throw notFound();
  return row;
}

type BoardCard = { object_id: string; title: string; x: number; y: number; stored: boolean };

async function boardJson(tx: Tx, collectionId: string): Promise<Record<string, unknown>> {
  const members = await tx.query<{ object_id: string; title: string }>(
    `select m.object_id, o.title from collection_member m
       join object_note o on o.id = m.object_id
      where m.collection_id = $1
      order by lower(o.title) asc, m.object_id asc`,
    [collectionId],
  );
  const stored = await tx.query<{ object_id: string; x: number; y: number }>(
    'select object_id, x, y from board_position where collection_id = $1',
    [collectionId],
  );
  const cards: BoardCard[] = members.map((member, index) => {
    const hit = stored.find((entry) => entry.object_id === member.object_id);
    if (hit !== undefined) {
      return { object_id: member.object_id, title: member.title, x: hit.x, y: hit.y, stored: true };
    }
    const fallback = defaultCardPosition(index);
    return { object_id: member.object_id, title: member.title, x: fallback.x, y: fallback.y, stored: false };
  });
  const ids = cards.map((card) => card.object_id);
  const edges = await tx.query<{ id: string; from_object_id: string; to_object_id: string }>(
    `select id, from_object_id, to_object_id from link_edge
      where from_object_id = any($1::uuid[]) and to_object_id = any($1::uuid[])
      order by id asc`,
    [ids],
  );
  return {
    collection_id: collectionId,
    cards,
    edges: edges.map((edge) => ({ id: edge.id, from: edge.from_object_id, to: edge.to_object_id })),
  };
}

export const collectionRoutes: Route[] = [
  route('GET', '/api/collections', async (): Promise<Reply> => {
    const collections = await withTransaction((tx) =>
      tx.query<{ id: string; name: string; object_count: string }>(
        `select c.id, c.name, count(m.object_id)::text as object_count
           from collection c left join collection_member m on m.collection_id = c.id
          group by c.id, c.name order by lower(c.name) asc`,
      ),
    );
    return json({
      collections: collections.map((row) => ({
        id: row.id,
        name: row.name,
        object_count: Number(row.object_count),
      })),
    });
  }),

  route('POST', '/api/collections', async (context: RequestContext): Promise<Reply> => {
    const body =
      context.json === null || typeof context.json !== 'object' ? {} : (context.json as Record<string, unknown>);
    const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
    const created = await withTransaction(async (tx) => {
      if (name === '') throw validationError({ name: COLLECTION_MESSAGES.name });
      const clash = await tx.one<{ id: string }>('select id from collection where lower(name) = lower($1)', [name]);
      if (clash !== null) throw validationError({ name: COLLECTION_MESSAGES.nameTaken });
      const id = randomUUID();
      await tx.query('insert into collection (id, name) values ($1, $2)', [id, name]);
      return { id, name, object_count: 0 };
    });
    return json(created, 201);
  }),

  route('GET', '/api/collections/:id', async (context: RequestContext): Promise<Reply> => {
    const result = await withTransaction(async (tx) => {
      const collection = await requireCollection(tx, context.params['id']);
      const types = await loadTypes(tx);
      const rows = await tx.query<ObjectRow>(
        `select o.id, o.type_id, o.title, to_char(o.daily_date, 'YYYY-MM-DD') as daily_date,
                o.share_visibility, o.backlinks, o.created_at, o.updated_at
           from collection_member m join object_note o on o.id = m.object_id
          where m.collection_id = $1 order by lower(o.title) asc`,
        [collection.id],
      );
      const objects: Record<string, unknown>[] = [];
      for (const row of rows) objects.push(await objectJson(tx, row, types, { withBlocks: false }));
      return { id: collection.id, name: collection.name, objects };
    });
    return json(result);
  }),

  route('POST', '/api/collections/:id/objects', async (context: RequestContext): Promise<Reply> => {
    const body =
      context.json === null || typeof context.json !== 'object' ? {} : (context.json as Record<string, unknown>);
    const objectId = typeof body['object_id'] === 'string' ? body['object_id'] : '';
    await commitWithEvents(async (tx) => {
      const collection = await requireCollection(tx, context.params['id']);
      if (!isUuid(objectId)) throw validationError({ object_id: COLLECTION_MESSAGES.objectMissing });
      const object = await tx.one<{ id: string }>('select id from object_note where id = $1', [objectId]);
      if (object === null) throw validationError({ object_id: COLLECTION_MESSAGES.objectMissing });
      const inserted = await tx.query<{ object_id: string }>(
        `insert into collection_member (collection_id, object_id) values ($1, $2)
         on conflict do nothing returning object_id`,
        [collection.id, objectId],
      );
      const events: LiveEvent[] =
        inserted.length === 0 ? [] : [{ type: 'object.saved', data: { object_id: objectId } }];
      return { result: null, events };
    });
    void deleteShareCacheForObject(objectId);
    return noContent();
  }),

  route('DELETE', '/api/collections/:id/objects/:objectId', async (context: RequestContext): Promise<Reply> => {
    const objectId = context.params['objectId'];
    await commitWithEvents(async (tx) => {
      const collection = await requireCollection(tx, context.params['id']);
      if (!isUuid(objectId)) throw notFound();
      const removed = await tx.query<{ object_id: string }>(
        'delete from collection_member where collection_id = $1 and object_id = $2 returning object_id',
        [collection.id, objectId],
      );
      if (removed.length === 0) throw notFound();
      await tx.query('delete from board_position where collection_id = $1 and object_id = $2', [
        collection.id,
        objectId,
      ]);
      return { result: null, events: [{ type: 'object.saved', data: { object_id: objectId } }] as LiveEvent[] };
    });
    void deleteShareCacheForObject(objectId);
    return noContent();
  }),

  route('DELETE', '/api/collections/:id', async (context: RequestContext): Promise<Reply> => {
    const outcome = await commitWithEvents(async (tx) => {
      const collection = await requireCollection(tx, context.params['id']);
      const links = await tx.query<{ id: string }>(
        'update share_link set revoked_at = now() where collection_id = $1 and revoked_at is null returning id',
        [collection.id],
      );
      await tx.query('delete from collection where id = $1', [collection.id]);
      const events: LiveEvent[] = links.map((link) => ({
        type: 'share_link.changed',
        data: { collection_id: collection.id, share_link_id: link.id },
      }));
      return { result: links.map((link) => link.id), events };
    });
    for (const linkId of outcome) void deleteShareCacheForLink(linkId);
    return noContent();
  }),

  route('GET', '/api/collections/:id/board', async (context: RequestContext): Promise<Reply> => {
    const result = await withTransaction(async (tx) => {
      const collection = await requireCollection(tx, context.params['id']);
      return boardJson(tx, collection.id);
    });
    return json(result);
  }),

  route('PUT', '/api/collections/:id/board', async (context: RequestContext): Promise<Reply> => {
    const body =
      context.json === null || typeof context.json !== 'object' ? {} : (context.json as Record<string, unknown>);
    const positions = body['positions'];
    const result = await commitWithEvents(async (tx) => {
      const collection = await requireCollection(tx, context.params['id']);
      if (!Array.isArray(positions) || positions.length < 1 || positions.length > BOARD_MAX_POSITIONS) {
        throw validationError({ positions: COLLECTION_MESSAGES.positions });
      }
      const members = await tx.query<{ object_id: string }>(
        'select object_id from collection_member where collection_id = $1',
        [collection.id],
      );
      const memberIds = members.map((row) => row.object_id);
      const errors: Record<string, string> = {};
      positions.forEach((entry, index) => {
        const record = entry === null || typeof entry !== 'object' ? {} : (entry as Record<string, unknown>);
        const objectId = typeof record['object_id'] === 'string' ? record['object_id'] : '';
        if (!memberIds.includes(objectId)) {
          errors[`positions.${index}.object_id`] = COLLECTION_MESSAGES.notInCollection;
        }
        if (!isBoardCoordinate(record['x'])) errors[`positions.${index}.x`] = COLLECTION_MESSAGES.coordinate;
        if (!isBoardCoordinate(record['y'])) errors[`positions.${index}.y`] = COLLECTION_MESSAGES.coordinate;
      });
      if (Object.keys(errors).length > 0) throw validationError(errors);
      const saved: { object_id: string; x: number; y: number }[] = [];
      for (const entry of positions as Record<string, unknown>[]) {
        const objectId = entry['object_id'] as string;
        const x = entry['x'] as number;
        const y = entry['y'] as number;
        await tx.query(
          `insert into board_position (collection_id, object_id, x, y) values ($1, $2, $3, $4)
           on conflict (collection_id, object_id) do update set x = excluded.x, y = excluded.y`,
          [collection.id, objectId, x, y],
        );
        saved.push({ object_id: objectId, x, y });
      }
      return {
        result: await boardJson(tx, collection.id),
        events: [
          { type: 'board.saved', data: { collection_id: collection.id, positions: saved } },
        ] as LiveEvent[],
      };
    });
    return json(result);
  }),

  route('GET', '/api/collections/:id/share-links', async (context: RequestContext): Promise<Reply> => {
    const settings = await loadSettings();
    const links = await withTransaction(async (tx) => {
      const collection = await requireCollection(tx, context.params['id']);
      return tx.query<ShareLinkRow>(
        `select ${SHARE_LINK_COLUMNS} from share_link where collection_id = $1 order by created_at desc`,
        [collection.id],
      );
    });
    return json({ share_links: links.map((link) => shareLinkJson(link, settings.homeTimeZone)) });
  }),

  route('POST', '/api/collections/:id/share-links', async (context: RequestContext): Promise<Reply> => {
    const body =
      context.json === null || typeof context.json !== 'object' ? {} : (context.json as Record<string, unknown>);
    const settings = await loadSettings();
    const expiresAt = typeof body['expires_at'] === 'string' ? body['expires_at'] : '';
    const created = await commitWithEvents(async (tx) => {
      const collection = await requireCollection(tx, context.params['id']);
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(expiresAt)) {
        throw validationError({ expires_at: COLLECTION_MESSAGES.expiresFormat });
      }
      const converted = localMinuteToInstant(expiresAt, settings.homeTimeZone);
      if (!converted.ok) throw validationError({ expires_at: COLLECTION_MESSAGES.expiresGap });
      const now = new Date();
      const currentMinute = localMinuteInZone(now, settings.homeTimeZone);
      if (expiresAt <= currentMinute) {
        throw validationError({ expires_at: COLLECTION_MESSAGES.expiresPast });
      }
      if (converted.instant.getTime() - now.getTime() > SHARE_LINK_MAX_DAYS * 86_400_000) {
        throw validationError({ expires_at: COLLECTION_MESSAGES.expiresTooFar });
      }
      const id = randomUUID();
      const token = randomBytes(24).toString('base64url');
      const rows = await tx.query<ShareLinkRow>(
        `insert into share_link (id, collection_id, token, expires_at_utc, time_zone)
         values ($1, $2, $3, $4, $5) returning ${SHARE_LINK_COLUMNS}`,
        [id, collection.id, token, converted.instant.toISOString(), settings.homeTimeZone],
      );
      return {
        result: shareLinkJson(rows[0], settings.homeTimeZone),
        events: [
          { type: 'share_link.changed', data: { collection_id: collection.id, share_link_id: id } },
        ] as LiveEvent[],
      };
    });
    return json(created, 201);
  }),

  route('POST', '/api/share-links/:id/revoke', async (context: RequestContext): Promise<Reply> => {
    const settings = await loadSettings();
    const id = context.params['id'];
    const result = await commitWithEvents(async (tx) => {
      if (!isUuid(id)) throw notFound();
      const link = await loadLinkById(tx, id);
      if (link === null) throw notFound();
      const revoked = await tx.query<ShareLinkRow>(
        `update share_link set revoked_at = now()
          where id = $1 and revoked_at is null and expires_at_utc > now()
          returning ${SHARE_LINK_COLUMNS}`,
        [id],
      );
      if (revoked.length === 0) {
        throw errorReply(409, 'link_not_active', { status: statusOf(link) });
      }
      return {
        result: shareLinkJson(revoked[0], settings.homeTimeZone),
        events: [
          {
            type: 'share_link.changed',
            data: { collection_id: revoked[0].collection_id, share_link_id: id },
          },
        ] as LiveEvent[],
      };
    });
    void deleteShareCacheForLink(id);
    return json(result);
  }),

  route('POST', '/api/share-links/:id/regenerate', async (context: RequestContext): Promise<Reply> => {
    const settings = await loadSettings();
    const id = context.params['id'];
    const result = await commitWithEvents(async (tx) => {
      if (!isUuid(id)) throw notFound();
      const link = await loadLinkById(tx, id);
      if (link === null) throw notFound();
      const revoked = await tx.query<ShareLinkRow>(
        `update share_link set revoked_at = now()
          where id = $1 and revoked_at is null and expires_at_utc > now()
          returning ${SHARE_LINK_COLUMNS}`,
        [id],
      );
      if (revoked.length === 0) {
        throw errorReply(409, 'link_not_active', { status: statusOf(link) });
      }
      const newId = randomUUID();
      const token = randomBytes(24).toString('base64url');
      const rows = await tx.query<ShareLinkRow>(
        `insert into share_link (id, collection_id, token, expires_at_utc, time_zone)
         values ($1, $2, $3, $4, $5) returning ${SHARE_LINK_COLUMNS}`,
        [newId, link.collection_id, token, link.expires_at_utc.toISOString(), settings.homeTimeZone],
      );
      return {
        result: shareLinkJson(rows[0], settings.homeTimeZone),
        events: [
          { type: 'share_link.changed', data: { collection_id: link.collection_id, share_link_id: id } },
          { type: 'share_link.changed', data: { collection_id: link.collection_id, share_link_id: newId } },
        ] as LiveEvent[],
      };
    });
    void deleteShareCacheForLink(id);
    return json(result, 201);
  }),
];
