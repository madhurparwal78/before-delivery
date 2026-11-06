// Refunds: exact allocation, the version check, Kill Bill item adjustments
// adjusted item by item, one audit entry, and the race rules against shipping.
import { type Pool, type PoolClient } from "pg";
import { ApiError } from "../core/http.js";
import type { Locale } from "../core/catalog.js";
import { message, fieldMessage } from "../core/copy.js";
import { applyRate, money, BAR_PRICE_CENTS } from "../core/money.js";
import { taxLinesFromJson } from "./stock.js";
import { hasControlChars } from "./text.js";
import { refundEmail } from "../core/emails.js";
import { queueNotice, type Outbox } from "../services/outbox.js";
import { KillBillClient, KillBillError, centsToKb } from "../services/killbill.js";
import type { OrderRecord, RefundRecord } from "./views.js";
import { writeAudit, type AuditActor } from "./audit.js";
import { dateToString } from "../core/toronto.js";
import { DROP_SCENTS } from "../core/catalog.js";

export interface RefundInput {
  bars: { batch: string; bar: number }[];
  restock: boolean;
  reason: string;
}

export interface RefundOutcome {
  refund: RefundRecord;
  order: OrderRecord;
}

export function orderFromRow(row: Record<string, unknown>, lines: unknown[]): OrderRecord {
  return {
    number: row.number as string,
    status: row.status as string,
    fulfilment: row.fulfilment as string,
    placed_at: row.placed_at as Date,
    ship_on: dateToString(row.ship_on as string | Date),
    locale: row.locale as string,
    email: row.email as string,
    name: row.name as string,
    line1: row.line1 as string,
    city: row.city as string,
    province: row.province as string,
    postal_code: row.postal_code as string,
    subtotal_cents: row.subtotal_cents as number,
    shipping_cents: row.shipping_cents as number,
    taxes: row.taxes,
    total_cents: row.total_cents as number,
    refunded_cents: row.refunded_cents as number,
    version: row.version as number,
    lines: (lines as {
      batch_code: string;
      scent: string;
      bar: number;
      unit_cents: number;
      refunded: boolean;
      kb_invoice_item_id: string | null;
    }[])
  };
}

export async function loadOrderForStaff(client: PoolClient, number: string, lock: boolean): Promise<{ row: Record<string, unknown>; order: OrderRecord; id: number }> {
  const res = await client.query(
    lock ? "SELECT * FROM orders WHERE number = $1 FOR UPDATE" : "SELECT * FROM orders WHERE number = $1",
    [number]
  );
  const row = res.rows[0];
  if (!row) throw new ApiError(404, "not_found");
  const lines = await client.query(
    "SELECT batch_code, scent, bar, unit_cents, refunded, kb_invoice_item_id FROM order_lines WHERE order_id = $1 ORDER BY batch_code, bar",
    [row.id]
  );
  return { row, order: orderFromRow(row, lines.rows), id: row.id as number };
}

/** The refund allocation rule, decided in this one place. */
export function allocateRefund(
  order: OrderRecord,
  bars: { batch: string; bar: number }[],
  issued: RefundRecord[]
): {
  barsCents: number;
  shippingCents: number;
  taxes: { code: string; rate: string; amount_cents: number }[];
  amountCents: number;
  final: boolean;
} {
  const barCents = bars.length * BAR_PRICE_CENTS;
  const orderTaxes = taxLinesFromJson(order.taxes);
  const refundedBars = new Set(
    order.lines.filter((line) => line.refunded).map((line) => `${line.batch_code}:${line.bar}`)
  );
  for (const bar of bars) refundedBars.add(`${bar.batch}:${bar.bar}`);
  const final = order.lines.every((line) => refundedBars.has(`${line.batch_code}:${line.bar}`));
  let shippingCents = 0;
  const taxes: { code: string; rate: string; amount_cents: number }[] = [];
  for (const tax of orderTaxes) {
    if (final) {
      const earlier = issued.reduce((sum, refund) => {
        const entry = refund.allocation.taxes.find((candidate) => candidate.code === tax.code);
        return sum + (entry?.amount_cents ?? 0);
      }, 0);
      taxes.push({ code: tax.code, rate: tax.rateLabel, amount_cents: tax.amount.cents - earlier });
    } else {
      taxes.push({ code: tax.code, rate: tax.rateLabel, amount_cents: applyRate(barCents, tax.rateHundredThousandths) });
    }
  }
  if (final) shippingCents = order.shipping_cents;
  const amountCents = barCents + shippingCents + taxes.reduce((sum, tax) => sum + tax.amount_cents, 0);
  return { barsCents: barCents, shippingCents, taxes, amountCents, final };
}

