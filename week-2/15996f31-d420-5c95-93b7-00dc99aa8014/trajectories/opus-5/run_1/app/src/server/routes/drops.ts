import { orderStatusLabel } from '../../shared/labels';
import { formatCalendarDate, pacificCalendarDate } from '../../shared/pacific';
import { pool, withTransaction } from '../db';
import { loadOrder, lockOrder } from '../data/order-access';
import {
  findDropOwner,
  loadOrderAggregates,
  requireDrop,
  type DropRecord,
  type OrderAggregate,
} from '../data/orders';
import { recordAudit } from '../data/outbox';
import { computeOrderFigures } from '../domain/figures';
import { nextDropStatus, orderAcceptsDelivery } from '../domain/transitions';
import { apiError } from '../http/errors';
import { requireActor, requireRole, type Actor, type Ctx, type Reply, type Route } from '../http/router';
import { FieldErrors, lengthWithin, trimmedString } from '../http/validate';
import { dropView } from '../views/orders';

const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const FUTURE_TOLERANCE_MS = 60_000;

interface DropContext {
  order: OrderAggregate;
  drop: DropRecord;
}

/** A drop the caller may see: their own for a beekeeper, any for the broker. */
async function requireVisibleDrop(actor: Actor, dropId: string): Promise<DropContext> {
  const owner = await findDropOwner(pool, dropId);
  if (owner === null) throw apiError.notFound();
  if (actor.role === 'beekeeper' && owner.beekeeperId !== actor.id) throw apiError.notFound();
  if (actor.role === 'grower') throw apiError.notFound();
  const order = await loadOrder(owner.orderId);
  return { order, drop: requireDrop(order, dropId) };
}

async function dropReply(dropId: string, orderId: string, actor: Actor): Promise<Reply> {
  const order = await loadOrder(orderId);
  const drop = requireDrop(order, dropId);
  return {
    status: 200,
    json: dropView(order, computeOrderFigures(order), drop, actor.role === 'broker'),
  };
}

async function deliver(ctx: Ctx): Promise<Reply> {
  const actor = requireRole(ctx, 'broker', 'beekeeper');
  const dropId = ctx.params.id as string;
  const { order: visible, drop: visibleDrop } = await requireVisibleDrop(actor, dropId);
  if (actor.role !== 'beekeeper' || visibleDrop.beekeeperId !== actor.id) throw apiError.forbidden();

  await withTransaction(async (client) => {
    const order = await lockOrder(client, visible.id);
    const drop = requireDrop(order, dropId);
    if (nextDropStatus('deliver', drop.status) === null || !orderAcceptsDelivery(order.status)) {
      throw apiError.invalidTransition(
        orderStatusLabel(order.status, order.settlementStatus),
        order.ref,
      );
    }
    const figures = computeOrderFigures(order);
    const fields = new FieldErrors();
    const blockId = trimmedString(ctx.body.json.block_id);
    const block = order.blocks.find((entry) => entry.blockId === blockId);
    if (block === undefined) {
      fields.add('block_id', 'Choose a block on this order');
    } else {
      const strength = figures.blocks.get(block.blockId);
      const room = block.hivesOrdered - (strength?.hivesDelivered ?? 0);
      if (drop.hives > room) {
        fields.add('block_id', `${block.name} has room for ${room} more hives`);
      }
    }

    const rawInstant = trimmedString(ctx.body.json.delivered_at);
    let deliveredOn: string | null = null;
    if (rawInstant === null || !INSTANT_PATTERN.test(rawInstant) || Number.isNaN(Date.parse(rawInstant))) {
      fields.add('delivered_at', 'Use a date and time');
    } else {
      const at = new Date(rawInstant);
      if (at.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
        fields.add('delivered_at', "Delivery time can't be in the future");
      } else {
        deliveredOn = pacificCalendarDate(at);
        if (deliveredOn > order.deliveryDeadline) {
          fields.add(
            'delivered_at',
            `Delivered after the delivery deadline (${formatCalendarDate(order.deliveryDeadline)})`,
          );
        }
      }
    }
    fields.throwIfAny();

    await client.query(
      `update drops set status = 'delivered', block_id = $2, delivered_at = $3, delivered_on = $4
        where id = $1`,
      [dropId, blockId, rawInstant, deliveredOn],
    );
    await recordAudit(client, {
      entityType: 'drop',
      entityId: dropId,
      action: 'delivered',
      actorId: actor.id,
      detail: { block_id: blockId, delivered_on: deliveredOn },
    });
  });
  return dropReply(dropId, visible.id, actor);
}

