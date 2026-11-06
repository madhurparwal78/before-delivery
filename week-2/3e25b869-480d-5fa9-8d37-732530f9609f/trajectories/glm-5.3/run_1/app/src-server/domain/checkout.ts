// Checkout: the all-or-nothing path from held bars to a paid order. The order
// number is taken before the Kill Bill call so a lost response keeps its key,
// and one shopper's checkout of a hold excludes every other.
import { type Pool, type PoolClient } from "pg";
import { ApiError } from "../core/http.js";
import type { Locale } from "../core/catalog.js";
import { message, fieldMessage } from "../core/copy.js";
import { dropPrice, money, BAR_PRICE_CENTS } from "../core/money.js";
import { findProvince } from "../core/provinces.js";
import { DROP_SCENTS } from "../core/catalog.js";
import { addDays, torontoDate, torontoParts } from "../core/toronto.js";
import { addMovement, refreshBatchState } from "./stock.js";
import { hasControlChars, isValidCanadianPostalCode } from "./text.js";
import { orderConfirmationEmail } from "../core/emails.js";
import { queueNotice, type Outbox } from "../services/outbox.js";
import { KillBillClient, KillBillError, centsToKb } from "../services/killbill.js";
import type { OrderRecord } from "./views.js";

export interface CheckoutInput {
  holds: string[];
  shipping: { name: string; line1: string; city: string; province: string; postal_code: string };
}

export interface CheckoutResult {
  order: OrderRecord;
}

interface HoldRow {
  id: string;
  cart_id: string;
  batch_code: string;
  bar: number;
  status: string;
  amount_cents: number;
  expires_at: Date;
}

