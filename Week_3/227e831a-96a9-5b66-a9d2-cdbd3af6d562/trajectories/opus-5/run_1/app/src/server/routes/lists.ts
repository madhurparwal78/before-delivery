import { isLegalMove, illegalTransitionMessage } from '../../shared/states.js';
import { pool, transaction, type Db } from '../db.js';
import { conflict, notFound, validationFailed } from '../http/errors.js';
import { declaredBody, present, textOf } from '../http/json.js';
import type { Reply, Route } from '../http/pipeline.js';
import {
  buildTripList,
  isUuid,
  loadLineRows,
  loadListSummaries,
  loadProfileRow,
  loadList,
  type ListRow,
} from '../store.js';
import { FieldErrors, MESSAGES, carryModeOf, trimmedText, wholeIn } from '../validate.js';

const UNIQUE_VIOLATION = '23505';

export function notEditableMessage(list: ListRow): string {
  return `${list.name} is ${list.state} and can't be edited.`;
}

async function lockedList(db: Db, id: string): Promise<ListRow> {
  if (!isUuid(id)) throw notFound('list');
  const result = await db.query<ListRow>(
    'SELECT id, name, state FROM trip_lists WHERE id = $1 FOR UPDATE',
    [id],
  );
  const row = result.rows[0];
  if (row === undefined) throw notFound('list');
  return row;
}

async function listReply(db: Db, listRow: ListRow, status: number): Promise<Reply> {
  const profile = await loadProfileRow(db);
  const list = buildTripList(listRow, await loadLineRows(db, listRow.id), profile);
  return { status, json: { list } };
}

interface LockedLine {
  id: string;
  item_id: string;
  quantity: number;
  units_owned: number;
}

