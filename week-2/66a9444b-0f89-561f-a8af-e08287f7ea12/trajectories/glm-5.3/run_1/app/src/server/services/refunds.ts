import type { PoolClient } from "pg";
import type { App } from "../http.js";
import { query, withTransaction, type Row } from "../db.js";
import { randomUUID } from "node:crypto";
import { euroCents } from "../../shared/money.js";
import { returnVoucher } from "./vouchers.js";
import { refreshOrderStatusTx } from "./shapes.js";
import { recordKbTransaction } from "./kb.js";

export interface AffectedOrder {
  order: Row;
  lines: Row[];
}

// The one refund rule: each affected order gets one refund record. Card share
// goes back through Kill Bill for visitor orders or becomes a credit note for
// group orders; the voucher share returns to the same voucher; unaffected
// lines keep their state and their passes keep scanning.
export async function refundLines(
  app: App,
  client: PoolClient,
  affected: AffectedOrder[],
  reason: string,
): Promise<number> {
  let count = 0;
  for (const { order, lines } of affected) {
    const orderId = String(order.id);
    const isGroup = String(order.kind) === "group";
    const capturedLines = lines.filter((l) => l.state === "captured" || l.state === "transferred");
    const pendingLines = lines.filter((l) => String(l.state) === "proof_pending");

    const cardCents = capturedLines.reduce((s, l) => s + Number(l.charged_cents), 0);
    const voucherCents = lines.reduce((s, l) => s + Number(l.voucher_cents), 0);

    const refundId = randomUUID();
    let creditNoteId: string | null = null;

    if (isGroup && cardCents > 0) {
      // One credit note per affected group order, with a Kill Bill item
      // adjustment per line.
      const invoiceId = order.invoice_id ? String(order.invoice_id) : null;
      const editionRes = await client.query("select first_day from edition where id = 1");
      const year = String(editionRes.rows[0]?.first_day ?? "").slice(0, 4) || String(new Date().getUTCFullYear());
      const seq = await client.query("select count(*) + 1 as n from credit_notes where number like $1", [`CN-${year}-%`]);
      const noteNumber = `CN-${year}-${String(Number(seq.rows[0].n)).padStart(4, "0")}`;
      const noteRes = await client.query(
        `insert into credit_notes (id, number, invoice_id, amount_cents)
         values ($1,$2,$3,$4) returning id`,
        [noteNumber, noteNumber, invoiceId, cardCents],
      );
      creditNoteId = String(noteRes.rows[0].id);
      for (const l of capturedLines) {
        await client.query(
          "insert into invoice_lines (invoice_id, line_id, description, amount_cents) values ($1,$2,$3,$4)",
          [creditNoteId, Number(l.id), `Credit note ${noteNumber} · ${String(l.title)} · ${String(l.holder_name)}`, Number(l.charged_cents)],
        );
      }
      if (invoiceId) {
        await client.query(
          "update invoices set credited_cents = credited_cents + $2, balance_cents = amount_cents - (credited_cents + $2) - paid_cents where id = $1",
          [invoiceId, cardCents],
        );
      }
    }

    await client.query(
      `insert into refunds (id, order_id, line_ids, card_cents, voucher_cents, credit_note_id, status, reason)
       values ($1,$2,$3::jsonb,$4,$5,$6,$7,$8)`,
      [
        refundId,
        orderId,
        JSON.stringify(lines.map((l) => Number(l.id))),
        cardCents,
        voucherCents,
        creditNoteId,
        "pending",
        reason,
      ],
    );

    // Line states: captured and transferred lines become refunded; pending
    // lines become voided.
    for (const l of capturedLines) {
      await client.query("update lines set state = 'refunded' where id = $1", [Number(l.id)]);
      await client.query("update passes set status = 'refunded' where line_id = $1 and status in ('valid','transferred')", [Number(l.id)]);
    }
    for (const l of pendingLines) {
      await client.query("update lines set state = 'voided' where id = $1", [Number(l.id)]);
      await client.query("update passes set status = 'voided' where line_id = $1 and status in ('valid','transferred')", [Number(l.id)]);
    }

    // Voucher shares go back to the same voucher.
    if (voucherCents > 0 && order.voucher_code) {
      await returnVoucher(client, String(order.voucher_code), voucherCents, orderId);
    }

    // A reduced-rate order whose every pending line was voided by the
    // cancellation has its authorisation voided.
    if (pendingLines.length > 0) {
      const remaining = await client.query(
        "select count(*) as n from lines where order_id = $1 and state = 'proof_pending'",
        [orderId],
      );
      if (Number(remaining.rows[0].n) === 0) {
        await voidAuthorisation(app, client, orderId);
      }
    }

    // The Kill Bill refund for a visitor order's card share; group orders get
    // the credit note instead. A pending refund completes when Kill Bill answers.
    if (!isGroup && cardCents > 0) {
      const status = await attemptKbRefund(app, client, orderId, refundId, cardCents);
      await client.query("update refunds set status = $2 where id = $1", [refundId, status]);
    } else if (isGroup) {
      await client.query("update refunds set status = 'completed' where id = $1", [refundId]);
    } else {
      await client.query("update refunds set status = 'completed' where id = $1", [refundId]);
    }

    await refreshOrderStatusTx(client, orderId);

    // One notice per affected order, listing only the affected items.
    const buyer = await client.query("select * from users where id = $1", [Number(order.buyer_id)]);
    const buyerEmail = String(buyer.rows[0].email);
    const itemLines = lines.map((l) => `- ${String(l.title)} (card ${euroCents(Number(l.charged_cents))}, voucher ${euroCents(Number(l.voucher_cents))})`).join("\n");
    if (isGroup && creditNoteId) {
      const note = await client.query("select * from credit_notes where id = $1", [creditNoteId]);
      await app.queueMail(client, "credit_note", buyerEmail, `Credit note ${String(note.rows[0].number)} from Kerf Collective`,
        `Credit note ${String(note.rows[0].number)}\n\n${itemLines}\n\nAmount: ${euroCents(cardCents)}`, [], orderId);
    } else {
      await app.queueMail(client, "refund_notice", buyerEmail, `Refund for order ${orderId}`,
        `We refunded these items of order ${orderId} — ${reason}\n\n${itemLines}\n\nCard refund: ${euroCents(cardCents)}\nVoucher return: ${euroCents(voucherCents)}`, [], orderId);
    }
    count += 1;
  }
  return count;
}

