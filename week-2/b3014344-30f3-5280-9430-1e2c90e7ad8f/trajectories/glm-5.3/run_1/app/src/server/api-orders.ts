import type { Router, Ctx } from './http.js';
import { HttpError, sendJson, newId } from './util.js';
import { idempotencyScope, isUuid, notFound, requireClientOwner, createAccount, createUser, getAccount } from './auth.js';
import { PLANS, isCarePlan, parsePlanId, parseCurrency, quoteFigures, invalidTransition } from './domain.js';
import { priceInEffect, nextOrderNumber } from './pricing.js';
import { getOrder, listOrdersByAccount, lockOrder, type OrderRow } from './orders.js';
import { BillingUnavailable } from './billing.js';
import { payOrder, payResponse } from './pay.js';
import { loadPlanState, planStatus } from './plans.js';
import { orderToJson, loadOrderPayments } from './api-public.js';

export function registerOrderRoutes(router: Router): void {
  router.post('/api/orders', async (ctx) => {
    const body = await ctx.body<{ plan?: string; currency?: string }>();
    const plan = parsePlanId(String(body.plan ?? ''));
    const currency = parseCurrency(String(body.currency ?? ''));
    const session = ctx.session ?? (await ensureAnonymousSession(ctx));
    if (session.user && session.user.role !== 'client_owner') {
      throw new HttpError(403, 'forbidden', 'Only clients may start an order.');
    }
    const priceRow = await priceInEffect(ctx.db, plan, currency, new Date());
    if (!priceRow) throw new BillingUnavailable('Live pricing is offline. Try again in a moment.');
    const figures = quoteFigures(plan, priceRow.amount);
    const id = newId();
    const number = await nextOrderNumber(ctx.db);
    await ctx.db.query(
      `INSERT INTO orders (id, number, account_id, session_id, plan, plan_name, currency, state, total_minor, due_now_minor, due_at_launch_minor, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'quoted', $8, $9, $10, now())`,
      [
        id,
        number,
        session.user?.accountId ?? null,
        session.sessionId,
        plan,
        PLANS[plan].name,
        currency,
        figures.total.minor,
        figures.dueNow.minor,
        figures.dueAtLaunch.minor,
      ],
    );
    const order = await getOrder(ctx.db, id);
    sendJson(ctx.res, 201, orderToJson(order!, { payments: [] }));
  });

  router.get('/api/orders', async (ctx) => {
    const user = requireClientOwner(ctx.session);
    const orders = await listOrdersByAccount(ctx.db, user.accountId!);
    const withPayments = await Promise.all(
      orders.map(async (order) => orderToJson(order, { payments: await loadOrderPayments(ctx.db, order) })),
    );
    sendJson(ctx.res, 200, { orders: withPayments });
  });

  router.get('/api/orders/{id}', async (ctx) => {
    const order = await loadVisibleOrder(ctx, ctx.params['id']!);
    sendJson(ctx.res, 200, orderToJson(order, { payments: await loadOrderPayments(ctx.db, order) }));
  });

  router.post('/api/orders/{id}/accept', async (ctx) => {
    const body = await ctx.body<{
      businessName?: string;
      name?: string;
      email?: string;
      password?: string;
      acceptTerms?: boolean;
    }>();
    const orderId = ctx.params['id']!;
    if (!isUuid(orderId)) throw notFound();
    const session = ctx.session ?? (await ensureAnonymousSession(ctx));

    await ctx.db.query('BEGIN');
    let committed = false;
    try {
      const order = await lockOrder(ctx.db, orderId);
      if (!order) throw notFound();
      if (order.state !== 'quoted') throw invalidTransition(order.state, 'accepted');
      if (order.sessionId !== session.sessionId) throw notFound();

      let accountId: string;
      let user: { id: string; name: string; email: string; role: string; accountId: string | null };
      if (session.user) {
        if (session.user.role !== 'client_owner') {
          throw new HttpError(403, 'forbidden', 'Only a client owner may accept a quote.');
        }
        accountId = session.user.accountId!;
        user = session.user;
      } else {
        const fields: Record<string, string> = {};
        const businessName = String(body.businessName ?? '').trim();
        const name = String(body.name ?? '').trim();
        const email = String(body.email ?? '').trim().toLowerCase();
        const password = String(body.password ?? '');
        if (businessName.length < 1 || businessName.length > 120) fields.businessName = 'Enter your business name, up to 120 characters.';
        if (name.length < 1 || name.length > 80) fields.name = 'Enter your name, up to 80 characters.';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = 'Enter a valid email address.';
        else {
          const existing = await ctx.db.query('SELECT id FROM users WHERE email = $1', [email]);
          if ((existing.rowCount ?? 0) > 0) fields.email = 'This person already has a Pampero Ledger sign-in.';
        }
        if (password.length < 10) fields.password = 'Choose a password of at least 10 characters.';
        if (body.acceptTerms !== true) fields.acceptTerms = 'Accept the scope and price to continue.';
        if (Object.keys(fields).length > 0) {
          throw new HttpError(422, 'invalid_accept', 'Check the form fields.', fields);
        }
        const account = await createAccount(ctx.db, businessName, order.currency);
        const created = await createUser(ctx.db, { accountId: account.id, name, email, role: 'client_owner', password });
        await ctx.db.query('UPDATE sessions SET user_id = $1 WHERE id = $2', [created.id, session.sessionId]);
        accountId = account.id;
        user = created;
      }

      const account = await getAccount(ctx.db, accountId);
      if (!account) throw notFound();
      if (account.currency !== order.currency) {
        throw new HttpError(422, 'currency_mismatch', `Your account bills in ${account.currency}.`, {
          currency: `Your account bills in ${account.currency}.`,
        });
      }
      if (isCarePlan(order.plan)) {
        const state = await loadPlanState(ctx.db, accountId);
        if (state && planStatus(state) !== 'cancelled') {
          throw new HttpError(409, 'plan_exists', 'Your account already has a care plan.');
        }
      }

      // The price in effect at this instant decides the acceptance.
      const priceRow = await priceInEffect(ctx.db, order.plan, order.currency, new Date());
      if (!priceRow) throw new BillingUnavailable();
      const figures = quoteFigures(order.plan, priceRow.amount);
      if (figures.total.minor !== BigInt(order.total_minor)) {
        throw new StaleQuoteError(order.id, figures.total.minor, figures.dueNow.minor, figures.dueAtLaunch.minor);
      }
      await ctx.db.query(
        `UPDATE orders SET state = 'accepted', account_id = $1, accepted_at = now(), price_row_id = $2 WHERE id = $3`,
        [accountId, priceRow.id, order.id],
      );
      await ctx.db.query('COMMIT');
      committed = true;
      const accepted = await getOrder(ctx.db, orderId);
      sendJson(ctx.res, 200, { order: orderToJson(accepted!, { payments: [] }), user });
    } catch (err) {
      if (!committed) await ctx.db.query('ROLLBACK').catch(() => undefined);
      if (err instanceof StaleQuoteError) {
        await ctx.db.query('BEGIN');
        await ctx.db.query(
          'UPDATE orders SET total_minor = $1, due_now_minor = $2, due_at_launch_minor = $3 WHERE id = $4',
          [err.totalMinor, err.dueNowMinor, err.dueAtLaunchMinor, err.orderId],
        );
        await ctx.db.query('COMMIT');
        const refreshed = await getOrder(ctx.db, err.orderId);
        throw new HttpError(409, 'quote_stale', 'Prices changed since your quote. Review the new total before accepting.', undefined, {
          order: orderToJson(refreshed!, { payments: [] }),
        });
      }
      throw err;
    }
  });

  router.post('/api/orders/{id}/pay', async (ctx) => {
    await withIdempotency(ctx, async (body) => {
      const user = requireClientOwner(ctx.session);
      if (!isUuid(ctx.params['id']!)) throw notFound();
      const order = await getOrder(ctx.db, ctx.params['id']!);
      if (!order || order.accountId !== user.accountId) throw notFound();
      const card = body.card as { number?: string; expiry?: string; cvc?: string } | undefined;
      if (!card) {
        throw new HttpError(422, 'invalid_card', 'Enter the card details.', { 'card.number': 'Enter a valid card number.' });
      }
      const result = await payOrder(ctx.db, order, {
        number: String(card.number ?? ''),
        expiry: String(card.expiry ?? ''),
        cvc: String(card.cvc ?? ''),
      });
      const refreshed = await getOrder(ctx.db, result.orderId);
      return {
        status: 201,
        body: { order: orderToJson(refreshed!, { payments: [] }), ...payResponse(result) },
      };
    });
  });
}

