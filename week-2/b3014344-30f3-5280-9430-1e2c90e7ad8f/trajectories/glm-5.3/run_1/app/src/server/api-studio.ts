import type { Router, Ctx } from './http.js';
import { HttpError, sendJson, config, newId, studioInstant } from './util.js';
import { notFound, requireStudioOwner, getAccount } from './auth.js';
import { amountFromMinor, amountToString, formatMoney } from './money.js';
import { listAccountInvoicesSafe } from './billing.js';
import { withIdempotency, loadVisibleOrder } from './api-orders.js';
import { orderToJson, loadOrderPayments } from './api-public.js';
import { listAllOrders, getOrder, lockOrder, listPayments, refundedTotal } from './orders.js';
import { invalidTransition, PLANS, type OrderState, type PlanId } from './domain.js';
import { createChargeInvoice, createAccountCredit, getAccountCba, getInvoice, refundPayment } from './killbill.js';
import { ensureKillbillAccount, queueEmail, recordInvoice } from './billing.js';
import { insertPrice } from './pricing.js';
import { listEntries, createEntry, updateEntry, getEntry, getEntryBySlug, type EntryRecord } from './cms.js';

export function invoiceToJson(invoice: {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  amount: number;
  balance: number;
  creditAdj: number;
  currency: string;
  status: string;
  items: { itemType: string; description: string; amount: number }[];
}, kind: string, orderId: string | null, pdfStored: boolean): Record<string, unknown> {
  let status: 'paid' | 'open' | 'void' | 'credit' = 'open';
  if (invoice.status === 'VOID' || invoice.status === 'VOIDED') status = 'void';
  else if (invoice.amount < 0) status = 'credit';
  else if (kind === 'credit') status = 'credit';
  else if (Math.abs(invoice.balance) < 0.005) status = 'paid';
  const currency = invoice.currency === 'ARS' ? 'ARS' : 'USD';
  const description =
    kind === 'deposit' || kind === 'balance'
      ? (invoice.items[0]?.description ?? '')
      : kind === 'care'
        ? 'Care plan first month'
        : kind === 'change'
          ? 'Care plan change'
          : kind === 'credit'
            ? 'Account credit'
            : 'Care plan renewal';
  const creditMinor = invoice.items
    .filter((item) => item.itemType === 'CREDIT_ADJ')
    .reduce((total, item) => total + Math.round(item.amount * 100), 0);
  const amountMinor = kind === 'credit' ? BigInt(creditMinor) : BigInt(Math.round(invoice.amount * 100));
  return {
    id: invoice.invoiceId,
    number: invoice.invoiceNumber,
    date: invoice.invoiceDate,
    kind,
    description,
    amount: amountToString(amountFromMinor(currency, amountMinor)),
    balance: amountToString(amountFromMinor(currency, BigInt(Math.round(invoice.balance * 100)))),
    currency: invoice.currency,
    status,
    orderId,
    pdf: pdfStored,
  };
}

export function registerInvoiceRoutes(router: Router): void {
  router.get('/api/invoices', async (ctx) => {
    const user = (await import('./auth.js')).requireClientOwner(ctx.session);
    const account = await getAccount(ctx.db, user.accountId!);
    if (!account?.killbillAccountId) {
      sendJson(ctx.res, 200, { invoices: [] });
      return;
    }
    const invoices = await listAccountInvoicesSafe(account.killbillAccountId);
    const records = await ctx.db.query('SELECT * FROM invoice_records WHERE account_id = $1', [user.accountId]);
    const byId = new Map(
      (records.rows as { invoice_id: string; order_id: string | null; kind: string; pdf_stored_at: Date | null }[]).map((r) => [r.invoice_id, r]),
    );
    const out = invoices.map((invoice) => {
      const record = byId.get(invoice.invoiceId);
      const kind = invoice.items.some((i) => i.itemType === 'REPAIR_ADJ') ? 'change' : (record?.kind ?? 'renewal');
      return invoiceToJson(invoice, kind, record?.order_id ?? null, record?.pdf_stored_at != null);
    });
    out.sort((a, b) => String(b.number).localeCompare(String(a.number)));
    sendJson(ctx.res, 200, { invoices: out });
  });

  router.get('/api/invoices/{id}', async (ctx) => {
    const user = (await import('./auth.js')).requireClientOwner(ctx.session);
    const record = await ctx.db.query('SELECT * FROM invoice_records WHERE invoice_id = $1 AND account_id = $2', [
      ctx.params['id']!,
      user.accountId,
    ]);
    if ((record.rowCount ?? 0) === 0) throw notFound();
    const row = record.rows[0] as { invoice_id: string; order_id: string | null; kind: string; pdf_stored_at: Date | null };
    const invoice = await getInvoice(row.invoice_id);
    sendJson(ctx.res, 200, invoiceToJson(invoice, row.kind, row.order_id, row.pdf_stored_at != null));
  });
}