async function paymentForOrder(app: App, client: PoolClient, orderId: string): Promise<{ paymentId: string } | null> {
  const res = await client.query(
    "select payment_id from kb_transactions where order_ref = $1 and external_key = $2 limit 1",
    [orderId, `${orderId}-auth`],
  );
  const row = res.rows[0];
  if (!row || !row.payment_id) return null;
  return { paymentId: String(row.payment_id) };
}

export async function attemptKbRefund(app: App, client: PoolClient, orderId: string, refundId: string, cents: number): Promise<string> {
  const payment = await paymentForOrder(app, client, orderId);
  if (!payment) return "completed";
  try {
    const tx = await app.killbill.completeTransaction(payment.paymentId, "REFUND", refundId, cents);
    await recordKbTransaction(client, tx, "REFUND", cents, refundId, orderId);
    return "completed";
  } catch {
    return "pending";
  }
}

export async function voidAuthorisation(app: App, client: PoolClient, orderId: string): Promise<void> {
  const payment = await paymentForOrder(app, client, orderId);
  if (!payment) return;
  const amountRes = await client.query(
    "select amount_cents from kb_transactions where order_ref = $1 and external_key = $2 limit 1",
    [orderId, `${orderId}-auth`],
  );
  const amount = Number(amountRes.rows[0]?.amount_cents ?? 0);
  try {
    const tx = await app.killbill.completeTransaction(payment.paymentId, "VOID", `${orderId}-void`, amount);
    await recordKbTransaction(client, tx, "VOID", amount, `${orderId}-void`, orderId);
  } catch {
    // Kill Bill unavailable: the sweep voids the authorisation later.
  }
}

// Pending refunds complete once Kill Bill answers, exactly one transaction each.
export async function completePendingRefunds(app: App): Promise<void> {
  const pending = await query("select * from refunds where status = 'pending' order by created_at");
  for (const refund of pending.rows) {
    const orderId = String(refund.order_id);
    const refundId = String(refund.id);
    const cardCents = Number(refund.card_cents);
    if (cardCents <= 0) continue;
    await withTransaction(async (client) => {
      const lock = await client.query("select * from refunds where id = $1 for update", [refundId]);
      if (String(lock.rows[0].status) !== "pending") return;
      const status = await attemptKbRefund(app, client, orderId, refundId, cardCents);
      await client.query("update refunds set status = $2 where id = $1", [refundId, status]);
    });
  }
}
