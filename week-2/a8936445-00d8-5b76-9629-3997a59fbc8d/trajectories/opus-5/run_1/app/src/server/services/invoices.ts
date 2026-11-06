import { randomUUID } from 'node:crypto';
import { errors } from '../http/errors.js';
import type { SessionUser } from '../http/context.js';
import { invoiceableBookings, updateBooking } from '../db/repo/bookings.js';
import { listShelves, listStations } from '../db/repo/catalog.js';
import {
  findInvoice,
  insertInvoice,
  listInvoices,
  lockInvoice,
  markInvoicePaid,
  nextInvoiceNumber,
  shelvesAlreadyBilled,
} from '../db/repo/invoices.js';
import { queueEmail } from '../db/repo/outbox.js';
import { recordStateChange } from '../db/repo/audit.js';
import { KITCHEN } from '../domain/constants.js';
import { invoiceTotals } from '../domain/invoiceTotals.js';
import { formatAmount } from '../domain/money.js';
import {
  isValidPeriod,
  kitchenDateOf,
  kitchenToday,
  monthPeriodOf,
  periodBounds,
} from '../domain/time.js';
import { renderPdf } from '../providers/pdf.js';
import * as storage from '../providers/storage.js';
import type { InvoiceLineRecord, InvoiceRecord, TenantRecord } from '../domain/types.js';
import { invoiceNoticeEmail, receiptEmail } from './emails.js';
import { billingAccountFor, requireTenant } from './tenants.js';
import { inUnitOfWork } from './unitOfWork.js';

function invoicePdf(tenant: TenantRecord, invoice: InvoiceRecord): Buffer {
  return renderPdf([
    { text: KITCHEN.name, bold: true, size: 16 },
    { text: `Invoice ${invoice.number}`, bold: true, size: 13 },
    { text: '' },
    { text: `Business: ${tenant.businessName}` },
    { text: `Period: ${invoice.period}` },
    { text: `Issued: ${kitchenDateOf(invoice.issuedAt)}` },
    { text: '' },
    { text: 'Lines', bold: true },
    ...invoice.lines.map((line) => ({
      text: `${line.description}  ${formatAmount(line.amountCents)}`,
    })),
    { text: '' },
    { text: `Subtotal: ${formatAmount(invoice.subtotalCents)}` },
    { text: `Sales tax (${invoice.taxRatePercent}%): ${formatAmount(invoice.taxCents)}` },
    { text: `Total: ${formatAmount(invoice.totalCents)}`, bold: true },
  ]);
}

