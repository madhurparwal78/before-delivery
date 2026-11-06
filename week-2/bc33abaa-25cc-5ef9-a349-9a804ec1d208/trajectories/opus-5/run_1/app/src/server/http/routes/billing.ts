import { Express, Request, Response } from 'express';
import { PeriodId, PlanId, isUpgrade, planOffer } from '../../../shared/plans';
import { query } from '../../db/pool';
import { assertActive, assertCheckoutAllowed, assertSubscriptionTransition } from '../../domain/subscription';
import {
  SCHEDULER_ACTOR,
  seatsForChoice,
  seatsUsed,
  subscriptionDto,
  writeAudit,
} from '../../domain/workspace';
import * as kb from '../../services/killbill';
import { MissingObjectError, getObject, storageKeys } from '../../services/storage';
import { hmacSha256Hex, safeEqual, sha256Hex } from '../../util/crypto';
import {
  assertCardAccepted,
  cardLast4,
  changePolicyFor,
  extraSeatsOnAccount,
  invoiceDto,
  killbillPeriod,
  killbillProduct,
  parseCard,
  payInvoiceAllOrNothing,
  paymentDto,
  pdfStoredIds,
  requireIdempotencyKey,
  rememberInvoice,
  seatAddons,
  seatPlanFor,
  sendRefundMail,
  updateSubscriptionRow,
  withIdempotency,
} from '../../billing/engine';
import { fail } from '../errors';
import {
  CallerContext,
  body,
  param,
  requireCaller,
  requireInteger,
  requirePermission,
} from '../context';
import { route } from '../route';
import { markPastDue, reactivateIfSettled } from '../../billing/dunning';

function parsePlan(body: Record<string, unknown>): { plan: PlanId; period: PeriodId } {
  const plan = body.plan;
  const period = body.period;
  if (plan !== 'team' && plan !== 'business') {
    throw fail.validation({ plan: 'Must be team or business' });
  }
  if (period !== 'monthly' && period !== 'annual') {
    throw fail.validation({ period: 'Must be monthly or annual' });
  }
  return { plan, period };
}

async function requireBillingCaller(req: Request): Promise<CallerContext> {
  const context = await requireCaller(req);
  requirePermission(context, 'billing.manage');
  return context;
}

async function idempotent(
  req: Request,
  res: Response,
  context: CallerContext,
  routeName: string,
  handler: () => Promise<{ status: number; body: unknown }>,
): Promise<void> {
  const key = requireIdempotencyKey(
    typeof req.headers['idempotency-key'] === 'string'
      ? (req.headers['idempotency-key'] as string)
      : undefined,
  );
  const outcome = await withIdempotency(
    context.workspace.id,
    key,
    routeName,
    req.rawBody,
    handler,
  );
  if (outcome.replayed) res.setHeader('Idempotent-Replayed', 'true');
  res.status(outcome.status).json(outcome.body);
}

async function accountOf(context: CallerContext): Promise<string> {
  const accountId = context.subscription.kb_account_id;
  if (accountId) return accountId;
  const found = await kb.findAccountId(context.workspace.id);
  if (!found) throw fail.conflict('subscription_not_active');
  return found;
}

/** Groups several Kill Bill changes into one generated invoice. */
async function withSingleInvoice<T>(
  accountId: string,
  expectInvoice: boolean,
  work: () => Promise<T>,
): Promise<{ result: T; invoice: kb.KbInvoice | null }> {
  const before = new Set((await kb.listInvoices(accountId)).map((invoice) => invoice.invoiceId));
  await kb.setAutoInvoicingOff(accountId, true);
  let result: T;
  try {
    result = await work();
  } finally {
    await kb.setAutoInvoicingOff(accountId, false);
  }
  const attempts = expectInvoice ? 12 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const generated = await kb.triggerInvoice(accountId);
    if (generated && !before.has(generated.invoiceId)) return { result, invoice: generated };
    const fresh = (await kb.listInvoices(accountId)).find(
      (invoice) => !before.has(invoice.invoiceId),
    );
    if (fresh) return { result, invoice: fresh };
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { result, invoice: null };
}

