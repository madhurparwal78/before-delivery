import { transact, type QueryValue } from '../db.js';
import { ApiError } from '../http/errors.js';
import { json, type RouteContext, type RouteResult } from '../http/context.js';
import { route, type Route } from '../http/router.js';
import { computeCharge } from '../domain/charge.js';
import { parseDollars } from '../domain/money.js';
import { endsAt } from '../domain/projection.js';
import { writeHistory } from '../store/requests.js';
import { insertCharge, loadCharges, projectInvoice, reloadCharge } from '../store/charges.js';
import { queueEmails } from '../store/emails.js';
import { chargesEmail } from '../mail/templates.js';
import { postPendingCharges } from '../workers/billing-poster.js';
import { readableRequest, viewById } from './common.js';
import { readIdempotencyKey, requireJsonContentType } from './validation.js';
import { bodyHash, rememberIdempotentResponse, replayOrReject } from './idempotency.js';
import type { Invoice } from '../../shared/types.js';

async function closeRequest(ctx: RouteContext): Promise<RouteResult> {
  const actor = ctx.requireActor();
  const requestId = ctx.param('id');
  const loaded = await readableRequest(actor, requestId);
  ctx.gate('billing_admin');

  const body = ctx.body();
  const rawKey = ctx.header('idempotency-key');
  if (rawKey !== null && rawKey.length >= 1 && rawKey.length <= 64) {
    const replay = await replayOrReject(actor.id, {
      key: rawKey,
      endpoint: 'close',
      request_id: requestId,
      body_hash: bodyHash(body),
    });
    if (replay !== null) return replay;
  }

  if (loaded.row.status !== 'completed') throw new ApiError('invalid_transition');
  requireJsonContentType(ctx.hasWrongContentType());
  const key = readIdempotencyKey(rawKey);

  const now = new Date();
  const seats = loaded.seats.filter((seat) => seat.status === 'confirmed').length;
  const rate = parseDollars(loaded.row.hourly_rate) ?? 0n;
  const charge = computeCharge(loaded.row.actual_minutes ?? loaded.row.duration_minutes, seats, rate);

  const chargeId = await transact(async (client) => {
    const created = await insertCharge(client, {
      request_id: requestId,
      kind: 'interpreting',
      billable_minutes: charge.billable_minutes,
      seats: charge.seats,
      hourly_rate: charge.hourly_rate,
      amount: charge.amount,
    });
    await client.query(`UPDATE requests SET status = 'invoiced' WHERE id = $1`, [requestId]);
    await writeHistory(
      client,
      requestId,
      actor.display_name,
      'closed',
      `$${charge.amount} for ${charge.billable_minutes} minutes`,
    );
    const scheduler = await client.query<{ email: string }>(
      `SELECT email FROM people WHERE role = 'client_scheduler' AND organisation_id = $1`,
      [loaded.row.organisation_id],
    );
    await queueEmails(
      client,
      scheduler.rows.map((row) =>
        chargesEmail(
          {
            reference: loaded.row.reference,
            setting: loaded.row.setting,
            required_credential: loaded.row.required_credential,
            starts_at: loaded.row.starts_at,
            ends_at: endsAt(loaded.row.starts_at, loaded.row.duration_minutes),
            city: loaded.row.city,
          },
          row.email,
          charge,
        ),
      ),
    );
    return created;
  });

  await postPendingCharges(chargeId).catch(() => undefined);

  const result = {
    request: await viewById(actor, requestId, now),
    invoice: projectInvoice(await reloadCharge(chargeId)),
  };
  await transact(async (client) => {
    await rememberIdempotentResponse(
      client,
      actor.id,
      { key, endpoint: 'close', request_id: requestId, body_hash: bodyHash(body) },
      200,
      result,
    );
  });
  return json(result);
}

async function visibleInvoices(ctx: RouteContext): Promise<Invoice[]> {
  const actor = ctx.gate('billing_admin', 'client_scheduler');
  const clauses: string[] = ['1 = 1'];
  const values: QueryValue[] = [];
  if (actor.role === 'client_scheduler') {
    values.push(actor.organisation?.id ?? '');
    clauses.push(`o.id = $${values.length}`);
  }
  const search = ctx.queryParam('q');
  if (search !== null && search !== '') {
    values.push(`%${search}%`);
    clauses.push(`r.reference ILIKE $${values.length}`);
  }
  const charges = await loadCharges(clauses.join(' AND '), values);
  return charges.map(projectInvoice);
}

async function listInvoices(ctx: RouteContext): Promise<RouteResult> {
  return json({ invoices: await visibleInvoices(ctx) });
}

const CSV_HEADER =
  'reference,organisation,kind,billable_minutes,seats,hourly_rate,amount,billing_status,killbill_invoice_id,created_at';

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

async function exportInvoices(ctx: RouteContext): Promise<RouteResult> {
  const invoices = await visibleInvoices(ctx);
  const lines = [CSV_HEADER];
  for (const invoice of invoices) {
    lines.push(
      [
        invoice.request_reference,
        invoice.organisation.name,
        invoice.kind,
        String(invoice.billable_minutes),
        String(invoice.seats),
        invoice.hourly_rate,
        invoice.amount,
        invoice.billing_status,
        invoice.killbill_invoice_id ?? '',
        invoice.created_at,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return {
    kind: 'text',
    status: 200,
    contentType: 'text/csv; charset=utf-8',
    body: `${lines.join('\r\n')}\r\n`,
    headers: { 'content-disposition': 'attachment; filename="invoices.csv"' },
  };
}

export const billingRoutes: Route[] = [
  route('POST', '/api/requests/:id/close', closeRequest),
  route('GET', '/api/invoices', listInvoices),
  route('GET', '/api/invoices.csv', exportInvoices),
];
