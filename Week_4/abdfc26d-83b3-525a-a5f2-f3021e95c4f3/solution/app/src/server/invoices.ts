import { one, pool, rows, tx } from "./db.js";
import { canMove, fromStates, MOVES, type OrderState } from "./order-states.js";
import { creditNoteHtml, invoiceHtml } from "./documents.js";
import { htmlToPdf } from "./gotenberg.js";
import { queueEmail } from "./outbox.js";
import { putObject } from "./s3.js";
import { dollars } from "../shared/rules.js";

// Invoice and credit note PDFs. A claim keeps two instances from rendering the same document at once;
// the number never changes across attempts. Receipts and refund notices are queued only once the PDF exists.

const CLAIM_SECONDS = 90;

interface InvoiceRow {
  id: string;
  state: string;
  seed: boolean;
  edition: number;
  invoice_number: string;
  paid_at: Date;
  billing_name: string;
  email: string;
  billing_country: string;
  net_cents: number;
  vat_rate_percent: number;
  vat_cents: number;
  gross_cents: number;
  piece_title: string;
  edition_count: number;
  seller_name: string;
  seller_address: string | null;
}

const day = (date: Date): string => date.toISOString().slice(0, 10);
/** The invoice line and the Kill Bill charge description of an edition. */
export const lineOf = (title: string, edition: number, count: number): string => `${title} — edition ${edition} of ${count}`;
export const invoiceKey = (number: string, paidAt: Date): string => `invoices/${paidAt.getUTCFullYear()}/${number}.pdf`;