export const listRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/lists',
    auth: 'owner',
    body: 'json',
    handler: async () => {
      const profile = await loadProfileRow();
      return { status: 200, json: { lists: await loadListSummaries(pool, profile) } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/lists',
    auth: 'owner',
    body: 'json',
    handler: async (ctx) => {
      const body = declaredBody(ctx.body, ['name']);
      const name = trimmedText(body['name'], 1, 80);
      if (name === null) throw validationFailed({ name: MESSAGES.listName });
      return transaction(async (db) => {
        const inserted = await db.query<ListRow>(
          'INSERT INTO trip_lists (name) VALUES ($1) RETURNING id, name, state',
          [name],
        );
        return listReply(db, inserted.rows[0] as ListRow, 201);
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/lists/:id',
    auth: 'owner',
    body: 'json',
    handler: async (ctx) => {
      const profile = await loadProfileRow();
      const list = await loadList(pool, profile, ctx.params['id'] as string);
      if (list === null) throw notFound('list');
      return { status: 200, json: { list } };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/lists/:id',
    auth: 'owner',
    body: 'json',
    handler: async (ctx) =>
      transaction(async (db) => {
        const list = await lockedList(db, ctx.params['id'] as string);
        if (list.state === 'walked') {
          throw conflict('list_not_editable', notEditableMessage(list));
        }
        const body = declaredBody(ctx.body, ['name']);
        const name = trimmedText(body['name'], 1, 80);
        if (name === null) throw validationFailed({ name: MESSAGES.listName });
        await db.query('UPDATE trip_lists SET name = $2 WHERE id = $1', [list.id, name]);
        return listReply(db, { ...list, name }, 200);
      }),
  },
  {
    method: 'POST',
    pattern: '/api/lists/:id/lines',
    auth: 'owner',
    body: 'json',
    handler: async (ctx) =>
      transaction(async (db) => {
        const list = await lockedList(db, ctx.params['id'] as string);
        const body = declaredBody(ctx.body, ['itemId', 'quantity', 'mode']);
        const itemId = textOf(body['itemId']) ?? '';
        const item = isUuid(itemId)
          ? (
              await db.query<{ id: string; name: string; units_owned: number; status: string }>(
                'SELECT id, name, units_owned, status FROM items WHERE id = $1',
                [itemId],
              )
            ).rows[0]
          : undefined;
        if (item === undefined) throw notFound('item');
        if (list.state !== 'planning') {
          throw conflict('list_not_editable', notEditableMessage(list));
        }
        if (item.units_owned === 0) {
          throw conflict('item_retired', `${item.name} is no longer in your closet.`);
        }
        const errors = new FieldErrors();
        let quantity = 1;
        if (present(body['quantity'])) {
          const parsed = wholeIn(body['quantity'], 1, Number.MAX_SAFE_INTEGER);
          if (parsed === null) errors.add('quantity', MESSAGES.quantityMin);
          else quantity = parsed;
        }
        let mode = 'base';
        if (present(body['mode'])) {
          const parsed = carryModeOf(body['mode']);
          if (parsed === null) errors.add('mode', MESSAGES.mode);
          else mode = parsed;
        }
        errors.throwIfAny();
        if (quantity > item.units_owned) {
          throw validationFailed({ quantity: `You own ${item.units_owned}.` });
        }
        try {
          await db.query(
            'INSERT INTO lines (list_id, item_id, quantity, mode) VALUES ($1, $2, $3, $4)',
            [list.id, item.id, quantity, mode],
          );
        } catch (error) {
          if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
            throw conflict('line_exists', `${item.name} is already on this list.`);
          }
          throw error;
        }
        return listReply(db, list, 201);
      }),
  },
  {
    method: 'PATCH',
    pattern: '/api/lists/:id/lines/:lineId',
    auth: 'owner',
    body: 'json',
    handler: async (ctx) =>
      transaction(async (db) => {
        const lineId = ctx.params['lineId'] as string;
        const listId = ctx.params['id'] as string;
        if (!isUuid(lineId) || !isUuid(listId)) throw notFound('line');
        const list = await lockedList(db, listId);
        const found = await db.query<LockedLine>(
          `SELECT l.id, l.item_id, l.quantity, i.units_owned
             FROM lines l JOIN items i ON i.id = l.item_id
            WHERE l.id = $1 AND l.list_id = $2 FOR UPDATE OF l`,
          [lineId, list.id],
        );
        const line = found.rows[0];
        if (line === undefined) throw notFound('line');
        if (list.state !== 'planning') {
          throw conflict('list_not_editable', notEditableMessage(list));
        }
        const body = declaredBody(ctx.body, ['quantity', 'mode']);
        const errors = new FieldErrors();
        const updates: string[] = [];
        const values: unknown[] = [line.id];
        if (present(body['quantity'])) {
          const quantity = wholeIn(body['quantity'], 1, Number.MAX_SAFE_INTEGER);
          if (quantity === null) errors.add('quantity', MESSAGES.quantityMin);
          else if (quantity > line.units_owned) {
            errors.add('quantity', `You own ${line.units_owned}.`);
          } else updates.push(`quantity = $${values.push(quantity)}`);
        }
        if (present(body['mode'])) {
          const mode = carryModeOf(body['mode']);
          if (mode === null) errors.add('mode', MESSAGES.mode);
          else updates.push(`mode = $${values.push(mode)}`);
        }
        errors.throwIfAny();
        if (updates.length > 0) {
          await db.query(`UPDATE lines SET ${updates.join(', ')} WHERE id = $1`, values);
        }
        return listReply(db, list, 200);
      }),
  },
  {
    method: 'DELETE',
    pattern: '/api/lists/:id/lines/:lineId',
    auth: 'owner',
    body: 'json',
    handler: async (ctx) =>
      transaction(async (db) => {
        const lineId = ctx.params['lineId'] as string;
        const listId = ctx.params['id'] as string;
        if (!isUuid(lineId) || !isUuid(listId)) throw notFound('line');
        const list = await lockedList(db, listId);
        const found = await db.query<{ id: string }>(
          'SELECT id FROM lines WHERE id = $1 AND list_id = $2',
          [lineId, list.id],
        );
        if (found.rows[0] === undefined) throw notFound('line');
        if (list.state !== 'planning') {
          throw conflict('list_not_editable', notEditableMessage(list));
        }
        await db.query('DELETE FROM lines WHERE id = $1', [lineId]);
        return listReply(db, list, 200);
      }),
  },
  {
    method: 'POST',
    pattern: '/api/lists/:id/state',
    auth: 'owner',
    body: 'json',
    handler: async (ctx) =>
      transaction(async (db) => {
        const list = await lockedList(db, ctx.params['id'] as string);
        const body = declaredBody(ctx.body, ['to']);
        const to = textOf(body['to']);
        if (to !== 'planning' && to !== 'packed' && to !== 'walked') {
          throw validationFailed({ to: MESSAGES.state });
        }
        if (!isLegalMove(list.state, to)) {
          throw conflict('illegal_transition', illegalTransitionMessage(list.state, to));
        }
        if (to === 'packed') {
          const lineRows = await loadLineRows(db, list.id);
          if (lineRows.some((row) => row.quantity > row.units_owned)) {
            throw conflict(
              'lines_not_in_closet',
              'Some lines are not in your closet. Unpack them before marking this list packed.',
            );
          }
          if (lineRows.length === 0) {
            throw conflict('empty_list', 'Add at least one item before marking this list packed.');
          }
          await db.query(
            `UPDATE lines l SET frozen_name = i.name, frozen_weight_grams = i.weight_grams
               FROM items i WHERE i.id = l.item_id AND l.list_id = $1`,
            [list.id],
          );
        }
        if (to === 'planning') {
          await db.query(
            'UPDATE lines SET frozen_name = NULL, frozen_weight_grams = NULL WHERE list_id = $1',
            [list.id],
          );
        }
        await db.query('UPDATE trip_lists SET state = $2 WHERE id = $1', [list.id, to]);
        return listReply(db, { ...list, state: to }, 200);
      }),
  },
];
