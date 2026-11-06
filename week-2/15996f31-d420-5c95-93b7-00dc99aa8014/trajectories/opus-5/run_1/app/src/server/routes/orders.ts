import { createHash } from 'node:crypto';
import type { Settlement } from '../../shared/api-types';
import { orderStatusLabel } from '../../shared/labels';
import {
  daysBetween,
  isCalendarDate,
  pacificCalendarDate,
} from '../../shared/pacific';
import { config } from '../config';
import { int, one, pool, rows, text, withTransaction } from '../db';
import { issueFileLink } from '../data/file-links';
import {
  hashRequestBody,
  replayResponse,
  requireIdempotencyKey,
  storeResponse,
} from '../data/idempotency';
import { loadOrder, lockOrder, requireVisibleOrder } from '../data/order-access';
import {
  loadOrderAggregates,
  loadRuleSets,
  requireDrop,
  type OrderAggregate,
} from '../data/orders';
import { enqueueEmail, recordAudit } from '../data/outbox';
import { visibleOrderIds } from '../data/visibility';
import { computeOrderFigures, type OrderFigures } from '../domain/figures';
import { newId, newSecret } from '../domain/ids';
import { ruleSetForBloomStart } from '../domain/rules';
import { nextOrderStatus } from '../domain/transitions';
import { ProviderUnavailable, apiError } from '../http/errors';
import { requireRole, type Actor, type Ctx, type Reply, type Route } from '../http/router';
import {
  FieldErrors,
  asArray,
  asRecord,
  isEmailAddress,
  lengthWithin,
  trimmedString,
  wholeNumberWithin,
} from '../http/validate';
import {
  recordDepositInvoice,
  recordSettlementPayment,
  voidDepositInvoice,
} from '../services/billing';
import { inspectionLinkEmail, placementConfirmation } from '../services/emails';
import { pumpOutbox } from '../workers/outbox';
import {
  beekeeperOrderListView,
  beekeeperOrderView,
  brokerOrderListView,
  brokerOrderView,
  dropView,
  growerOrderListView,
  growerOrderView,
  settlementView,
} from '../views/orders';
import { allocateSettlement } from '../domain/allocation';

const BAD_DATE = 'Use a date like 2027-02-05';
const NO_RULE_SET = 'No pay rules cover this bloom start';
const MAX_BLOOM_SPAN_DAYS = 45;

function orderJson(actor: Actor, order: OrderAggregate, figures: OrderFigures, now: Date): unknown {
  if (actor.role === 'broker') return brokerOrderView(order, figures, now);
  if (actor.role === 'grower') return growerOrderView(order, figures);
  return beekeeperOrderView(order, figures, actor.id);
}

function orderListJson(
  actor: Actor,
  order: OrderAggregate,
  figures: OrderFigures,
  now: Date,
): unknown {
  if (actor.role === 'broker') return brokerOrderListView(order, figures, now);
  if (actor.role === 'grower') return growerOrderListView(order, figures);
  return beekeeperOrderListView(order, figures);
}

function statusLabelOf(order: OrderAggregate): string {
  return orderStatusLabel(order.status, order.settlementStatus);
}

async function reloadReply(orderId: string, actor: Actor, status = 200): Promise<Reply> {
  const order = await loadOrder(orderId);
  return { status, json: orderJson(actor, order, computeOrderFigures(order), new Date()) };
}

async function nextOrderRef(client: {
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}): Promise<string> {
  const result = await client.query("select nextval('order_ref_seq') as value");
  return `BD-${int(result.rows[0]?.value ?? 0)}`;
}