export async function checkout(
  pool: Pool,
  kb: KillBillClient,
  outbox: Outbox,
  locale: Locale,
  cartId: string | undefined,
  customerId: number,
  customerEmail: string,
  input: CheckoutInput
): Promise<CheckoutResult> {
  const fields = validateCheckout(locale, input);
  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, "invalid", null, fields);
  }
  const client = await pool.connect();
  try {
    // One checkout of these holds at a time, in a stable lock order.
    const holdIds = [...input.holds].sort();
    for (const holdId of holdIds) {
      await client.query("SELECT pg_advisory_lock(hashtext($1))", [`hold:${holdId}`]);
    }
    const released = { value: false };
    try {
      // Judge the holds at the moment the request arrives.
      const holdRows = await loadHolds(client, input.holds, cartId);
      const now = new Date();
      for (const hold of holdRows) {
        if (hold.expires_at <= now) {
          throw new ApiError(410, "hold_expired", message("hold_expired", locale));
        }
      }
      for (const hold of holdRows) {
        if (hold.status !== "active") {
          throw new ApiError(409, "hold_not_active");
        }
      }
      const batchScent = await loadBatchScents(client, holdRows);

      // The order number is taken before any Kill Bill call, in its own committed unit.
      const counter = await client.query("SELECT value FROM counters WHERE name = 'order' FOR UPDATE");
      const orderNumber = `PDL-${String(Number(counter.rows[0].value) + 1).padStart(6, "0")}`;
      await client.query("UPDATE counters SET value = value + 1 WHERE name = 'order'");
      await client.query("COMMIT");

      const province = findProvince(input.shipping.province)!;
      const price = dropPrice(holdRows.length, province.taxes);
      const killbill = await runKillBill(kb, customerEmail, input.shipping.name, locale, holdRows, batchScent, price, orderNumber);

      // The shop records, in one unit.
      const placedAt = new Date();
      const cutoff = await packingCutoff(client);
      const shipOn = computeShipOn(placedAt, cutoff);
      const taxesJson = price.taxes.map((tax) => ({ code: tax.code, rate: tax.rateLabel, amount_cents: tax.amount.cents }));
      await client.query("BEGIN");
      await client.query(
        "UPDATE customers SET killbill_account_id = $2 WHERE id = $1 AND (killbill_account_id IS NULL OR killbill_account_id <> $2)",
        [customerId, killbill.accountId]
      );
      const orderRes = await client.query(
        `INSERT INTO orders (number, customer_id, status, fulfilment, placed_at, ship_on, locale, email,
          name, line1, city, province, postal_code, subtotal_cents, shipping_cents, taxes, total_cents,
          refunded_cents, version, killbill_invoice_id, killbill_payment_id)
         VALUES ($1, $2, 'paid', 'to_pack', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, 0, 1, $16, $17)
         RETURNING id`,
        [
          orderNumber, customerId, placedAt, shipOn, locale, customerEmail,
          input.shipping.name, input.shipping.line1, input.shipping.city, input.shipping.province,
          input.shipping.postal_code, price.subtotal.cents, price.shipping.cents,
          JSON.stringify(taxesJson), price.total.cents, killbill.invoiceId, killbill.paymentId
        ]
      );
      const orderId = orderRes.rows[0].id as number;
      for (const [index, hold] of holdRows.entries()) {
        await client.query(
          `INSERT INTO order_lines (order_id, batch_code, scent, bar, unit_cents, refunded, kb_invoice_item_id)
           VALUES ($1, $2, $3, $4, $5, false, $6)`,
          [orderId, hold.batch_code, batchScent.get(hold.batch_code)!, hold.bar, BAR_PRICE_CENTS, killbill.itemIds[index] || null]
        );
      }
      for (const hold of holdRows) {
        await client.query("UPDATE holds SET status = 'converted' WHERE id = $1", [hold.id]);
      }
      const byBatch = new Map<string, number[]>();
      for (const hold of holdRows) {
        const list = byBatch.get(hold.batch_code) ?? [];
        list.push(hold.bar);
        byBatch.set(hold.batch_code, list);
      }
      for (const [batchCode, batchBars] of byBatch) {
        await addMovement(client, batchCode, "sale", batchBars, orderNumber);
        await refreshBatchState(client, batchCode, placedAt);
      }
      const content = orderConfirmationEmail({
        orderNumber,
        bars: holdRows.map((hold) => ({
          bar: hold.bar,
          batch: hold.batch_code,
          scentEn: scentName(batchScent.get(hold.batch_code)!, "en-CA"),
          scentFr: scentName(batchScent.get(hold.batch_code)!, "fr-CA"),
          price: money(hold.amount_cents)
        })),
        subtotal: price.subtotal,
        shipping: price.shipping,
        taxes: price.taxes,
        total: price.total,
        shipOn
      });
      await queueNotice(client, {
        key: `order.${orderNumber}`,
        kind: "order_confirmation",
        to: customerEmail,
        locale,
        subjectEn: content.subjectEn,
        subjectFr: content.subjectFr,
        linesEn: content.linesEn,
        linesFr: content.linesFr
      });
      await client.query(
        `UPDATE orders SET kb_shipping_item_id = $2, kb_tax_items = $3::jsonb WHERE id = $1`,
        [orderId, killbill.shippingItemId, JSON.stringify(killbill.taxItems)]
      );
      await client.query("COMMIT");
      outbox.kick();

      const record: OrderRecord = {
        number: orderNumber,
        status: "paid",
        fulfilment: "to_pack",
        placed_at: placedAt,
        ship_on: shipOn,
        locale,
        email: customerEmail,
        name: input.shipping.name,
        line1: input.shipping.line1,
        city: input.shipping.city,
        province: input.shipping.province,
        postal_code: input.shipping.postal_code,
        subtotal_cents: price.subtotal.cents,
        shipping_cents: price.shipping.cents,
        taxes: taxesJson,
        total_cents: price.total.cents,
        refunded_cents: 0,
        version: 1,
        lines: holdRows.map((hold, index) => ({
          batch_code: hold.batch_code,
          scent: batchScent.get(hold.batch_code)!,
          bar: hold.bar,
          unit_cents: BAR_PRICE_CENTS,
          refunded: false,
          kb_invoice_item_id: killbill.itemIds[index] || null
        }))
      };
      released.value = true;
      return { order: record };
    } finally {
      if (!released.value) {
        await client.query("ROLLBACK").catch(() => undefined);
      }
      for (const holdId of holdIds) {
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [`hold:${holdId}`]).catch(() => undefined);
      }
    }
  } finally {
    client.release();
  }
}

