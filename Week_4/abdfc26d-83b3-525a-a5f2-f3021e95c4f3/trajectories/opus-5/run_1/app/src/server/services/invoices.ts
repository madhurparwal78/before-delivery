import { query, transaction } from '../db/pool.js';
import { PdfRenderingUnavailable, renderPdf } from '../providers/gotenberg.js';
import { objectKeys, putObject } from '../providers/storage.js';
import { invoiceHtml } from './documents.js';
import { queueMail, sendNow } from './outbox.js';

interface PendingInvoiceRow {
  id: string;
  invoice_number: string;
  state: string;
  edition_number: number;
  edition_count: number;
  billing_name: string | null;
  email: string | null;
  billing_country: string | null;
  net_cents: number;
  vat_rate_percent: number;
  vat_cents: number;
  gross_cents: number;
  paid_at: Date;
  piece_title: string;
  seller_name: string;
  seller_address: string | null;
}

/** The selling creator is the remixer when the piece is a remix. */
const PENDING_INVOICE_SELECT = `
  SELECT o.id, o.invoice_number, o.state, o.edition_number, o.edition_count, o.billing_name,
         o.email, o.billing_country, o.net_cents, o.vat_rate_percent, o.vat_cents,
         o.gross_cents, o.paid_at,
         p.title AS piece_title,
         seller.display_name AS seller_name,
         seller.seller_address AS seller_address
  FROM edition_orders o
  JOIN pieces p ON p.id = o.piece_id
  JOIN app_users seller ON seller.id = p.creator_id
`;

/**
 * Claims pending invoices so no two instances render the same order at once.
 * Claims older than a minute are taken over, so a crashed instance frees its work.
 */
async function claimPendingInvoices(limit: number): Promise<PendingInvoiceRow[]> {
  const claimed = await query<{ id: string }>(
    `UPDATE edition_orders SET invoice_claimed_at = now()
     WHERE id IN (
       SELECT o.id FROM edition_orders o
       WHERE o.invoice_status = 'pending'
         AND o.invoice_number IS NOT NULL
         AND (o.invoice_claimed_at IS NULL OR o.invoice_claimed_at < now() - interval '1 minute')
       ORDER BY o.paid_at
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     RETURNING id`,
    [limit],
  );
  if (claimed.rows.length === 0) return [];

  const result = await query<PendingInvoiceRow>(
    `${PENDING_INVOICE_SELECT} WHERE o.id = ANY($1::uuid[])`,
    [claimed.rows.map((row) => row.id)],
  );
  return result.rows;
}

/**
 * Renders and stores one invoice PDF. The invoice number never changes across
 * attempts. A paid order then becomes invoiced and queues its receipt; a seed
 * order keeps its state.
 */
async function renderOneInvoice(order: PendingInvoiceRow): Promise<void> {
  const html = invoiceHtml({
    invoiceNumber: order.invoice_number,
    issuedAt: order.paid_at,
    sellerName: order.seller_name,
    sellerAddress: order.seller_address ?? 'Phosphene Yard',
    buyerName: order.billing_name ?? '',
    buyerEmail: order.email ?? '',
    buyerCountry: order.billing_country ?? '',
    pieceTitle: order.piece_title,
    edition: order.edition_number,
    editionCount: order.edition_count,
    netCents: order.net_cents,
    vatRatePercent: order.vat_rate_percent,
    vatCents: order.vat_cents,
    grossCents: order.gross_cents,
  });

  const pdf = await renderPdf(html);
  const key = objectKeys.invoice(order.paid_at.getUTCFullYear(), order.invoice_number);
  await putObject(key, pdf, 'application/pdf');

  const queuedMessageId = await transaction(async (client) => {
    await client.query(
      `UPDATE edition_orders SET invoice_status = 'ready', invoice_object_key = $2,
                                 invoice_claimed_at = NULL
       WHERE id = $1`,
      [order.id, key],
    );

    if (order.state !== 'paid') return null;

    await client.query(
      `UPDATE edition_orders SET state = 'invoiced', receipt_status = 'queued' WHERE id = $1`,
      [order.id],
    );

    return queueMail(client, {
      recipient: order.email ?? '',
      subject: `Your receipt for ${order.piece_title} \u2014 edition ${order.edition_number} of ${order.edition_count}`,
      bodyText: [
        `Thank you for collecting edition ${order.edition_number} of ${order.edition_count} of ${order.piece_title}.`,
        '',
        `Invoice ${order.invoice_number} is attached as a PDF.`,
        'Your export and invoice are in your library at Phosphene Yard.',
        '',
        'Phosphene Yard',
      ].join('\n'),
      attachmentKey: key,
      attachmentName: `${order.invoice_number}.pdf`,
      receiptForOrderId: order.id,
    });
  });

  if (queuedMessageId) {
    await sendNow(queuedMessageId);
  }
}

/** Runs one pass of the invoice rendering retry. */
export async function renderPendingInvoices(): Promise<void> {
  const orders = await claimPendingInvoices(10);
  for (const order of orders) {
    try {
      await renderOneInvoice(order);
    } catch (error) {
      await query('UPDATE edition_orders SET invoice_claimed_at = NULL WHERE id = $1', [order.id]);
      if (!(error instanceof PdfRenderingUnavailable)) {
        process.stderr.write(`invoice render failed for ${order.invoice_number}: ${String(error)}\n`);
      }
    }
  }
}