export const orderRoutes: readonly Route[] = [
  {
    method: 'GET',
    path: '/api/orders',
    body: 'none',
    auth: 'session',
    handle: async (ctx) => {
      const actor = requireRole(ctx, 'broker', 'grower', 'beekeeper');
      const ids = await visibleOrderIds(pool, actor);
      const aggregates = await loadOrderAggregates(pool, ids);
      const now = new Date();
      const list = [...aggregates.values()]
        .sort((left, right) =>
          left.bloomStart === right.bloomStart
            ? left.ref < right.ref
              ? -1
              : 1
            : left.bloomStart < right.bloomStart
              ? -1
              : 1,
        )
        .map((order) => orderListJson(actor, order, computeOrderFigures(order), now));
      return { status: 200, json: list };
    },
  },
  {
    method: 'GET',
    path: '/api/orders/:id',
    body: 'none',
    auth: 'session',
    handle: async (ctx) => {
      const actor = requireRole(ctx, 'broker', 'grower', 'beekeeper');
      const order = await requireVisibleOrder(pool, actor, ctx.params.id as string);
      return {
        status: 200,
        json: orderJson(actor, order, computeOrderFigures(order), new Date()),
      };
    },
  },
  {
    method: 'POST',
    path: '/api/orders',
    body: 'json',
    auth: 'session',
    handle: async (ctx) => {
      const actor = requireRole(ctx, 'broker');
      const fields = new FieldErrors();
      const orchardId = trimmedString(ctx.body.json.orchard_id);
      const bloomStart = ctx.body.json.bloom_start;
      const bloomEnd = ctx.body.json.bloom_end;
      const deliveryDeadline = ctx.body.json.delivery_deadline;

      const orchard =
        orchardId === null
          ? null
          : await one(pool, 'select id from orchards where id = $1', [orchardId]);
      if (orchard === null) fields.add('orchard_id', 'Choose an orchard');

      if (!isCalendarDate(bloomStart)) fields.add('bloom_start', BAD_DATE);
      if (!isCalendarDate(bloomEnd)) fields.add('bloom_end', BAD_DATE);
      if (!isCalendarDate(deliveryDeadline)) fields.add('delivery_deadline', BAD_DATE);

      const ruleSets = await loadRuleSets(pool);
      const ruleSet = isCalendarDate(bloomStart)
        ? ruleSetForBloomStart(ruleSets, bloomStart)
        : null;
      if (isCalendarDate(bloomStart) && ruleSet === null) {
        fields.add('bloom_start', NO_RULE_SET);
      }

      if (isCalendarDate(bloomStart) && isCalendarDate(bloomEnd)) {
        const span = daysBetween(bloomStart, bloomEnd);
        if (span < 0 || span > MAX_BLOOM_SPAN_DAYS) {
          fields.add(
            'bloom_end',
            'Bloom end must be on or after bloom start and within 45 days of it',
          );
        }
      }
      if (isCalendarDate(bloomStart) && isCalendarDate(deliveryDeadline)) {
        if (deliveryDeadline > bloomStart) {
          fields.add('delivery_deadline', 'Delivery deadline must be on or before bloom start');
        }
      }

      const rawBlocks = asArray(ctx.body.json.blocks);
      const orchardBlocks =
        orchardId === null
          ? []
          : await rows(pool, 'select id from blocks where orchard_id = $1', [orchardId]);
      const orchardBlockIds = new Set(orchardBlocks.map((row) => text(row.id)));
      const chosen: Array<{ blockId: string; hives: number }> = [];
      const seen = new Set<string>();
      if (rawBlocks.length === 0) fields.add('blocks', 'Order at least one block, each block once');
      rawBlocks.forEach((entry, index) => {
        const record = asRecord(entry);
        const blockId = trimmedString(record.block_id);
        const hives = wholeNumberWithin(record.hives, 1, 2000);
        if (blockId === null || !orchardBlockIds.has(blockId)) {
          fields.add(`blocks.${index}.block_id`, "That block isn't on this orchard");
        } else if (seen.has(blockId)) {
          fields.add('blocks', 'Order at least one block, each block once');
        } else {
          seen.add(blockId);
        }
        if (hives === null) {
          fields.add(`blocks.${index}.hives`, 'Hives must be a whole number from 1 to 2000');
        }
        if (blockId !== null && hives !== null) chosen.push({ blockId, hives });
      });
      fields.throwIfAny();
      if (ruleSet === null) throw apiError.validation({ bloom_start: NO_RULE_SET });

      const orderId = newId('ord');
      await withTransaction(async (client) => {
        const ref = await nextOrderRef(client);
        await client.query(
          `insert into orders (id, ref, orchard_id, rule_set_id, status, bloom_start, bloom_end,
             delivery_deadline) values ($1,$2,$3,$4,'draft',$5,$6,$7)`,
          [orderId, ref, orchardId, ruleSet.id, bloomStart, bloomEnd, deliveryDeadline],
        );
        for (let index = 0; index < chosen.length; index += 1) {
          const block = chosen[index] as { blockId: string; hives: number };
          await client.query(
            'insert into order_blocks (order_id, block_id, hives_ordered, position) values ($1,$2,$3,$4)',
            [orderId, block.blockId, block.hives, index],
          );
        }
        await recordAudit(client, {
          entityType: 'order',
          entityId: orderId,
          action: 'drafted',
          actorId: actor.id,
          detail: { ref },
        });
      });
      return reloadReply(orderId, actor, 201);
    },
  },
  {
    method: 'POST',
    path: '/api/orders/:id/open',
    body: 'json',
    auth: 'session',
    handle: async (ctx) => {
      const actor = requireRole(ctx, 'broker');
      const orderId = ctx.params.id as string;
      await requireVisibleOrder(pool, actor, orderId);
      await withTransaction(async (client) => {
        const order = await lockOrder(client, orderId);
        const next = nextOrderStatus('open', order.status);
        if (next === null) throw apiError.invalidTransition(statusLabelOf(order), order.ref);
        const figures = computeOrderFigures(order);
        await recordDepositInvoice(client, order, figures);
        await client.query('update orders set status = $2 where id = $1', [orderId, next]);
        await recordAudit(client, {
          entityType: 'order',
          entityId: orderId,
          action: 'opened',
          actorId: actor.id,
          detail: { deposit_cents: figures.depositCents },
        });
      });
      return reloadReply(orderId, actor);
    },
  },
  {
    method: 'POST',
    path: '/api/orders/:id/cancel',
    body: 'json',
    auth: 'session',
    handle: async (ctx) => {
      const actor = requireRole(ctx, 'broker');
      const orderId = ctx.params.id as string;
      await requireVisibleOrder(pool, actor, orderId);
      await withTransaction(async (client) => {
        const order = await lockOrder(client, orderId);
        const next = nextOrderStatus('cancel', order.status);
        if (next === null) throw apiError.invalidTransition(statusLabelOf(order), order.ref);
        if (order.drops.some((drop) => drop.status !== 'committed')) {
          throw apiError.dropsDelivered(order.ref);
        }
        await voidDepositInvoice(client, order);
        await client.query('update orders set status = $2 where id = $1', [orderId, next]);
        await recordAudit(client, {
          entityType: 'order',
          entityId: orderId,
          action: 'cancelled',
          actorId: actor.id,
        });
      });
      return reloadReply(orderId, actor);
    },
  },
  {
    method: 'POST',
    path: '/api/orders/:id/drops',
    body: 'json',
    auth: 'session',
    handle: async (ctx) => {
      const actor = requireRole(ctx, 'beekeeper');
      const orderId = ctx.params.id as string;
      await requireVisibleOrder(pool, actor, orderId);
      const dropId = newId('drp');
      await withTransaction(async (client) => {
        const order = await lockOrder(client, orderId);
        const figures = computeOrderFigures(order);
        if (order.status === 'filled') throw apiError.notEnoughOpenHives(0, order.ref);
        if (order.status !== 'open') {
          throw apiError.invalidTransition(statusLabelOf(order), order.ref);
        }
        const requested = ctx.body.json.hives;
        if (typeof requested === 'number' && requested > figures.hivesRemaining) {
          throw apiError.notEnoughOpenHives(figures.hivesRemaining, order.ref);
        }
        const fields = new FieldErrors();
        const yardName = trimmedString(ctx.body.json.yard_name);
        const hives = wholeNumberWithin(requested, 1, 1000);
        if (!lengthWithin(yardName, 1, 60)) {
          fields.add('yard_name', 'Yard name must be 1 to 60 characters');
        }
        if (hives === null) fields.add('hives', 'Hives must be a whole number from 1 to 1000');
        fields.throwIfAny();

        await client.query(
          `insert into drops (id, order_id, beekeeper_id, yard_name, hives, status)
           values ($1,$2,$3,$4,$5,'committed')`,
          [dropId, orderId, actor.id, yardName, hives],
        );
        if (figures.hivesCommitted + (hives as number) >= figures.hivesOrdered) {
          const filled = nextOrderStatus('fill', order.status);
          await client.query('update orders set status = $2 where id = $1', [orderId, filled]);
        }
        await recordAudit(client, {
          entityType: 'drop',
          entityId: dropId,
          action: 'committed',
          actorId: actor.id,
          detail: { order_id: orderId, hives },
        });
      });
      const order = await loadOrder(orderId);
      const figures = computeOrderFigures(order);
      return { status: 201, json: dropView(order, figures, requireDrop(order, dropId), false) };
    },
  },
  {
    method: 'POST',
    path: '/api/orders/:id/place',
    body: 'json',
    auth: 'session',
    handle: async (ctx) => {
      const actor = requireRole(ctx, 'broker');
      const orderId = ctx.params.id as string;
      await requireVisibleOrder(pool, actor, orderId);
      await withTransaction(async (client) => {
        const order = await lockOrder(client, orderId);
        const next = nextOrderStatus('place', order.status);
        if (next === null) throw apiError.invalidTransition(statusLabelOf(order), order.ref);
        if (order.drops.some((drop) => drop.status === 'committed')) {
          throw apiError.dropsNotDelivered(order.ref);
        }
        await client.query('update orders set status = $2 where id = $1', [orderId, next]);
        await enqueueEmail(client, placementConfirmation(order, computeOrderFigures(order)));
        await recordAudit(client, {
          entityType: 'order',
          entityId: orderId,
          action: 'placed',
          actorId: actor.id,
        });
      });
      void pumpOutbox();
      return reloadReply(orderId, actor);
    },
  },
  {
    method: 'POST',
    path: '/api/orders/:id/inspection-links',
    body: 'json',
    auth: 'session',
    handle: async (ctx) => {
      const actor = requireRole(ctx, 'broker');
      const orderId = ctx.params.id as string;
      await requireVisibleOrder(pool, actor, orderId);
      const created = await withTransaction(async (client) => {
        const order = await lockOrder(client, orderId);
        if (nextOrderStatus('issue_link', order.status) === null) {
          throw apiError.invalidTransition(statusLabelOf(order), order.ref);
        }
        const fields = new FieldErrors();
        const inspectorEmail = trimmedString(ctx.body.json.inspector_email);
        if (!isEmailAddress(inspectorEmail)) {
          fields.add('inspector_email', 'Enter an email address like name@example.com');
        }
        fields.throwIfAny();

        await client.query(
          `update inspection_links set status = 'expired'
            where order_id = $1 and status in ('issued','used')`,
          [orderId],
        );
        const linkId = newId('inl');
        const token = newSecret();
        const expiresAt = new Date(Date.now() + config.inspectionLinkTtlSeconds * 1000);
        await client.query(
          `insert into inspection_links (id, order_id, token_hash, inspector_email, status, expires_at)
           values ($1,$2,$3,$4,'issued',$5)`,
          [
            linkId,
            orderId,
            createHash('sha256').update(token).digest('hex'),
            inspectorEmail,
            expiresAt.toISOString(),
          ],
        );
        await enqueueEmail(
          client,
          inspectionLinkEmail({
            order,
            linkId,
            token,
            inspectorEmail: inspectorEmail as string,
            expiresAt,
          }),
        );
        await recordAudit(client, {
          entityType: 'inspection_link',
          entityId: linkId,
          action: 'issued',
          actorId: actor.id,
          detail: { order_id: orderId, inspector_email: inspectorEmail },
        });
        return {
          id: linkId,
          status: 'issued',
          inspector_email: inspectorEmail as string,
          expires_at: expiresAt.toISOString(),
        };
      });
      void pumpOutbox();
      return { status: 201, json: created };
    },
  },
  {
    method: 'GET',
    path: '/api/orders/:id/settlement',
    body: 'none',
    auth: 'session',
    handle: async (ctx) => {
      const actor = requireRole(ctx, 'broker');
      const order = await requireVisibleOrder(pool, actor, ctx.params.id as string);
      return { status: 200, json: settlementView(order, computeOrderFigures(order)) };
    },
  },
  {
    method: 'POST',
    path: '/api/orders/:id/settle',
    body: 'json',
    auth: 'session',
    handle: async (ctx) => settle(ctx),
  },
  {
    method: 'GET',
    path: '/api/orders/:id/report',
    body: 'none',
    auth: 'session',
    handle: async (ctx) => {
      const actor = requireRole(ctx, 'broker', 'grower', 'beekeeper');
      const orderId = ctx.params.id as string;
      const order = await requireVisibleOrder(pool, actor, orderId);
      if (actor.role === 'beekeeper' && !order.drops.some((drop) => drop.beekeeperId === actor.id)) {
        throw apiError.notFound();
      }
      const link = order.inspectionLink;
      if (link === null || link.status !== 'signed' || link.reportKey === null) {
        throw apiError.notFound();
      }
      const location = await issueFileLink(pool, {
        objectKey: link.reportKey,
        contentType: 'application/pdf',
        filename: 'report.pdf',
      });
      return { status: 302, headers: { Location: location, 'Cache-Control': 'private, no-store' } };
    },
  },
];