export function registerStudioRoutes(router: Router): void {
  router.get('/api/studio/orders', async (ctx) => {
    requireStudioOwner(ctx.session);
    const orders = await listAllOrders(ctx.db);
    const out = await Promise.all(
      orders.map(async (order) => {
        const account = order.accountId ? await getAccount(ctx.db, order.accountId) : null;
        return orderToJson(order, {
          businessName: account?.businessName ?? '',
          payments: await loadOrderPayments(ctx.db, order),
        });
      }),
    );
    sendJson(ctx.res, 200, { orders: out });
  });

  router.get('/api/studio/orders/{id}', async (ctx) => {
    requireStudioOwner(ctx.session);
    const order = await loadVisibleOrder(ctx, ctx.params['id']!);
    const account = order.accountId ? await getAccount(ctx.db, order.accountId) : null;
    sendJson(ctx.res, 200, orderToJson(order, { businessName: account?.businessName ?? '', payments: await loadOrderPayments(ctx.db, order) }));
  });

  router.post('/api/studio/orders/{id}/transitions', async (ctx) => {
    requireStudioOwner(ctx.session);
    const body = await ctx.body<{ to?: string }>();
    const to = String(body.to ?? '');
    await ctx.db.query('BEGIN');
    let committed = false;
    try {
      const order = await lockOrder(ctx.db, ctx.params['id']!);
      if (!order) throw notFound();
      const account = order.accountId ? await getAccount(ctx.db, order.accountId) : null;
      if (to === 'balance_invoiced') {
        if (order.state !== 'in_build') throw invalidTransition(order.state, to as OrderState);
        const ownerEmail = await accountOwnerEmail(ctx.db, order.accountId!);
        const killbillAccountId = await ensureKillbillAccount(ctx.db, order.accountId!, account!.businessName, ownerEmail, order.currency);
        const balance = amountFromMinor(order.currency, BigInt(order.due_at_launch_minor));
        const invoice = await createChargeInvoice(killbillAccountId, `${order.number} launch balance`, balance);
        await recordInvoice(ctx.db, { invoiceId: invoice.invoiceId, accountId: order.accountId!, orderId: order.id, kind: 'balance' });
        await ctx.db.query('UPDATE invoice_records SET noticed_at = now() WHERE invoice_id = $1', [invoice.invoiceId]);
        await queueEmail(ctx.db, {
          to: ownerEmail,
          subject: `Invoice ${invoice.invoiceNumber} from Pampero Build Co.: ${formatMoney(balance)}`,
          body: [
            'A new invoice from Pampero Build Co.',
            '',
            `Amount: ${formatMoney(balance)}`,
            `Due amount: ${formatMoney(balance)}`,
            '',
            `View and pay it at ${config.publicUrl}/portal/invoices`,
          ].join('\n'),
        });
        await ctx.db.query('UPDATE orders SET state = $1 WHERE id = $2', ['balance_invoiced', order.id]);
        await ctx.db.query('COMMIT');
        committed = true;
        const refreshed = await getOrder(ctx.db, order.id);
        sendJson(ctx.res, 200, orderToJson(refreshed!, { businessName: account?.businessName ?? '', payments: await loadOrderPayments(ctx.db, refreshed!) }));
        return;
      }
      if (to === 'in_build') {
        if (order.state !== 'deposit_paid') throw invalidTransition(order.state, to as OrderState);
      } else if (to === 'closed') {
        if (order.state !== 'paid_in_full') throw invalidTransition(order.state, to as OrderState);
        if (PLANS[order.plan].kind === 'care') throw invalidTransition(order.state, to as OrderState);
        const projectResult = await ctx.db.query('SELECT id FROM projects WHERE order_id = $1', [order.id]);
        if ((projectResult.rowCount ?? 0) > 0) {
          await ctx.db.query('UPDATE projects SET closed_at = now() WHERE order_id = $1', [order.id]);
        }
      } else {
        throw new HttpError(422, 'invalid_transition_target', 'Choose a valid next state.', { to: 'Choose a valid next state.' });
      }
      await ctx.db.query('UPDATE orders SET state = $1 WHERE id = $2', [to, order.id]);
      await ctx.db.query('COMMIT');
      committed = true;
      const refreshed = await getOrder(ctx.db, order.id);
      sendJson(ctx.res, 200, orderToJson(refreshed!, { businessName: account?.businessName ?? '', payments: await loadOrderPayments(ctx.db, refreshed!) }));
    } catch (err) {
      if (!committed) await ctx.db.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  });

  router.get('/api/studio/contractors', async (ctx) => {
    requireStudioOwner(ctx.session);
    const result = await ctx.db.query("SELECT id, name, email FROM users WHERE role = 'contractor' ORDER BY name ASC");
    sendJson(ctx.res, 200, { contractors: result.rows });
  });

  router.post('/api/studio/projects/{id}/assignments', async (ctx) => {
    requireStudioOwner(ctx.session);
    const body = await ctx.body<{ contractorId?: string }>();
    const contractorId = String(body.contractorId ?? '');
    const projectResult = await ctx.db.query('SELECT * FROM projects WHERE id = $1', [ctx.params['id']!]);
    if ((projectResult.rowCount ?? 0) === 0) throw notFound();
    const project = projectResult.rows[0] as { id: string; closed_at: Date | null };
    if (project.closed_at) {
      throw new HttpError(409, 'project_closed', 'This project is closed.');
    }
    const contractor = await ctx.db.query("SELECT id FROM users WHERE id = $1 AND role = 'contractor'", [contractorId]);
    if ((contractor.rowCount ?? 0) === 0) {
      throw new HttpError(422, 'invalid_contractor', 'Choose a contractor.', { contractorId: 'Choose a contractor.' });
    }
    const existing = await ctx.db.query('SELECT 1 FROM assignments WHERE project_id = $1 AND contractor_id = $2', [project.id, contractorId]);
    if ((existing.rowCount ?? 0) > 0) {
      sendJson(ctx.res, 200, { contractors: await assignmentsOf(ctx.db, project.id) });
      return;
    }
    await ctx.db.query('INSERT INTO assignments (project_id, contractor_id, assigned_at) VALUES ($1, $2, now())', [project.id, contractorId]);
    sendJson(ctx.res, 201, { contractors: await assignmentsOf(ctx.db, project.id) });
  });

  router.delete('/api/studio/projects/{id}/assignments/{contractorId}', async (ctx) => {
    requireStudioOwner(ctx.session);
    await ctx.db.query('DELETE FROM assignments WHERE project_id = $1 AND contractor_id = $2', [ctx.params['id']!, ctx.params['contractorId']!]);
    ctx.res.writeHead(204);
    ctx.res.end();
  });

  router.post('/api/studio/orders/{id}/refunds', async (ctx) => {
    requireStudioOwner(ctx.session);
    const order = await getOrder(ctx.db, ctx.params['id']!);
    if (!order) throw notFound();
    await withIdempotency(ctx, async (body) => {
      const paymentKind = String(body.payment ?? '');
      if (paymentKind !== 'deposit' && paymentKind !== 'balance') {
        throw new HttpError(422, 'invalid_payment', 'Choose the deposit or the launch balance.', { payment: 'Choose the deposit or the launch balance.' });
      }
      const amountRaw = String(body.amount ?? '');
      if (!/^\d+(\.\d{1,2})?$/.test(amountRaw) || Number(amountRaw) <= 0) {
        throw new HttpError(422, 'invalid_amount', 'Enter an amount up to two decimals.', { amount: 'Enter an amount up to two decimals.' });
      }
      const reason = String(body.reason ?? '').trim();
      const payments = await listPayments(ctx.db, order.id);
      const payment = payments.find((p) => p.kind === paymentKind);
      if (!payment) {
        throw new HttpError(409, 'payment_not_captured', 'That payment has not been captured yet.');
      }
      const amount = amountFromMinor(order.currency, BigInt(Math.round(Number(amountRaw) * 100)));
      // serialize refunds on one payment so the refunds never sum above it
      await ctx.db.query('BEGIN');
      try {
        const locked = await ctx.db.query('SELECT id FROM payments WHERE id = $1 FOR UPDATE', [payment.id]);
        if ((locked.rowCount ?? 0) === 0) throw notFound();
        const refundedBefore = await refundedTotal(ctx.db, payment.id);
        const remaining = payment.amountMinor - refundedBefore;
        if (amount.minor > remaining) {
          throw new HttpError(422, 'refund_over_cap', `That is more than the ${formatMoney({ currency: order.currency, minor: remaining })} left on this payment.`, {
            amount: `That is more than the ${formatMoney({ currency: order.currency, minor: remaining })} left on this payment.`,
          });
        }
        const transactionKey = newId();
        const transactionId = await refundPayment(payment.killbillPaymentId, amount, transactionKey);
        const refundId = newId();
        await ctx.db.query(
          'INSERT INTO refunds (id, payment_id, amount_minor, reason, killbill_transaction_id, created_at) VALUES ($1, $2, $3, $4, $5, now())',
          [refundId, payment.id, amount.minor, reason, transactionId],
        );
        await ctx.db.query('COMMIT');
        const refundedNow = await refundedTotal(ctx.db, payment.id);
        const left = payment.amountMinor - refundedNow;
        const ownerEmail = await accountOwnerEmail(ctx.db, order.accountId!);
        await queueEmail(ctx.db, {
          to: ownerEmail,
          subject: `Refund of ${formatMoney(amount)} on ${order.number}`,
          body: [
            `A refund of ${formatMoney(amount)} was issued on ${order.number}.`,
            '',
            `Amount left on that payment: ${formatMoney({ currency: order.currency, minor: left })}`,
          ].join('\n'),
        });
        return {
          status: 201,
          body: {
            refund: { id: refundId, payment: paymentKind, amount: amountToString(amount), currency: order.currency, killbillTransactionId: transactionId },
            payment: {
              kind: payment.kind,
              amount: amountToString(amountFromMinor(payment.currency as 'USD' | 'ARS', payment.amountMinor)),
              refunded: amountToString(amountFromMinor(payment.currency as 'USD' | 'ARS', refundedNow)),
              remaining: amountToString(amountFromMinor(payment.currency as 'USD' | 'ARS', left)),
            },
          },
        };
      } catch (err) {
        await ctx.db.query('ROLLBACK').catch(() => undefined);
        throw err;
      }
    });
  });

  router.post('/api/studio/accounts/{id}/credits', async (ctx) => {
    requireStudioOwner(ctx.session);
    const account = await getAccount(ctx.db, ctx.params['id']!);
    if (!account) throw notFound();
    await withIdempotency(ctx, async (body) => {
      if (!account.killbillAccountId) {
        throw new HttpError(409, 'no_billing_account', 'This account has no billing account yet.');
      }
      const amountRaw = String(body.amount ?? '');
      if (!/^\d+(\.\d{1,2})?$/.test(amountRaw) || Number(amountRaw) <= 0) {
        throw new HttpError(422, 'invalid_amount', 'Enter an amount up to two decimals.', { amount: 'Enter an amount up to two decimals.' });
      }
      const currencyRaw = String(body.currency ?? '');
      if (currencyRaw !== account.currency) {
        throw new HttpError(422, 'invalid_currency', `Credits must be in ${account.currency}.`, {
          currency: `Credits must be in ${account.currency}.`,
        });
      }
      const reason = String(body.reason ?? '').trim();
      const amount = amountFromMinor(account.currency, BigInt(Math.round(Number(amountRaw) * 100)));
      await createAccountCredit(account.killbillAccountId, amount, 'Account credit');
      const creditId = newId();
      await ctx.db.query('INSERT INTO credits (id, account_id, amount_minor, currency, reason, created_at) VALUES ($1, $2, $3, $4, $5, now())', [
        creditId,
        account.id,
        amount.minor,
        account.currency,
        reason,
      ]);
      const cba = await getAccountCba(account.killbillAccountId, account.currency);
      const ownerEmail = await accountOwnerEmail(ctx.db, account.id);
      await queueEmail(ctx.db, {
        to: ownerEmail,
        subject: `Account credit of ${formatMoney(amount)}`,
        body: [`An account credit of ${formatMoney(amount)} was added to your account.`, '', `Reason: ${reason || 'Credit from the studio'}`].join('\n'),
      });
      return {
        status: 201,
        body: {
          credit: { id: creditId, amount: amountToString(amount), currency: account.currency },
          accountCredit: amountToString(cba ?? amountFromMinor(account.currency, 0n)),
        },
      };
    });
  });

  router.get('/api/studio/prices', async (ctx) => {
    requireStudioOwner(ctx.session);
    const result = await ctx.db.query('SELECT id, plan, currency, amount_minor, effective_at FROM prices ORDER BY effective_at ASC');
    const rows = result.rows as { id: string; plan: string; currency: string; amount_minor: string; effective_at: Date }[];
    sendJson(ctx.res, 200, {
      prices: rows.map((row) => ({
        id: row.id,
        plan: row.plan,
        currency: row.currency,
        amount: amountToString(amountFromMinor(row.currency === 'ARS' ? 'ARS' : 'USD', BigInt(row.amount_minor))),
        effectiveAt: studioInstant(new Date(row.effective_at)),
      })),
    });
  });

  router.post('/api/studio/prices', async (ctx) => {
    requireStudioOwner(ctx.session);
    const body = await ctx.body<{ plan?: string; currency?: string; amount?: string; effectiveAt?: string }>();
    const planRaw = String(body.plan ?? '');
    if (!(planRaw in PLANS)) {
      throw new HttpError(422, 'invalid_plan', 'Choose one of the published plans.', { plan: 'Choose one of the published plans.' });
    }
    const currencyRaw = String(body.currency ?? 'ARS');
    if (currencyRaw !== 'ARS') {
      throw new HttpError(422, 'invalid_currency', 'Peso prices only. Dollar prices are fixed.', { currency: 'Peso prices only. Dollar prices are fixed.' });
    }
    const amountRaw = String(body.amount ?? '');
    if (!/^\d+(\.\d{1,2})?$/.test(amountRaw) || Number(amountRaw) <= 0) {
      throw new HttpError(422, 'invalid_amount', 'Enter an amount up to two decimals.', { amount: 'Enter an amount up to two decimals.' });
    }
    let effectiveAt = new Date();
    if (body.effectiveAt !== undefined && body.effectiveAt !== null && String(body.effectiveAt).length > 0) {
      const parsed = new Date(String(body.effectiveAt));
      if (Number.isNaN(parsed.getTime())) {
        throw new HttpError(422, 'invalid_effective_at', 'Enter a valid instant.', { effectiveAt: 'Enter a valid instant.' });
      }
      if (parsed < new Date()) {
        throw new HttpError(422, 'invalid_effective_at', 'The instant must be in the future.', { effectiveAt: 'The instant must be in the future.' });
      }
      effectiveAt = parsed;
    }
    const row = await insertPrice(ctx.db, {
      plan: planRaw as PlanId,
      currency: 'ARS',
      amount: amountFromMinor('ARS', BigInt(Math.round(Number(amountRaw) * 100))),
      effectiveAt,
    });
    sendJson(ctx.res, 201, {
      id: row.id,
      plan: row.plan,
      currency: row.currency,
      amount: amountToString(row.amount),
      effectiveAt: studioInstant(row.effectiveAt),
    });
  });

  router.get('/api/studio/entries', async (ctx) => {
    requireStudioOwner(ctx.session);
    try {
      const caseStudies = await listEntries('case_study');
      const journal = await listEntries('journal');
      sendJson(ctx.res, 200, { entries: [...caseStudies, ...journal] });
    } catch {
      throw new HttpError(503, 'cms_unavailable', 'Case studies are unavailable right now.');
    }
  });

  router.post('/api/studio/entries', async (ctx) => {
    requireStudioOwner(ctx.session);
    const body = await ctx.body<{ kind?: string; slug?: string; title?: string; client?: string; year?: string; summary?: string; body?: string }>();
    const kind = String(body.kind ?? '');
    if (kind !== 'case_study' && kind !== 'journal') {
      throw new HttpError(422, 'invalid_kind', 'Choose a case study or a journal post.', { kind: 'Choose a case study or a journal post.' });
    }
    const fields: Record<string, string> = {};
    const slug = String(body.slug ?? '').trim();
    const title = String(body.title ?? '').trim();
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) fields.slug = 'Use lowercase letters, digits and hyphens.';
    else if (await getEntryBySlug(slug)) fields.slug = 'That slug is already in use.';
    if (title.length < 1) fields.title = 'Enter a title.';
    if (Object.keys(fields).length > 0) {
      throw new HttpError(422, 'invalid_entry', 'Check the form fields.', fields);
    }
    try {
      const entry: EntryRecord = await createEntry({
        kind: kind as 'case_study' | 'journal',
        slug,
        title,
        client: String(body.client ?? ''),
        year: String(body.year ?? ''),
        summary: String(body.summary ?? ''),
        body: String(body.body ?? ''),
        status: 'draft',
        publishedAt: null,
      });
      sendJson(ctx.res, 201, entry);
    } catch {
      throw new HttpError(503, 'cms_unavailable', 'Case studies are unavailable right now.');
    }
  });

  router.post('/api/studio/entries/{id}/publish', async (ctx) => {
    requireStudioOwner(ctx.session);
    await entryLifecycle(ctx, 'publish');
  });

  router.post('/api/studio/entries/{id}/withdraw', async (ctx) => {
    requireStudioOwner(ctx.session);
    await entryLifecycle(ctx, 'withdraw');
  });
}

