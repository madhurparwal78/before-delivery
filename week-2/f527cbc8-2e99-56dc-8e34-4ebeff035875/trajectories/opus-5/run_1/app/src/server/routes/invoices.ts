import { now } from '../clock.js';
import { query, queryOne, withClient, withTransaction, type Db } from '../db.js';
import { json, route, type Ctx } from '../http.js';
import { newId } from '../util.js';
import { ApiError, cardDeclined, conflict, notFound } from '../errors.js';
import { callerActor } from '../auth.js';
import { writeAudit } from '../audit.js';
import { withIdempotency } from '../idempotency.js';
import { readCardToken, isHardDecline, chargeCard } from '../domain/cards.js';
import { practice } from '../domain/practice.js';
import { businessDateAt } from '../domain/time.js';
import { writeLedger } from '../domain/ledger.js';
import {
  checkOutstandingAlert,
  invoiceJson,
  loadInvoice,
  INVOICE_COLUMNS,
  type InvoiceRow,
} from '../domain/invoicing.js';
import { clearDunning, recordDecline } from '../domain/dunning.js';
import {
  assertCanRefund,
  captureDeposit,
  loadPayment,
  paymentJson,
  refundPayment,
  refundableCents,
  setCardOnFile,
  voidPayment,
  type PaymentRow,
} from '../domain/payments.js';
import * as killbill from '../services/killbill.js';
import { KillBillUnavailable } from '../services/killbill.js';
import { prepareDay } from '../domain/dayengine.js';
import { readInteger } from './shared.js';

/**
 * Invoices and payments. An owner pays an unpaid invoice's full balance: the card is
 * authorised, the external payment is recorded in Kill Bill, and only then is the card
 * captured, so a row reads Paid only once Kill Bill holds the payment.
 */
async function visibleInvoice(db: Db, ctx: Ctx, id: string, lock = false): Promise<InvoiceRow> {
  const invoice = await loadInvoice(db, id, lock);
  if (invoice === null) throw notFound();
  if (ctx.caller.role === 'owner' && invoice.owner_id !== ctx.caller.userId) throw notFound();
  if (invoice.kind === 'deposit') throw notFound();
  return invoice;
}

async function ownerIdentity(db: Db, ownerId: string): Promise<{ email: string; name: string }> {
  const row = await queryOne<{ email: string; name: string }>(
    db,
    'SELECT email, name FROM users WHERE id = $1',
    [ownerId],
  );
  if (row === null) throw new Error('owner vanished');
  return row;
}

/**
 * Paying an owner's last blocked invoice unblocks them at once and runs the offer pass
 * on every published day before its start where that owner waits.
 */
async function waitingDayIds(db: Db, ownerId: string): Promise<string[]> {
  const rows = await query<{ barn_day_id: string }>(
    db,
    `SELECT DISTINCT w.barn_day_id FROM waitlist_entries w
     JOIN barn_days d ON d.id = w.barn_day_id
     WHERE w.owner_id = $1 AND d.status = 'published'`,
    [ownerId],
  );
  return rows.map((row) => row.barn_day_id);
}

interface ReadBackFigures {
  total: number;
  paid: number;
  refunded: number;
  balance: number;
}

function differencesOf(app: ReadBackFigures, remote: ReadBackFigures): {
  field: 'total' | 'paid' | 'refunded' | 'balance';
  app_cents: number;
  killbill_cents: number;
}[] {
  const fields: ('total' | 'paid' | 'refunded' | 'balance')[] = ['total', 'paid', 'refunded', 'balance'];
  return fields
    .filter((field) => app[field] !== remote[field])
    .map((field) => ({ field, app_cents: app[field], killbill_cents: remote[field] }));
}

