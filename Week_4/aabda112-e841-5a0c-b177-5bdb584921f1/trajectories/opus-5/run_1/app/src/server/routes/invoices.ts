import { Router } from 'express';
import { serverNow } from '../clock';
import { newId, one, query, transaction, type Tx } from '../db';
import { AppError, invalid } from '../errors';
import {
  body,
  created,
  findInClinic,
  findPatient,
  ok,
  rememberIdempotency,
  replayIdempotency,
  route,
} from '../http';
import { requireActor, requireCapability } from '../auth';
import { announce, publish } from '../live';
import { lineAmounts } from '../domain/money';
import {
  drawForInvoiceLine,
  lockItem,
  lowStockAnnouncement,
  returnInvoiceLineDraws,
  settleLowStock,
  type StockItemRow,
} from '../domain/stock';
import { clinicTimeHm, money } from '../format';
import { exportObjectKey, putObject } from '../storage';
import { invoicePdf } from '../pdf';

export const invoiceRouter = Router();

export type InvoiceRow = {
  id: string;
  clinic_id: string;
  number: string;
  patient_id: string;
  appointment_id: string | null;
  status: string;
  discount_percent: number;
  voided_by: string | null;
  voided_at: Date | null;
  void_reason: string | null;
};

export const STATUS_TEXT: Record<string, string> = {
  draft: 'Draft',
  issued: 'Unpaid',
  'part-paid': 'Part paid',
  paid: 'Paid',
  voided: 'Voided',
};

export async function invoiceDetail(tx: Tx, invoiceId: string): Promise<Record<string, unknown>> {
  const invoice = await tx.one<InvoiceRow & { patient_name: string; voided_by_name: string | null }>(
    `select i.*, p.name as patient_name, v.name as voided_by_name
       from invoices i join patients p on p.id = i.patient_id
       left join users v on v.id = i.voided_by
      where i.id = $1`,
    [invoiceId],
  );
  if (!invoice) throw new AppError('not_found');
  const lines = await tx.query<{
    id: string;
    stock_item_id: string;
    description: string;
    quantity: number;
    unit_price_pence: number;
  }>(
    'select id, stock_item_id, description, quantity, unit_price_pence from invoice_lines where invoice_id = $1 order by seq',
    [invoiceId],
  );
  const payments = await tx.query<{
    id: string;
    pence: number;
    at: Date;
    taken_by: string;
    taken_by_name: string;
  }>(
    `select pa.id, pa.pence, pa.at, pa.taken_by, u.name as taken_by_name
       from payments pa join users u on u.id = pa.taken_by
      where pa.invoice_id = $1 order by pa.at, pa.id`,
    [invoiceId],
  );
  const apiLines = lines.map((line) => {
    const amounts = lineAmounts(line.quantity, line.unit_price_pence, invoice.discount_percent);
    return {
      id: line.id,
      stockItemId: line.stock_item_id,
      description: line.description,
      quantity: line.quantity,
      unitPricePence: line.unit_price_pence,
      netPence: amounts.netPence,
      discountPence: amounts.discountPence,
      vatPence: amounts.vatPence,
      totalPence: amounts.totalPence,
    };
  });
  const totalPence = apiLines.reduce((sum, line) => sum + line.totalPence, 0);
  const paidPence = payments.reduce((sum, payment) => sum + payment.pence, 0);
  return {
    id: invoice.id,
    number: invoice.number,
    patientId: invoice.patient_id,
    patientName: invoice.patient_name,
    appointmentId: invoice.appointment_id,
    status: invoice.status,
    statusText: STATUS_TEXT[invoice.status],
    discountPercent: invoice.discount_percent,
    lines: apiLines,
    totalPence,
    paidPence,
    balancePence: totalPence - paidPence,
    payments: payments.map((payment) => ({
      id: payment.id,
      pence: payment.pence,
      at: payment.at.toISOString(),
      takenBy: { id: payment.taken_by, name: payment.taken_by_name },
    })),
    voidedBy: invoice.voided_by ? { id: invoice.voided_by, name: invoice.voided_by_name } : null,
    voidedAt: invoice.voided_at ? invoice.voided_at.toISOString() : null,
    voidReason: invoice.void_reason,
  };
}

async function loadInvoice(id: unknown, clinicId: string): Promise<InvoiceRow> {
  return findInClinic<InvoiceRow>('invoices', id, clinicId);
}

