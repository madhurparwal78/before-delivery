import { iso, nowMs } from '../clock';
import { query, tx } from '../db';
import { ApiError, isUuid } from '../http/errors';
import { closedBody } from '../http/request';
import type { HandlerResult, RequestContext } from '../http/context';
import { requireIdempotencyKey, withIdempotency } from '../domain/idempotency';
import {
  bookingJson,
  loadBooking,
  lockBooking,
  transitionVerdict,
  type BookingRecord,
} from '../domain/bookings';
import {
  availableQuarters,
  drawFromLots,
  recordMovement,
  withMemberLock,
  type LotAllocation,
} from '../domain/ledger';
import {
  formatMoney,
  lateQuarterHours,
  overageAmount,
  resolveRate,
  type RateRow,
} from '../domain/rules';
import { BillingUnavailable, createCommittedOverageInvoice, ensureAccount } from '../services/killbill';
import type { OverageJson } from '../../shared/types';

async function siteRates(siteId: string): Promise<RateRow[]> {
  return query<RateRow>(
    `select id, to_char(effective_from, 'YYYY-MM-DD') as effective_from, hourly_rate_cents,
            tax_rate_percent, created_at
       from rates where site_id = $1 order by effective_from asc`,
    [siteId],
  );
}

export async function checkOutBooking(ctx: RequestContext): Promise<HandlerResult> {
  const user = ctx.requireUser();
  const bookingId = ctx.params.id as string;
  ctx.audit.targetType = 'booking';
  ctx.audit.targetId = isUuid(bookingId) ? bookingId : null;
  const key = requireIdempotencyKey(ctx.headers['idempotency-key']);
  closedBody(ctx.json(), []);
  if (!isUuid(bookingId)) throw new ApiError('not_found');
  const existing = await tx(async (client) => loadBooking(client, bookingId));
  if (existing === null || existing.site_id !== user.site_id) throw new ApiError('not_found');
  return withIdempotency(
    {
      actorUserId: user.user_id,
      key,
      method: 'POST',
      path: '/api/bookings/{id}/check-out',
      binding: JSON.stringify({ booking_id: bookingId }),
    },
    async () => {
      const prepared = await tx(async (client) => {
        await lockBooking(client, bookingId);
        const booking = (await loadBooking(client, bookingId)) as BookingRecord;
        const at = nowMs();
        const verdict = transitionVerdict('check_out', booking.status, null, at);
        if (verdict !== 'ok') throw new ApiError('invalid_transition');
        return booking;
      });
      const rates = await siteRates(prepared.site_id);
      const rate = resolveRate(rates, prepared.date_text);
      const hourlyRateCents = rate === null ? 0 : rate.hourly_rate_cents;
      const taxRatePercent = rate === null ? '0' : rate.tax_rate_percent;

      /* Everything below is judged again under the locks, so one commit decides it. */
      const result = await tx(async (client) => {
        return withMemberLock(client, prepared.member_id, async () => {
          await lockBooking(client, bookingId);
          const booking = (await loadBooking(client, bookingId)) as BookingRecord;
          const commitMs = nowMs();
          const verdict = transitionVerdict('check_out', booking.status, null, commitMs);
          if (verdict !== 'ok') throw new ApiError('invalid_transition');
          const lateQuarters = lateQuarterHours(booking.end_at.getTime(), commitMs);
          let packQuarters = 0;
          let allocations: LotAllocation[] = [];
          if (lateQuarters > 0) {
            const available = await availableQuarters(
              client,
              booking.member_id,
              booking.home_zone,
              commitMs,
            );
            packQuarters = Math.min(available, lateQuarters);
            if (packQuarters > 0) {
              allocations =
                (await drawFromLots(
                  client,
                  booking.member_id,
                  booking.home_zone,
                  commitMs,
                  packQuarters,
                )) ?? [];
            }
          }
          const overageQuarters = lateQuarters - packQuarters;
          let overage: OverageJson | null = null;
          if (overageQuarters > 0) {
            const amount = overageAmount(overageQuarters, hourlyRateCents, taxRatePercent);
            let invoiceId: string | null = null;
            if (amount.totalCents > 0) {
              const accountId = await ensureAccount({
                memberId: booking.member_id,
                businessName: booking.business_name,
                email: booking.member_email,
              });
              await client.query('update members set killbill_account_id = $2 where id = $1', [
                booking.member_id,
                accountId,
              ]);
              invoiceId = await createCommittedOverageInvoice({
                accountId,
                totalCents: amount.totalCents,
                description:
                  `Overage ${booking.reference}: ${overageQuarters} quarter hours at ` +
                  `$${formatMoney(hourlyRateCents)}/h plus ${taxRatePercent}% tax`,
              });
            }
            overage = {
              quarter_hours: overageQuarters,
              hourly_rate_cents: hourlyRateCents,
              tax_rate_percent: taxRatePercent,
              subtotal_cents: amount.subtotalCents,
              tax_cents: amount.taxCents,
              total_cents: amount.totalCents,
              killbill_invoice_id: invoiceId,
            };
          }
          const actor = {
            userId: user.user_id,
            name: user.name,
            role: 'kitchen_manager' as const,
          };
          await recordMovement(client, {
            tenantId: booking.tenant_id,
            memberId: booking.member_id,
            kind: 'usage',
            quarters: booking.quarters,
            createdAtMs: commitMs,
            actor,
            bookingId,
          });
          if (packQuarters > 0) {
            await recordMovement(client, {
              tenantId: booking.tenant_id,
              memberId: booking.member_id,
              kind: 'late_checkout',
              quarters: packQuarters,
              createdAtMs: commitMs,
              actor,
              bookingId,
              lots: allocations,
            });
          }
          await client.query(
            `update bookings set status = 'checked_out', checked_out_at = $2,
               checked_out_by_user_id = $3, checked_out_by_name = $4,
               late_quarter_hours = $5, pack_quarters_applied = $6, overage = $7
              where id = $1`,
            [
              bookingId,
              iso(commitMs),
              user.user_id,
              user.name,
              lateQuarters,
              packQuarters,
              overage === null ? null : JSON.stringify(overage),
            ],
          );
          return (await loadBooking(client, bookingId)) as BookingRecord;
        });
      });
      return { status: 200, body: { booking: bookingJson(result, nowMs()) } };
    },
  ).catch((error: unknown) => {
    if (error instanceof BillingUnavailable) throw new ApiError('billing_unavailable');
    throw error;
  });
}