async function settle(ctx: Ctx): Promise<Reply> {
  const actor = requireRole(ctx, 'broker');
  const orderId = ctx.params.id as string;
  await requireVisibleOrder(pool, actor, orderId);
  const key = requireIdempotencyKey(ctx.headers);
  const scope = `settle:${orderId}`;
  const requestHash = hashRequestBody(ctx.body.json);
  const replay = await replayResponse(pool, scope, key, requestHash);
  if (replay !== null) return { status: replay.status, json: replay.body };

  const prepared = await withTransaction(async (client) => {
    const order = await lockOrder(client, orderId);
    if (order.settlementStatus !== 'none') throw apiError.alreadySettled(order.orchard.name);
    if (nextOrderStatus('settle', order.status) === null) {
      throw apiError.invalidTransition(statusLabelOf(order), order.ref);
    }
    if (order.drops.some((drop) => drop.status !== 'accepted')) {
      throw apiError.dropsNotAccepted(order.orchard.name);
    }
    const fields = new FieldErrors();
    const paymentReceivedOn = ctx.body.json.payment_received_on;
    if (!isCalendarDate(paymentReceivedOn)) {
      fields.add('payment_received_on', BAD_DATE);
    } else if (paymentReceivedOn > pacificCalendarDate(new Date())) {
      fields.add('payment_received_on', "Payment date can't be after today (Pacific)");
    }
    fields.throwIfAny();

    const figures = computeOrderFigures(order);
    const grosses = [...figures.grossByBeekeeper.entries()].map(([beekeeperId, grossCents]) => ({
      beekeeperId,
      grossCents,
    }));
    const allocation = allocateSettlement(
      figures.payableCents,
      order.ruleSet.commissionBps,
      grosses,
    );
    const shares = allocation.shares.map((share) => ({
      beekeeperId: share.beekeeperId,
      hives: figures.hivesByBeekeeper.get(share.beekeeperId) ?? 0,
      grossCents: figures.grossByBeekeeper.get(share.beekeeperId) ?? 0,
      payoutCents: share.payoutCents,
    }));
    await client.query(
      `insert into settlements (order_id, status, payment_received_on, rule_set_id, payable_cents,
         commission_bps, commission_cents, shares)
       values ($1,'queued',$2,$3,$4,$5,$6,$7::jsonb)`,
      [
        orderId,
        paymentReceivedOn,
        order.ruleSet.id,
        figures.payableCents,
        order.ruleSet.commissionBps,
        allocation.commissionCents,
        JSON.stringify(shares),
      ],
    );
    await client.query("update orders set settlement_status = 'queued' where id = $1", [orderId]);
    await recordAudit(client, {
      entityType: 'order',
      entityId: orderId,
      action: 'settlement_queued',
      actorId: actor.id,
      detail: { payable_cents: figures.payableCents },
    });
    return { payableCents: figures.payableCents };
  });

  const completed = await completeSettlement(orderId, prepared.payableCents, actor.id);
  const order = await loadOrder(orderId);
  const settlement: Settlement = settlementView(order, computeOrderFigures(order));
  const reply: Reply = completed
    ? { status: 200, json: { status: 'settled', settlement } }
    : { status: 202, json: { status: 'queued', settlement } };
  await storeResponse(pool, scope, key, requestHash, {
    status: reply.status,
    body: reply.json,
  });
  return reply;
}

/** Records the grower's payment and marks the order settled, once. */
export async function completeSettlement(
  orderId: string,
  payableCents: number,
  actorId: string | null,
): Promise<boolean> {
  try {
    await withTransaction(async (client) => {
      const order = await lockOrder(client, orderId);
      if (order.settlementStatus === 'settled') return;
      await recordSettlementPayment(client, order, payableCents);
      await client.query(
        `update settlements set status = 'settled', settled_at = now() where order_id = $1`,
        [orderId],
      );
      await client.query(
        `update orders set status = 'settled', settlement_status = 'settled' where id = $1`,
        [orderId],
      );
      await recordAudit(client, {
        entityType: 'order',
        entityId: orderId,
        action: 'settled',
        actorId,
        detail: { payable_cents: payableCents },
      });
    });
    return true;
  } catch (error) {
    if (error instanceof ProviderUnavailable && error.provider === 'billing') return false;
    throw error;
  }
}
