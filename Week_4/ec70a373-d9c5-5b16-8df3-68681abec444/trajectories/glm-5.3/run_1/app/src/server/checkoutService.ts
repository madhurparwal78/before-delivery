import type { DbClient, Row } from './db.js';
import { clientQuery } from './db.js';
import type { AppContext, SessionUser } from './context.js';
import { memberById } from './context.js';
import { nowMs } from '../clock.js';
import { ApiError } from './errors.js';
import { loadBooking, loadSite, loadStation, type BookingRow } from './domain.js';

import { drawFromLots, writeMovement } from './ledger.js';
import { bookingWire } from './wire.js';
import { formatMoney } from '../labels.js';
import { localDateOfInstant } from '../sitetime.js';
import type { Json } from '../types.js';

/** Lateness: whole minutes from the booked end, rounded up to quarter hours. */
export function lateQuarterHours(endAt: number, checkOutAt: number): number {
  const lateMinutes = Math.floor((checkOutAt - endAt) / 60000);
  if (lateMinutes <= 0) return 0;
  return Math.ceil(lateMinutes / 15);
}

/** Rounding happens once, half up to whole cents, at the line stage. */
export function overageAmount(quarterHours: number, hourlyRateCents: number, taxRatePercent: string): { subtotalCents: number; taxCents: number; totalCents: number } {
  const exactSubtotal = (quarterHours * hourlyRateCents) / 4;
  const subtotalCents = roundHalfUp(exactSubtotal);
  const exactTax = (exactSubtotal * Number(taxRatePercent)) / 100;
  const taxCents = roundHalfUp(exactTax);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

/** The rate with the latest effective date on or before the booking's site-local start date. */
export async function resolveRate(client: DbClient, siteId: string, bookingDate: string): Promise<Row | null> {
  const rows = await clientQuery<Row>(
    client,
    `SELECT * FROM rates WHERE site_id = $1 AND effective_from <= $2 ORDER BY effective_from DESC LIMIT 1`,
    [siteId, bookingDate],
  );
  return rows[0] ?? null;
}

export async function checkOut(
  ctx: AppContext,
  client: DbClient,
  actor: SessionUser,
  bookingId: string,
): Promise<{ body: Json }> {
  const booking = await loadBooking(client, bookingId);
  if (!booking || booking.tenant_id !== actor.tenantId || booking.site_id !== actor.siteId) {
    throw new ApiError(404, 'not_found', 'There is nothing here.');
  }
  if (booking.status !== 'checked_in') {
    throw new ApiError(409, 'invalid_transition', 'That booking cannot be checked out.');
  }
  const at = nowMs();
  const lateQh = lateQuarterHours(Number(booking.end_at), at);
  const site = await loadSite(client, booking.site_id);
  const zone = site?.time_zone ?? 'UTC';
  const bookingDate = localDateOfInstant(Number(booking.start_at), zone);
  const rate = await resolveRate(client, booking.site_id, bookingDate);
  void zone;

  let packAppliedQh = 0;
  let overageQh = 0;
  if (lateQh > 0) {
    const balance = await clientQuery<Row>(
      client,
      `SELECT COALESCE(SUM(quarter_hours), 0) AS total FROM movement_entries WHERE member_id = $1 AND account = 'available'`,
      [booking.member_id],
    );
    const availableQh = Number(balance[0].total);
    packAppliedQh = Math.min(lateQh, Math.max(0, availableQh));
    overageQh = lateQh - packAppliedQh;
  }

  let overage: Record<string, Json> | null = null;
  let invoiceId: string | null = null;
  if (overageQh > 0 && rate) {
    const amounts = overageAmount(overageQh, Number(rate.hourly_rate_cents), String(rate.tax_rate_percent));
    const member = await memberById(client, booking.member_id);
    const hourlyRate = Number(rate.hourly_rate_cents);
    const description = `Overage ${booking.reference}: ${overageQh} quarter hours at $${formatMoney(hourlyRate)}/h plus ${String(rate.tax_rate_percent)}% tax`;
    try {
      const account = await ctx.killbill.ensureAccount({
        externalKey: booking.member_id,
        name: String(member?.business_name ?? ''),
        email: String(member?.email ?? ''),
      });
      const createdInvoiceId = await ctx.killbill.createOverageInvoice({
        accountId: account.accountId,
        amountDollars: amounts.totalCents / 100,
        description,
        externalKey: bookingId,
      });
      await ctx.killbill.commitInvoice(createdInvoiceId);
      const status = await ctx.killbill.invoiceStatus(createdInvoiceId);
      if (status !== 'COMMITTED') {
        await ctx.killbill.voidInvoice(createdInvoiceId);
        throw new Error('not committed');
      }
      invoiceId = createdInvoiceId;
      overage = {
        quarter_hours: overageQh,
        hourly_rate_cents: hourlyRate,
        tax_rate_percent: String(rate.tax_rate_percent),
        subtotal_cents: amounts.subtotalCents,
        tax_cents: amounts.taxCents,
        total_cents: amounts.totalCents,
        killbill_invoice_id: createdInvoiceId,
      };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(503, 'billing_unavailable', 'Billing is unreachable right now.');
    }
  } else if (rate) {
    const amounts = overageAmount(overageQh, Number(rate.hourly_rate_cents), String(rate.tax_rate_percent));
    overage = {
      quarter_hours: overageQh,
      hourly_rate_cents: Number(rate.hourly_rate_cents),
      tax_rate_percent: String(rate.tax_rate_percent),
      subtotal_cents: amounts.subtotalCents,
      tax_cents: amounts.taxCents,
      total_cents: amounts.totalCents,
      killbill_invoice_id: null,
    };
  }

  const updated = await clientQuery<Row>(
    client,
    `UPDATE bookings SET status = 'checked_out', checked_out_at = $2, checked_out_by_name = $3,
       late_qh = $4, pack_applied_qh = $5, overage = $6
     WHERE id = $1 AND status = 'checked_in' RETURNING *`,
    [bookingId, at, actor.name, lateQh, packAppliedQh, overage === null ? null : JSON.stringify(overage)],
  );
  if (updated.length === 0) throw new ApiError(409, 'invalid_transition', 'That booking changed elsewhere.');

  await writeMovement(client, {
    memberId: booking.member_id,
    tenantId: booking.tenant_id,
    kind: 'usage',
    fromAccount: 'committed',
    toAccount: 'used',
    quarterHours: Number(booking.quarter_hours),
    bookingId,
    actor: { userId: actor.userId, name: actor.name, role: 'kitchen_manager' },
    atMs: at,
    lots: [],
  });
  if (packAppliedQh > 0) {
    const draws = await drawFromLots(client, booking.member_id, packAppliedQh);
    await writeMovement(client, {
      memberId: booking.member_id,
      tenantId: booking.tenant_id,
      kind: 'late_checkout',
      fromAccount: 'available',
      toAccount: 'used',
      quarterHours: packAppliedQh,
      bookingId,
      actor: { userId: actor.userId, name: actor.name, role: 'kitchen_manager' },
      atMs: at,
      lots: draws,
    });
  }
  const station = await loadStation(client, booking.station_id);
  const member = await memberById(client, booking.member_id);
  const wire = bookingWire(updated[0] as unknown as BookingRow, String(station?.name ?? ''), String(member?.business_name ?? ''));
  return { body: { booking: wire } as unknown as Json };
}