invoiceRouter.get(
  '/api/invoices/:id.pdf',
  route(async (request, response) => {
    const actor = await requireActor(request);
    const invoice = await loadInvoice(request.params.id, actor.clinicId);
    requireCapability(actor, 'invoice.read');
    const detail = await transaction((tx) => invoiceDetail(tx, invoice.id));
    const lines = (detail.lines as { description: string; quantity: number; totalPence: number }[]).map(
      (line) => `${line.description} x${line.quantity} ${money(line.totalPence)}`,
    );
    const totals = [
      `Total ${money(detail.totalPence as number)}`,
      `Paid ${money(detail.paidPence as number)}`,
      `Balance due ${money(detail.balancePence as number)}`,
      ...(detail.payments as { pence: number; at: string; takenBy: { name: string } }[]).map(
        (payment) =>
          `Payment ${money(payment.pence)} taken by ${payment.takenBy.name} at ${clinicTimeHm(
            Date.parse(payment.at),
          )}`,
      ),
    ];
    if (detail.voidedAt) {
      const voidedBy = detail.voidedBy as { name: string };
      totals.push(
        `Voided by ${voidedBy.name} at ${clinicTimeHm(Date.parse(detail.voidedAt as string))}: ${
          detail.voidReason as string
        }`,
      );
    }
    const bytes = await invoicePdf({ number: invoice.number, lines, totals });
    const key = exportObjectKey(actor.clinicId, 'invoice', invoice.id, Math.floor(serverNow() / 1000));
    await putObject(key, bytes, 'application/pdf');
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(`${invoice.number}.pdf`)}`,
    );
    response.status(200).end(bytes);
  }),
);

invoiceRouter.get(
  '/api/invoices',
  route(async (request) => {
    const actor = await requireActor(request);
    requireCapability(actor, 'invoice.read');
    const status = typeof request.query.status === 'string' ? request.query.status : '';
    const rows = await query<InvoiceRow & { patient_name: string }>(
      `select i.*, p.name as patient_name from invoices i join patients p on p.id = i.patient_id
        where i.clinic_id = $1 and ($2 = '' or i.status = $2)
        order by i.number desc`,
      [actor.clinicId, status],
    );
    const invoices = await transaction(async (tx) => {
      const list = [];
      for (const row of rows) {
        const detail = await invoiceDetail(tx, row.id);
        list.push({
          id: row.id,
          number: row.number,
          patientName: row.patient_name,
          status: row.status,
          statusText: STATUS_TEXT[row.status],
          totalPence: detail.totalPence,
          balancePence: detail.balancePence,
        });
      }
      return list;
    });
    return ok({ invoices });
  }),
);

invoiceRouter.post(
  '/api/invoices',
  route(async (request) => {
    const actor = await requireActor(request);
    const input = body(request);
    const patient = await findPatient(input.patientId, actor.clinicId);
    let appointmentId: string | null = null;
    if (input.appointmentId !== undefined && input.appointmentId !== null) {
      const appointment = await findInClinic<{ id: string }>(
        'appointments',
        input.appointmentId,
        actor.clinicId,
        'id',
      );
      appointmentId = appointment.id;
    }
    requireCapability(actor, 'invoice.build');
    const invoice = await transaction(async (tx) => {
      if (appointmentId) {
        const existing = await tx.one<{ id: string }>(
          `select id from invoices where appointment_id = $1 and status <> 'voided'`,
          [appointmentId],
        );
        if (existing) throw new AppError('invoice_exists');
      }
      await tx.query('select pg_advisory_xact_lock(hashtext($1), 5)', [actor.clinicId]);
      const counter = await tx.one<{ next_invoice: number }>(
        `insert into clinic_counters (clinic_id, next_invoice) values ($1, 1)
         on conflict (clinic_id) do update set next_invoice = clinic_counters.next_invoice + 1
         returning next_invoice`,
        [actor.clinicId],
      );
      const number = `INV-${String(counter?.next_invoice ?? 1).padStart(4, '0')}`;
      const id = newId();
      await tx.query(
        `insert into invoices (id, clinic_id, number, patient_id, appointment_id, status)
         values ($1,$2,$3,$4,$5,'draft')`,
        [id, actor.clinicId, number, patient.id, appointmentId],
      );
      return invoiceDetail(tx, id);
    });
    publish(actor.clinicId, { kind: 'changed', topics: ['invoices'] });
    return created(invoice);
  }),
);

invoiceRouter.get(
  '/api/invoices/:id',
  route(async (request) => {
    const actor = await requireActor(request);
    const invoice = await loadInvoice(request.params.id, actor.clinicId);
    requireCapability(actor, 'invoice.read');
    return ok(await transaction((tx) => invoiceDetail(tx, invoice.id)));
  }),
);

invoiceRouter.post(
  '/api/invoices/:id/lines',
  route(async (request) => {
    const actor = await requireActor(request);
    const invoice = await loadInvoice(request.params.id, actor.clinicId);
    const input = body(request);
    const item = await findInClinic<StockItemRow>('stock_items', input.stockItemId, actor.clinicId);
    requireCapability(actor, 'invoice.build');
    const replay = await replayIdempotency(request, actor.clinicId);
    if (replay) return replay;
    if (invoice.status !== 'draft') throw new AppError('invoice_not_draft');
    const quantity = input.quantity;
    if (
      typeof quantity !== 'number' ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 999
    ) {
      throw invalid('quantity');
    }
    const now = serverNow();
    const result = await transaction(async (tx) => {
      await lockItem(tx, item.id);
      const current = await tx.one<{ status: string }>('select status from invoices where id = $1', [
        invoice.id,
      ]);
      if (!current || current.status !== 'draft') throw new AppError('invoice_not_draft');
      const lineId = newId();
      await tx.query(
        `insert into invoice_lines (id, invoice_id, stock_item_id, description, quantity, unit_price_pence)
         values ($1,$2,$3,$4,$5,$6)`,
        [lineId, invoice.id, item.id, item.name, quantity, item.unit_price_pence],
      );
      await drawForInvoiceLine(tx, {
        item,
        quantity,
        invoiceLineId: lineId,
        byUser: actor.id,
        now,
      });
      const crossing = await settleLowStock(tx, item, now);
      const detail = await invoiceDetail(tx, invoice.id);
      return { detail, crossing };
    });
    publish(actor.clinicId, { kind: 'changed', topics: ['invoices', 'stock'] });
    if (result.crossing) {
      announce(actor.clinicId, lowStockAnnouncement(result.crossing), 'manager');
    }
    await rememberIdempotency(request, actor.clinicId, 201, result.detail);
    return created(result.detail);
  }),
);

invoiceRouter.delete(
  '/api/invoices/:id/lines/:lineId',
  route(async (request) => {
    const actor = await requireActor(request);
    const invoice = await loadInvoice(request.params.id, actor.clinicId);
    const line = await one<{ id: string; stock_item_id: string }>(
      'select id, stock_item_id from invoice_lines where id = $1 and invoice_id = $2',
      [request.params.lineId, invoice.id],
    );
    if (!line) throw new AppError('not_found');
    requireCapability(actor, 'invoice.build');
    if (invoice.status !== 'draft') throw new AppError('invoice_not_draft');
    const now = serverNow();
    const result = await transaction(async (tx) => {
      const item = await tx.one<StockItemRow>('select * from stock_items where id = $1', [
        line.stock_item_id,
      ]);
      await lockItem(tx, line.stock_item_id);
      await returnInvoiceLineDraws(tx, { invoiceLineId: line.id, byUser: actor.id, now });
      await tx.query('delete from invoice_lines where id = $1', [line.id]);
      const crossing = item ? await settleLowStock(tx, item, now) : null;
      return { detail: await invoiceDetail(tx, invoice.id), crossing };
    });
    publish(actor.clinicId, { kind: 'changed', topics: ['invoices', 'stock'] });
    if (result.crossing) {
      announce(actor.clinicId, lowStockAnnouncement(result.crossing), 'manager');
    }
    return ok(result.detail);
  }),
);

invoiceRouter.patch(
  '/api/invoices/:id',
  route(async (request) => {
    const actor = await requireActor(request);
    const invoice = await loadInvoice(request.params.id, actor.clinicId);
    requireCapability(actor, 'invoice.build');
    if (invoice.status !== 'draft') throw new AppError('invoice_not_draft');
    const input = body(request);
    const percent = input.discountPercent;
    if (typeof percent !== 'number' || !Number.isInteger(percent) || percent < 0 || percent > 100) {
      throw invalid('discountPercent');
    }
    const detail = await transaction(async (tx) => {
      await tx.query('update invoices set discount_percent = $2 where id = $1', [invoice.id, percent]);
      return invoiceDetail(tx, invoice.id);
    });
    publish(actor.clinicId, { kind: 'changed', topics: ['invoices'] });
    return ok(detail);
  }),
);

invoiceRouter.post(
  '/api/invoices/:id/issue',
  route(async (request) => {
    const actor = await requireActor(request);
    const invoice = await loadInvoice(request.params.id, actor.clinicId);
    requireCapability(actor, 'invoice.build');
    if (invoice.status !== 'draft') throw new AppError('invoice_not_draft');
    const lines = await one<{ count: string }>(
      'select count(*)::text as count from invoice_lines where invoice_id = $1',
      [invoice.id],
    );
    if (Number(lines?.count ?? 0) === 0) throw new AppError('no_lines', { field: 'lines' });
    const detail = await transaction(async (tx) => {
      await tx.query(`update invoices set status = 'issued' where id = $1`, [invoice.id]);
      return invoiceDetail(tx, invoice.id);
    });
    publish(actor.clinicId, { kind: 'changed', topics: ['invoices'] });
    return ok(detail);
  }),
);

invoiceRouter.post(
  '/api/invoices/:id/payments',
  route(async (request) => {
    const actor = await requireActor(request);
    const invoice = await loadInvoice(request.params.id, actor.clinicId);
    requireCapability(actor, 'invoice.money');
    const replay = await replayIdempotency(request, actor.clinicId);
    if (replay) return replay;
    if (invoice.status === 'draft') throw new AppError('invoice_not_issued');
    if (invoice.status === 'paid' || invoice.status === 'voided') {
      throw new AppError('invoice_closed');
    }
    const input = body(request);
    const pence = input.pence;
    if (typeof pence !== 'number' || !Number.isInteger(pence) || pence < 1) throw invalid('pence');
    const now = serverNow();
    const detail = await transaction(async (tx) => {
      await tx.query('select pg_advisory_xact_lock(hashtext($1), 6)', [invoice.id]);
      const before = await invoiceDetail(tx, invoice.id);
      const status = before.status as string;
      if (status === 'draft') throw new AppError('invoice_not_issued');
      if (status === 'paid' || status === 'voided') throw new AppError('invoice_closed');
      const balance = before.balancePence as number;
      if (pence > balance) throw new AppError('payment_too_large', { field: 'pence' });
      await tx.query(
        'insert into payments (id, invoice_id, pence, at, taken_by) values ($1,$2,$3,$4,$5)',
        [newId(), invoice.id, pence, new Date(now).toISOString(), actor.id],
      );
      const nextStatus = pence === balance ? 'paid' : 'part-paid';
      await tx.query('update invoices set status = $2 where id = $1', [invoice.id, nextStatus]);
      return invoiceDetail(tx, invoice.id);
    });
    publish(actor.clinicId, { kind: 'changed', topics: ['invoices'] });
    await rememberIdempotency(request, actor.clinicId, 201, detail);
    return created(detail);
  }),
);

invoiceRouter.post(
  '/api/invoices/:id/void',
  route(async (request) => {
    const actor = await requireActor(request);
    const invoice = await loadInvoice(request.params.id, actor.clinicId);
    requireCapability(actor, 'invoice.money');
    if (invoice.status === 'voided') throw new AppError('invoice_closed');
    const payments = await one<{ count: string }>(
      'select count(*)::text as count from payments where invoice_id = $1',
      [invoice.id],
    );
    if (Number(payments?.count ?? 0) > 0) throw new AppError('invoice_has_payments');
    if (invoice.status === 'paid') throw new AppError('invoice_has_payments');
    const input = body(request);
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (reason.length === 0) throw invalid('reason', 'missing');
    if (reason.length > 200) throw invalid('reason');
    const now = serverNow();
    const result = await transaction(async (tx) => {
      const lines = await tx.query<{ id: string; stock_item_id: string }>(
        'select id, stock_item_id from invoice_lines where invoice_id = $1 order by seq',
        [invoice.id],
      );
      const crossings = [];
      for (const line of lines) {
        await lockItem(tx, line.stock_item_id);
        await returnInvoiceLineDraws(tx, { invoiceLineId: line.id, byUser: actor.id, now });
      }
      await tx.query(
        `update invoices set status = 'voided', voided_by = $2, voided_at = $3, void_reason = $4
          where id = $1`,
        [invoice.id, actor.id, new Date(now).toISOString(), reason],
      );
      for (const itemId of new Set(lines.map((line) => line.stock_item_id))) {
        const item = await tx.one<StockItemRow>('select * from stock_items where id = $1', [itemId]);
        if (!item) continue;
        const crossing = await settleLowStock(tx, item, now);
        if (crossing) crossings.push(crossing);
      }
      return { detail: await invoiceDetail(tx, invoice.id), crossings };
    });
    publish(actor.clinicId, { kind: 'changed', topics: ['invoices', 'stock'] });
    for (const crossing of result.crossings) {
      announce(actor.clinicId, lowStockAnnouncement(crossing), 'manager');
    }
    return ok(result.detail);
  }),
);
