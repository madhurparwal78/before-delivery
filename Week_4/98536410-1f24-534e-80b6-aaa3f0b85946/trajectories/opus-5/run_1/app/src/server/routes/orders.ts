import { randomUUID } from 'node:crypto';
import { asNumber, query, serverNow, withTransaction } from '../db.js';
import {
  ApiError,
  forbidden,
  invalidTransition,
  notFound,
  storageUnavailableError,
  validationFailed,
} from '../http/errors.js';
import { bodyObject, param, requireRole, requireSession, stringField } from '../http/context.js';
import type { RequestContext, SessionUser } from '../http/context.js';
import { json, raw } from '../http/result.js';
import type { ApiResult } from '../http/result.js';
import { isoMillis } from '../domain/time.js';
import { refundCents } from '../domain/money.js';
import {
  canMoveOrder,
  canMoveReturn,
  isOrderStatus,
  isReturnStatus,
  ORDER_EVENT_OF_STATUS,
  RETURN_EVENT_OF_STATUS,
} from '../domain/transitions.js';
import type { OrderStatus, ReturnStatus } from '../domain/transitions.js';
import {
  appendEvent,
  assertChain,
  loadOrderRecord,
  loadReturnWithOrder,
  maySeeOrder,
  orderLines,
  orderObjectOf,
  rebuildOrderView,
  replayOf,
  toReturnObject,
} from '../orders.js';
import type { OrderRecord } from '../orders.js';
import { placeOrder, validateCustomer } from '../placement.js';
import { claimRequestKey, finishRequestKey, readRequestKey } from '../requestKeys.js';
import { returnUnitsToShelf } from '../stock.js';
import {
  StorageUnavailable,
  getObject,
  isStorageUp,
  orderDocumentKey,
  putObject,
  returnLabelKey,
} from '../services/storage.js';
import { trimmedQuery } from './stores.js';
import type { JsonValue } from '../domain/history.js';

const DEFAULT_PAGE = 20;
const MAX_PAGE = 100;

export async function postOrder(context: RequestContext): Promise<ApiResult> {
  const session = requireRole(context, 'shopper');
  const requestKey = readRequestKey({ headers: context.request.headers as Record<string, unknown> });
  const fields = bodyObject(context);

  const claim = await claimRequestKey(
    session.operatorId,
    session.userId,
    'order',
    requestKey,
    fields,
  );
  if (claim.kind === 'replay') return json(claim.answer.body, claim.answer.status);

  try {
    const holdId = fields['hold_id'];
    if (typeof holdId !== 'string' || !/^[0-9a-f-]{36}$/i.test(holdId)) throw notFound();
    const owned = await query(`SELECT id FROM holds WHERE id = $1 AND user_id = $2`, [
      holdId,
      session.userId,
    ]);
    if (owned.length === 0) throw notFound();

    const slotStart = fields['slot_start_utc'];
    if (typeof slotStart !== 'string' || Number.isNaN(Date.parse(slotStart))) {
      throw validationFailed({ slot_start_utc: 'Choose a collection time.' });
    }
    const customer = validateCustomer(fields);
    if (!isStorageUp()) throw storageUnavailableError();

    const order = await placeOrder({
      operatorId: session.operatorId,
      userId: session.userId,
      holdId,
      slotStartUtc: isoMillis(new Date(slotStart)),
      customerName: customer.name,
      customerEmail: customer.email,
    });
    await finishRequestKey(session.operatorId, session.userId, requestKey, 201, order);
    return json(order, 201);
  } catch (error) {
    if (error instanceof StorageUnavailable) {
      await finishRequestKey(session.operatorId, session.userId, requestKey, 503, {});
      throw storageUnavailableError();
    }
    if (error instanceof ApiError) {
      await finishRequestKey(
        session.operatorId,
        session.userId,
        requestKey,
        error.status,
        error.body(),
      );
    } else {
      await finishRequestKey(session.operatorId, session.userId, requestKey, 500, {});
    }
    throw error;
  }
}

