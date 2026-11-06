import { Router } from 'express';
import { formatHours } from '../../../shared/format.js';
import { pool } from '../../db/pool.js';
import { requireBilling } from '../../domain/confirming.js';
import {
  billingAmountCents,
  bookingIdsOfInvoice,
  createInvoice,
  invoiceView,
  loadInvoice,
  loadInvoiceLines,
  loadInvoices,
} from '../../domain/invoices.js';
import {
  cardInForce,
  loadRateCards,
  loadStations,
  stationMap,
} from '../../domain/kitchens.js';
import { PACK_QUARTERS, loadMovements, packBalanceQuarters, recordMovement } from '../../domain/pack.js';
import { kitchenToday } from '../../domain/time.js';
import { requireKitchen, requireMember, requireRole, requireUser } from '../access.js';
import { created, ok, param, route } from '../context.js';
import { failures } from '../errors.js';
import { withIdempotency } from '../idempotency.js';
import { withService } from '../../services/health.js';
import {
  ensureBillingAccount,
  postCharges,
  reverseInvoice,
  type PostedInvoice,
} from '../../services/killbill.js';

export const billingRoutes = Router();

billingRoutes.get(
  '/members/:member_id/pack',
  route(async (ctx) => {
    const user = requireUser(ctx.user);
    const member =
      user.role === 'bookkeeper'
        ? await bookkeeperMember(user.kitchen_id, param(ctx.req, 'member_id'))
        : await requireMember(pool, user, param(ctx.req, 'member_id'));
    const balance = await packBalanceQuarters(pool, member.id);
    return ok({
      balance_quarters: balance,
      balance_hours: formatHours(balance),
      movements: await loadMovements(pool, member.id),
    });
  }),
);

async function bookkeeperMember(kitchenId: string, memberId: string) {
  const row = await pool.query<{ id: string; kitchen_id: string; business: string; contact_email: string }>(
    'SELECT id, kitchen_id, business, contact_email FROM members WHERE id = $1',
    [memberId],
  );
  const member = row.rows[0];
  if (!member || member.kitchen_id !== kitchenId) throw failures.notFound();
  return member;
}

billingRoutes.post(
  '/members/:member_id/packs',
  route(async (ctx) => {
    const user = requireUser(ctx.user);
    const member = await requireMember(pool, user, param(ctx.req, 'member_id'));
    requireRole(user, 'operator', 'member');
    const kitchen = await requireKitchen(pool, user, member.kitchen_id);

    return withIdempotency(ctx, user.id, async () => {
      const today = kitchenToday(kitchen.timezone, ctx.now);
      const rateCard = cardInForce(await loadRateCards(pool, kitchen.id), today);
      if (!rateCard) throw failures.notFound();
      requireBilling();

      const accountId = await withService('billing', () =>
        ensureBillingAccount({
          memberId: member.id,
          business: member.business,
          contactEmail: member.contact_email,
        }),
      ).catch(() => {
        throw failures.billingUnavailable();
      });

      let posted: PostedInvoice | null = null;
      const client = await pool.connect();
      let invoiceId: string;
      let movementId: string;
      try {
        await client.query('BEGIN');
        movementId = await recordMovement(client, {
          memberId: member.id,
          kind: 'purchase',
          quarters: PACK_QUARTERS,
          bookingId: null,
          reverses: null,
          now: ctx.now,
        });
        const invoice = await createInvoice(client, {
          kitchenId: kitchen.id,
          memberId: member.id,
          kind: 'pack',
          lines: [{ description: '20-hour pack', amount_cents: rateCard.pack_price_cents }],
          totalCents: rateCard.pack_price_cents,
          killbillInvoiceId: null,
          now: ctx.now,
        });
        invoiceId = invoice.id;
        posted = await withService('billing', () =>
          postCharges(accountId, [
            {
              description: `${invoice.ref} · 20-hour pack`,
              amount_cents: rateCard.pack_price_cents,
            },
          ]),
        );
        await client.query('UPDATE invoices SET killbill_invoice_id = $2 WHERE id = $1', [
          invoice.id,
          posted.killbillInvoiceId,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        if (posted) await reverseInvoice(accountId, posted).catch(() => undefined);
        throw error instanceof Error && error.name === 'ApiFailure'
          ? error
          : failures.billingUnavailable();
      } finally {
        client.release();
      }

      const movements = await loadMovements(pool, member.id);
      const movement = movements.find((entry) => entry.id === movementId);
      const row = await loadInvoice(pool, invoiceId);
      if (!movement || !row) throw failures.notFound();
      const stations = stationMap(await loadStations(pool, kitchen.id));
      return created({
        movement,
        invoice: invoiceView(
          row,
          await loadInvoiceLines(pool, [invoiceId]),
          [],
          stations,
          await billingAmountCents(posted.killbillInvoiceId),
        ),
        balance_quarters: await packBalanceQuarters(pool, member.id),
      });
    });
  }),
);

billingRoutes.get(
  '/invoices',
  route(async (ctx) => {
    const user = requireUser(ctx.user);
    const stations = stationMap(await loadStations(pool, user.kitchen_id));
    const filter: { kitchenId: string; memberId?: string } = { kitchenId: user.kitchen_id };
    if (user.role === 'member' && user.member_id !== null) filter.memberId = user.member_id;
    const rows = await loadInvoices(pool, filter);
    const lines = await loadInvoiceLines(
      pool,
      rows.map((row) => row.id),
    );
    const invoices = [];
    for (const row of rows) {
      invoices.push(
        invoiceView(
          row,
          lines.filter((line) => line.invoice_id === row.id),
          await bookingIdsOfInvoice(pool, row.id),
          stations,
          await billingAmountCents(row.killbill_invoice_id),
        ),
      );
    }
    return ok({ invoices });
  }),
);

billingRoutes.get(
  '/invoices/:invoice_id',
  route(async (ctx) => {
    const user = requireUser(ctx.user);
    const row = await loadInvoice(pool, param(ctx.req, 'invoice_id'));
    if (!row || row.kitchen_id !== user.kitchen_id) throw failures.notFound();
    if (user.role === 'member' && row.member_id !== user.member_id) throw failures.notFound();
    const stations = stationMap(await loadStations(pool, user.kitchen_id));
    return ok({
      invoice: invoiceView(
        row,
        await loadInvoiceLines(pool, [row.id]),
        await bookingIdsOfInvoice(pool, row.id),
        stations,
        await billingAmountCents(row.killbill_invoice_id),
      ),
    });
  }),
);