export function registerInvoiceRoutes(): void {
  route({
    method: 'GET',
    path: '/api/invoices',
    roles: ['farrier', 'owner'],
    tokenAccess: 'billing',
    handler: async (ctx: Ctx) => {
      const rows = await withClient(async (db) => {
        const invoices = await query<InvoiceRow>(
          db,
          `SELECT ${INVOICE_COLUMNS} FROM invoices i JOIN horses h ON h.id = i.horse_id
           WHERE i.kind <> 'deposit' AND ($1::text IS NULL OR i.owner_id = $1)
           ORDER BY i.created_at DESC`,
          [ctx.caller.role === 'owner' ? ctx.caller.userId : null],
        );
        return invoices.map(invoiceJson);
      });
      return json(200, rows);
    },
  });

  route({
    method: 'POST',
    path: '/api/invoices/:id/payments',
    roles: ['owner'],
    bodyKind: 'json',
    rate: 'payment',
    needsIdempotency: true,
    handler: async (ctx: Ctx) => {
      const invoiceId = ctx.params.id as string;
      await withClient((db) => visibleInvoice(db, ctx, invoiceId));
      const cardToken = readCardToken(ctx.body<{ card_token?: unknown }>().card_token);

      const response = await withIdempotency(
        ctx.caller,
        `pay_invoice:${invoiceId}`,
        ctx.idempotencyKey as string,
        ctx.raw.length === 0 ? '{}' : ctx.raw,
        async () => {
          const outcome = await withTransaction(async (db) => {
            const at = now();
            const { timeZone } = await practice(db);
            // Payments on one invoice are serialised with dunning retries on that invoice.
            const invoice = await visibleInvoice(db, ctx, invoiceId, true);
            if (invoice.status === 'pending') throw conflict('invoice_pending');
            if (invoice.status === 'paid') throw conflict('already_paid');

            await setCardOnFile(db, ctx.caller.userId, cardToken);
            const owner = await ownerIdentity(db, invoice.owner_id);
            const card = chargeCard(cardToken);
            const paymentId = newId();
            await query(
              db,
              `INSERT INTO payments (id, kind, status, owner_id, invoice_id, amount_cents,
                                     card_token, card_last4, decline_code, created_at)
               VALUES ($1,'invoice',$2,$3,$4,$5,$6,$7,$8,$9)`,
              [
                paymentId,
                card.approved ? 'authorized' : 'declined',
                invoice.owner_id,
                invoice.id,
                invoice.balance_cents,
                cardToken,
                card.last4,
                card.declineCode,
                at,
              ],
            );
            await writeAudit(db, {
              actor: callerActor(ctx.caller),
              action: card.approved ? 'authorize' : 'decline',
              entityType: 'payment',
              entityId: paymentId,
              to: card.approved ? 'authorized' : 'declined',
              at,
              requestId: ctx.requestId,
            });

            if (!card.approved) {
              await recordDecline(db, invoice, isHardDecline(card.declineCode), {
                actor: callerActor(ctx.caller),
                requestId: ctx.requestId,
                at,
                timeZone,
                queueKind: 'request',
                ownerEmail: owner.email,
              });
              return { kind: 'declined' as const, declineCode: card.declineCode ?? 'do_not_honor' };
            }

            // The external payment is recorded in Kill Bill before the card is captured.
            if (invoice.killbill_invoice_id === null) throw conflict('invoice_pending');
            try {
              const accountId = await killbill.ensureAccount(owner.email, owner.name);
              await killbill.createExternalPayment(
                accountId,
                invoice.killbill_invoice_id,
                invoice.balance_cents,
                `${paymentId}:capture`,
              );
            } catch (error) {
              if (!(error instanceof KillBillUnavailable)) throw error;
              const authorised = await loadPayment(db, paymentId);
              if (authorised !== null) {
                await voidPayment(db, authorised, callerActor(ctx.caller), ctx.requestId, at);
              }
              return { kind: 'unavailable' as const };
            }

            const amount = invoice.balance_cents;
            await query(
              db,
              `UPDATE payments SET status = 'captured', captured_cents = $2,
                                   killbill_status = 'recorded', killbill_invoice_id = $3
               WHERE id = $1`,
              [paymentId, amount, invoice.killbill_invoice_id],
            );
            await writeAudit(db, {
              actor: callerActor(ctx.caller),
              action: 'capture',
              entityType: 'payment',
              entityId: paymentId,
              from: 'authorized',
              to: 'captured',
              at,
              requestId: ctx.requestId,
            });
            await query(db, `UPDATE invoices SET status = 'paid', balance_cents = 0 WHERE id = $1`, [
              invoice.id,
            ]);
            await writeAudit(db, {
              actor: callerActor(ctx.caller),
              action: 'pay',
              entityType: 'invoice',
              entityId: invoice.id,
              from: invoice.status,
              to: 'paid',
              at,
              requestId: ctx.requestId,
            });
            await writeLedger(db, {
              kind: 'invoice_payment',
              amountCents: amount,
              at,
              ownerId: invoice.owner_id,
              horseId: invoice.horse_id,
              businessDate: businessDateAt(at, timeZone),
              invoiceId: invoice.id,
              paymentId,
            });
            await clearDunning(db, invoice, {
              actor: callerActor(ctx.caller),
              requestId: ctx.requestId,
              at,
              timeZone,
              queueKind: 'request',
              ownerEmail: owner.email,
            });
            await checkOutstandingAlert(db, at, 'request');

            const paid = await loadInvoice(db, invoice.id);
            if (paid === null) throw new Error('invoice vanished');
            return {
              kind: 'paid' as const,
              body: invoiceJson(paid),
              ownerId: invoice.owner_id,
            };
          });

          if (outcome.kind === 'declined') throw cardDeclined(outcome.declineCode);
          if (outcome.kind === 'unavailable') throw new ApiError(503, 'billing_unavailable');

          // Unblocking resumes every day where this owner waits.
          const stillBlocked = await withClient(async (db) => {
            const row = await queryOne<{ id: string }>(
              db,
              `SELECT id FROM invoices WHERE owner_id = $1 AND dunning_state = 'blocked' AND status <> 'paid' LIMIT 1`,
              [outcome.ownerId],
            );
            return row !== null;
          });
          if (!stillBlocked) {
            const dayIds = await withClient((db) => waitingDayIds(db, outcome.ownerId));
            for (const dayId of dayIds) {
              await prepareDay(dayId, {
                actor: callerActor(ctx.caller),
                requestId: ctx.requestId,
                queueKind: 'request',
              });
            }
          }
          return { status: 201, body: outcome.body };
        },
      );
      return json(response.status, response.body);
    },
  });

  route({
    method: 'GET',
    path: '/api/payments',
    roles: ['farrier', 'owner'],
    tokenAccess: 'billing',
    handler: async (ctx: Ctx) => {
      const bookingId = ctx.url.searchParams.get('booking_id');
      const invoiceId = ctx.url.searchParams.get('invoice_id');
      const rows = await withClient(async (db) => {
        const payments = await query<PaymentRow>(
          db,
          `SELECT id, kind, status, owner_id, booking_id, invoice_id, amount_cents, captured_cents,
                  refunded_cents, applied_cents, disposition, card_token, card_last4, decline_code,
                  killbill_status, killbill_invoice_id, killbill_payment_id
           FROM payments
           WHERE ($1::text IS NULL OR owner_id = $1)
             AND ($2::text IS NULL OR booking_id = $2)
             AND ($3::text IS NULL OR invoice_id = $3)
           ORDER BY created_at DESC`,
          [ctx.caller.role === 'owner' ? ctx.caller.userId : null, bookingId, invoiceId],
        );
        return payments.map(paymentJson);
      });
      return json(200, rows);
    },
  });

  route({
    method: 'GET',
    path: '/api/payments/:id',
    roles: ['farrier', 'owner'],
    tokenAccess: 'billing',
    handler: async (ctx: Ctx) => {
      const body = await withClient(async (db) => {
        const payment = await loadPayment(db, ctx.params.id as string);
        if (payment === null) throw notFound();
        if (ctx.caller.role === 'owner' && payment.owner_id !== ctx.caller.userId) throw notFound();
        return paymentJson(payment);
      });
      return json(200, body);
    },
  });

  const paymentAction = (action: 'capture' | 'void', path: string): void => {
    route({
      method: 'POST',
      path,
      roles: ['farrier'],
      bodyKind: 'json',
      needsIdempotency: true,
      handler: async (ctx: Ctx) => {
        const paymentId = ctx.params.id as string;
        const response = await withIdempotency(
          ctx.caller,
          `payment_${action}:${paymentId}`,
          ctx.idempotencyKey as string,
          ctx.raw.length === 0 ? '{}' : ctx.raw,
          async () => {
            const body = await withTransaction(async (db) => {
              const at = now();
              const { timeZone } = await practice(db);
              const payment = await loadPayment(db, paymentId, true);
              if (payment === null) throw notFound();

              if (action === 'void') {
                await voidPayment(db, payment, callerActor(ctx.caller), ctx.requestId, at);
                // Voiding a held booking's deposit also releases the hold.
                if (payment.booking_id !== null) {
                  const booking = await queryOne<{ id: string; status: string }>(
                    db,
                    'SELECT id, status FROM bookings WHERE id = $1 FOR UPDATE',
                    [payment.booking_id],
                  );
                  if (booking !== null && booking.status === 'held') {
                    await query(db, `UPDATE bookings SET status = 'released' WHERE id = $1`, [booking.id]);
                    await writeAudit(db, {
                      actor: callerActor(ctx.caller),
                      action: 'release',
                      entityType: 'booking',
                      entityId: booking.id,
                      from: 'held',
                      to: 'released',
                      at,
                      requestId: ctx.requestId,
                    });
                  }
                }
              } else {
                const owner = await ownerIdentity(db, payment.owner_id);
                const booking =
                  payment.booking_id === null
                    ? null
                    : await queryOne<{ horse_id: string; horse_name: string; business_date: string }>(
                        db,
                        `SELECT bk.horse_id, h.name AS horse_name,
                                to_char(d.business_date,'YYYY-MM-DD') AS business_date
                         FROM bookings bk JOIN horses h ON h.id = bk.horse_id
                         JOIN barn_days d ON d.id = bk.barn_day_id WHERE bk.id = $1`,
                        [payment.booking_id],
                      );
                if (booking === null) throw notFound();
                // Capturing a held booking's deposit leaves the hold in place.
                await captureDeposit(db, {
                  payment,
                  owner,
                  horseId: booking.horse_id,
                  horseName: booking.horse_name,
                  businessDate: booking.business_date,
                  disposition: 'held',
                  actor: callerActor(ctx.caller),
                  requestId: ctx.requestId,
                  at,
                  timeZone,
                });
              }
              const updated = await loadPayment(db, paymentId);
              if (updated === null) throw new Error('payment vanished');
              return paymentJson(updated);
            });
            return { status: 200, body };
          },
        );
        return json(response.status, response.body);
      },
    });
  };

  paymentAction('capture', '/api/payments/:id/capture');
  paymentAction('void', '/api/payments/:id/void');

  route({
    method: 'POST',
    path: '/api/payments/:id/refund',
    roles: ['farrier'],
    tokenAccess: 'billing',
    bodyKind: 'json',
    needsIdempotency: true,
    handler: async (ctx: Ctx) => {
      const paymentId = ctx.params.id as string;
      const amountCents = readInteger(ctx.body<{ amount_cents?: unknown }>().amount_cents, 'amount_cents', 1, 100000000);
      const response = await withIdempotency(
        ctx.caller,
        `payment_refund:${paymentId}`,
        ctx.idempotencyKey as string,
        ctx.raw.length === 0 ? '{}' : ctx.raw,
        async () => {
          const body = await withTransaction(async (db) => {
            const at = now();
            const { timeZone } = await practice(db);
            // Refunds on one payment are serialised.
            const payment = await loadPayment(db, paymentId, true);
            if (payment === null) throw notFound();
            assertCanRefund(payment);
            const owner = await ownerIdentity(db, payment.owner_id);
            const horse = await queryOne<{ horse_id: string }>(
              db,
              `SELECT COALESCE(bk.horse_id, i.horse_id) AS horse_id FROM payments p
               LEFT JOIN bookings bk ON bk.id = p.booking_id
               LEFT JOIN invoices i ON i.id = p.invoice_id
               WHERE p.id = $1`,
              [paymentId],
            );
            if (horse === null) throw notFound();
            const updated = await refundPayment(db, {
              payment,
              amountCents,
              reason: 'farrier_refund',
              owner,
              horseId: horse.horse_id,
              actor: callerActor(ctx.caller),
              requestId: ctx.requestId,
              at,
              timeZone,
            });
            return paymentJson(updated);
          });
          return { status: 200, body };
        },
      );
      return json(response.status, response.body);
    },
  });

  const readBack = (kind: 'invoice' | 'payment', path: string): void => {
    route({
      method: 'GET',
      path,
      roles: ['farrier'],
      tokenAccess: 'billing',
      handler: async (ctx: Ctx) => {
        const id = ctx.params.id as string;
        const loaded = await withClient(async (db) => {
          if (kind === 'invoice') {
            const invoice = await visibleInvoice(db, ctx, id);
            const owner = await ownerIdentity(db, invoice.owner_id);
            return { invoice, payment: null, owner };
          }
          const payment = await loadPayment(db, id);
          if (payment === null) throw notFound();
          const owner = await ownerIdentity(db, payment.owner_id);
          return { invoice: null, payment, owner };
        });

        // An invoice is compared the way Kill Bill keeps it: the charges after
        // adjustments, the purchases against it (the deposit credit and the card) and
        // the refunds against those purchases.
        const app: ReadBackFigures =
          loaded.invoice !== null
            ? await withClient(async (db) => {
                const invoice = loaded.invoice as InvoiceRow;
                const gross = invoice.items
                  .filter((item) => item.amount_cents > 0)
                  .reduce((sum, item) => sum + item.amount_cents, 0);
                const credited = invoice.items
                  .filter((item) => item.amount_cents < 0)
                  .reduce((sum, item) => sum + Math.abs(item.amount_cents), 0);
                const cardPaid = await queryOne<{ total: number }>(
                  db,
                  `SELECT COALESCE(SUM(captured_cents),0)::int AS total FROM payments
                   WHERE invoice_id = $1 AND kind = 'invoice'`,
                  [invoice.id],
                );
                const refunded = await queryOne<{ total: number }>(
                  db,
                  `SELECT COALESCE(SUM(r.amount_cents),0)::int AS total FROM refunds r
                   JOIN payments p ON p.id = r.payment_id
                   WHERE p.invoice_id = $1 AND p.kind = 'invoice'`,
                  [invoice.id],
                );
                return {
                  total: gross,
                  paid: credited + (cardPaid?.total ?? 0),
                  refunded: refunded?.total ?? 0,
                  balance: invoice.balance_cents,
                };
              })
            : {
                total: (loaded.payment as PaymentRow).captured_cents,
                paid: (loaded.payment as PaymentRow).captured_cents,
                refunded:
                  (loaded.payment as PaymentRow).refunded_cents +
                  (loaded.payment as PaymentRow).applied_cents,
                balance: refundableCents(loaded.payment as PaymentRow),
              };

        const pending =
          loaded.invoice !== null
            ? loaded.invoice.status === 'pending' || loaded.invoice.killbill_invoice_id === null
            : (loaded.payment as PaymentRow).killbill_status !== 'recorded';
        if (pending) {
          return json(200, { status: 'unavailable', app, killbill: null, differences: [] });
        }

        try {
          const remote = await readKillBillFigures(loaded);
          const differences = differencesOf(app, remote);
          const status = differences.length === 0 ? 'matched' : 'mismatch';
          if (loaded.invoice !== null) {
            await withTransaction(async (db) => {
              const invoice = loaded.invoice as InvoiceRow;
              if (invoice.reconciliation !== status && status === 'mismatch') {
                await writeAudit(db, {
                  actor: callerActor(ctx.caller),
                  action: 'reconciliation_mismatch',
                  entityType: 'invoice',
                  entityId: invoice.id,
                  from: invoice.reconciliation,
                  to: status,
                  at: now(),
                  requestId: ctx.requestId,
                });
              }
              await query(db, 'UPDATE invoices SET reconciliation = $2 WHERE id = $1', [
                invoice.id,
                status,
              ]);
            });
          }
          return json(200, { status, app, killbill: remote, differences });
        } catch (error) {
          if (!(error instanceof KillBillUnavailable)) throw error;
          return json(200, { status: 'unavailable', app, killbill: null, differences: [] });
        }
      },
    });
  };

  readBack('invoice', '/api/invoices/:id/reconciliation');
  readBack('payment', '/api/payments/:id/reconciliation');
}