function visibilityClause(session: SessionUser, values: unknown[]): string {
  if (session.role === 'shopper') {
    values.push(session.userId);
    return `AND o.user_id = $${values.length}`;
  }
  if (session.role === 'manager') {
    values.push(session.storeIds);
    return `AND o.store_id = ANY($${values.length}::text[])`;
  }
  return '';
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const split = decoded.lastIndexOf('|');
  const createdAt = decoded.slice(0, split);
  const id = decoded.slice(split + 1);
  if (split === -1 || Number.isNaN(Date.parse(createdAt)) || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw validationFailed({ before: 'Use a cursor from next_before.' });
  }
  return { createdAt, id };
}

export async function listOrders(context: RequestContext): Promise<ApiResult> {
  const session = requireSession(context);
  const text = trimmedQuery(context);

  const limitRaw = context.url.searchParams.get('limit');
  let limit = DEFAULT_PAGE;
  if (limitRaw !== null) {
    limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) {
      throw validationFailed({ limit: 'Use a whole number from 1 to 100.' });
    }
  }

  const values: unknown[] = [session.operatorId];
  let filters = `WHERE o.operator_id = $1 ${visibilityClause(session, values)}`;

  if (text !== '') {
    values.push(text);
    filters += ` AND (o.number = $${values.length} OR lower(o.customer_email) = lower($${values.length}))`;
  }
  const storeId = context.url.searchParams.get('store_id');
  if (storeId !== null) {
    values.push(storeId);
    filters += ` AND o.store_id = $${values.length}`;
  }
  const status = context.url.searchParams.get('status');
  if (status !== null) {
    if (!isOrderStatus(status)) throw validationFailed({ status: 'Use a known order status.' });
    values.push(status);
    filters += ` AND o.status = $${values.length}`;
  }

  const total = asNumber(
    (await query(`SELECT count(*) AS total FROM orders o ${filters}`, values))[0]!['total'],
  );

  let pageFilters = filters;
  const before = context.url.searchParams.get('before');
  if (before !== null) {
    const cursor = decodeCursor(before);
    values.push(cursor.createdAt, cursor.id);
    pageFilters += ` AND (o.created_at, o.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`;
  }
  values.push(limit + 1);

  const rows = await query(
    `SELECT o.id, o.number, o.status, o.store_id, s.name AS store_name, o.slot_start_utc,
            o.total_cents, o.customer_email, o.created_at
       FROM orders o JOIN stores s ON s.id = o.store_id ${pageFilters}
      ORDER BY o.created_at DESC, o.id DESC LIMIT $${values.length}`,
    values,
  );

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return json({
    count: total,
    orders: page.map((row) => ({
      id: row['id'] as string,
      number: row['number'] as string,
      status: row['status'] as OrderStatus,
      store_id: row['store_id'] as string,
      store_name: row['store_name'] as string,
      slot_start_utc: isoMillis(row['slot_start_utc'] as Date),
      total_cents: asNumber(row['total_cents']),
      customer_email: row['customer_email'] as string,
      created_at: isoMillis(row['created_at'] as Date),
    })),
    next_before:
      rows.length > limit && last ? encodeCursor(last['created_at'] as Date, last['id'] as string) : null,
  });
}

async function visibleOrder(session: SessionUser, orderId: string): Promise<OrderRecord> {
  const order = await loadOrderRecord(session.operatorId, orderId);
  if (!order || !maySeeOrder(session, order)) throw notFound();
  return order;
}

export async function getOrder(context: RequestContext): Promise<ApiResult> {
  const session = requireSession(context);
  const order = await visibleOrder(session, param(context, 'id'));
  return json(await orderObjectOf(order));
}