export const dropRoutes: readonly Route[] = [
  {
    method: 'GET',
    path: '/api/drops',
    body: 'none',
    auth: 'session',
    handle: async (ctx) => {
      const actor = requireActor(ctx);
      if (actor.role === 'grower') throw apiError.forbidden();
      const owned = await pool.query(
        actor.role === 'broker'
          ? 'select distinct order_id from drops'
          : 'select distinct order_id from drops where beekeeper_id = $1',
        actor.role === 'broker' ? [] : [actor.id],
      );
      const orderIds = owned.rows.map((row) => String(row.order_id));
      const aggregates = await loadOrderAggregates(pool, orderIds);
      const list = [...aggregates.values()].flatMap((order) => {
        const figures = computeOrderFigures(order);
        return order.drops
          .filter((drop) => actor.role === 'broker' || drop.beekeeperId === actor.id)
          .map((drop) => dropView(order, figures, drop, actor.role === 'broker'));
      });
      return { status: 200, json: list };
    },
  },
  {
    method: 'GET',
    path: '/api/drops/:id',
    body: 'none',
    auth: 'session',
    handle: async (ctx) => {
      const actor = requireActor(ctx);
      const { order, drop } = await requireVisibleDrop(actor, ctx.params.id as string);
      return {
        status: 200,
        json: dropView(order, computeOrderFigures(order), drop, actor.role === 'broker'),
      };
    },
  },
  {
    method: 'POST',
    path: '/api/drops/:id/deliver',
    body: 'json',
    auth: 'session',
    handle: deliver,
  },
  {
    method: 'POST',
    path: '/api/drops/:id/accept',
    body: 'json',
    auth: 'session',
    handle: async (ctx) => {
      const actor = requireActor(ctx);
      const dropId = ctx.params.id as string;
      const context = await requireVisibleDrop(actor, dropId);
      if (actor.role !== 'beekeeper' || context.drop.beekeeperId !== actor.id) {
        throw apiError.forbidden();
      }
      await withTransaction(async (client) => {
        const order = await lockOrder(client, context.order.id);
        const drop = requireDrop(order, dropId);
        const next = nextDropStatus('accept', drop.status);
        if (next === null) {
          throw apiError.invalidTransition(
            orderStatusLabel(order.status, order.settlementStatus),
            order.ref,
          );
        }
        await client.query('update drops set status = $2 where id = $1', [dropId, next]);
        await recordAudit(client, {
          entityType: 'drop',
          entityId: dropId,
          action: 'accepted',
          actorId: actor.id,
        });
      });
      return dropReply(dropId, context.order.id, actor);
    },
  },
  {
    method: 'POST',
    path: '/api/drops/:id/dispute',
    body: 'json',
    auth: 'session',
    handle: async (ctx) => {
      const actor = requireActor(ctx);
      const dropId = ctx.params.id as string;
      const context = await requireVisibleDrop(actor, dropId);
      if (actor.role !== 'beekeeper' || context.drop.beekeeperId !== actor.id) {
        throw apiError.forbidden();
      }
      await withTransaction(async (client) => {
        const order = await lockOrder(client, context.order.id);
        const drop = requireDrop(order, dropId);
        const next = nextDropStatus('dispute', drop.status);
        if (next === null) {
          throw apiError.invalidTransition(
            orderStatusLabel(order.status, order.settlementStatus),
            order.ref,
          );
        }
        const fields = new FieldErrors();
        const reason = trimmedString(ctx.body.json.reason);
        if (!lengthWithin(reason, 10, 500)) {
          fields.add('reason', 'Reason must be 10 to 500 characters');
        }
        fields.throwIfAny();
        await client.query('update drops set status = $2, dispute_reason = $3 where id = $1', [
          dropId,
          next,
          reason,
        ]);
        await recordAudit(client, {
          entityType: 'drop',
          entityId: dropId,
          action: 'disputed',
          actorId: actor.id,
          detail: { reason },
        });
      });
      return dropReply(dropId, context.order.id, actor);
    },
  },
  {
    method: 'POST',
    path: '/api/drops/:id/resolve',
    body: 'json',
    auth: 'session',
    handle: async (ctx) => {
      const actor = requireActor(ctx);
      const dropId = ctx.params.id as string;
      const context = await requireVisibleDrop(actor, dropId);
      if (actor.role !== 'broker') throw apiError.forbidden();
      await withTransaction(async (client) => {
        const order = await lockOrder(client, context.order.id);
        const drop = requireDrop(order, dropId);
        const next = nextDropStatus('resolve', drop.status);
        if (next === null) {
          throw apiError.invalidTransition(
            orderStatusLabel(order.status, order.settlementStatus),
            order.ref,
          );
        }
        const fields = new FieldErrors();
        const note = trimmedString(ctx.body.json.note);
        if (!lengthWithin(note, 1, 500)) fields.add('note', 'Note must be 1 to 500 characters');
        fields.throwIfAny();
        await client.query('update drops set status = $2, resolution_note = $3 where id = $1', [
          dropId,
          next,
          note,
        ]);
        await recordAudit(client, {
          entityType: 'drop',
          entityId: dropId,
          action: 'resolved',
          actorId: actor.id,
          detail: { note },
        });
      });
      return dropReply(dropId, context.order.id, actor);
    },
  },
];