class StaleQuoteError extends Error {
  constructor(
    readonly orderId: string,
    readonly totalMinor: bigint,
    readonly dueNowMinor: bigint,
    readonly dueAtLaunchMinor: bigint,
  ) {
    super('quote_stale');
  }
}

export async function ensureAnonymousSession(ctx: Ctx): Promise<NonNullable<Ctx['session']>> {
  if (ctx.session) return ctx.session;
  const sessionId = newId();
  await ctx.db.query("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ($1, NULL, now(), now() + interval '30 days')", [sessionId]);
  ctx.res.setHeader('Set-Cookie', `pampero_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
  ctx.session = { sessionId, user: null };
  return ctx.session;
}

export async function loadVisibleOrder(ctx: Ctx, orderId: string): Promise<OrderRow> {
  if (!isUuid(orderId)) throw notFound();
  const order = await getOrder(ctx.db, orderId);
  if (!order) throw notFound();
  if (ctx.session?.user?.role === 'studio_owner') return order;
  if (order.state === 'quoted') {
    if (ctx.session && order.sessionId === ctx.session.sessionId) return order;
    throw notFound();
  }
  if (ctx.session?.user?.role === 'client_owner' && order.accountId === ctx.session.user.accountId) return order;
  throw notFound();
}

/**
 * The one place that applies Idempotency-Key semantics: only a 2xx response is
 * stored, a replay returns it unchanged, a mismatched body is refused, and a
 * concurrent request with the same key waits for the first.
 */
export async function withIdempotency(
  ctx: Ctx,
  handler: (body: Record<string, unknown>) => Promise<{ status: number; body: Record<string, unknown> }>,
): Promise<void> {
  const body = await ctx.body<Record<string, unknown>>().catch((err: HttpError) => {
    if (err.code === 'unsupported_media_type' || err.code === 'payload_too_large') throw err;
    return {};
  });
  const key = ctx.req.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length < 1 || key.length > 200 || !/^[\x20-\x7e]+$/.test(key)) {
    throw new HttpError(422, 'missing_idempotency_key', 'Send an Idempotency-Key header.', {
      'Idempotency-Key': 'Send an Idempotency-Key header.',
    });
  }
  const scope = idempotencyScope(ctx.session);
  const path = ctx.url.pathname;
  const method = ctx.req.method ?? 'POST';
  const raw = JSON.stringify(body ?? {});
  const { sha256Hex } = await import('./util.js');
  const hash = sha256Hex(raw);

  const existing = await ctx.db.query(
    'SELECT request_hash, state, status, response_body FROM idempotency WHERE scope = $1 AND method = $2 AND path = $3 AND key = $4',
    [scope, method, path, key],
  );
  if ((existing.rowCount ?? 0) > 0) {
    const row = existing.rows[0] as { request_hash: string; state: string; status: number | null; response_body: string | null };
    if (row.request_hash !== hash) {
      throw new HttpError(409, 'idempotency_mismatch', 'This key was used with a different request.');
    }
    const deadline = Date.now() + 15_000;
    while (row.state === 'processing' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const again = await ctx.db.query(
        'SELECT state, status, response_body FROM idempotency WHERE scope = $1 AND method = $2 AND path = $3 AND key = $4',
        [scope, method, path, key],
      );
      const fresh = again.rows[0] as { state: string; status: number | null; response_body: string | null };
      row.state = fresh.state;
      row.status = fresh.status;
      row.response_body = fresh.response_body;
    }
    if (row.state === 'done' && row.status !== null && row.response_body !== null) {
      sendJson(ctx.res, row.status, JSON.parse(row.response_body) as Record<string, unknown>, { 'Idempotent-Replayed': 'true' });
      return;
    }
    throw new BillingUnavailable();
  }

  await ctx.db.query(
    "INSERT INTO idempotency (scope, method, path, key, request_hash, state, created_at) VALUES ($1, $2, $3, $4, $5, 'processing', now())",
    [scope, method, path, key, hash],
  );
  try {
    const result = await handler(body ?? {});
    if (result.status >= 200 && result.status < 300) {
      await ctx.db.query(
        'UPDATE idempotency SET status = $1, response_body = $2, state = $3 WHERE scope = $4 AND method = $5 AND path = $6 AND key = $7',
        [result.status, JSON.stringify(result.body), 'done', scope, method, path, key],
      );
    } else {
      await ctx.db.query('DELETE FROM idempotency WHERE scope = $1 AND method = $2 AND path = $3 AND key = $4', [scope, method, path, key]);
    }
    sendJson(ctx.res, result.status, result.body);
  } catch (err) {
    await ctx.db.query('DELETE FROM idempotency WHERE scope = $1 AND method = $2 AND path = $3 AND key = $4', [scope, method, path, key]);
    throw err;
  }
}
