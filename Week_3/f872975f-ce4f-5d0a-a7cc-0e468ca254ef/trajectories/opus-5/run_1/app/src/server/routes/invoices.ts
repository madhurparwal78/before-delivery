import { InvoiceLine } from '../../shared/money';
import { pool, rows } from '../db/pool';
import { ApiError } from '../errors';
import { Reply, RequestContext, jsonReply, pathParam, requireUser } from '../http';
import { Route, route } from './types';

interface InvoiceRow {
  id: string;
  ticket_id: string;
  board_tag: string;
  maker_id: string;
  price_cents: number;
  deposit_cents: number;
  amount_cents: number;
  lines: InvoiceLine[];
  status: string;
  paid_at: Date;
  killbill_payment_id: string | null;
}

function invoiceShape(invoice: InvoiceRow): Record<string, unknown> {
  return {
    id: invoice.id,
    ticket: invoice.ticket_id,
    board: invoice.board_tag,
    price_cents: invoice.price_cents,
    deposit_cents: invoice.deposit_cents,
    amount_cents: invoice.amount_cents,
    lines: invoice.lines,
    status: invoice.status,
    paid_at: invoice.paid_at.toISOString(),
    killbill_payment_id: invoice.killbill_payment_id
  };
}

const INVOICE_COLUMNS = `
  id, ticket_id, board_tag, maker_id, price_cents, deposit_cents, amount_cents, lines, status, paid_at, killbill_payment_id
`;

async function listInvoices(context: RequestContext): Promise<Reply> {
  const user = requireUser(context);
  if (user.role === 'hand') throw new ApiError('forbidden');
  const found = await rows<InvoiceRow>(
    pool,
    `SELECT ${INVOICE_COLUMNS} FROM invoices WHERE ($1::text IS NULL OR maker_id = $1) ORDER BY id`,
    [user.role === 'owner' ? null : user.id]
  );
  return jsonReply(200, { invoices: found.map(invoiceShape) });
}

async function readInvoice(context: RequestContext): Promise<Reply> {
  const user = requireUser(context);
  const found = await rows<InvoiceRow>(pool, `SELECT ${INVOICE_COLUMNS} FROM invoices WHERE id = $1`, [
    pathParam(context, 'id')
  ]);
  const invoice = found[0];
  if (invoice === undefined) throw new ApiError('not_found');
  if (user.role === 'maker' && invoice.maker_id !== user.id) throw new ApiError('not_found');
  if (user.role === 'hand') throw new ApiError('forbidden');
  return jsonReply(200, { invoice: invoiceShape(invoice) });
}

export const invoiceRoutes: Route[] = [
  route('GET', '/api/invoices', true, listInvoices),
  route('GET', '/api/invoices/:id', true, readInvoice)
];
