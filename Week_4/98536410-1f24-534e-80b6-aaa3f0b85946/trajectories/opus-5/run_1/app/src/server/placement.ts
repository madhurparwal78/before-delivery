import { randomUUID } from 'node:crypto';
import { asNumber, beginTransaction, query } from './db.js';
import type { Row } from './db.js';
import { SLOT_CAPACITY } from './domain/hours.js';
import { formatAmount, lineTotalCents, vatCents } from './domain/money.js';
import {
  holdExpired,
  invalidTransition,
  notFound,
  slotUnavailable,
  validationFailed,
} from './http/errors.js';
import { releaseHoldOnce, releaseHoldWithin } from './holds.js';
import { appendEvent, orderObjectOf, rebuildOrderView } from './orders.js';
import type { OrderRecord } from './orders.js';
import { consumeHeldUnits } from './stock.js';
import {
  deleteObject,
  orderDocumentKey,
  putObject,
} from './services/storage.js';
import { isOfferedSlot, loadStore } from './views.js';
import type { OrderObject } from './views.js';
import type { JsonValue } from './domain/history.js';

export type PlacementInput = {
  operatorId: string;
  userId: string;
  holdId: string;
  slotStartUtc: string;
  customerName: string;
  customerEmail: string;
};

/**
 * Commits the order rows, the stored document and the rebuilt summary together or leaves
 * none of them: the document is written while the transaction is still open, so a storage
 * failure rolls everything back and leaves the hold active.
 */