/** Renders, stores and records one order's invoice; a paid order then moves to invoiced and queues its receipt. */
export async function renderInvoice(orderId: string): Promise<void> {
  const order = await one<InvoiceRow>(
    pool,
    `UPDATE orders o SET invoice_claimed_until = now() + make_interval(secs => ${CLAIM_SECONDS})
       FROM pieces p, users u
      WHERE o.id = $1 AND p.id = o.piece_id AND u.id = p.creator_id AND o.invoice_status = 'pending'
        AND (o.invoice_claimed_until IS NULL OR o.invoice_claimed_until < now())
      RETURNING o.*, p.title AS piece_title, p.edition_count, u.display_name AS seller_name, u.seller_address`,
    [orderId],
  );
  if (!order) return;
  try {
    const pdf = await htmlToPdf(
      invoiceHtml({
        number: order.invoice_number,
        issued: day(order.paid_at),
        sellerName: order.seller_name,
        sellerAddress: order.seller_address,
        buyerName: order.billing_name,
        buyerEmail: order.email,
        buyerCountry: order.billing_country,
        line: lineOf(order.piece_title, order.edition, order.edition_count),
        net: order.net_cents,
        rate: order.vat_rate_percent,
        vat: order.vat_cents,
        gross: order.gross_cents,
      }),
    );
    await putObject(invoiceKey(order.invoice_number, order.paid_at), pdf, "application/pdf");
    await tx(async (client, after) => {
      const current = await one<{ state: OrderState }>(client, "SELECT state FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
      if (current && canMove("invoice", current.state) && !order.seed) {
        await client.query(
          "UPDATE orders SET state = $2, invoice_status = 'ready', receipt_status = 'queued', invoice_claimed_until = NULL WHERE id = $1",
          [orderId, MOVES.invoice.to],
        );
        const send = await queueEmail(client, {
          kind: "receipt",
          to: order.email,
          subject: `Your receipt for ${lineOf(order.piece_title, order.edition, order.edition_count)}`,
          text: [
            `Thank you, ${order.billing_name}.`,
            "",
            `You collected ${lineOf(order.piece_title, order.edition, order.edition_count)}.`,
            `Net $${dollars(order.net_cents)}, VAT ${order.vat_rate_percent}% $${dollars(order.vat_cents)}, total $${dollars(order.gross_cents)} USD.`,
            `Invoice ${order.invoice_number} is attached. Your export and invoice are in your library on Phosphene Yard.`,
            "",
            "Phosphene Yard, by Brightmoss Works",
          ].join("\n"),
          attachment: { name: `${order.invoice_number}.pdf`, data: pdf },
          orderId,
        });
        after(send);
      } else {
        await client.query("UPDATE orders SET invoice_status = 'ready', invoice_claimed_until = NULL WHERE id = $1", [orderId]);
      }
    });
  } catch (error) {
    console.error(`invoice ${order.invoice_number} not rendered yet:`, error instanceof Error ? error.message : error);
    await pool.query("UPDATE orders SET invoice_claimed_until = NULL WHERE id = $1", [orderId]);
  }
}

interface CreditNoteRow {
  id: string;
  credit_note_number: string;
  net_cents: number;
  vat_cents: number;
  gross_cents: number;
  created_at: Date;
  invoice_number: string;
  edition: number;
  billing_name: string;
  email: string;
  vat_rate_percent: number;
  piece_title: string;
  edition_count: number;
}

/** Renders and stores a refund's credit note, then queues its refund notice. */
export async function renderCreditNote(refundId: string): Promise<void> {
  const note = await one<CreditNoteRow>(
    pool,
    `UPDATE refunds f SET claimed_until = now() + make_interval(secs => ${CLAIM_SECONDS})
       FROM orders o, pieces p
      WHERE f.id = $1 AND o.id = f.order_id AND p.id = o.piece_id AND f.pdf_status = 'pending'
        AND (f.claimed_until IS NULL OR f.claimed_until < now())
      RETURNING f.*, o.invoice_number, o.edition, o.billing_name, o.email, o.vat_rate_percent, p.title AS piece_title, p.edition_count`,
    [refundId],
  );
  if (!note) return;
  try {
    const line = lineOf(note.piece_title, note.edition, note.edition_count);
    const pdf = await htmlToPdf(
      creditNoteHtml({
        number: note.credit_note_number,
        invoiceNumber: note.invoice_number,
        issued: day(note.created_at),
        buyerName: note.billing_name,
        line,
        net: note.net_cents,
        rate: note.vat_rate_percent,
        vat: note.vat_cents,
        gross: note.gross_cents,
      }),
    );
    await putObject(`credit-notes/${note.created_at.getUTCFullYear()}/${note.credit_note_number}.pdf`, pdf, "application/pdf");
    await tx(async (client, after) => {
      const updated = await one(client, "UPDATE refunds SET pdf_status = 'ready', claimed_until = NULL WHERE id = $1 AND pdf_status = 'pending' RETURNING id", [refundId]);
      if (!updated) return;
      const send = await queueEmail(client, {
        kind: "refund_notice",
        to: note.email,
        subject: `Refund issued: ${note.credit_note_number}`,
        text: [
          `Hello ${note.billing_name},`,
          "",
          `We refunded $${dollars(note.gross_cents)} USD (net $${dollars(note.net_cents)}, VAT $${dollars(note.vat_cents)}) for ${line}.`,
          `Credit note ${note.credit_note_number} refers to invoice ${note.invoice_number} and is attached.`,
          "",
          "Phosphene Yard, by Brightmoss Works",
        ].join("\n"),
        attachment: { name: `${note.credit_note_number}.pdf`, data: pdf },
      });
      after(send);
    });
  } catch (error) {
    console.error(`credit note ${note.credit_note_number} not rendered yet:`, error instanceof Error ? error.message : error);
    await pool.query("UPDATE refunds SET claimed_until = NULL WHERE id = $1", [refundId]);
  }
}

/** The 30-second retry: every pending invoice (paid or seed orders) and credit note in this database. */
export async function retryPendingDocuments(): Promise<void> {
  const invoices = await rows<{ id: string }>(
    pool,
    "SELECT id FROM orders WHERE invoice_status = 'pending' AND (state = ANY($1) OR seed) AND (invoice_claimed_until IS NULL OR invoice_claimed_until < now())",
    [fromStates("invoice")],
  );
  for (const { id } of invoices) await renderInvoice(id);
  const notes = await rows<{ id: string }>(
    pool,
    "SELECT id FROM refunds WHERE pdf_status = 'pending' AND (claimed_until IS NULL OR claimed_until < now())",
  );
  for (const { id } of notes) await renderCreditNote(id);
}
