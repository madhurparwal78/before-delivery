import type { RefundResponse, SplitRow, SplitsResponse } from '../../shared/api.js';
import { config } from '../config.js';
import { query, transaction, type Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { nextCreditNoteNumber } from '../domain/sequences.js';
import { allocateRefundReversal, type PartySaleRow, type SplitParty } from '../domain/split.js';
import { vatCents } from '../domain/vat.js';
import { KillBillUnavailable, refundPayment } from '../providers/killbill.js';
import { PdfRenderingUnavailable, renderPdf } from '../providers/gotenberg.js';
import { objectKeys, putObject } from '../providers/storage.js';
import { creditNoteHtml } from './documents.js';
import { loadOrder } from './orders.js';
import { queueMail, sendNow } from './outbox.js';

interface SplitRowRecord {
  party: SplitParty;
  holder_user_id: string | null;
  holder_name: string;
  kind: 'sale' | 'refund';
  amount_cents: number;
  refund_id: string | null;
}

async function splitRowsOf(client: Queryable, orderId: string): Promise<SplitRowRecord[]> {
  const result = await client.query<SplitRowRecord>(
    `SELECT party, holder_user_id, holder_name, kind, amount_cents, refund_id
     FROM split_rows WHERE order_id = $1 ORDER BY id`,
    [orderId],
  );
  return result.rows;
}

export async function getSplits(orderId: string): Promise<SplitsResponse> {
  if (!/^[0-9a-f-]{36}$/.test(orderId)) throw ApiError.notFound();
  const order = await transaction((client) => loadOrder(client, orderId, false));
  if (!order) throw ApiError.notFound();

  const rows = await transaction((client) => splitRowsOf(client, orderId));
  return {
    net_cents: order.net_cents,
    rows: rows.map(
      (row): SplitRow => ({
        party: row.party,
        holder: row.holder_name,
        kind: row.kind,
        amount_cents: row.amount_cents,
        refund_id: row.refund_id,
      }),
    ),
  };
}

/** Each party's sale row and the cents of it already reversed. */
function partySaleRows(rows: readonly SplitRowRecord[]): PartySaleRow[] {
  const parties: SplitParty[] = ['creator', 'remixer', 'platform'];
  const result: PartySaleRow[] = [];
  for (const party of parties) {
    const saleCents = rows
      .filter((row) => row.party === party && row.kind === 'sale')
      .reduce((sum, row) => sum + row.amount_cents, 0);
    if (saleCents === 0 && !rows.some((row) => row.party === party)) continue;
    const reversedCents = rows
      .filter((row) => row.party === party && row.kind === 'refund')
      .reduce((sum, row) => sum - row.amount_cents, 0);
    result.push({ party, saleCents, reversedCents });
  }
  return result;
}

function readRefundBody(body: unknown, remainingNetCents: number): { netCents: number; reason: string } {
  const input = (body ?? {}) as Record<string, unknown>;
  const netCents = input.net_cents;
  const reason = typeof input.reason === 'string' ? input.reason : '';

  if (
    typeof netCents !== 'number' ||
    !Number.isInteger(netCents) ||
    netCents < 1 ||
    netCents > remainingNetCents
  ) {
    throw ApiError.validation({
      net_cents: `Refund between $0.01 and $${(remainingNetCents / 100).toFixed(2)}.`,
    });
  }
  if (reason.length > 300) {
    throw ApiError.validation({ reason: 'Keep the reason under 300 characters.' });
  }
  return { netCents, reason };
}

/**
 * Refunds a receipted order in full or in part through Kill Bill, then records
 * the reversing split rows and the numbered credit note.
 */
export async function issueRefund(orderId: string, body: unknown): Promise<RefundResponse> {
  if (!/^[0-9a-f-]{36}$/.test(orderId)) throw ApiError.notFound();

  const prepared = await transaction(async (client) => {
    const order = await loadOrder(client, orderId, false);
    if (!order) throw ApiError.notFound();
    if (order.state !== 'receipted') {
      throw ApiError.invalidTransition('Only a receipted order can be refunded.');
    }
    if (!order.paid_at || !order.killbill_payment_id) {
      throw ApiError.invalidTransition('That order has no payment to refund.');
    }

    const ageSeconds = (Date.now() - order.paid_at.getTime()) / 1000;
    if (ageSeconds > config.refundWindowSeconds) {
      throw new ApiError(409, 'refund_window_closed', 'Refunds close 30 days after payment.');
    }

    const remainingNet = order.net_cents - order.refunded_net_cents;
    const refund = readRefundBody(body, remainingNet);
    return { order, refund, paymentId: order.killbill_payment_id };
  });

  const { order, refund } = prepared;
  const isFinal = order.refunded_net_cents + refund.netCents === order.net_cents;
  const refundVat = isFinal
    ? order.vat_cents - (await refundedVatSoFar(orderId))
    : vatCents(refund.netCents, order.vat_rate_percent);
  const refundGross = refund.netCents + refundVat;

  let confirmed: boolean;
  try {
    confirmed = await refundPayment(prepared.paymentId, refundGross);
  } catch (error) {
    if (error instanceof KillBillUnavailable) throw ApiError.paymentsUnavailable();
    throw error;
  }
  if (!confirmed) {
    throw ApiError.paymentsUnavailable();
  }

  const recorded = await transaction(async (client) => {
    const current = await loadOrder(client, orderId, true);
    if (!current) throw ApiError.notFound();

    const refundedAt = new Date();
    const creditNoteNumber = await nextCreditNoteNumber(client, refundedAt);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO order_refunds (order_id, credit_note_number, net_cents, vat_cents, gross_cents,
                                  reason, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        orderId,
        creditNoteNumber,
        refund.netCents,
        refundVat,
        refundGross,
        refund.reason,
        refundedAt,
      ],
    );
    const refundId = inserted.rows[0]?.id;
    if (!refundId) throw new Error('Refund insert returned no id');

    const rows = await splitRowsOf(client, orderId);
    const reversal = allocateRefundReversal(
      current.net_cents,
      partySaleRows(rows),
      refund.netCents,
      current.refunded_net_cents,
    );

    const writtenRows: SplitRow[] = [];
    for (const share of reversal) {
      const sale = rows.find((row) => row.party === share.party && row.kind === 'sale');
      if (!sale) continue;
      await client.query(
        `INSERT INTO split_rows (order_id, party, holder_user_id, holder_name, kind, amount_cents,
                                 refund_id, occurred_at)
         VALUES ($1, $2, $3, $4, 'refund', $5, $6, $7)`,
        [
          orderId,
          share.party,
          sale.holder_user_id,
          sale.holder_name,
          -share.amountCents,
          refundId,
          refundedAt,
        ],
      );
      writtenRows.push({
        party: share.party,
        holder: sale.holder_name,
        kind: 'refund',
        amount_cents: -share.amountCents,
        refund_id: refundId,
      });
    }

    const refundedNet = current.refunded_net_cents + refund.netCents;
    await client.query(
      `UPDATE edition_orders
       SET refunded_net_cents = $2, state = CASE WHEN $3 THEN 'refunded' ELSE state END
       WHERE id = $1`,
      [orderId, refundedNet, refundedNet === current.net_cents],
    );

    return { refundId, creditNoteNumber, refundedAt, rows: writtenRows };
  });

  await storeCreditNote(recorded.refundId).catch(() => undefined);

  return {
    refund: {
      id: recorded.refundId,
      credit_note_number: recorded.creditNoteNumber,
      net_cents: refund.netCents,
      vat_cents: refundVat,
      gross_cents: refundGross,
      rows: recorded.rows,
    },
  };
}