export async function loadRefund(client: PoolClient, number: string): Promise<RefundRecord> {
  const res = await client.query("SELECT * FROM refunds WHERE number = $1", [number]);
  const row = res.rows[0];
  if (!row) throw new ApiError(404, "not_found");
  return refundFromRow(row, number);
}

export function refundFromRow(row: Record<string, unknown>, orderNumber: string): RefundRecord {
  return {
    number: row.number as string,
    order_number: orderNumber,
    status: row.status as string,
    bars: row.bars as { batch: string; bar: number }[],
    restock: row.restock as boolean,
    amount_cents: row.amount_cents as number,
    allocation: row.allocation as RefundRecord["allocation"],
    reason: row.reason as string,
    killbill_ref: (row.killbill_ref as string | null) ?? null,
    created_at: row.created_at as Date
  };
}

async function issuedRefunds(client: PoolClient, orderId: number): Promise<RefundRecord[]> {
  const res = await client.query(
    "SELECT * FROM refunds WHERE order_id = $1 AND status = 'issued' ORDER BY id",
    [orderId]
  );
  const orderNumber = (await client.query("SELECT number FROM orders WHERE id = $1", [orderId])).rows[0].number as string;
  return res.rows.map((row) => refundFromRow(row, orderNumber));
}

function validateRefund(locale: Locale, order: OrderRecord, input: RefundInput): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!Array.isArray(input.bars) || input.bars.length === 0) {
    fields.bars = fieldMessage("bars_refund", locale);
  } else {
    const inOrder = input.bars.filter((bar) =>
      order.lines.some((line) => line.batch_code === bar.batch && line.bar === bar.bar)
    );
    if (inOrder.length !== input.bars.length) {
      fields.bars = fieldMessage("bars_refund", locale);
    }
  }
  if (typeof input.restock !== "boolean") {
    fields.restock = fieldMessage("cant_set", locale);
  }
  if (typeof input.reason !== "string" || input.reason.trim().length < 3 || input.reason.length > 500 || hasControlChars(input.reason)) {
    fields.reason = fieldMessage("reason", locale);
  }
  return fields;
}