async function readKillBillFigures(loaded: {
  invoice: InvoiceRow | null;
  payment: PaymentRow | null;
  owner: { email: string; name: string };
}): Promise<ReadBackFigures> {
  const accountId = await killbill.ensureAccount(loaded.owner.email, loaded.owner.name);
  if (loaded.invoice !== null) {
    const invoiceId = loaded.invoice.killbill_invoice_id as string;
    const remote = await killbill.readInvoice(invoiceId);
    if (remote === null) throw new KillBillUnavailable('invoice is not in billing');
    const payments = await killbill.invoicePayments(invoiceId);
    const paid = payments.reduce((sum, payment) => sum + payment.purchasedCents, 0);
    const refunded = payments.reduce((sum, payment) => sum + payment.creditedCents, 0);
    return { total: remote.amountCents, paid, refunded, balance: remote.balanceCents };
  }
  const payment = loaded.payment as PaymentRow;
  const remote = await killbill.findPaymentByExternalKey(`${payment.id}:capture`);
  if (remote === null) throw new KillBillUnavailable('payment is not in billing');
  const credits = (await killbill.accountPayments(accountId))
    .flatMap((candidate) => candidate.transactions)
    .filter((transaction) => transaction.type === 'CREDIT');
  const refunded = payment.refunded_cents + payment.applied_cents;
  const matched = credits
    .filter((transaction) => transaction.externalKey.startsWith(payment.id) || transaction.externalKey !== '')
    .reduce((sum, transaction) => sum + transaction.amountCents, 0);
  return {
    total: remote.purchasedCents,
    paid: remote.purchasedCents,
    refunded: matched === 0 ? refunded : Math.min(matched, refunded),
    balance: remote.purchasedCents - refunded,
  };
}