function scentName(slug: string, locale: Locale): string {
  const scent = DROP_SCENTS.find((candidate) => candidate.slug === slug);
  if (!scent) return slug;
  return locale === "fr-CA" ? scent.fr : scent.en;
}

async function loadHolds(client: PoolClient, holdIds: string[], cartId: string | undefined): Promise<HoldRow[]> {
  const rows: HoldRow[] = [];
  for (const holdId of holdIds) {
    const res = await client.query("SELECT * FROM holds WHERE id = $1", [holdId]);
    const row = res.rows[0] as HoldRow | undefined;
    if (!row || row.cart_id !== cartId) {
      throw new ApiError(404, "not_found");
    }
    rows.push(row);
  }
  return rows;
}

async function loadBatchScents(client: PoolClient, holdRows: HoldRow[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const hold of holdRows) {
    if (map.has(hold.batch_code)) continue;
    const res = await client.query("SELECT scent FROM batches WHERE code = $1", [hold.batch_code]);
    const scent = res.rows[0]?.scent as string | undefined;
    if (scent) map.set(hold.batch_code, scent);
  }
  return map;
}

function validateCheckout(locale: Locale, input: CheckoutInput): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!Array.isArray(input.holds) || input.holds.length === 0) {
    fields.holds = fieldMessage("holds", locale);
  }
  const shipping = input.shipping;
  if (!shipping || typeof shipping !== "object") {
    fields["shipping.name"] = fieldMessage("name", locale);
    fields["shipping.line1"] = fieldMessage("line1", locale);
    fields["shipping.city"] = fieldMessage("city", locale);
    fields["shipping.province"] = fieldMessage("province", locale);
    fields["shipping.postal_code"] = fieldMessage("postal_code", locale);
    return fields;
  }
  if (typeof shipping.name !== "string" || shipping.name.trim().length === 0 || hasControlChars(shipping.name)) {
    fields["shipping.name"] = fieldMessage("name", locale);
  }
  if (typeof shipping.line1 !== "string" || shipping.line1.trim().length === 0 || hasControlChars(shipping.line1)) {
    fields["shipping.line1"] = fieldMessage("line1", locale);
  }
  if (typeof shipping.city !== "string" || shipping.city.trim().length === 0 || hasControlChars(shipping.city)) {
    fields["shipping.city"] = fieldMessage("city", locale);
  }
  if (typeof shipping.province !== "string" || !findProvince(shipping.province)) {
    fields["shipping.province"] = fieldMessage("province", locale);
  }
  if (typeof shipping.postal_code !== "string" || !isValidCanadianPostalCode(shipping.postal_code)) {
    fields["shipping.postal_code"] = fieldMessage("postal_code", locale);
  }
  return fields;
}

async function packingCutoff(client: PoolClient): Promise<string> {
  const res = await client.query("SELECT value FROM settings WHERE key = 'packing_cutoff_local'");
  return (res.rows[0]?.value as string) ?? "14:00";
}

/** The ship date: the paid instant in Toronto, before the cutoff on a weekday. */
export function computeShipOn(placedAt: Date, cutoffLocal: string): string {
  const parts = torontoParts(placedAt);
  const date = torontoDate(placedAt);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const [cutoffH, cutoffM] = cutoffLocal.split(":").map(Number);
  const beforeCutoff = parts.hour * 60 + parts.minute < cutoffH * 60 + cutoffM;
  if (weekday >= 1 && weekday <= 5 && beforeCutoff) {
    return date;
  }
  let candidate = date;
  for (let i = 0; i < 7; i++) {
    candidate = addDays(candidate, 1);
    const candidateWeekday = new Date(`${candidate}T12:00:00Z`).getUTCDay();
    if (candidateWeekday >= 1 && candidateWeekday <= 5) {
      return candidate;
    }
  }
  return candidate;
}