async function entryLifecycle(ctx: Ctx, action: 'publish' | 'withdraw'): Promise<void> {
  let current: EntryRecord;
  try {
    current = await getEntry(ctx.params['id']!);
  } catch {
    throw notFound();
  }
  try {
    if (action === 'publish') {
      if (current.status !== 'draft') {
        throw new HttpError(409, 'invalid_transition', `This entry is ${current.status} and cannot be published.`);
      }
      sendJson(ctx.res, 200, await updateEntry(current.id, { status: 'published', publishedAt: new Date().toISOString() }));
      return;
    }
    if (current.status !== 'published') {
      throw new HttpError(409, 'invalid_transition', `This entry is ${current.status} and cannot be withdrawn.`);
    }
    sendJson(ctx.res, 200, await updateEntry(current.id, { status: 'withdrawn' }));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(503, 'cms_unavailable', 'Case studies are unavailable right now.');
  }
}

async function assignmentsOf(db: Ctx['db'], projectId: string): Promise<{ id: string; name: string; email: string }[]> {
  const result = await db.query(
    'SELECT u.id, u.name, u.email FROM assignments a JOIN users u ON u.id = a.contractor_id WHERE a.project_id = $1 ORDER BY u.name ASC',
    [projectId],
  );
  return result.rows as { id: string; name: string; email: string }[];
}

export async function accountOwnerEmail(db: Ctx['db'], accountId: string): Promise<string> {
  const result = await db.query("SELECT email FROM users WHERE account_id = $1 AND role = 'client_owner' LIMIT 1", [accountId]);
  const row = result.rows[0] as { email: string } | undefined;
  return row?.email ?? 'client@pampero.test';
}