export async function postOrderTransition(context: RequestContext): Promise<ApiResult> {
  const session = requireSession(context);
  const order = await visibleOrder(session, param(context, 'id'));

  const fields = bodyObject(context);
  const to = fields['to'];
  if (!isOrderStatus(to) || to === 'placed') {
    throw validationFailed({ to: 'Use a known order status.' });
  }

  const isShopManager = session.role === 'manager' && session.storeIds.includes(order.storeId);
  const careCancelling = session.role === 'care' && to === 'cancelled';
  if (!isShopManager && !careCancelling) throw forbidden();

  await assertChain(order.id);
  if (!canMoveOrder(order.status, to)) throw invalidTransition(order.status, to);

  await withTransaction(async (tx) => {
    const current = (
      await tx.query(`SELECT status FROM orders WHERE id = $1 FOR UPDATE`, [order.id])
    ).rows[0]!['status'] as OrderStatus;
    if (!canMoveOrder(current, to)) throw invalidTransition(current, to);

    if (to === 'cancelled') {
      const lines = await orderLines(order.id, tx);
      await returnUnitsToShelf(
        tx,
        order.storeId,
        lines.map((line) => ({ sku: line.sku, quantity: line.quantity })),
      );
    }
    await appendEvent(tx, order.id, ORDER_EVENT_OF_STATUS[to], {
      by: session.userId,
      from: current,
      to,
    });
    await rebuildOrderView(tx, order.id);
  });

  const updated = await loadOrderRecord(session.operatorId, order.id);
  return json(await orderObjectOf(updated as OrderRecord));
}

export async function getOrderDocument(context: RequestContext): Promise<ApiResult> {
  const session = requireSession(context);
  const order = await visibleOrder(session, param(context, 'id'));
  if (!isStorageUp()) throw storageUnavailableError();
  const bytes = await getObject(orderDocumentKey(session.operatorId, order.number)).catch(() => {
    throw storageUnavailableError();
  });
  if (!bytes) throw storageUnavailableError();
  return raw(bytes, 'application/json');
}

export async function getOrderEvents(context: RequestContext): Promise<ApiResult> {
  const session = requireRole(context, 'lead', 'care', 'manager');
  const order = await visibleOrder(session, param(context, 'id'));
  const entries = await assertChain(order.id);
  return json({
    order_id: order.id,
    events: entries.map((entry) => ({
      seq: entry.seq,
      type: entry.type,
      at: isoMillis(entry.at),
      data: entry.data,
      digest: entry.digest,
    })),
  });
}

export async function getOrderReplay(context: RequestContext): Promise<ApiResult> {
  const session = requireRole(context, 'lead', 'care', 'manager');
  const order = await visibleOrder(session, param(context, 'id'));
  const rebuilt = await replayOf(order.id);
  return json({
    order_id: order.id,
    status: rebuilt.status,
    last_seq: rebuilt.lastSeq,
    total_cents: rebuilt.totalCents,
    refunded_cents: rebuilt.refundedCents,
    returns: rebuilt.returns.map((item) => ({
      id: item.id,
      status: item.status,
      refund_cents: item.refund_cents,
    })),
  });
}

