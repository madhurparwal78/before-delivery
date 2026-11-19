import { cancelHoldConflict, placeHoldConflict } from '../../domain/transitions';
import { today } from '../../../shared/time';
import { pool, withTransaction } from '../../repo/db';
import { readCalendar } from '../../repo/calendar';
import {
  insertHold,
  lockItems,
  readHold,
  readHolds,
  readItem,
  setHoldStatus,
} from '../../repo/inventory';
import { isMemberActive } from '../../repo/users';
import { promoteHoldForItem } from '../../actions/hold-promotion';
import * as fail from '../errors';
import { jsonReply, type Reply, type Route } from '../pipeline';
import { readInteger } from '../validate';

export const listHoldsRoute: Route = {
  method: 'GET',
  pattern: '/api/holds',
  body: 'json',
  auth: 'signed-in',
  run: async (ctx): Promise<Reply> => {
    const user = ctx.requireUser();
    const calendar = await readCalendar(pool);
    const itemId = ctx.query.get('item_id');
    return jsonReply(200, {
      holds: await readHolds(
        pool,
        {
          memberId: user.role === 'member' ? user.id : undefined,
          itemId: itemId !== null && /^\d+$/.test(itemId) ? Number(itemId) : undefined,
        },
        calendar.timeZone,
      ),
    });
  },
};

export const placeHoldRoute: Route<{ itemId: number }> = {
  method: 'POST',
  pattern: '/api/holds',
  body: 'json',
  auth: 'signed-in',
  resolve: async (ctx) => {
    const itemId = ctx.peekId('item_id');
    if (itemId !== null && !(await readItem(pool, itemId))) throw fail.notFound();
    return { itemId: itemId ?? 0 };
  },
  role: (ctx) => {
    if (ctx.role !== 'member') throw fail.membersOnly();
  },
  run: async (ctx, resolved): Promise<Reply> => {
    const user = ctx.requireUser();
    if (readInteger(ctx.json(), 'item_id') === null) {
      throw fail.invalid({ item_id: 'Choose a tool to hold.' });
    }
    return withTransaction(async (client) => {
      const calendar = await readCalendar(client);
      await lockItems(client, [resolved.itemId]);
      const item = await readItem(client, resolved.itemId);
      if (!item) throw fail.notFound();
      const active = await isMemberActive(client, user.id, today(calendar.timeZone, ctx.now));
      const existing = await client.query(
        `select id from holds where item_id = $1 and member_id = $2
         and status in ('queued', 'ready')`,
        [resolved.itemId, user.id],
      );
      const conflict = placeHoldConflict(active, item.status, existing.rows.length > 0);
      if (conflict) throw fail.conflict(conflict);
      const holdId = await insertHold(client, resolved.itemId, user.id);
      const hold = await readHold(client, holdId, calendar.timeZone);
      return jsonReply(201, { hold });
    });
  },
};

export const cancelHoldRoute: Route<{ id: number }> = {
  method: 'DELETE',
  pattern: '/api/holds/:id',
  body: 'json',
  auth: 'signed-in',
  resolve: async (ctx) => {
    const user = ctx.requireUser();
    const id = ctx.pathId('id');
    const rows = await pool.query<{ member_id: number }>(
      'select member_id from holds where id = $1',
      [id],
    );
    const hold = rows.rows[0];
    if (!hold) throw fail.notFound();
    if (user.role === 'member' && hold.member_id !== user.id) throw fail.notFound();
    return { id };
  },
  role: (ctx) => {
    if (ctx.role !== 'member') throw fail.membersOnly();
  },
  run: async (ctx, resolved): Promise<Reply> => {
    return withTransaction(async (client) => {
      const calendar = await readCalendar(client);
      const locked = await client.query<{ id: number; item_id: number; status: string }>(
        'select id, item_id, status from holds where id = $1 for update',
        [resolved.id],
      );
      const hold = locked.rows[0];
      if (!hold) throw fail.notFound();
      const conflict = cancelHoldConflict(hold.status as 'queued' | 'ready');
      if (conflict) throw fail.conflict(conflict);
      const wasReady = hold.status === 'ready';
      await setHoldStatus(client, hold.id, 'cancelled');
      if (wasReady) {
        const item = await readItem(client, hold.item_id);
        if (item?.status === 'on-wall') {
          await promoteHoldForItem(client, hold.item_id, calendar, ctx.now);
        }
      }
      const cancelled = await readHold(client, hold.id, calendar.timeZone);
      return jsonReply(200, { hold: cancelled });
    });
  },
};