async function runKillBill(
  kb: KillBillClient,
  email: string,
  name: string,
  locale: Locale,
  holdRows: HoldRow[],
  batchScent: Map<string, string>,
  price: { shipping: { cents: number }; total: { cents: number }; taxes: { code: string; rateLabel: string; amount: { cents: number } }[] },
  orderNumber: string
): Promise<{ invoiceId: string; paymentId: string; itemIds: string[]; shippingItemId: string | null; taxItems: { code: string; itemId: string }[]; accountId: string }> {
  try {
    let account = await kb.getAccountByKey(email);
    if (!account) {
      account = await kb.createAccount({
        externalKey: email,
        name,
        currency: "CAD",
        timeZone: "America/Toronto",
        locale: locale === "fr-CA" ? "fr_CA" : "en_CA"
      });
      await kb.tagAccountDraft(account.accountId);
    }
    const accountId = account.accountId;
    const chargeItems = holdRows.map((hold) => ({
      itemType: "EXTERNAL_CHARGE" as const,
      description: `Bar ${hold.bar} · ${hold.batch_code} · ${scentName(batchScent.get(hold.batch_code) ?? "", "en-CA")}`,
      amount: centsToKb(hold.amount_cents),
      currency: "CAD" as const
    }));
    if (price.shipping.cents > 0) {
      chargeItems.push({
        itemType: "EXTERNAL_CHARGE",
        description: "Shipping",
        amount: centsToKb(price.shipping.cents),
        currency: "CAD"
      });
    }
    const created = await kb.createExternalCharges(accountId, chargeItems);
    const invoiceId = created[0].invoiceId;
    const itemIds: string[] = holdRows.map((hold) => {
      const item = created.find((candidate) =>
        candidate.description === `Bar ${hold.bar} · ${hold.batch_code} · ${scentName(batchScent.get(hold.batch_code) ?? "", "en-CA")}`
      );
      return item?.invoiceItemId ?? "";
    });
    const shippingItem = created.find((candidate) => candidate.description === "Shipping");
    const shippingItemId = shippingItem?.invoiceItemId ?? null;
    const taxItemInputs = price.taxes.map((tax) => ({
      itemType: "TAX" as const,
      description: tax.code,
      amount: centsToKb(tax.amount.cents),
      currency: "CAD" as const,
      invoiceId
    }));
    let taxItems: { code: string; itemId: string }[] = [];
    if (taxItemInputs.length > 0) {
      const createdTaxes = await kb.createTaxItems(account.accountId, taxItemInputs);
      taxItems = price.taxes.map((tax) => ({
        code: tax.code,
        itemId: createdTaxes.find((candidate) => candidate.description === tax.code)?.invoiceItemId ?? ""
      }));
    }
    await kb.commitInvoice(invoiceId);
    // An account credit may have been auto-applied at commit; a drop order pays in full.
    const invoice = await kb.getInvoice(invoiceId);
    for (const item of invoice.items ?? []) {
      if (item.itemType === "CBA_ADJ" && item.amount < 0) {
        await kb.deleteCbaItem(invoiceId, item.invoiceItemId, accountId);
      }
    }
    let paymentId = "";
    if (price.total.cents > 0) {
      const payment = await kb.payInvoice(invoiceId, {
        targetInvoiceId: invoiceId,
        accountId,
        purchasedAmount: centsToKb(price.total.cents),
        currency: "CAD",
        paymentExternalKey: orderNumber,
        transactions: [{
          transactionExternalKey: orderNumber,
          transactionType: "PURCHASE",
          amount: centsToKb(price.total.cents),
          currency: "CAD"
        }]
      }, "loafline");
      paymentId = payment.paymentId;
    }
    return { invoiceId, paymentId, itemIds, shippingItemId, taxItems, accountId };
  } catch (err) {
    if (err instanceof KillBillError) {
      throw new ApiError(503, "billing_unavailable", message("billing_unavailable_checkout", locale));
    }
    throw err;
  }
}