export async function postReturn(context: RequestContext): Promise<ApiResult> {
  const session = requireSession(context);
  const order = await visibleOrder(session, param(context, 'id'));
  if (session.role !== 'manager' || !session.storeIds.includes(order.storeId)) throw forbidden();

  await assertChain(order.id);
  if (order.status !== 'collected') throw invalidTransition(order.status, 'return.requested');

  const fields = bodyObject(context);
  const reason = stringField(fields, 'reason', 1, 200, 'Give a reason of 1 to 200 characters.');
  const requested = fields['lines'];
  if (!Array.isArray(requested) || requested.length === 0) {
    throw validationFailed({ lines: 'Choose at least one line to return.' });
  }

  const lines = await orderLines(order.id);
  const errors: Record<string, string> = {};
  const wanted: { sku: string; quantity: number }[] = [];

  requested.forEach((entry, index) => {
    const source = entry as Record<string, unknown>;
    const sku = source['sku'];
    const quantity = source['quantity'];
    const line = lines.find((candidate) => candidate.sku === sku);
    if (typeof sku !== 'string' || !line) {
      errors[`lines.${index}.sku`] = 'Choose a line of this order.';
      return;
    }
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) {
      errors[`lines.${index}.quantity`] = 'Enter a whole number of units.';
      return;
    }
    if (quantity > line.quantity - line.returned_quantity) {
      errors[`lines.${index}.quantity`] = 'More than can be returned.';
      return;
    }
    wanted.push({ sku, quantity });
  });
  if (Object.keys(errors).length > 0) throw validationFailed(errors);

  const created = await withTransaction(async (tx) => {
    const sequence =
      asNumber(
        (
          await tx.query(
            `SELECT COALESCE(max(sequence), 0) AS top FROM returns WHERE order_id = $1`,
            [order.id],
          )
        ).rows[0]!['top'],
      ) + 1;
    const returnId = randomUUID();
    const number = `${order.number}-R${sequence}`;

    let refundTotal = 0;
    const eventLines: JsonValue[] = [];
    const storedLines: { sku: string; quantity: number; refund_cents: number }[] = [];

    for (const entry of [...wanted].sort((a, b) => (a.sku < b.sku ? -1 : 1))) {
      const line = lines.find((candidate) => candidate.sku === entry.sku)!;
      const refund = refundCents(
        entry.quantity,
        line.unit_price_milli,
        line.returned_quantity,
        line.quantity,
        line.line_total_cents,
      );
      refundTotal += refund;
      storedLines.push({ sku: entry.sku, quantity: entry.quantity, refund_cents: refund });
      eventLines.push({ quantity: entry.quantity, refund_cents: refund, sku: entry.sku });
    }

    await tx.query(
      `INSERT INTO returns (id, order_id, number, sequence, status, reason, refund_cents, created_at)
       VALUES ($1,$2,$3,$4,'requested',$5,$6, now())`,
      [returnId, order.id, number, sequence, reason, refundTotal],
    );
    for (const line of storedLines) {
      await tx.query(
        `INSERT INTO return_lines (return_id, sku, quantity, refund_cents) VALUES ($1,$2,$3,$4)`,
        [returnId, line.sku, line.quantity, line.refund_cents],
      );
    }
    await appendEvent(tx, order.id, 'return.requested', {
      lines: eventLines,
      number,
      refund_cents: refundTotal,
      return_id: returnId,
    });
    await rebuildOrderView(tx, order.id);

    const row = (await tx.query(`SELECT * FROM returns WHERE id = $1`, [returnId])).rows[0]!;
    const rows = (
      await tx.query(
        `SELECT sku, quantity, refund_cents FROM return_lines WHERE return_id = $1 ORDER BY sku`,
        [returnId],
      )
    ).rows;
    return toReturnObject(row, rows);
  });

  return json(created, 201);
}

export async function listReturns(context: RequestContext): Promise<ApiResult> {
  const session = requireSession(context);
  const storeId = context.url.searchParams.get('store_id');
  if (storeId === null) throw validationFailed({ store_id: 'Name the shop.' });

  const store = (
    await query(`SELECT id FROM stores WHERE id = $1 AND operator_id = $2`, [
      storeId,
      session.operatorId,
    ])
  )[0];
  if (!store) throw notFound();
  const allowed =
    session.role === 'lead' || (session.role === 'manager' && session.storeIds.includes(storeId));
  if (!allowed) throw notFound();

  const rows = await query(
    `SELECT rt.* FROM returns rt JOIN orders o ON o.id = rt.order_id
      WHERE o.store_id = $1 ORDER BY rt.created_at DESC`,
    [storeId],
  );
  const returns = [];
  for (const row of rows) {
    const lines = await query(
      `SELECT sku, quantity, refund_cents FROM return_lines WHERE return_id = $1 ORDER BY sku`,
      [row['id']],
    );
    returns.push(toReturnObject(row, lines));
  }
  return json({ returns });
}