export async function issueRefund(
  pool: Pool,
  kb: KillBillClient,
  outbox: Outbox,
  locale: Locale,
  actor: AuditActor,
  orderNumber: string,
  ifMatchVersion: number | null,
  input: RefundInput
): Promise<RefundOutcome> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // The order row lock is held across the Kill Bill call, so a ship that
    // arrives meanwhile waits and then answers by this refund's outcome.
    const loaded = await loadOrderForStaff(client, orderNumber, true);
    const order = loaded.order;
    if (ifMatchVersion === null) {
      throw new ApiError(428, "precondition_required");
    }
    if (order.version !== ifMatchVersion) {
      throw new ApiError(412, "stale_version", message("stale_version", locale));
    }
    const already = input.bars.filter((bar) =>
      order.lines.some((line) => line.batch_code === bar.batch && line.bar === bar.bar && line.refunded)
    );
    if (already.length > 0) {
      throw new ApiError(409, "already_refunded");
    }
    const fields = validateRefund(locale, order, input);
    if (Object.keys(fields).length > 0) {
      throw new ApiError(422, "invalid", null, fields);
    }
    if (input.restock) {
      for (const batch of new Set(input.bars.map((bar) => bar.batch))) {
        const state = await client.query("SELECT state FROM batches WHERE code = $1", [batch]);
        if (state.rows[0]?.state === "withdrawn") {
          throw new ApiError(422, "invalid", null, { restock: fieldMessage("restock", locale) });
        }
      }
    }
    const issued = await issuedRefunds(client, loaded.id);
    const allocation = allocateRefund(order, input.bars, issued);
    const counter = await client.query("SELECT value FROM counters WHERE name = 'refund' FOR UPDATE");
    const refundNumber = `RF-${String(Number(counter.rows[0].value) + 1).padStart(6, "0")}`;
    await client.query("UPDATE counters SET value = value + 1 WHERE name = 'refund'");
    // A failed refund allocates nothing, so the row starts at zero.
    const insert = await client.query(
      `INSERT INTO refunds (number, order_id, status, bars, restock, amount_cents, allocation, reason)
       VALUES ($1, $2, 'requested', $3::jsonb, $4, 0, $5::jsonb, $6)
       RETURNING id, created_at`,
      [
        refundNumber, loaded.id, JSON.stringify(input.bars), input.restock,
        JSON.stringify({ bars_cents: 0, shipping_cents: 0, taxes: [] }),
        input.reason
      ]
    );
    const refundId = insert.rows[0].id as number;
    const createdAt = insert.rows[0].created_at as Date;
    await client.query("UPDATE orders SET version = version + 1 WHERE number = $1", [orderNumber]);

    // Kill Bill: refund the invoice payment, item by item.
    let outcome: "issued" | "failed";
    let killbillRef: string | null = null;
    try {
      let paymentId = loaded.row.killbill_payment_id as string | null;
      if (!paymentId) {
        const invoiceId = loaded.row.killbill_invoice_id as string;
        const payments = await kb.getInvoicePayments(invoiceId);
        paymentId = payments.find((candidate) => candidate.paymentExternalKey === orderNumber)?.paymentId ?? null;
      }
      if (!paymentId) throw new KillBillError(404, "payment missing", false);
      const taxItems = (loaded.row.kb_tax_items as { code: string; itemId: string }[] | null) ?? [];
      const shippingItemId = loaded.row.kb_shipping_item_id as string | null;
      const adjustments: { invoiceItemId: string; amount: number }[] = [];
      for (const bar of input.bars) {
        const line = order.lines.find((candidate) => candidate.batch_code === bar.batch && candidate.bar === bar.bar);
        if (line?.kb_invoice_item_id) {
          adjustments.push({ invoiceItemId: line.kb_invoice_item_id, amount: centsToKb(BAR_PRICE_CENTS) });
        }
      }
      if (allocation.final && shippingItemId && allocation.shippingCents > 0) {
        adjustments.push({ invoiceItemId: shippingItemId, amount: centsToKb(allocation.shippingCents) });
      }
      for (const tax of allocation.taxes) {
        const item = taxItems.find((candidate) => candidate.code === tax.code);
        if (item && tax.amount_cents > 0) {
          adjustments.push({ invoiceItemId: item.itemId, amount: centsToKb(tax.amount_cents) });
        }
      }
      await kb.refundInvoicePayment(paymentId, {
        paymentId,
        amount: centsToKb(allocation.amountCents),
        currency: "CAD",
        isAdjusted: true,
        adjustments,
        transactionExternalKey: refundNumber
      }, actor.email);
      const paymentAfter = await kb.getPayment(paymentId);
      const refundTx = paymentAfter.transactions.find((tx) => tx.transactionExternalKey === refundNumber);
      killbillRef = refundTx?.transactionId ?? null;
      outcome = "issued";
    } catch (err) {
      if (!(err instanceof KillBillError)) throw err;
      outcome = "failed";
    }

    if (outcome === "issued") {
      await client.query(
        "UPDATE refunds SET status = 'issued', amount_cents = $2, killbill_ref = $3, allocation = $4::jsonb WHERE id = $1",
        [
          refundId, allocation.amountCents, killbillRef,
          JSON.stringify({
            bars_cents: allocation.barsCents,
            shipping_cents: allocation.shippingCents,
            taxes: allocation.taxes
          })
        ]
      );
      for (const bar of input.bars) {
        await client.query(
          `UPDATE order_lines SET refunded = true
           WHERE order_id = $1 AND batch_code = $2 AND bar = $3`,
          [loaded.id, bar.batch, bar.bar]
        );
      }
      await client.query(
        "UPDATE orders SET refunded_cents = refunded_cents + $2, status = $3 WHERE number = $1",
        [orderNumber, allocation.amountCents, allocation.final ? "refunded" : "partially_refunded"]
      );
      if (input.restock) {
        const byBatch = new Map<string, number[]>();
        for (const bar of input.bars) {
          const list = byBatch.get(bar.batch) ?? [];
          list.push(bar.bar);
          byBatch.set(bar.batch, list);
        }
        for (const [batchCode, bars] of byBatch) {
          await client.query(
            "INSERT INTO stock_movements (batch_code, kind, bars, ref) VALUES ($1, 'restock', $2, $3)",
            [batchCode, bars, refundNumber]
          );
          await client.query(
            "UPDATE batches SET state = 'live' WHERE code = $1 AND state = 'sold_out'",
            [batchCode]
          );
        }
      }
      const content = refundEmail({
        refundNumber,
        orderNumber,
        bars: input.bars.map((bar) => {
          const slug = order.lines.find((line) => line.batch_code === bar.batch && line.bar === bar.bar)?.scent ?? "";
          const scent = DROP_SCENTS.find((candidate) => candidate.slug === slug);
          return {
            bar: bar.bar,
            batch: bar.batch,
            scentEn: scent ? scent.en : slug,
            scentFr: scent ? scent.fr : slug
          };
        }),
        amount: money(allocation.amountCents)
      });
      await queueNotice(client, {
        key: `refund.${refundNumber}`,
        kind: "refund",
        to: order.email,
        locale: order.locale as Locale,
        subjectEn: content.subjectEn,
        subjectFr: content.subjectFr,
        linesEn: content.linesEn,
        linesFr: content.linesFr
      });
    } else {
      await client.query("UPDATE refunds SET status = 'failed', killbill_ref = NULL WHERE id = $1", [refundId]);
    }
    await writeAudit(
      client, actor, "refund", orderNumber, input.reason,
      outcome === "issued" ? allocation.amountCents : 0, killbillRef, outcome
    );
    await client.query("COMMIT");
    outbox.kick();

    if (outcome === "failed") {
      throw new ApiError(503, "billing_unavailable", refundFailedCopy(locale, refundNumber));
    }
    const after = await loadOrderForStaff(client, orderNumber, false);
    const refundRow: RefundRecord = {
      number: refundNumber,
      order_number: orderNumber,
      status: outcome,
      bars: input.bars,
      restock: input.restock,
      amount_cents: outcome === "issued" ? allocation.amountCents : 0,
      allocation: outcome === "issued"
        ? { bars_cents: allocation.barsCents, shipping_cents: allocation.shippingCents, taxes: allocation.taxes }
        : { bars_cents: 0, shipping_cents: 0, taxes: [] },
      reason: input.reason,
      killbill_ref: killbillRef,
      created_at: createdAt
    };
    return { refund: refundRow, order: after.order };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    throw err;
  }
}

export function refundFailedCopy(locale: Locale, refundNumber: string): string {
  return locale === "fr-CA"
    ? `Kill Bill est injoignable. Le remboursement ${refundNumber} est consigné comme échoué; rien n'a été remboursé.`
    : `Kill Bill is unreachable. Refund ${refundNumber} is recorded as failed; nothing was paid back.`;
}

