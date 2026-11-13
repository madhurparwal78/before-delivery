import { randomBytes } from 'node:crypto';
import { buildCategoryEntries, buildTotals } from '../../shared/lines.js';
import { isIsoDate, isShareExpired, todayInZone } from '../../shared/sharetime.js';
import type { Share, SharedList } from '../../shared/types.js';
import { pool, transaction, type Db } from '../db.js';
import { HttpError, notFound, validationFailed } from '../http/errors.js';
import { declaredBody, present, textOf } from '../http/json.js';
import type { Route } from '../http/pipeline.js';
import {
  buildTripList,
  loadLineRows,
  loadListRow,
  loadProfileRow,
  type ProfileRow,
} from '../store.js';
import { MESSAGES } from '../validate.js';

interface ShareRow {
  id: string;
  list_id: string;
  token: string;
  expires_on: string | null;
  created_at: Date;
}



export function shareJson(row: ShareRow, profile: ProfileRow): Share {
  const expiresOn = row.expires_on;
  return {
    id: row.id,
    token: row.token,
    url: `/s/${row.token}`,
    expiresOn,
    expired: isShareExpired(expiresOn, profile.time_zone),
    createdAt: row.created_at.toISOString(),
  };
}

async function activeShare(db: Db, listId: string): Promise<ShareRow | null> {
  const result = await db.query<ShareRow>(
    'SELECT id, list_id, token, expires_on::text AS expires_on, created_at FROM shares WHERE list_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC',
    [listId],
  );
  return result.rows[0] ?? null;
}

export async function sharedListFor(token: string): Promise<SharedList | null> {
  const profile = await loadProfileRow();
  const result = await pool.query<ShareRow>(
    `SELECT id, list_id, token, expires_on::text AS expires_on, created_at FROM shares
     WHERE token = $1 AND revoked_at IS NULL`,
    [token],
  );
  const share = result.rows[0];
  if (share === undefined) return null;
  if (isShareExpired(share.expires_on, profile.time_zone)) return null;
  const listRow = await loadListRow(pool, share.list_id);
  if (listRow === null) return null;
  const list = buildTripList(listRow, await loadLineRows(pool, listRow.id), profile);
  const lines = list.lines
    .filter((line) => line.inCloset)
    .map((line) => ({
      name: line.name,
      category: line.category,
      quantity: line.quantity,
      mode: line.mode,
      unitWeightGrams: line.unitWeightGrams,
      lineWeightGrams: line.lineWeightGrams,
      baseGrams: line.baseGrams,
      wornGrams: line.wornGrams,
      consumableGrams: line.consumableGrams,
      carryNote: line.carryNote,
      weightDisplay: line.weightDisplay,
    }));
  return {
    listName: list.name,
    state: list.state,
    hikerName: profile.display_name,
    lines,
    categories: buildCategoryEntries(list.lines, profile.unit),
    totals: buildTotals(list.lines, profile.goal_grams, profile.unit),
  };
}

const readOnly = (): HttpError =>
  new HttpError(405, 'read_only', 'A shared list can only be read.', {
    headers: { allow: 'GET' },
  });

export const shareRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/lists/:id/share',
    auth: 'owner',
    body: 'json',
    handler: async (ctx) => {
      const list = await loadListRow(pool, ctx.params['id'] as string);
      if (list === null) throw notFound('list');
      const profile = await loadProfileRow();
      const share = await activeShare(pool, list.id);
      return {
        status: 200,
        json: { share: share === null ? null : shareJson(share, profile) },
        headers: { 'cache-control': 'no-store' },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/lists/:id/share',
    auth: 'owner',
    body: 'json',
    handler: async (ctx) => {
      const list = await loadListRow(pool, ctx.params['id'] as string);
      if (list === null) throw notFound('list');
      const profile = await loadProfileRow();
      const body = declaredBody(ctx.body, ['expiresOn']);
      let expiresOn: string | null = null;
      if (present(body['expiresOn']) && body['expiresOn'] !== null) {
        const text = textOf(body['expiresOn']);
        if (text === null || !isIsoDate(text) || text < todayInZone(profile.time_zone)) {
          throw validationFailed({ expiresOn: MESSAGES.expiresOn });
        }
        expiresOn = text;
      }
      const share = await transaction(async (db) => {
        await db.query('SELECT id FROM trip_lists WHERE id = $1 FOR UPDATE', [list.id]);
        await db.query(
          'UPDATE shares SET revoked_at = now() WHERE list_id = $1 AND revoked_at IS NULL',
          [list.id],
        );
        const inserted = await db.query<ShareRow>(
          `INSERT INTO shares (list_id, token, expires_on) VALUES ($1, $2, $3)
           RETURNING id, list_id, token, expires_on::text AS expires_on, created_at`,
          [list.id, randomBytes(24).toString('base64url'), expiresOn],
        );
        return inserted.rows[0] as ShareRow;
      });
      return {
        status: 201,
        json: { share: shareJson(share, profile) },
        headers: { 'cache-control': 'no-store' },
      };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/lists/:id/share',
    auth: 'owner',
    body: 'json',
    handler: async (ctx) => {
      const list = await loadListRow(pool, ctx.params['id'] as string);
      if (list === null) throw notFound('list');
      await pool.query(
        'UPDATE shares SET revoked_at = now() WHERE list_id = $1 AND revoked_at IS NULL',
        [list.id],
      );
      return { status: 204, headers: { 'cache-control': 'no-store' } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/share/:token',
    auth: 'public',
    body: 'json',
    handler: async (ctx) => {
      const share = await sharedListFor(ctx.params['token'] as string);
      if (share === null) throw notFound('share');
      return { status: 200, json: { share }, headers: { 'cache-control': 'no-store' } };
    },
  },
  ...(['POST', 'PUT', 'PATCH', 'DELETE'] as const).map((method) => ({
    method,
    pattern: '/api/share/:token',
    auth: 'public' as const,
    body: 'json' as const,
    handler: async () => {
      throw readOnly();
    },
  })),
];