export async function postReturnTransition(context: RequestContext): Promise<ApiResult> {
  const session = requireSession(context);
  const found = await loadReturnWithOrder(session.operatorId, param(context, 'id'));
  if (!found || !maySeeOrder(session, found.order)) throw notFound();
  if (session.role !== 'manager' || !session.storeIds.includes(found.order.storeId)) {
    throw forbidden();
  }

  const to = bodyObject(context)['to'];
  if (!isReturnStatus(to) || to === 'requested') {
    throw validationFailed({ to: 'Use a known return status.' });
  }
  await assertChain(found.order.id);

  const from = found.returnRow['status'] as ReturnStatus;
  if (!canMoveReturn(from, to)) throw invalidTransition(from, to);

  await withTransaction(async (tx) => {
    const current = (
      await tx.query(`SELECT status FROM returns WHERE id = $1 FOR UPDATE`, [found.returnRow['id']])
    ).rows[0]!['status'] as ReturnStatus;
    if (!canMoveReturn(current, to)) throw invalidTransition(current, to);

    const lines = (
      await tx.query(`SELECT sku, quantity FROM return_lines WHERE return_id = $1 ORDER BY sku`, [
        found.returnRow['id'],
      ])
    ).rows;

    if (to === 'received') {
      await returnUnitsToShelf(
        tx,
        found.order.storeId,
        lines.map((line) => ({
          sku: line['sku'] as string,
          quantity: asNumber(line['quantity']),
        })),
      );
    }
    await tx.query(`UPDATE returns SET status = $2 WHERE id = $1`, [found.returnRow['id'], to]);
    await appendEvent(tx, found.order.id, RETURN_EVENT_OF_STATUS[to], {
      by: session.userId,
      from: current,
      return_id: found.returnRow['id'] as string,
      to,
    });
    await rebuildOrderView(tx, found.order.id);
  });

  const row = (await query(`SELECT * FROM returns WHERE id = $1`, [found.returnRow['id']]))[0]!;
  const lines = await query(
    `SELECT sku, quantity, refund_cents FROM return_lines WHERE return_id = $1 ORDER BY sku`,
    [found.returnRow['id']],
  );
  return json(toReturnObject(row, lines));
}

export async function postReturnLabel(context: RequestContext): Promise<ApiResult> {
  const session = requireSession(context);
  const found = await loadReturnWithOrder(session.operatorId, param(context, 'id'));
  if (!found || !maySeeOrder(session, found.order)) throw notFound();
  if (session.role !== 'manager' || !session.storeIds.includes(found.order.storeId)) {
    throw forbidden();
  }
  if (!isStorageUp()) throw storageUnavailableError();

  const returnNumber = found.returnRow['number'] as string;
  const key = returnLabelKey(session.operatorId, returnNumber);
  const existing = await getObject(key).catch(() => {
    throw storageUnavailableError();
  });
  if (existing) return raw(existing, 'text/plain; charset=utf-8');

  const lines = await query(
    `SELECT rl.sku, rl.quantity, p.name FROM return_lines rl
       JOIN products p ON p.sku = rl.sku AND p.operator_id = $2
      WHERE rl.return_id = $1 ORDER BY rl.sku`,
    [found.returnRow['id'], session.operatorId],
  );
  const text = [
    `Tramela return ${returnNumber}`,
    `Order ${found.order.number}`,
    `Shop ${found.order.storeName}`,
    ...lines.map(
      (line) => `${asNumber(line['quantity'])} x ${line['sku'] as string} ${line['name'] as string}`,
    ),
  ].join('\n');

  await putObject(key, Buffer.from(text, 'utf8'), 'text/plain; charset=utf-8').catch(() => {
    throw storageUnavailableError();
  });
  const stored = await getObject(key).catch(() => {
    throw storageUnavailableError();
  });
  return raw(stored ?? Buffer.from(text, 'utf8'), 'text/plain; charset=utf-8');
}

const REVIEW_WINDOW_SECONDS = 86400;

export async function getEstateReview(context: RequestContext): Promise<ApiResult> {
  const session = requireRole(context, 'lead');
  const now = await serverNow();
  const start = new Date(now.getTime() - REVIEW_WINDOW_SECONDS * 1000);
  const rows = await query(
    `SELECT e.seq, e.at, e.order_id, e.type, o.number, o.store_id
       FROM order_events e JOIN orders o ON o.id = e.order_id
      WHERE o.operator_id = $1 AND e.at >= $2 AND e.at <= $3
      ORDER BY e.at, e.seq`,
    [session.operatorId, start, now],
  );
  return json({
    window_start: isoMillis(start),
    window_end: isoMillis(now),
    events: rows.map((row) => ({
      seq: asNumber(row['seq']),
      at: isoMillis(row['at'] as Date),
      order_id: row['order_id'] as string,
      order_number: row['number'] as string,
      store_id: row['store_id'] as string,
      type: row['type'] as string,
    })),
  });
}