export async function issueInvoice(
  actor: SessionUser,
  tenantId: string,
  period: string,
): Promise<InvoiceRecord> {
  const tenant = await requireTenant(tenantId);
  if (!isValidPeriod(period)) throw errors.validation({ period: 'Give a month as YYYY-MM.' });
  const currentPeriod = monthPeriodOf(kitchenToday());
  if (period > currentPeriod) {
    throw errors.validation({ period: 'That month has not started yet.' });
  }

  const bounds = periodBounds(period);
  const periodStartDate = `${period}-01`;
  const periodEndDate = kitchenDateOf(new Date(bounds.end.getTime() - 60_000));
  const stations = new Map((await listStations()).map((station) => [station.id, station]));
  const shelves = await listShelves();
  const accountId = await billingAccountFor(tenant);
  const issuedAt = new Date();

  return inUnitOfWork(async (uow) => {
    const items = await invoiceableBookings(
      uow.tx,
      tenant.id,
      periodStartDate,
      periodEndDate,
      bounds.start,
      bounds.end,
    );
    const billed = await shelvesAlreadyBilled(uow.tx, tenant.id, period);
    const tenantShelves = shelves.filter(
      (shelf) => shelf.tenantId === tenant.id && !billed.has(shelf.id),
    );

    const lines: InvoiceLineRecord[] = [];
    for (const booking of items.stationTime) {
      const station = stations.get(booking.stationId);
      lines.push({
        kind: 'station_time',
        description: `Station time ${station ? station.name : booking.stationId} ${booking.date} ${booking.startLocal}-${booking.endLocal}`,
        bookingRef: booking.ref,
        shelfId: null,
        amountCents: booking.amountCents ?? 0,
      });
    }
    for (const booking of items.holdover) {
      const station = stations.get(booking.stationId);
      lines.push({
        kind: 'holdover',
        description: `Hold-over ${booking.holdoverBilledMinutes} min ${station ? station.name : booking.stationId} ${booking.date}`,
        bookingRef: booking.ref,
        shelfId: null,
        amountCents: booking.holdoverAmountCents ?? 0,
      });
    }
    for (const booking of items.lateFee) {
      lines.push({
        kind: 'late_fee',
        description: `Late cancellation fee ${booking.date} (policy v${booking.policyVersion})`,
        bookingRef: booking.ref,
        shelfId: null,
        amountCents: booking.cancellationFeeCents ?? 0,
      });
    }
    for (const shelf of tenantShelves) {
      lines.push({
        kind: 'storage',
        description: `${shelf.name} ${period}`,
        bookingRef: null,
        shelfId: shelf.id,
        amountCents: shelf.monthlyRateCents,
      });
    }

    if (lines.length === 0) {
      throw errors.conflict('nothing_to_invoice', 'There is nothing to invoice for that month.');
    }

    const totals = invoiceTotals(lines);
    const number = await nextInvoiceNumber(uow.tx, period);
    const invoice: InvoiceRecord = {
      id: randomUUID(),
      number,
      tenantId: tenant.id,
      period,
      status: 'issued',
      lines,
      subtotalCents: totals.subtotalCents,
      taxRatePercent: totals.taxRatePercent,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
      pdfKey: `invoices/${tenant.id}/${number}.pdf`,
      issuedAt,
      paidAt: null,
    };

    await insertInvoice(uow.tx, invoice);
    for (const booking of items.stationTime) {
      await updateBooking(uow.tx, booking.id, { station_time_invoice_id: invoice.id });
    }
    for (const booking of items.holdover) {
      await updateBooking(uow.tx, booking.id, { holdover_invoice_id: invoice.id });
    }
    for (const booking of items.lateFee) {
      await updateBooking(uow.tx, booking.id, { late_fee_invoice_id: invoice.id });
    }
    await recordStateChange(uow.tx, {
      actorUserId: actor.id,
      entity: 'invoice',
      entityId: invoice.id,
      fromState: null,
      toState: 'issued',
      detail: { number, period },
    });
    await queueEmail(uow.tx, invoiceNoticeEmail(tenant, invoice));

    for (const shelf of tenantShelves) {
      await uow.charge(
        tenant.id,
        accountId,
        shelf.monthlyRateCents,
        `Storage shelf ${shelf.id} ${period}`,
      );
    }
    if (invoice.taxCents > 0) {
      await uow.charge(tenant.id, accountId, invoice.taxCents, `Sales tax ${number}`);
    }
    await uow.store(invoice.pdfKey, invoicePdf(tenant, invoice), 'application/pdf');
    return invoice;
  });
}

export async function invoicesFor(
  actor: SessionUser,
  tenantFilter: string | null,
): Promise<InvoiceRecord[]> {
  if (actor.role === 'operator') return listInvoices(tenantFilter);
  return listInvoices(actor.tenantId);
}

export async function requireInvoice(id: string, actor: SessionUser): Promise<InvoiceRecord> {
  const invoice = await findInvoice(id);
  if (!invoice) throw errors.notFound();
  if (actor.tenantId !== null && invoice.tenantId !== actor.tenantId) throw errors.notFound();
  return invoice;
}

export async function invoicePdfBytes(invoice: InvoiceRecord): Promise<Buffer> {
  const stored = await storage.getObject(invoice.pdfKey);
  if (!stored) throw errors.notFound();
  return stored.body;
}

export async function payInvoice(actor: SessionUser, id: string): Promise<InvoiceRecord> {
  const invoice = await requireInvoice(id, actor);
  if (invoice.status === 'paid') {
    throw errors.conflict('invoice_paid', 'This invoice is already paid.');
  }
  const tenant = await requireTenant(invoice.tenantId);
  const accountId = await billingAccountFor(tenant);
  const paidAt = new Date();

  await inUnitOfWork(async (uow) => {
    const locked = await lockInvoice(uow.tx, invoice.id);
    if (!locked || locked.status === 'paid') {
      throw errors.conflict('invoice_paid', 'This invoice is already paid.');
    }
    await markInvoicePaid(uow.tx, invoice.id, paidAt);
    await recordStateChange(uow.tx, {
      actorUserId: actor.id,
      entity: 'invoice',
      entityId: invoice.id,
      fromState: 'issued',
      toState: 'paid',
    });
    await queueEmail(uow.tx, receiptEmail(tenant, { ...invoice, status: 'paid', paidAt }));
    await uow.purchase(accountId, invoice.totalCents, `invoice-${invoice.number}`);
  });
  return (await findInvoice(invoice.id))!;
}
