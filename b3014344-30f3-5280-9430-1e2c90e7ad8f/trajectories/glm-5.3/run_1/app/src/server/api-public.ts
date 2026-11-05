import type { Router, Ctx } from './http.js';
import { HttpError, sendJson, studioInstant, ZONE } from './util.js';
import { requireUser } from './auth.js';
import {
  PLANS,
  isCarePlan,
  parsePlanId,
  parseCurrency,
  quoteFigures,
} from './domain.js';
import { priceInEffect } from './pricing.js';
import { amountFromMinor, amountToString, sharePercent } from './money.js';
import { listPayments, refundedTotal, type OrderRow } from './orders.js';
import { signIn } from './auth.js';
import { ensureBillingReachable, BillingUnavailable } from './billing.js';
import {
  listEntries,
  getEntryBySlug,
  type EntryRecord,
} from './cms.js';

export function orderToJson(order: OrderRow, extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: order.id,
    number: order.number,
    accountId: order.accountId,
    plan: order.plan,
    planName: order.planName,
    currency: order.currency,
    state: order.state,
    total: amountToString(amountFromMinor(order.currency, BigInt(order.total_minor))),
    dueNow: amountToString(amountFromMinor(order.currency, BigInt(order.due_now_minor))),
    dueAtLaunch: amountToString(amountFromMinor(order.currency, BigInt(order.due_at_launch_minor))),
    acceptedAt: order.acceptedAt ? studioInstant(order.acceptedAt) : null,
    projectId: order.projectId,
    ...extra,
  };
}

export async function loadOrderPayments(db: Ctx['db'], order: OrderRow): Promise<Record<string, unknown>[]> {
  const payments = await listPayments(db, order.id);
  const result: Record<string, unknown>[] = [];
  for (const payment of payments) {
    const refunded = await refundedTotal(db, payment.id);
    result.push({
      kind: payment.kind,
      amount: amountToString(amountFromMinor(payment.currency as 'USD' | 'ARS', payment.amountMinor)),
      refunded: amountToString(amountFromMinor(payment.currency as 'USD' | 'ARS', refunded)),
      remaining: amountToString(amountFromMinor(payment.currency as 'USD' | 'ARS', payment.amountMinor - refunded)),
      capturedAt: studioInstant(payment.capturedAt),
      killbillPaymentId: payment.killbillPaymentId,
    });
  }
  return result;
}

// ---------- Health, clock, CMS ----------

export function registerPublicRoutes(router: Router): void {
  router.get('/api/health', async (ctx) => {
    const { health } = await import('./health.js');
    const state = await health();
    sendJson(ctx.res, 200, state);
  });

  router.get('/api/clock', async (ctx) => {
    sendJson(ctx.res, 200, { now: studioInstant(new Date()), zone: ZONE });
  });

  router.get('/api/case-studies', async (ctx) => {
    await listEntriesRoute(ctx, 'case_study');
  });
  router.get('/api/journal', async (ctx) => {
    await listEntriesRoute(ctx, 'journal');
  });
  router.get('/api/case-studies/{slug}', async (ctx) => {
    await entryRoute(ctx, ctx.params['slug']!);
  });
  router.get('/api/journal/{slug}', async (ctx) => {
    await entryRoute(ctx, ctx.params['slug']!);
  });
}

async function listEntriesRoute(ctx: Ctx, kind: 'case_study' | 'journal'): Promise<void> {
  try {
    const entries = await listEntries(kind, 'published');
    const mapped = entries
      .map((entry) => ({
        slug: entry.slug,
        title: entry.title,
        client: entry.client,
        year: entry.year,
        summary: entry.summary,
        publishedAt: entry.publishedAt,
      }))
      .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
    sendJson(ctx.res, 200, { entries: mapped });
  } catch {
    throw new HttpError(503, 'cms_unavailable', 'Case studies are unavailable right now.');
  }
}

async function entryRoute(ctx: Ctx, slug: string): Promise<void> {
  let entry: EntryRecord | null;
  try {
    entry = await getEntryBySlug(slug);
  } catch {
    throw new HttpError(503, 'cms_unavailable', 'Case studies are unavailable right now.');
  }
  if (!entry || entry.status !== 'published') {
    throw new HttpError(404, 'not_found', 'We could not find that page.');
  }
  sendJson(ctx.res, 200, entry);
}

// ---------- Plans and quotes ----------

export function registerQuoteRoutes(router: Router): void {
  router.get('/api/plans', async (ctx) => {
    const currencyRaw = ctx.url.searchParams.get('currency') ?? 'USD';
    let currency: 'USD' | 'ARS';
    try {
      currency = parseCurrency(currencyRaw);
    } catch {
      throw new HttpError(422, 'invalid_currency', 'Choose USD or ARS.', { currency: 'Choose USD or ARS.' });
    }
    await ensureBillingReachable();
    const plans: Record<string, unknown>[] = [];
    for (const plan of Object.values(PLANS)) {
      const row = await priceInEffect(ctx.db, plan.id, currency, new Date());
      if (!row) throw new BillingUnavailable('Live pricing is offline. Try again in a moment.');
      plans.push({
        plan: plan.id,
        name: plan.name,
        amount: amountToString(row.amount),
        interval: isCarePlan(plan.id) ? 'month' : null,
      });
    }
    sendJson(ctx.res, 200, { currency, plans });
  });

  router.post('/api/quotes', async (ctx) => {
    const body = await ctx.body<{ plan?: string; currency?: string }>();
    const plan = parsePlanId(String(body.plan ?? ''));
    const currency = parseCurrency(String(body.currency ?? ''));
    await ensureBillingReachable();
    const row = await priceInEffect(ctx.db, plan, currency, new Date());
    if (!row) throw new BillingUnavailable('Live pricing is offline. Try again in a moment.');
    const figures = quoteFigures(plan, row.amount);
    sendJson(ctx.res, 200, {
      plan,
      currency,
      total: amountToString(figures.total),
      dueNow: amountToString(figures.dueNow),
      dueAtLaunch: amountToString(figures.dueAtLaunch),
      dueNowShare: sharePercent(figures.dueNow.minor, figures.total.minor),
      priceEffectiveAt: studioInstant(row.effectiveAt),
    });
  });
}

// ---------- Session ----------

export function registerSessionRoutes(router: Router): void {
  router.post('/api/session', async (ctx) => {
    const body = await ctx.body<{ email?: string; password?: string }>();
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const result = await signIn(ctx.db, email, password);
    setSessionCookie(ctx, result.sessionId);
    sendJson(ctx.res, 200, { user: userToJson(result.user) });
  });

  router.delete('/api/session', async (ctx) => {
    if (ctx.session) {
      await ctx.db.query('DELETE FROM sessions WHERE id = $1', [ctx.session.sessionId]);
    }
    clearSessionCookie(ctx);
    ctx.res.writeHead(204);
    ctx.res.end();
  });

  router.get('/api/me', async (ctx) => {
    const user = requireUser(ctx.session);
    sendJson(ctx.res, 200, { user: userToJson(user) });
  });
}

export function userToJson(user: { id: string; name: string; email: string; role: string; accountId: string | null }): Record<string, unknown> {
  return { id: user.id, name: user.name, email: user.email, role: user.role, accountId: user.accountId };
}

function setSessionCookie(ctx: Ctx, sessionId: string): void {
  const headers = ctx.res.getHeaders();
  void headers;
  ctx.res.setHeader('Set-Cookie', `pampero_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
}

function clearSessionCookie(ctx: Ctx): void {
  ctx.res.setHeader('Set-Cookie', 'pampero_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}