export async function placeOrder(input: PlacementInput): Promise<OrderObject> {
  const holdRow = (
    await query(`SELECT * FROM holds WHERE id = $1 AND user_id = $2`, [input.holdId, input.userId])
  )[0];
  if (!holdRow) throw notFound();

  const storeId = holdRow['store_id'] as string;
  const store = await loadStore(input.operatorId, storeId);
  if (!store) throw notFound();

  const now = new Date();
  if (holdRow['status'] === 'active' && (holdRow['expires_at'] as Date).getTime() <= now.getTime()) {
    await releaseHoldOnce(input.holdId, 'window_ended');
    throw holdExpired(input.holdId);
  }
  if (holdRow['status'] === 'released') {
    if (holdRow['release_reason'] === 'window_ended') throw holdExpired(input.holdId);
    throw invalidTransition('released', 'converted');
  }
  if (holdRow['status'] === 'converted') throw invalidTransition('converted', 'converted');

  if (!(await isOfferedSlot(store, now, input.slotStartUtc))) throw slotUnavailable();

  const handle = await beginTransaction();
  let documentKey: string | null = null;
  try {
    const { tx } = handle;

    await tx.query(
      `INSERT INTO slot_locks (store_id, slot_start_utc) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [storeId, input.slotStartUtc],
    );
    await tx.query(
      `SELECT store_id FROM slot_locks WHERE store_id = $1 AND slot_start_utc = $2 FOR UPDATE`,
      [storeId, input.slotStartUtc],
    );
    const taken = asNumber(
      (
        await tx.query(
          `SELECT count(*) AS taken FROM orders
            WHERE store_id = $1 AND slot_start_utc = $2 AND status <> 'cancelled'`,
          [storeId, input.slotStartUtc],
        )
      ).rows[0]!['taken'],
    );
    if (taken >= SLOT_CAPACITY) throw slotUnavailable();

    const locked = (
      await tx.query(`SELECT * FROM holds WHERE id = $1 FOR UPDATE`, [input.holdId])
    ).rows[0] as Row;
    if (locked['status'] !== 'active') {
      if (locked['release_reason'] === 'window_ended') throw holdExpired(input.holdId);
      throw invalidTransition(locked['status'] as string, 'converted');
    }
    if ((locked['expires_at'] as Date).getTime() <= Date.now()) {
      await releaseHoldWithin(tx, input.holdId, 'window_ended');
      await handle.commit();
      throw holdExpired(input.holdId);
    }

    const holdLines = (
      await tx.query(
        `SELECT h.sku, h.quantity, p.name, p.unit_price_milli FROM hold_lines h
           JOIN products p ON p.operator_id = $2 AND p.sku = h.sku
          WHERE h.hold_id = $1 ORDER BY h.sku`,
        [input.holdId, input.operatorId],
      )
    ).rows;

    await tx.query(`UPDATE holds SET status = 'converted' WHERE id = $1`, [input.holdId]);
    await consumeHeldUnits(
      tx,
      storeId,
      holdLines.map((line) => ({
        sku: line['sku'] as string,
        quantity: asNumber(line['quantity']),
      })),
    );

    const prefix = (
      await tx.query(`SELECT order_prefix FROM operators WHERE id = $1`, [input.operatorId])
    ).rows[0]!['order_prefix'] as string;
    const sequence = asNumber(
      (
        await tx.query(
          `UPDATE order_numbers SET next_number = next_number + 1 WHERE operator_id = $1
            RETURNING next_number - 1 AS taken`,
          [input.operatorId],
        )
      ).rows[0]!['taken'],
    );
    const number = `${prefix}-${String(sequence).padStart(6, '0')}`;

    const orderId = randomUUID();
    let totalCents = 0;
    let totalVat = 0;
    const eventLines: JsonValue[] = [];

    for (const line of holdLines) {
      const quantity = asNumber(line['quantity']);
      const unitPrice = asNumber(line['unit_price_milli']);
      const lineTotal = lineTotalCents(quantity, unitPrice);
      const lineVat = vatCents(lineTotal, store.vatRate);
      totalCents += lineTotal;
      totalVat += lineVat;
      eventLines.push({
        line_total_cents: lineTotal,
        quantity,
        sku: line['sku'] as string,
        unit_price_milli: unitPrice,
        vat_cents: lineVat,
      });
    }

    await tx.query(
      `INSERT INTO orders (id, operator_id, store_id, user_id, number, status, slot_start_utc,
         customer_name, customer_email, total_cents, vat_cents, created_at)
       VALUES ($1,$2,$3,$4,$5,'placed',$6,$7,$8,$9,$10, now())`,
      [
        orderId,
        input.operatorId,
        storeId,
        input.userId,
        number,
        input.slotStartUtc,
        input.customerName,
        input.customerEmail,
        totalCents,
        totalVat,
      ],
    );
    for (const line of holdLines) {
      const quantity = asNumber(line['quantity']);
      const unitPrice = asNumber(line['unit_price_milli']);
      const lineTotal = lineTotalCents(quantity, unitPrice);
      await tx.query(
        `INSERT INTO order_lines (order_id, sku, name, quantity, unit_price_milli,
           line_total_cents, vat_rate, vat_cents) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          orderId,
          line['sku'],
          line['name'],
          quantity,
          unitPrice,
          lineTotal,
          store.vatRate,
          vatCents(lineTotal, store.vatRate),
        ],
      );
    }

    await appendEvent(tx, orderId, 'order.placed', {
      hold_id: input.holdId,
      lines: eventLines,
      number,
      slot_start_utc: new Date(input.slotStartUtc).toISOString(),
      store_id: storeId,
      total_cents: totalCents,
      vat_cents: totalVat,
    });
    await rebuildOrderView(tx, orderId);

    await tx.query(`DELETE FROM cart_lines WHERE user_id = $1`, [input.userId]);

    const record = (
      await tx.query(
        `SELECT o.*, s.name AS store_name, s.timezone FROM orders o
           JOIN stores s ON s.id = o.store_id WHERE o.id = $1`,
        [orderId],
      )
    ).rows[0] as Row;
    const orderRecord: OrderRecord = {
      id: orderId,
      operatorId: input.operatorId,
      storeId,
      storeName: record['store_name'] as string,
      timezone: record['timezone'] as string,
      userId: input.userId,
      number,
      status: 'placed',
      slotStartUtc: record['slot_start_utc'] as Date,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      totalCents,
      vatCents: totalVat,
      createdAt: record['created_at'] as Date,
    };
    const orderObject = await orderObjectOf(orderRecord, tx);

    await tx.query(
      `INSERT INTO mail_outbox (id, order_id, to_address, subject, body, next_attempt_at)
       VALUES ($1,$2,$3,$4,$5, now())`,
      [
        randomUUID(),
        orderId,
        input.customerEmail,
        `Order ${number} confirmed: collect at ${orderRecord.storeName}`,
        [
          `Order ${number}`,
          `Shop: ${orderRecord.storeName}`,
          `Collect on ${orderObject.slot_local_date} at ${orderObject.slot_local_time} (${orderRecord.timezone})`,
          `Total: ${formatAmount(totalCents)}`,
        ].join('\n'),
      ],
    );

    documentKey = orderDocumentKey(input.operatorId, number);
    await putObject(documentKey, Buffer.from(JSON.stringify(orderObject), 'utf8'), 'application/json');

    await handle.commit();
    return orderObject;
  } catch (error) {
    await handle.rollback();
    if (documentKey !== null) await deleteObject(documentKey);
    throw error;
  }
}

export function validateCustomer(source: Record<string, unknown>): {
  name: string;
  email: string;
} {
  const customer = source['customer'];
  if (typeof customer !== 'object' || customer === null) {
    throw validationFailed({ customer: 'Send the collecting customer.' });
  }
  const fields = customer as Record<string, unknown>;
  const name = fields['name'];
  const email = fields['email'];
  const errors: Record<string, string> = {};
  if (typeof name !== 'string' || name.length < 1 || name.length > 120) {
    errors['customer.name'] = 'Enter a name of 1 to 120 characters.';
  }
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    errors['customer.email'] = 'Enter an email address.';
  }
  if (Object.keys(errors).length > 0) throw validationFailed(errors);
  return { name: name as string, email: email as string };
}
