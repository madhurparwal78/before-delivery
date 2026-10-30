import { Router } from 'express';
import type { Request } from 'express';
import { many, one, pool } from '../db/pool.js';
import { centsToDecimal } from '../lib/money.js';
import { notFound } from '../lib/errors.js';
import { requireCaller, requireRole, type Caller } from '../http/middleware.js';
import { fail } from '../http/validate.js';
import {
  creditedCents,
  listInvoices,
  loadInvoice,
  paidCents,
  serialiseCreditNote,
  serialiseInvoice,
} from '../domain/invoices.js';

export const groupRouter = Router();

const GROUP_READERS = ['group_booker', 'finance'] as const;

/** Group bookers see only their own organisation; finance may read every organisation. */
function organisationScope(caller: Caller, req: Request): string | null {
  if (caller.role === 'group_booker') return caller.organisationId;
  const requested = req.query['organisation_id'];
  return typeof requested === 'string' ? requested : null;
}

function scopeClause(organisationId: string | null): { clause: string; values: string[] } {
  return organisationId === null
    ? { clause: 'organisation_id IS NOT NULL', values: [] }
    : { clause: 'organisation_id = $1', values: [organisationId] };
}

groupRouter.get('/group/dashboard', async (req, res) => {
  const caller = requireRole(req, ...GROUP_READERS);
  const organisationId = organisationScope(caller, req);
  const scope = scopeClause(organisationId);

  const counts = await one<{ orders: number; tickets: number }>(
    pool,
    `SELECT COUNT(DISTINCT o.id)::int AS orders, COUNT(l.id)::int AS tickets
     FROM orders o LEFT JOIN order_lines l ON l.order_id = o.id
     WHERE o.${scope.clause}`,
    scope.values,
  );

  const invoices = await listInvoices(pool, organisationId);
  let invoiced = 0;
  let credited = 0;
  let paid = 0;
  let outstanding = 0;
  for (const invoice of invoices) {
    const invoiceCredited = await creditedCents(pool, invoice.id);
    const invoicePaid =
      invoice.status === 'written_off'
        ? invoice.amount_cents - invoiceCredited
        : await paidCents(pool, invoice.id);
    invoiced += invoice.amount_cents;
    credited += invoiceCredited;
    paid += invoicePaid;
    outstanding += invoice.amount_cents - invoiceCredited - invoicePaid;
  }

  const organisation =
    organisationId === null
      ? { id: '', name: 'Every organisation' }
      : ((await one<{ id: string; name: string }>(
          pool,
          `SELECT id, name FROM organisations WHERE id = $1`,
          [organisationId],
        )) ?? { id: organisationId, name: organisationId });

  res.status(200).json({
    organisation,
    orders: counts?.orders ?? 0,
    tickets: counts?.tickets ?? 0,
    invoiced_cents: invoiced,
    credited_cents: credited,
    paid_cents: paid,
    outstanding_cents: outstanding,
  });
});

groupRouter.get('/group/attendees', async (req, res) => {
  const caller = requireRole(req, ...GROUP_READERS);
  const organisationId = organisationScope(caller, req);
  const query = typeof req.query['q'] === 'string' ? req.query['q'].trim() : '';
  if (query.length < 2) fail('q', 'too_short');

  const rows =
    organisationId === null
      ? await many<{
          name: string;
          order_ref: string;
          line_id: string;
          item_title: string;
          state: string;
        }>(
          pool,
          `SELECT l.holder_name AS name, o.ref AS order_ref, l.id AS line_id,
                  l.title AS item_title, l.state
           FROM order_lines l JOIN orders o ON o.id = l.order_id
           WHERE o.organisation_id IS NOT NULL AND l.holder_name ILIKE '%' || $1 || '%'
           ORDER BY l.holder_name, l.position`,
          [query],
        )
      : await many<{
          name: string;
          order_ref: string;
          line_id: string;
          item_title: string;
          state: string;
        }>(
          pool,
          `SELECT l.holder_name AS name, o.ref AS order_ref, l.id AS line_id,
                  l.title AS item_title, l.state
           FROM order_lines l JOIN orders o ON o.id = l.order_id
           WHERE o.organisation_id = $1 AND l.holder_name ILIKE '%' || $2 || '%'
           ORDER BY l.holder_name, l.position`,
          [organisationId, query],
        );

  res.status(200).json({ attendees: rows });
});

groupRouter.get('/group/export.csv', async (req, res) => {
  const caller = requireRole(req, ...GROUP_READERS);
  const organisationId = organisationScope(caller, req);
  const rows =
    organisationId === null
      ? await many<ExportRow>(pool, exportQuery('o.organisation_id IS NOT NULL'), [])
      : await many<ExportRow>(pool, exportQuery('o.organisation_id = $1'), [organisationId]);

  const lines = [
    'order_ref,attendee_name,item,festival_day,list_eur,group_discount_eur,voucher_eur,invoiced_eur,state',
    ...rows.map((row) =>
      [
        row.order_ref,
        csvCell(row.attendee_name),
        csvCell(row.item),
        row.festival_day ?? '',
        centsToDecimal(row.list_cents),
        centsToDecimal(row.group_discount_cents),
        centsToDecimal(row.voucher_cents),
        centsToDecimal(row.charged_cents),
        row.state,
      ].join(','),
    ),
  ];
  res.status(200);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="kerf-group-export.csv"');
  res.send(`${lines.join('\n')}\n`);
});

interface ExportRow {
  order_ref: string;
  attendee_name: string;
  item: string;
  festival_day: string | null;
  list_cents: number;
  group_discount_cents: number;
  voucher_cents: number;
  charged_cents: number;
  state: string;
}

function exportQuery(clause: string): string {
  return `SELECT o.ref AS order_ref, l.holder_name AS attendee_name, l.title AS item,
                 l.festival_day::text AS festival_day, l.list_cents, l.group_discount_cents,
                 l.voucher_cents, l.charged_cents, l.state
          FROM order_lines l JOIN orders o ON o.id = l.order_id
          WHERE ${clause}
          ORDER BY o.created_at, l.position`;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

groupRouter.get('/invoices', async (req, res) => {
  const caller = requireRole(req, ...GROUP_READERS);
  const organisationId = organisationScope(caller, req);
  const rows = await listInvoices(pool, organisationId);
  const invoices = [];
  for (const row of rows) {
    invoices.push(await serialiseInvoice(pool, row));
  }
  res.status(200).json({ invoices });
});

groupRouter.get('/invoices/:id', async (req, res) => {
  const caller = requireCaller(req);
  const invoice = await loadInvoice(pool, req.params.id);
  if (invoice === null) throw notFound();
  if (caller.role === 'finance') {
    res.status(200).json(await serialiseInvoice(pool, invoice));
    return;
  }
  if (caller.role !== 'group_booker' || invoice.organisation_id !== caller.organisationId) {
    throw notFound();
  }
  res.status(200).json(await serialiseInvoice(pool, invoice));
});

groupRouter.get('/credit-notes/:id', async (req, res) => {
  const caller = requireCaller(req);
  const note = await serialiseCreditNote(pool, req.params.id);
  if (note === null) throw notFound();
  const invoice = await loadInvoice(pool, note.invoice_id);
  if (invoice === null) throw notFound();
  if (caller.role === 'finance') {
    res.status(200).json(note);
    return;
  }
  if (caller.role !== 'group_booker' || invoice.organisation_id !== caller.organisationId) {
    throw notFound();
  }
  res.status(200).json(note);
});