export function registerBillingRoutes(app: Express): void {
  app.get(
    '/api/billing',
    route(async (req, res) => {
      const context = await requireBillingCaller(req);
      res.json({
        subscription: subscriptionDto(context.subscription),
        card: context.subscription.card_last4 ? { last4: context.subscription.card_last4 } : null,
      });
    }),
  );

  app.get(
    '/api/billing/gateway',
    route(async (req, res) => {
      const context = await requireCaller(req);
      requirePermission(context, 'workspace.admin');
      res.json({ signingSecret: context.workspace.signing_secret });
    }),
  );

  app.post(
    '/api/billing/checkout',
    route(async (req, res) => {
      const input = body(req);
      const context = await requireBillingCaller(req);
      await idempotent(req, res, context, 'checkout', async () => {
        assertCheckoutAllowed(context.subscription);
        const { plan, period } = parsePlan(input);
        const extraSeats = requireInteger(input, 'extraSeats', { min: 0, max: 500 });
        const card = parseCard(input.card);
        const seatsAfter = seatsForChoice(plan, period, extraSeats);
        const used = await seatsUsed(context.workspace.id);
        if (used > seatsAfter) {
          throw fail.conflict('seats_in_use', { seatsUsed: used, seatsAfter });
        }
        assertCardAccepted(card);
        assertSubscriptionTransition(context.subscription.state, 'active');

        const offer = planOffer(plan, period);
        const accountId = await kb.createAccount(context.workspace.id, context.workspace.name);
        // A checkout that failed after its subscription was created leaves one behind.
        for (const leftover of await kb.accountBundleSubscriptions(accountId)) {
          if (leftover.state !== 'CANCELLED' && leftover.cancelledDate === null) {
            await kb.cancelSubscription(leftover.subscriptionId, 'IMMEDIATE');
          }
        }
        const { result, invoice } = await withSingleInvoice(accountId, true, async () => {
          const base = await kb.createSubscription(accountId, offer.killbillPlan);
          if (extraSeats > 0) {
            await kb.createSeatAddon(accountId, base.bundleId, offer.killbillSeatPlan, extraSeats);
          }
          return base;
        });
        if (!invoice) throw fail.serviceDown('billing');

        const recorded = await payInvoiceAllOrNothing({
          workspace: context.workspace,
          accountId,
          invoiceId: invoice.invoiceId,
          transactionExternalKey: `${context.workspace.id}:${requireIdempotencyKey(
            req.headers['idempotency-key'] as string,
          )}`,
          actor: context.author,
        });
        const subscription = await updateSubscriptionRow(context.workspace.id, {
          state: 'active',
          plan,
          period,
          extra_seats: extraSeats,
          trial_ends_at: null,
          suspended_reason: null,
          grace_ends_at: null,
          failed_at: null,
          card_last4: cardLast4(card),
          kb_account_id: accountId,
          kb_bundle_id: result.bundleId,
          kb_base_subscription_id: result.subscriptionId,
        });
        await writeAudit({
          workspaceId: context.workspace.id,
          actor: context.author,
          action: 'subscription.started',
          target: { type: 'subscription', id: context.workspace.id },
        });
        return {
          status: 201,
          body: {
            subscription: subscriptionDto(subscription),
            invoice: invoiceDto(recorded.invoice, true),
            payment: paymentDto(
              recorded.payment,
              recorded.invoice.invoiceId,
              new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
            ),
          },
        };
      });
    }),
  );

  app.get(
    '/api/billing/plan/preview',
    route(async (req, res) => {
      const context = await requireBillingCaller(req);
      const { plan, period } = parsePlan({
        plan: req.query.plan,
        period: req.query.period,
      } as Record<string, unknown>);
      assertActive(context.subscription);
      const from = { plan: context.subscription.plan, period: context.subscription.period };
      const immediate = isUpgrade(from, { plan, period });
      const accountId = await accountOf(context);
      const subscriptionId = context.subscription.kb_base_subscription_id;
      const bundleId = context.subscription.kb_bundle_id;
      if (!subscriptionId || !bundleId) throw fail.conflict('subscription_not_active');
      if (!immediate) {
        const base = await kb.getSubscription(subscriptionId);
        res.json({
          change: 'end_of_term',
          amountCents: 0,
          effectiveAt: base.chargedThroughDate
            ? new Date(`${base.chargedThroughDate}T00:00:00Z`).toISOString().replace(/\.\d{3}Z$/, 'Z')
            : null,
        });
        return;
      }
      const dryRun = await kb.dryRunPlanChange({
        accountId,
        bundleId,
        subscriptionId,
        product: killbillProduct(plan),
        billingPeriod: killbillPeriod(period),
        policy: 'IMMEDIATE',
      });
      let amountCents = dryRun ? kb.toCents(dryRun.amount) : 0;
      const addons = await seatAddons(bundleId);
      for (const addon of addons) {
        const addonDry = await kb.dryRunAddonChange({
          accountId,
          bundleId,
          subscriptionId: addon.subscriptionId,
          seatPlan: seatPlanFor(plan, period),
        });
        if (addonDry) amountCents += kb.toCents(addonDry.amount);
      }
      res.json({
        change: 'immediate',
        amountCents,
        effectiveAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      });
    }),
  );

  app.post(
    '/api/billing/plan',
    route(async (req, res) => {
      const input = body(req);
      const context = await requireBillingCaller(req);
      await idempotent(req, res, context, 'plan', async () => {
        assertActive(context.subscription);
        const { plan, period } = parsePlan(input);
        const from = { plan: context.subscription.plan, period: context.subscription.period };
        if (from.plan === plan && from.period === period) {
          throw fail.validation({ plan: 'Already on this plan' });
        }
        const seatsAfter = seatsForChoice(plan, period, context.subscription.extra_seats);
        const used = await seatsUsed(context.workspace.id);
        if (used > seatsAfter) throw fail.conflict('seats_in_use', { seatsUsed: used, seatsAfter });
        const accountId = await accountOf(context);
        const subscriptionId = context.subscription.kb_base_subscription_id;
        const bundleId = context.subscription.kb_bundle_id;
        if (!subscriptionId || !bundleId) throw fail.conflict('subscription_not_active');
        const policy = changePolicyFor(from, { plan, period });
        const seatPlan = seatPlanFor(plan, period);

        const { invoice } = await withSingleInvoice(accountId, policy === 'IMMEDIATE', async () => {
          for (const addon of await seatAddons(bundleId)) {
            await kb.changeAddonPlan(addon.subscriptionId, seatPlan, policy);
          }
          await kb.changePlan(
            subscriptionId,
            killbillProduct(plan),
            killbillPeriod(period),
            planOffer(plan, period).killbillPlan,
            policy,
          );
        });

        if (policy === 'IMMEDIATE') {
          if (!invoice || invoice.balance <= 0) {
            const subscription = await updateSubscriptionRow(context.workspace.id, { plan, period });
            await writeAudit({
              workspaceId: context.workspace.id,
              actor: context.author,
              action: 'subscription.plan_changed',
              target: { type: 'subscription', id: context.workspace.id },
            });
            return {
              status: 200,
              body: {
                change: 'immediate',
                subscription: subscriptionDto(subscription),
                invoice: null,
                payment: null,
              },
            };
          }
          const recorded = await payInvoiceAllOrNothing({
            workspace: context.workspace,
            accountId,
            invoiceId: invoice.invoiceId,
            transactionExternalKey: `${context.workspace.id}:${req.headers['idempotency-key'] as string}`,
            actor: context.author,
          });
          const subscription = await updateSubscriptionRow(context.workspace.id, {
            plan,
            period,
            pending_change: null,
          });
          await writeAudit({
            workspaceId: context.workspace.id,
            actor: context.author,
            action: 'subscription.plan_changed',
            target: { type: 'subscription', id: context.workspace.id },
          });
          return {
            status: 200,
            body: {
              change: 'immediate',
              subscription: subscriptionDto(subscription),
              invoice: invoiceDto(recorded.invoice, true),
              payment: paymentDto(
                recorded.payment,
                recorded.invoice.invoiceId,
                new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
              ),
            },
          };
        }

        const base = await kb.getSubscription(subscriptionId);
        const effectiveAt = base.chargedThroughDate
          ? new Date(`${base.chargedThroughDate}T00:00:00Z`).toISOString().replace(/\.\d{3}Z$/, 'Z')
          : new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
        const subscription = await updateSubscriptionRow(context.workspace.id, {
          pending_change: {
            plan,
            period,
            extraSeats: context.subscription.extra_seats,
            effectiveAt,
          },
        });
        await writeAudit({
          workspaceId: context.workspace.id,
          actor: context.author,
          action: 'subscription.plan_changed',
          target: { type: 'subscription', id: context.workspace.id },
        });
        return {
          status: 200,
          body: {
            change: 'end_of_term',
            subscription: subscriptionDto(subscription),
            effectiveAt,
          },
        };
      });
    }),
  );

  app.post(
    '/api/billing/seats',
    route(async (req, res) => {
      const input = body(req);
      const context = await requireBillingCaller(req);
      await idempotent(req, res, context, 'seats', async () => {
        assertActive(context.subscription);
        const extraSeats = requireInteger(input, 'extraSeats', { min: 0, max: 500 });
        if (extraSeats === context.subscription.extra_seats) {
          throw fail.validation({ extraSeats: 'No change' });
        }
        const seatsAfter = seatsForChoice(
          context.subscription.plan,
          context.subscription.period,
          extraSeats,
        );
        const used = await seatsUsed(context.workspace.id);
        if (used > seatsAfter) throw fail.conflict('seats_in_use', { seatsUsed: used, seatsAfter });
        const accountId = await accountOf(context);
        const bundleId = context.subscription.kb_bundle_id;
        const subscriptionId = context.subscription.kb_base_subscription_id;
        if (!bundleId || !subscriptionId) throw fail.conflict('subscription_not_active');
        const seatPlan = seatPlanFor(context.subscription.plan, context.subscription.period);

        if (extraSeats > context.subscription.extra_seats) {
          const delta = extraSeats - context.subscription.extra_seats;
          const { invoice } = await withSingleInvoice(accountId, true, async () => {
            await kb.createSeatAddon(accountId, bundleId, seatPlan, delta);
          });
          if (!invoice) throw fail.serviceDown('billing');
          const recorded = await payInvoiceAllOrNothing({
            workspace: context.workspace,
            accountId,
            invoiceId: invoice.invoiceId,
            transactionExternalKey: `${context.workspace.id}:${req.headers['idempotency-key'] as string}`,
            actor: context.author,
          });
          const addons = await seatAddons(bundleId);
          const subscription = await updateSubscriptionRow(context.workspace.id, {
            extra_seats: extraSeatsOnAccount(addons),
          });
          await writeAudit({
            workspaceId: context.workspace.id,
            actor: context.author,
            action: 'subscription.seats_changed',
            target: { type: 'subscription', id: context.workspace.id },
          });
          return {
            status: 200,
            body: {
              change: 'immediate',
              subscription: subscriptionDto(subscription),
              invoice: invoiceDto(recorded.invoice, true),
              payment: paymentDto(
                recorded.payment,
                recorded.invoice.invoiceId,
                new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
              ),
            },
          };
        }

        const base = await kb.getSubscription(subscriptionId);
        const effectiveAt = base.chargedThroughDate
          ? new Date(`${base.chargedThroughDate}T00:00:00Z`).toISOString().replace(/\.\d{3}Z$/, 'Z')
          : new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
        let remaining = context.subscription.extra_seats - extraSeats;
        for (const addon of await seatAddons(bundleId)) {
          if (remaining <= 0) break;
          const next = Math.max(0, addon.quantity - remaining);
          remaining -= addon.quantity - next;
          if (next === 0) await kb.cancelSubscription(addon.subscriptionId, 'END_OF_TERM');
          else await kb.setAddonQuantity(addon.subscriptionId, next, base.chargedThroughDate);
        }
        const subscription = await updateSubscriptionRow(context.workspace.id, {
          pending_change: {
            plan: context.subscription.plan,
            period: context.subscription.period,
            extraSeats,
            effectiveAt,
          },
        });
        await writeAudit({
          workspaceId: context.workspace.id,
          actor: context.author,
          action: 'subscription.seats_changed',
          target: { type: 'subscription', id: context.workspace.id },
        });
        return {
          status: 200,
          body: {
            change: 'end_of_term',
            subscription: subscriptionDto(subscription),
            effectiveAt,
          },
        };
      });
    }),
  );

  app.get(
    '/api/billing/invoices',
    route(async (req, res) => {
      const context = await requireBillingCaller(req);
      const accountId = context.subscription.kb_account_id;
      if (!accountId) {
        res.json({ invoices: [], payments: [] });
        return;
      }
      const invoices = await kb.listInvoices(accountId);
      const stored = await pdfStoredIds(context.workspace.id);
      for (const invoice of invoices) {
        await rememberInvoice(context.workspace.id, invoice, stored.has(invoice.invoiceId));
      }
      const payments = await kb.listPayments(accountId);
      const records = await query<{ id: string; invoice_id: string; created_at: Date }>(
        `SELECT id, invoice_id, created_at FROM payment_records WHERE workspace_id = $1`,
        [context.workspace.id],
      );
      const byId = new Map(records.map((record) => [record.id, record]));
      res.json({
        invoices: invoices
          .map((invoice) => invoiceDto(invoice, stored.has(invoice.invoiceId)))
          .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : Number(b.number) - Number(a.number))),
        payments: payments.map((payment) => {
          const record = byId.get(payment.paymentId);
          return paymentDto(
            payment,
            record?.invoice_id ?? '',
            (record?.created_at ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
          );
        }),
      });
    }),
  );

  app.get(
    '/api/billing/invoices/:invoiceId/pdf',
    route(async (req, res) => {
      const context = await requireBillingCaller(req);
      const rows = await query<{ id: string; pdf_stored: boolean }>(
        `SELECT id, pdf_stored FROM invoice_records WHERE id = $1 AND workspace_id = $2`,
        [param(req, 'invoiceId'), context.workspace.id],
      );
      const record = rows[0];
      if (!record || !record.pdf_stored) throw fail.notFound();
      try {
        const bytes = await getObject(storageKeys.invoice(context.workspace.id, record.id));
        res.type('application/pdf').send(bytes);
      } catch (error) {
        if (error instanceof MissingObjectError) throw fail.notFound();
        throw error;
      }
    }),
  );

  app.post(
    '/api/billing/invoices/:invoiceId/pay',
    route(async (req, res) => {
      const input = body(req);
      const context = await requireBillingCaller(req);
      const accountId = context.subscription.kb_account_id;
      if (!accountId) throw fail.notFound();
      const invoices = await kb.listInvoices(accountId);
      const target = invoices.find((invoice) => invoice.invoiceId === param(req, 'invoiceId'));
      if (!target) throw fail.notFound();
      await idempotent(req, res, context, 'pay', async () => {
        const card = parseCard(input.card);
        if (kb.toCents(target.balance) <= 0) throw fail.conflict('invoice_already_paid');
        assertCardAccepted(card);
        const recorded = await payInvoiceAllOrNothing({
          workspace: context.workspace,
          accountId,
          invoiceId: target.invoiceId,
          transactionExternalKey: `${context.workspace.id}:${req.headers['idempotency-key'] as string}`,
          actor: context.author,
        });
        await updateSubscriptionRow(context.workspace.id, { card_last4: cardLast4(card) });
        await writeAudit({
          workspaceId: context.workspace.id,
          actor: context.author,
          action: 'invoice.paid',
          target: { type: 'invoice', id: target.invoiceId },
        });
        const subscription = await reactivateIfSettled(context.workspace.id, accountId);
        return {
          status: 200,
          body: {
            invoice: invoiceDto(recorded.invoice, true),
            payment: paymentDto(
              recorded.payment,
              recorded.invoice.invoiceId,
              new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
            ),
            subscription: subscriptionDto(subscription),
          },
        };
      });
    }),
  );

  app.post(
    '/api/billing/payments/:paymentId/refund',
    route(async (req, res) => {
      const input = body(req);
      const context = await requireBillingCaller(req);
      const rows = await query<{ id: string; invoice_id: string; amount_cents: number }>(
        `SELECT id, invoice_id, amount_cents FROM payment_records WHERE id = $1 AND workspace_id = $2`,
        [param(req, 'paymentId'), context.workspace.id],
      );
      const record = rows[0];
      if (!record) throw fail.notFound();
      await idempotent(req, res, context, 'refund', async () => {
        const payment = await kb.getPayment(record.id);
        const refunded = payment.transactions
          .filter((t) => t.transactionType === 'REFUND' && t.status === 'SUCCESS')
          .reduce((total, t) => total + kb.toCents(t.amount), 0);
        const refundable = kb.toCents(payment.purchasedAmount) - refunded;
        const requested =
          input.amountCents === undefined
            ? refundable
            : requireInteger(input, 'amountCents', { min: 1, max: 100_000_000 });
        if (requested > refundable) {
          throw fail.validation({ amountCents: 'More than the refundable balance' });
        }
        const transactionKey = `${context.workspace.id}:${req.headers['idempotency-key'] as string}`;
        const updated = await kb.refundPayment({
          paymentId: record.id,
          amountCents: requested,
          transactionExternalKey: transactionKey,
        });
        await query(
          `UPDATE payment_records SET refunded_cents = refunded_cents + $2 WHERE id = $1`,
          [record.id, requested],
        );
        const invoiceRows = await query<{ number: string }>(
          `SELECT number FROM invoice_records WHERE id = $1`,
          [record.invoice_id],
        );
        await sendRefundMail({
          workspace: context.workspace,
          invoiceNumber: invoiceRows[0]?.number ?? record.invoice_id,
          amountCents: requested,
          paymentId: record.id,
          transactionKey,
        });
        await writeAudit({
          workspaceId: context.workspace.id,
          actor: context.author,
          action: 'payment.refunded',
          target: { type: 'payment', id: record.id },
        });
        return {
          status: 200,
          body: {
            payment: paymentDto(
              updated,
              record.invoice_id,
              new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
            ),
          },
        };
      });
    }),
  );

  app.post(
    '/api/billing/cancel',
    route(async (req, res) => {
      const context = await requireCaller(req);
      requirePermission(context, 'workspace.admin');
      await idempotent(req, res, context, 'cancel', async () => {
        assertSubscriptionTransition(context.subscription.state, 'cancelled');
        const subscriptionId = context.subscription.kb_base_subscription_id;
        if (subscriptionId) await kb.cancelSubscription(subscriptionId, 'IMMEDIATE');
        const subscription = await updateSubscriptionRow(context.workspace.id, {
          state: 'cancelled',
          pending_change: null,
          suspended_reason: null,
        });
        await writeAudit({
          workspaceId: context.workspace.id,
          actor: context.author,
          action: 'subscription.cancelled',
          target: { type: 'subscription', id: context.workspace.id },
        });
        return { status: 200, body: { subscription: subscriptionDto(subscription) } };
      });
    }),
  );

  app.post(
    '/api/billing/webhook',
    route(async (req, res) => {
      const event = body(req);
      const workspaceId = typeof event.workspaceId === 'string' ? event.workspaceId : '';
      const rows = await query<{ id: string; signing_secret: string }>(
        `SELECT id, signing_secret FROM workspaces WHERE id = $1`,
        [workspaceId],
      );
      const workspace = rows[0];
      const signature = req.headers['orrery-signature'];
      if (!workspace || typeof signature !== 'string') throw fail.invalidSignature();
      const expected = `sha256=${hmacSha256Hex(workspace.signing_secret, req.rawBody)}`;
      if (!safeEqual(signature, expected)) throw fail.invalidSignature();

      const eventId = typeof event.id === 'string' ? event.id : '';
      if (eventId.length === 0) throw fail.validation({ id: 'Required' });
      const bodyHash = sha256Hex(req.rawBody);
      const claimed = await query<{ claimed: boolean }>(
        `INSERT INTO webhook_events (id, workspace_id, body_sha256)
         VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, id) DO NOTHING
         RETURNING true AS claimed`,
        [eventId, workspace.id, bodyHash],
      );
      if (claimed.length === 0) {
        const stored = await query<{ body_sha256: string }>(
          `SELECT body_sha256 FROM webhook_events WHERE workspace_id = $1 AND id = $2`,
          [workspace.id, eventId],
        );
        if (stored[0]?.body_sha256 !== bodyHash) throw fail.conflict('idempotency_key_reused');
        res.json({ received: true, duplicate: true });
        return;
      }

      try {
        await handleWebhookEvent(workspace.id, event);
      } catch (error) {
        await query(`DELETE FROM webhook_events WHERE workspace_id = $1 AND id = $2`, [
          workspace.id,
          eventId,
        ]);
        throw error;
      }
      res.json({ received: true, duplicate: false });
    }),
  );
}