async function refundedVatSoFar(orderId: string): Promise<number> {
  const result = await query<{ total: number }>(
    'SELECT COALESCE(SUM(vat_cents), 0)::int AS total FROM order_refunds WHERE order_id = $1',
    [orderId],
  );
  return result.rows[0]?.total ?? 0;
}

interface CreditNoteRow {
  id: string;
  credit_note_number: string;
  net_cents: number;
  vat_cents: number;
  gross_cents: number;
  created_at: Date;
  invoice_number: string;
  vat_rate_percent: number;
  edition_number: number;
  edition_count: number;
  billing_name: string | null;
  email: string | null;
  piece_title: string;
  seller_name: string;
  seller_address: string | null;
}

const CREDIT_NOTE_SELECT = `
  SELECT f.id, f.credit_note_number, f.net_cents, f.vat_cents, f.gross_cents, f.created_at,
         o.invoice_number, o.vat_rate_percent, o.edition_number, o.edition_count,
         o.billing_name, o.email,
         p.title AS piece_title,
         seller.display_name AS seller_name,
         seller.seller_address AS seller_address
  FROM order_refunds f
  JOIN edition_orders o ON o.id = f.order_id
  JOIN pieces p ON p.id = o.piece_id
  JOIN app_users seller ON seller.id = p.creator_id
`;

