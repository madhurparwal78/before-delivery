import type { Ctx } from './apiRoutes.js';
import { jsonOk } from './http.js';
import { requireRole } from './handlersCore.js';
import { SEAT_PRICE } from './shared.js';

/**
 * Billing figures come only from the Kill Bill account whose external key is
 * the office key. When Kill Bill cannot be reached, the answer is still 200
 * with `reachable:false`, null figures and the waiting list still shown.
 */
export async function getBilling(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'office_manager', 'managing_partner');
  const accountId = await ctx.store.killbill.ensureAccount();
  const waiting = await ctx.store.pool.query(
    `SELECT sc.person_id, p.full_name, sc.change, sc.since
     FROM seat_changes sc JOIN people p ON p.id = sc.person_id
     WHERE sc.state = 'waiting' ORDER BY sc.since`
  );
  const waitingList = waiting.rows.map((row) => ({
    person_id: String(row.person_id),
    name: String(row.full_name),
    change: String(row.change) === 'add' ? 'add' : 'release',
    since: new Date(row.since as string).toISOString()
  }));
  if (!accountId) {
    jsonOk(ctx.res, 200, {
      reachable: false,
      seats: null,
      seat_price: SEAT_PRICE,
      currency: 'USD',
      next_invoice: null,
      licence_term_ends_on: null,
      waiting: waitingList
    });
    return;
  }
  const subscriptions = await ctx.store.killbill.officeSubscriptions(accountId);
  if (subscriptions === null) {
    jsonOk(ctx.res, 200, {
      reachable: false,
      seats: null,
      seat_price: SEAT_PRICE,
      currency: 'USD',
      next_invoice: null,
      licence_term_ends_on: null,
      waiting: waitingList
    });
    return;
  }
  const figures = ctx.store.killbill.figures(subscriptions);
  jsonOk(ctx.res, 200, {
    reachable: true,
    seats: figures.seats,
    seat_price: SEAT_PRICE,
    currency: 'USD',
    next_invoice: figures.nextInvoiceDate
      ? { date: figures.nextInvoiceDate, amount: figures.nextInvoiceAmount }
      : null,
    licence_term_ends_on: figures.licenceTermEndsOn,
    waiting: waitingList
  });
}