async function handleWebhookEvent(
  workspaceId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const type = body.type;
  if (type === 'payment.succeeded') {
    const invoiceId = typeof body.invoiceId === 'string' ? body.invoiceId : '';
    const amountCents = typeof body.amountCents === 'number' ? body.amountCents : null;
    if (invoiceId.length === 0 || amountCents === null) {
      throw fail.validation({ invoiceId: 'Required' });
    }
    const workspaceRows = await query<{
      id: string;
      name: string;
      time_zone: string;
      review_links_enabled: boolean;
      signing_secret: string;
      created_at: Date;
    }>(`SELECT * FROM workspaces WHERE id = $1`, [workspaceId]);
    const workspace = workspaceRows[0];
    if (!workspace) throw fail.notFound();
    const subscriptionRows = await query<{ kb_account_id: string | null }>(
      `SELECT kb_account_id FROM subscriptions WHERE workspace_id = $1`,
      [workspaceId],
    );
    const accountId = subscriptionRows[0]?.kb_account_id;
    if (!accountId) throw fail.notFound();
    const invoices = await kb.listInvoices(accountId);
    const invoice = invoices.find((candidate) => candidate.invoiceId === invoiceId);
    if (!invoice) throw fail.notFound();
    const balanceCents = kb.toCents(invoice.balance);
    if (balanceCents <= 0) return;
    if (amountCents !== balanceCents) {
      throw fail.validation({ amountCents: `Must equal the invoice balance of ${balanceCents}` });
    }
    await payInvoiceAllOrNothing({
      workspace,
      accountId,
      invoiceId,
      transactionExternalKey: `${workspaceId}:${String(body.id)}`,
      actor: SCHEDULER_ACTOR,
    });
    await writeAudit({
      workspaceId,
      actor: SCHEDULER_ACTOR,
      action: 'invoice.paid',
      target: { type: 'invoice', id: invoiceId },
    });
    await reactivateIfSettled(workspaceId, accountId);
    return;
  }
  if (type === 'payment.failed') {
    const paymentId = typeof body.paymentId === 'string' ? body.paymentId : '';
    if (paymentId.length === 0) throw fail.validation({ paymentId: 'Required' });
    const rows = await query<{ id: string; invoice_id: string; amount_cents: number; charged_back: boolean }>(
      `SELECT id, invoice_id, amount_cents, charged_back FROM payment_records
       WHERE id = $1 AND workspace_id = $2`,
      [paymentId, workspaceId],
    );
    const record = rows[0];
    if (!record) throw fail.notFound();
    if (record.charged_back) return;
    await kb.chargebackPayment({
      paymentId: record.id,
      amountCents: record.amount_cents,
      transactionExternalKey: `${workspaceId}:${String(body.id)}`,
    });
    await query(`UPDATE payment_records SET charged_back = true WHERE id = $1`, [record.id]);
    await markPastDue(workspaceId, record.invoice_id);
    return;
  }
  throw fail.validation({ type: 'Unknown event type' });
}
