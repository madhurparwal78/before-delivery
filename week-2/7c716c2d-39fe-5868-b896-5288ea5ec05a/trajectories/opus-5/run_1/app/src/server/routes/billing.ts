import { ApiError } from '../errors.js';
import { activeMemberCount, requireOwner } from '../access.js';
import { withIdempotency } from '../idempotency.js';
import { sessionRoute, type Route } from '../router.js';
import { accountExternalKey } from '../services/killbill.js';
import {
  changeSeats,
  confirmedSeats,
  MAX_SEATS,
  MIN_SEATS,
  monthlyTotal,
  pendingInviteCount,
  SEAT_PRICE,
} from '../seats.js';
import type { Billing } from '../../shared/types.js';

async function billingBody(workspaceId: string, options: { force?: boolean } = {}): Promise<Billing> {
  const seats = await confirmedSeats(workspaceId, options);
  return {
    limit: seats.limit,
    active: await activeMemberCount(workspaceId),
    pending: await pendingInviteCount(workspaceId),
    price_per_seat: SEAT_PRICE,
    currency: 'USD',
    monthly_total: monthlyTotal(seats.limit),
    billing_status: seats.billingStatus,
    account_external_key: accountExternalKey(workspaceId),
    scheduled_limit: seats.scheduledLimit,
    scheduled_on: seats.scheduledOn,
  };
}

export const billingRoutes: Route[] = [
  sessionRoute('GET', '/api/billing', 'none', async (ctx) => {
    const workspaceId = requireOwner(ctx.actor);
    return { status: 200, body: await billingBody(workspaceId, { force: true }) };
  }),

  sessionRoute('PUT', '/api/billing/seats', 'json', async (ctx) => {
    const workspaceId = requireOwner(ctx.actor);
    return withIdempotency(ctx.actor.id, 'put-seats', ctx.idempotencyKey, ctx.rawBody, async () => {
      const seats = ctx.body.seats;
      if (
        typeof seats !== 'number' ||
        !Number.isInteger(seats) ||
        seats < MIN_SEATS ||
        seats > MAX_SEATS
      ) {
        throw new ApiError('validation', {
          fields: { seats: `Choose between ${MIN_SEATS} and ${MAX_SEATS} seats.` },
          message: `Choose between ${MIN_SEATS} and ${MAX_SEATS} seats.`,
        });
      }
      const active = await activeMemberCount(workspaceId);
      await changeSeats(workspaceId, seats, active);
      return { status: 200, body: await billingBody(workspaceId) };
    });
  }),
];