/**
 * Renders the credit note PDF and queues the refund notice. While Gotenberg is
 * down the refund keeps its number and this work waits for the retry.
 */
async function storeCreditNote(refundId: string): Promise<void> {
  const result = await query<CreditNoteRow>(`${CREDIT_NOTE_SELECT} WHERE f.id = $1`, [refundId]);
  const note = result.rows[0];
  if (!note || !note.invoice_number) return;

  const pdf = await renderPdf(
    creditNoteHtml({
      creditNoteNumber: note.credit_note_number,
      invoiceNumber: note.invoice_number,
      issuedAt: note.created_at,
      sellerName: note.seller_name,
      sellerAddress: note.seller_address ?? 'Phosphene Yard',
      buyerName: note.billing_name ?? '',
      pieceTitle: note.piece_title,
      edition: note.edition_number,
      editionCount: note.edition_count,
      netCents: note.net_cents,
      vatRatePercent: note.vat_rate_percent,
      vatCents: note.vat_cents,
      grossCents: note.gross_cents,
    }),
  );

  const key = objectKeys.creditNote(note.created_at.getUTCFullYear(), note.credit_note_number);
  await putObject(key, pdf, 'application/pdf');

  const messageId = await transaction(async (client) => {
    const claim = await client.query(
      `UPDATE order_refunds SET note_status = 'ready', object_key = $2
       WHERE id = $1 AND note_status = 'pending'`,
      [refundId, key],
    );
    if ((claim.rowCount ?? 0) === 0) return null;

    return queueMail(client, {
      recipient: note.email ?? '',
      subject: `Refund issued: ${note.credit_note_number}`,
      bodyText: [
        `A refund of $${(note.gross_cents / 100).toFixed(2)} has been issued for ${note.piece_title} \u2014 edition ${note.edition_number} of ${note.edition_count}.`,
        '',
        `Credit note ${note.credit_note_number} is attached as a PDF.`,
        '',
        'Phosphene Yard',
      ].join('\n'),
      attachmentKey: key,
      attachmentName: `${note.credit_note_number}.pdf`,
    });
  });

  if (messageId) await sendNow(messageId);
}

/** Re-renders credit notes whose PDF is still waiting for Gotenberg. */
export async function renderPendingCreditNotes(): Promise<void> {
  const pending = await query<{ id: string }>(
    "SELECT id FROM order_refunds WHERE note_status = 'pending' ORDER BY created_at LIMIT 10",
  );
  for (const row of pending.rows) {
    try {
      await storeCreditNote(row.id);
    } catch (error) {
      if (!(error instanceof PdfRenderingUnavailable)) {
        process.stderr.write(`credit note render failed for ${row.id}: ${String(error)}\n`);
      }
    }
  }
}
