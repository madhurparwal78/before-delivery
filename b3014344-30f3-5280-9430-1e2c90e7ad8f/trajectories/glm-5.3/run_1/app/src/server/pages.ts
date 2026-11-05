import type { Router, Ctx } from './http.js';
import { HttpError, studioInstant } from './util.js';
import type { UserRow } from './auth.js';
import { listEntries } from './cms.js';
import { PLANS } from './domain.js';
import { priceInEffect } from './pricing.js';
import { amountFromMinor, amountToString, formatMoney, type Currency } from './money.js';
import { quoteFigures } from './domain.js';
import { listOrdersByAccount, listPayments } from './orders.js';
import { listVisibleProjects, loadVisibleProject } from './api-portal.js';
import { listProjectFiles, UPLOAD_ALLOWLIST_SENTENCE } from './files.js';
import { loadPlanState, planView, planStatus } from './plans.js';
import { listAccountInvoicesSafe } from './billing.js';
import { invoiceToJson } from './api-studio.js';

const NOT_FOUND_HEADING = "We couldn't find that page.";
const ACCESS_ENDED_HEADING = 'Your access to this project ended when it closed.';

export interface PageOptions {
  title: string;
  bodyId?: string;
  navMode?: 'public' | 'portal' | 'studio';
  user?: UserRow | null;
  hideScene?: boolean;
  head?: string;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function clockTime(date: Date): string {
  const shifted = new Date(date.getTime() - 180 * 60_000);
  return shifted.toISOString().slice(11, 19);
}

function mainNav(user: UserRow | null): string {
  const links = ['<a href="/#work">Work</a>', '<a href="/#process">Process</a>', '<a href="/#pricing">Pricing</a>', '<a href="/journal">Journal</a>'];
  links.push(user ? '<a href="/portal">Portal</a>' : '<a href="/sign-in">Sign in</a>');
  return `<nav aria-label="Main">${links.join('')}</nav>`;
}

function shell(options: PageOptions, content: string, extra = ''): string {
  const { title } = options;
  const nav = `<a class="skip" href="#content">Skip to content</a>
<header class="site-header">
  <a class="brand" href="/">Pampero Build Co.</a>
  ${mainNav(options.user ?? null)}
  <button type="button" class="menu-button" data-drawer-open aria-controls="menu-drawer" aria-expanded="false">Menu</button>
</header>
<div id="menu-drawer" class="drawer" data-drawer hidden>
  <div class="drawer-panel" role="dialog" aria-modal="true" aria-label="Menu">
    <nav aria-label="Main">${['<a href="/#work">Work</a>', '<a href="/#process">Process</a>', '<a href="/#pricing">Pricing</a>', '<a href="/journal">Journal</a>', (options.user ? '<a href="/portal">Portal</a>' : '<a href="/sign-in">Sign in</a>')].join('')}</nav>
    <button type="button" data-drawer-close>Close menu</button>
  </div>
</div>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/assets/app.css">
<script defer src="/assets/app.js"></script>
${extra}
</head>
<body class="${options.hideScene ? 'no-scene' : ''}"${options.bodyId ? ` id="${options.bodyId}"` : ''}>
${nav}
<main id="content">
${content}
</main>
<footer class="site-footer">
  <p>Pampero Build Co. · Buenos Aires · <a href="mailto:studio@pampero.build">studio@pampero.build</a></p>
  <p class="clock" aria-live="off"><span id="studio-clock" role="timer" aria-label="Studio time" data-clock="${clockTime(new Date())}">Studio time ${clockTime(new Date())}</span></p>
</footer>
</body>
</html>`;
}

function sendPage(ctx: Ctx, status: number, html: string): void {
  ctx.res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  ctx.res.end(html);
}

export function registerPageRoutes(router: Router): void {
  router.get('/', async (ctx) => {
    let caseStudies: { slug: string; title: string; client: string; year: string; summary: string; publishedAt: string }[] = [];
    let deckOutage = false;
    try {
      caseStudies = (await listEntries('case_study', 'published')).map((e) => ({
        slug: e.slug,
        title: e.title,
        client: e.client,
        year: e.year,
        summary: e.summary,
        publishedAt: e.publishedAt ?? '',
      }));
      caseStudies.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    } catch {
      deckOutage = true;
    }
    const user = ctx.session?.user ?? null;
    const pricesUsd = await planPrices(ctx, 'USD');
    const pricesArs = await planPrices(ctx, 'ARS');
    const priceData = serializePrices({ USD: pricesUsd, ARS: pricesArs });
    const content = `
<section class="hero section" data-section-id="hero">
  <p class="hero-line">Web design and build for businesses that bill in two currencies.</p>
  <p class="hero-pitch">One person, one studio, one honest quote.</p>
</section>
<section class="section work-section" id="work" data-section-id="work">
  <h2>Work</h2>
  ${deckOutage ? '<p class="outage-copy" role="status">Case studies are unavailable right now.</p>' : `<div role="region" aria-label="Work"><ul aria-label="Case studies" class="deck" data-deck>${caseStudies.map((entry) => `<li class="deck-item"><article class="card"><a href="/work/${escapeHtml(entry.slug)}" data-card="${escapeHtml(entry.slug)}">${escapeHtml(entry.title)}</a><p class="card-meta">${escapeHtml(entry.client)} · ${escapeHtml(entry.year)}</p><p class="card-summary">${escapeHtml(entry.summary)}</p></article></li>`).join('\n')}</ul></div>`}
</section>
<section class="section process-section" id="process" data-section-id="process">
  <h2>Process</h2>
  <ol class="process-list">
    <li><strong>Quote</strong> on the server, to the cent.</li>
    <li><strong>Deposit</strong> 40% locks the price.</li>
    <li><strong>Build</strong> with the people who know your brand.</li>
    <li><strong>Launch</strong> on time and settled to the centavo.</li>
  </ol>
</section>
<section class="section pricing-section" id="pricing" data-section-id="pricing" data-pricing>
  <h2>Pricing</h2>
  <fieldset class="currency-picker">
    <legend>Currency</legend>
    <div role="radiogroup" aria-label="Currency" class="radios" data-currency-group>
      <label><input type="radio" name="currency" value="USD" checked> USD</label>
      <label><input type="radio" name="currency" value="ARS"> ARS</label>
    </div>
  </fieldset>
  <div class="plan-cards" data-plans data-prices="${escapeHtml(priceData)}">
    ${planCard(ctx, 'launch-page', 'Launch Page', pricesUsd)}
    ${planCard(ctx, 'studio-site', 'Studio Site', pricesUsd)}
    ${careCard(ctx, pricesUsd)}
  </div>
  <div class="quote-sheet-wrap">
    <div data-quote-sheet data-state="ready" data-crease="40.0" data-tilt="18" aria-live="off">
      <section aria-label="Quote" class="quote-sheet" data-quote-panel>
        <div class="quote-label" data-quote-label>Due now and due at launch</div>
        <div class="quote-crease" data-quote-crease aria-hidden="true"></div>
        <div class="quote-panels" data-quote-panels>
          <div class="quote-panel"><h3>Due now</h3><p class="amount" data-due-now>${escapeHtml(formatMoney(pricesUsd['studio-site']!.dueNow))}</p></div>
          <div class="quote-panel"><h3>Due at launch</h3><p class="amount" data-due-launch>${escapeHtml(formatMoney(pricesUsd['studio-site']!.dueAtLaunch))}</p></div>
        </div>
        <p class="quote-total">Total <span data-quote-total>${escapeHtml(formatMoney(pricesUsd['studio-site']!.total))}</span></p>
      </section>
      <table class="quote-table" data-quote-table aria-label="Quote" hidden>
        <caption class="sr-only">Quote</caption>
        <thead><tr><th scope="col">Due now</th><th scope="col">Due at launch</th></tr></thead>
        <tbody><tr><td data-due-now>${escapeHtml(formatMoney(pricesUsd['studio-site']!.dueNow))}</td><td data-due-launch>${escapeHtml(formatMoney(pricesUsd['studio-site']!.dueAtLaunch))}</td></tr></tbody>
        <tfoot><tr><th scope="row">Total</th><td data-quote-total>${escapeHtml(formatMoney(pricesUsd['studio-site']!.total))}</td></tr></tfoot>
      </table>
    </div>
    <p class="sr-only" role="status" aria-live="polite" id="quote-status" data-quote-status>Due now ${escapeHtml(formatMoney(pricesUsd['studio-site']!.dueNow))}, due at launch ${escapeHtml(formatMoney(pricesUsd['studio-site']!.dueAtLaunch))}, total ${escapeHtml(formatMoney(pricesUsd['studio-site']!.total))}.</p>
  </div>
  <button type="button" class="primary" data-start-checkout>Start checkout</button>
</section>
<section class="section contact-section" id="contact" data-section-id="contact">
  <h2>Contact</h2>
  <p><a href="mailto:studio@pampero.build">studio@pampero.build</a></p>
</section>`;
    sendPage(ctx, 200, shell({ title: 'Pampero Build Co.', user }, content));
  });

  router.get('/work/{slug}', async (ctx) => {
    const { getEntryBySlug } = await import('./cms.js');
    let entry = null;
    try {
      entry = await getEntryBySlug(ctx.params['slug']!);
    } catch {
      sendPage(ctx, 503, notFoundPage("Case studies are unavailable right now."));
      return;
    }
    if (!entry || entry.status !== 'published') {
      sendNotFound(ctx);
      return;
    }
    const content = `<article class="case-study">
  <h1>${escapeHtml(entry.title)}</h1>
  <p class="card-meta">${escapeHtml(entry.client)} · ${escapeHtml(entry.year)}</p>
  <p>${escapeHtml(entry.summary)}</p>
  <div class="entry-body">${escapeHtml(entry.body).replace(/\n/g, '</p><p>')}</div>
  <p><a href="/#work" data-back-to-work>Back to work</a></p>
</article>`;
    sendPage(ctx, 200, shell({ title: entry.title, user: ctx.session?.user ?? null }, content));
  });

  router.get('/journal', async (ctx) => {
    let posts: { slug: string; title: string; summary: string; publishedAt: string }[] = [];
    let outage = false;
    try {
      posts = (await listEntries('journal', 'published')).map((e) => ({ slug: e.slug, title: e.title, summary: e.summary, publishedAt: e.publishedAt ?? '' }));
      posts.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    } catch {
      outage = true;
    }
    const content = `<section class="journal-section">
  <h1>Journal</h1>
  ${outage ? '<p class="outage-copy" role="status">Case studies are unavailable right now.</p>' : `<ul aria-label="Journal posts" class="journal-list">${posts.map((post) => `<li><a href="/journal/${escapeHtml(post.slug)}">${escapeHtml(post.title)}</a><p>${escapeHtml(post.summary)}</p></li>`).join('\n')}</ul>`}
</section>`;
    sendPage(ctx, 200, shell({ title: 'Journal', user: ctx.session?.user ?? null }, content));
  });

  router.get('/journal/{slug}', async (ctx) => {
    const { getEntryBySlug } = await import('./cms.js');
    let entry = null;
    try {
      entry = await getEntryBySlug(ctx.params['slug']!);
    } catch {
      sendPage(ctx, 503, notFoundPage('Case studies are unavailable right now.'));
      return;
    }
    if (!entry || entry.status !== 'published') {
      sendNotFound(ctx);
      return;
    }
    const content = `<article class="journal-post">
  <h1>${escapeHtml(entry.title)}</h1>
  <p>${escapeHtml(entry.summary)}</p>
  <div class="entry-body">${escapeHtml(entry.body).replace(/\n/g, '</p><p>')}</div>
  <p><a href="/journal">Back to journal</a></p>
</article>`;
    sendPage(ctx, 200, shell({ title: entry.title, user: ctx.session?.user ?? null }, content));
  });

  router.get('/sign-in', async (ctx) => {
    const next = ctx.url.searchParams.get('next') ?? '';
    const content = `<section class="auth-section">
  <h1>Sign in</h1>
  <form method="post" action="/sign-in" data-sign-in-form>
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="email" required>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <button type="submit" class="primary">Sign in</button>
    <div role="alert" data-sign-in-error></div>
  </form>
</section>`;
    sendPage(ctx, 200, shell({ title: 'Sign in', user: ctx.session?.user ?? null }, content, `<meta name="next" content="${escapeHtml(next)}">`));
  });

  router.get('/checkout/{orderId}', async (ctx) => {
    const { loadVisibleOrder } = await import('./api-orders.js');
    let order;
    try {
      order = await loadVisibleOrder(ctx, ctx.params['orderId']!);
    } catch {
      sendNotFound(ctx);
      return;
    }
    const user = ctx.session?.user ?? null;
    const currency = order.currency as Currency;
    const total = amountFromMinor(currency, BigInt(order.total_minor));
    const dueNow = amountFromMinor(currency, BigInt(order.due_now_minor));
    const dueAtLaunch = amountFromMinor(currency, BigInt(order.due_at_launch_minor));
    const content = `<section class="checkout-section">
  <h1>Checkout</h1>
  <div class="checkout-grid">
    <div>
      <section aria-label="Order summary" class="order-summary">
        <h2>${escapeHtml(order.planName)}</h2>
        <p>${escapeHtml(order.number)} · ${currency}</p>
        <div data-quote-sheet data-state="ready" data-crease="40.0" data-tilt="18">
          <section aria-label="Quote" class="quote-sheet">
            <div class="quote-crease" aria-hidden="true"></div>
            <div class="quote-panels">
              <div class="quote-panel"><h3>Due now</h3><p class="amount">${escapeHtml(formatMoney(dueNow))}</p></div>
              <div class="quote-panel"><h3>Due at launch</h3><p class="amount">${escapeHtml(formatMoney(dueAtLaunch))}</p></div>
            </div>
            <p class="quote-total">Total <span>${escapeHtml(formatMoney(total))}</span></p>
          </section>
          <table class="quote-table" data-quote-table aria-label="Quote" hidden>
            <thead><tr><th scope="col">Due now</th><th scope="col">Due at launch</th></tr></thead>
            <tbody><tr><td>${escapeHtml(formatMoney(dueNow))}</td><td>${escapeHtml(formatMoney(dueAtLaunch))}</td></tr></tbody>
            <tfoot><tr><th scope="row">Total</th><td>${escapeHtml(formatMoney(total))}</td></tr></tfoot>
          </table>
        </div>
      </section>
    </div>
    <div>
      ${form("Accept quote", "accept", `
        ${user ? '' : `
        <label for="businessName">Business name</label>
        <input id="businessName" name="businessName" autocomplete="organization" required>
        <label for="name">Your name</label>
        <input id="name" name="name" autocomplete="name" required>
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="email" required>
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="new-password" required>`}
        <label class="check"><input type="checkbox" name="acceptTerms" required> I accept the scope and price in this quote</label>
        <button type="submit" class="primary" data-accept-quote>Accept quote</button>
        ${user ? '' : '<p><a href="/sign-in?next=' + encodeURIComponent(ctx.url.pathname) + '">Already a client? Sign in</a></p>'}
        <div role="alert" data-accept-error></div>`)}
      <form aria-label="Payment" data-payment-form ${order.state === 'accepted' || order.state === 'balance_invoiced' ? '' : 'disabled'}>
        <h2>Payment</h2>
        <label for="cardNumber">Card number</label>
        <input id="cardNumber" name="cardNumber" inputmode="numeric" autocomplete="cc-number" required>
        <label for="expiry">Expiry (MM/YY)</label>
        <input id="expiry" name="expiry" autocomplete="cc-exp" required>
        <label for="cvc">CVC</label>
        <input id="cvc" name="cvc" inputmode="numeric" autocomplete="cc-csc" required>
        <button type="submit" class="primary" data-pay data-order="${escapeHtml(order.id)}" data-due="${escapeHtml(formatMoney(order.state === 'balance_invoiced' ? dueAtLaunch : dueNow))}">Pay ${escapeHtml(formatMoney(order.state === 'balance_invoiced' ? dueAtLaunch : dueNow))}</button>
        <div role="alert" data-checkout-banner></div>
      </form>
      <p class="sr-only" role="status" aria-live="polite" data-checkout-status></p>
    </div>
  </div>
</section>`;
    const extra = `<meta name="order-state" content="${escapeHtml(order.state)}">`;
    sendPage(ctx, 200, shell({ title: `Checkout ${order.number}`, user }, content, extra));
  });

  router.get('/orders/{orderId}/receipt', async (ctx) => {
    const { loadVisibleOrder } = await import('./api-orders.js');
    let order;
    try {
      order = await loadVisibleOrder(ctx, ctx.params['orderId']!);
    } catch {
      sendNotFound(ctx);
      return;
    }
    const payments = await listPayments(ctx.db, order.id);
    const latest = payments.at(-1);
    if (!latest) {
      sendNotFound(ctx);
      return;
    }
    const owner = await ctx.db.query("SELECT email FROM users WHERE account_id = $1 AND role = 'client_owner' LIMIT 1", [order.accountId]);
    const ownerEmail = (owner.rows[0] as { email: string } | undefined)?.email ?? '';
    const amount = amountFromMinor(latest.currency as Currency, latest.amountMinor);
    const kindLabel = latest.kind === 'deposit' ? 'Deposit' : latest.kind === 'balance' ? 'Launch balance' : latest.kind === 'care' ? 'Care plan' : 'Renewal';
    const content = `<section class="receipt-section">
  <h1>Payment received</h1>
  <p>${escapeHtml(order.number)}</p>
  <p>${kindLabel}</p>
  <p class="amount">${escapeHtml(formatMoney(amount))}</p>
  <p>${escapeHtml(studioInstant(latest.capturedAt))}</p>
  <p>We'll email your receipt to ${escapeHtml(ownerEmail)}.</p>
  <p><a href="/portal" class="primary">Go to your portal</a></p>
</section>`;
    sendPage(ctx, 200, shell({ title: `Receipt ${order.number}`, user: ctx.session?.user ?? null, hideScene: true }, content));
  });

  router.get('/invite/{token}', async (ctx) => {
    const token = ctx.params['token']!;
    const result = await ctx.db.query('SELECT * FROM invites WHERE token = $1', [token]);
    if ((result.rowCount ?? 0) === 0) {
      sendNotFound(ctx);
      return;
    }
    const invite = result.rows[0] as Record<string, unknown>;
    if (invite.used_at) {
      sendPage(ctx, 409, errorPage(ACCESS_ENDED_HEADING));
      return;
    }
    if (new Date(invite.expires_at as Date) < new Date()) {
      sendNotFound(ctx);
      return;
    }
    const account = await ctx.db.query('SELECT business_name FROM accounts WHERE id = $1', [invite.account_id]);
    const project = await ctx.db.query('SELECT business_name, plan_name FROM projects WHERE id = $1', [invite.project_id]);
    const businessName = (account.rows[0] as { business_name: string }).business_name;
    const projectName = (project.rows[0] as { plan_name: string }).plan_name;
    const content = `<section class="auth-section">
  <h1>Join ${escapeHtml(businessName)}</h1>
  <p>${escapeHtml(projectName)}</p>
  <form data-invite-form data-token="${escapeHtml(token)}">
    <label for="name">Name</label>
    <input id="name" name="name" autocomplete="name" required>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="new-password" required>
    <button type="submit" class="primary">Join</button>
    <div role="alert" data-invite-error></div>
  </form>
</section>`;
    sendPage(ctx, 200, shell({ title: `Join ${businessName}`, user: null }, content));
  });

  router.get('/portal', async (ctx) => await portalOverview(ctx));
  router.get('/portal/projects', async (ctx) => await portalProjects(ctx));
  router.get('/portal/projects/{id}', async (ctx) => await portalProject(ctx));
  router.get('/portal/plan', async (ctx) => await portalPlan(ctx));
  router.get('/portal/invoices', async (ctx) => await portalInvoices(ctx));
  router.get('/studio', async (ctx) => await studioConsole(ctx));
}

function notFoundPage(copy: string): string {
  return `<section class="error-section"><h1>${escapeHtml(NOT_FOUND_HEADING)}</h1><p>${escapeHtml(copy)}</p><p><a href="/">Go home</a></p></section>`;
}

function errorPage(heading: string): string {
  return `<section class="error-section"><h1>${escapeHtml(heading)}</h1><p><a href="/">Go home</a></p></section>`;
}

function form(name: string, action: string, inner: string): string {
  return `<form aria-label="${escapeHtml(name)}" data-form="${escapeHtml(action)}">${inner}</form>`;
}

async function sendNotFound(ctx: Ctx): Promise<void> {
  sendPage(ctx, 404, notFoundPage('The address you followed does not lead anywhere in the ledger.'));
}

function serializePrices(data: Record<string, Record<string, { total: ReturnType<typeof amountFromMinor>; dueNow: ReturnType<typeof amountFromMinor>; dueAtLaunch: ReturnType<typeof amountFromMinor> } | null>>): string {
  const out: Record<string, Record<string, { total: string; dueNow: string; dueAtLaunch: string }>> = {};
  for (const [currency, plans] of Object.entries(data)) {
    out[currency] = {};
    for (const [plan, figures] of Object.entries(plans)) {
      out[currency][plan] = figures
        ? { total: amountToString(figures.total), dueNow: amountToString(figures.dueNow), dueAtLaunch: amountToString(figures.dueAtLaunch) }
        : { total: '0.00', dueNow: '0.00', dueAtLaunch: '0.00' };
    }
  }
  return JSON.stringify(out);
}

async function planPrices(ctx: Ctx, currency: Currency): Promise<Record<string, { total: ReturnType<typeof amountFromMinor>; dueNow: ReturnType<typeof amountFromMinor>; dueAtLaunch: ReturnType<typeof amountFromMinor> } | null>> {
  const out: Record<string, { total: ReturnType<typeof amountFromMinor>; dueNow: ReturnType<typeof amountFromMinor>; dueAtLaunch: ReturnType<typeof amountFromMinor> } | null> = {};
  for (const plan of Object.keys(PLANS) as (keyof typeof PLANS)[]) {
    const row = await priceInEffect(ctx.db, plan, currency, new Date());
    if (!row) {
      out[plan] = null;
      continue;
    }
    out[plan] = quoteFigures(plan, row.amount);
  }
  return out;
}

function planCard(ctx: Ctx, plan: 'launch-page' | 'studio-site', name: string, prices: Record<string, { total: ReturnType<typeof amountFromMinor>; dueNow: ReturnType<typeof amountFromMinor>; dueAtLaunch: ReturnType<typeof amountFromMinor> } | null>): string {
  void ctx;
  const price = prices[plan];
  return `<article class="plan-card" data-plan="${plan}">
  <h3>${name}</h3>
  <p class="plan-price" data-plan-price="${plan}">${price ? escapeHtml(formatMoney(price.total)) : ''}</p>
  <button type="button" data-choose="${plan}" aria-pressed="${plan === 'studio-site'}">Choose ${name}</button>
</article>`;
}

function careCard(ctx: Ctx, prices: Record<string, { total: ReturnType<typeof amountFromMinor>; dueNow: ReturnType<typeof amountFromMinor>; dueAtLaunch: ReturnType<typeof amountFromMinor> } | null>): string {
  void ctx;
  const lite = prices['care-lite'];
  const plus = prices['care-plus'];
  return `<article class="plan-card care-card" data-plan="care">
  <h3>Care</h3>
  <div role="radiogroup" aria-label="Care tier" class="radios" data-tier-group>
    <label><input type="radio" name="tier" value="care-lite" checked> Lite</label>
    <label><input type="radio" name="tier" value="care-plus"> Plus</label>
  </div>
  <p class="plan-price" data-plan-price="care-lite">${lite ? escapeHtml(formatMoney(lite.total)) + ' / month' : ''}</p>
  <p class="plan-price" data-plan-price="care-plus" hidden>${plus ? escapeHtml(formatMoney(plus.total)) + ' / month' : ''}</p>
  <button type="button" data-choose="care" aria-pressed="false">Choose Care</button>
</article>`;
}

function portalShell(title: string, user: UserRow, active: string, content: string): string {
  const links = user.role === 'client_owner'
    ? `<a href="/portal" ${active === 'overview' ? 'aria-current="page"' : ''}>Overview</a>
       <a href="/portal/projects" ${active === 'projects' ? 'aria-current="page"' : ''}>Projects</a>
       <a href="/portal/plan" ${active === 'plan' ? 'aria-current="page"' : ''}>Plan</a>
       <a href="/portal/invoices" ${active === 'invoices' ? 'aria-current="page"' : ''}>Invoices</a>`
    : `<a href="/portal" ${active === 'overview' ? 'aria-current="page"' : ''}>Overview</a>
       <a href="/portal/projects" ${active === 'projects' ? 'aria-current="page"' : ''}>Projects</a>`;
  const nav = `<a class="skip" href="#content">Skip to content</a>
<header class="site-header">
  <a class="brand" href="/">Pampero Build Co.</a>
  <div class="portal-links">
    <nav aria-label="Portal">${links}</nav>
    <button type="button" class="sign-out" data-sign-out>Sign out</button>
  </div>
</header>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/assets/app.css">
<script defer src="/assets/app.js"></script>
</head>
<body class="no-scene portal" data-user-role="${escapeHtml(user.role)}">
${nav}
<main id="content" class="portal-main">
${content}
</main>
<footer class="site-footer">
  <p>Pampero Build Co. · Buenos Aires · <a href="mailto:studio@pampero.build">studio@pampero.build</a></p>
  <p class="clock"><span id="studio-clock" role="timer" aria-label="Studio time" data-clock="${clockTime(new Date())}">Studio time ${clockTime(new Date())}</span></p>
</footer>
</body>
</html>`;
}

async function requirePageUser(ctx: Ctx): Promise<UserRow | null> {
  if (!ctx.session?.user) return null;
  return ctx.session.user;
}

async function portalOverview(ctx: Ctx): Promise<void> {
  const user = await requirePageUser(ctx);
  if (!user) {
    redirectToSignIn(ctx, '/portal');
    return;
  }
  let content = '';
  if (user.role === 'studio_owner') {
    ctx.res.writeHead(302, { Location: '/studio' });
    ctx.res.end();
    return;
  }
  if (user.role === 'client_owner') {
    const orders = await listOrdersByAccount(ctx.db, user.accountId!);
    const projects = await listVisibleProjects(ctx);
    const state = await loadPlanState(ctx.db, user.accountId!).catch(() => null);
    const plan = state ? planView(state) : null;
    content = `<h1>Overview</h1>
<section aria-label="Orders">
<h2>Orders</h2>
<ul class="order-list">
${orders.map((order) => `<li><span>${escapeHtml(order.number)}</span> <span>${escapeHtml(order.planName)}</span> <span>${escapeHtml(order.state.replace(/_/g, ' '))}</span> <span>${escapeHtml(formatMoney(amountFromMinor(order.currency as Currency, BigInt(order.total_minor))))}</span>${order.state === 'balance_invoiced' ? ` <a class="primary" href="/checkout/${escapeHtml(order.id)}" data-pay-balance>Pay launch balance</a>` : ''}</li>`).join('\n')}
</ul>
</section>
<section aria-label="Plan">
<h2>Plan</h2>
${plan ? `<p>${escapeHtml(plan.planName)} · ${escapeHtml(plan.status.replace(/_/g, ' '))} · ${escapeHtml(plan.monthlyPrice)} / month</p><p><a href="/portal/plan">Open plan</a></p>` : '<p>No care plan yet.</p><p><a href="/#pricing">Choose Care</a></p>'}
</section>
<section aria-label="Projects">
<h2>Projects</h2>
<ul class="project-list">
${projects.map((project) => `<li><a href="/portal/projects/${escapeHtml(project.id)}">${escapeHtml(project.businessName)} · ${escapeHtml(project.planName)}</a></li>`).join('\n')}
</ul>
</section>`;
  } else {
    const projects = await listVisibleProjects(ctx);
    content = `<h1>Overview</h1>
<section aria-label="Projects">
<h2>Projects</h2>
<ul class="project-list">
${projects.map((project) => `<li><a href="/portal/projects/${escapeHtml(project.id)}">${escapeHtml(project.businessName)} · ${escapeHtml(project.planName)}</a></li>`).join('\n')}
</ul>
</section>`;
  }
  sendPage(ctx, 200, portalShell('Portal', user, 'overview', content));
}

async function portalProjects(ctx: Ctx): Promise<void> {
  const user = await requirePageUser(ctx);
  if (!user) {
    redirectToSignIn(ctx, '/portal/projects');
    return;
  }
  const projects = await listVisibleProjects(ctx);
  const content = `<h1>Projects</h1>
<section aria-label="Projects">
<ul class="project-list">
${projects.map((project) => `<li><a href="/portal/projects/${escapeHtml(project.id)}">${escapeHtml(project.businessName)} · ${escapeHtml(project.planName)}</a></li>`).join('\n')}
</ul>
</section>`;
  sendPage(ctx, 200, portalShell('Projects', user, 'projects', content));
}

async function portalProject(ctx: Ctx): Promise<void> {
  const user = await requirePageUser(ctx);
  if (!user) {
    redirectToSignIn(ctx, ctx.url.pathname);
    return;
  }
  let project;
  try {
    project = await loadVisibleProject(ctx, ctx.params['id']!);
  } catch (err: unknown) {
    if (err instanceof HttpError && err.code === 'access_ended') {
      sendPage(ctx, 403, `<section class="error-section"><h1>${escapeHtml(ACCESS_ENDED_HEADING)}</h1><p><a href="/">Go home</a></p></section>`);
      return;
    }
    sendNotFound(ctx);
    return;
  }
  const assets = await listProjectFiles(ctx.db, project.row.id, 'asset');
  const deliverables = await listProjectFiles(ctx.db, project.row.id, 'deliverable');
  let contractors: { id: string; name: string }[] = [];
  if (project.access !== 'contractor') {
    const result = await ctx.db.query('SELECT u.id, u.name FROM assignments a JOIN users u ON u.id = a.contractor_id WHERE a.project_id = $1', [project.row.id]);
    contractors = (result.rows as { id: string; name: string }[]).map((r) => ({ id: r.id, name: r.name }));
  }
  const canUploadAsset = user.role === 'client_owner' || user.role === 'teammate';
  const canUploadDeliverable = user.role === 'studio_owner' || user.role === 'contractor';
  const showContractors = user.role === 'client_owner' || user.role === 'studio_owner';
  const fileList = (files: ReturnType<typeof listProjectFiles> extends Promise<infer T> ? T : never, kind: 'asset' | 'deliverable'): string =>
    `<div role="region" aria-label="${kind === 'asset' ? 'Brand assets' : 'Deliverables'}"><ul data-file-list="${kind}">${files.map((file) => `<li><span>${escapeHtml(file.name)}</span> <span>${(file.size / 1024).toFixed(0)} KB</span> <button type="button" data-download="${escapeHtml(file.id)}">Download ${escapeHtml(file.name)}</button></li>`).join('\n')}</ul></div>`;
  content_placeholder: {
    const heading = `${project.row.businessName} · ${project.row.planName}`;
    const content = `<h1>${escapeHtml(heading)}</h1>
<p>${escapeHtml(project.row.orderNumber)} · ${escapeHtml(project.row.state.replace(/_/g, ' '))}${project.row.closedAt ? ' · closed' : ''}</p>
<section aria-label="Brand assets" class="files-section">
<h2>Brand assets</h2>
${fileList(assets, 'asset')}
${canUploadAsset && !project.isClosed ? `<label for="asset-input">Upload brand asset</label><input id="asset-input" type="file" data-upload="asset" data-project="${escapeHtml(project.row.id)}">` : ''}
</section>
<section aria-label="Deliverables" class="files-section">
<h2>Deliverables</h2>
${fileList(deliverables, 'deliverable')}
${canUploadDeliverable && !project.isClosed ? `<label for="deliverable-input">Upload deliverable</label><input id="deliverable-input" type="file" data-upload="deliverable" data-project="${escapeHtml(project.row.id)}">` : ''}
</section>
<p class="allowlist">${escapeHtml(UPLOAD_ALLOWLIST_SENTENCE)}</p>
<p class="sr-only" role="status" aria-live="polite" data-upload-status></p>
${showContractors ? `<section aria-label="Contractors"><h2>Contractors</h2><ul>${contractors.map((c) => `<li>${escapeHtml(c.name)}</li>`).join('\n')}</ul></section>` : ''}
${user.role === 'client_owner' && !project.isClosed ? `<button type="button" data-invite-open>Invite teammate</button>
<div data-invite-dialog class="drawer" hidden>
  <div class="drawer-panel" role="dialog" aria-modal="true" aria-label="Invite teammate">
    <label for="invite-email">Email</label>
    <input id="invite-email" type="email" data-invite-email>
    <button type="button" class="primary" data-invite-send data-project="${escapeHtml(project.row.id)}">Send invite</button>
    <button type="button" data-invite-close>Close</button>
    <p class="sr-only" role="status" aria-live="polite" data-invite-status></p>
  </div>
</div>` : ''}`;
    sendPage(ctx, 200, portalShell(project.row.businessName, user, 'projects', content));
    break content_placeholder;
  }
}

async function portalPlan(ctx: Ctx): Promise<void> {
  const user = await requirePageUser(ctx);
  if (!user || user.role !== 'client_owner') {
    redirectToSignIn(ctx, '/portal/plan');
    return;
  }
  let state: Awaited<ReturnType<typeof loadPlanState>> = null;
  let plan: ReturnType<typeof planView> | null = null;
  let billingOutage = false;
  try {
    state = await loadPlanState(ctx.db, user.accountId!);
    plan = state ? planView(state) : null;
  } catch (err) {
    if (err instanceof HttpError && err.status === 503) {
      billingOutage = true;
    } else {
      throw err;
    }
  }
  if (billingOutage) {
    const content = `<h1>Plan</h1>
<p class="outage-copy" data-plan-outage>Billing is unreachable, so we can't show your plan status right now.</p>`;
    sendPage(ctx, 200, portalShell('Plan', user, 'plan', content));
    return;
  }
  if (state && plan) {
    const status = planStatus(state);
    const tierLabel = plan.tier === 'lite' ? 'Care Lite' : 'Care Plus';
    const otherTier = plan.tier === 'lite' ? 'plus' : 'lite';
    const otherLabel = plan.tier === 'lite' ? 'Care Plus' : 'Care Lite';
    const canChange = status === 'active' && !plan.pauseOn;
    const canPause = status === 'active' && !plan.pauseOn;
    const canResume = status === 'paused' || (status === 'active' && plan.pauseOn !== null);
    const canCancel = status === 'active' && !plan.pauseOn;
    const content = `<h1>Plan</h1>
${status === 'past_due' ? `<div role="alert" class="banner past-due"><p>Your last care-plan payment failed. Update your card to keep your plan.</p></div>` : ''}
${!state || plan === null ? '' : ''}
<p>Status: <span data-plan-status-label>${escapeHtml(statusLabel(plan))}</span></p>
<p>Tier: <span data-plan-tier>${escapeHtml(tierLabel)}</span></p>
<p>Monthly price: <span>${escapeHtml(plan.monthlyPrice)}</span></p>
<p>Period start: <span>${escapeHtml(plan.periodStart ?? '')}</span></p>
<p>Charged through: <span>${escapeHtml(plan.chargedThrough ?? '')}</span></p>
${plan.pauseOn ? `<p>Pauses on ${escapeHtml(plan.pauseOn)}</p>` : ''}
${plan.endsOn ? `<p>Ends on ${escapeHtml(plan.endsOn)}</p>` : ''}
${plan.failedAttempts > 0 ? `<p>Failed attempts: ${plan.failedAttempts}</p>` : ''}
<div class="plan-actions" data-plan-actions>
${canChange ? `<button type="button" data-plan-change="${otherTier}">Switch to ${otherLabel}</button>` : ''}
${canPause ? `<button type="button" data-plan-pause>Pause plan</button>` : ''}
${canResume ? `<button type="button" data-plan-resume>Resume plan</button>` : ''}
${canCancel ? `<button type="button" data-plan-cancel>Cancel plan</button>` : ''}
</div>
${status === 'past_due' ? `<form aria-label="Update card" data-update-card>
<label for="cardNumber">Card number</label><input id="cardNumber" name="cardNumber" required>
<label for="expiry">Expiry (MM/YY)</label><input id="expiry" name="expiry" required>
<label for="cvc">CVC</label><input id="cvc" name="cvc" required>
<button type="submit" class="primary">Update card and pay</button>
</form>` : ''}
<div data-plan-change-dialog class="drawer" hidden>
  <div class="drawer-panel" role="dialog" aria-modal="true" aria-label="Confirm plan change">
    <div data-quote-sheet data-state="quoting" data-crease="0.0" data-tilt="0">
      <section aria-label="Quote" class="quote-sheet">
        <div class="quote-label" data-quote-label>Quoting…</div>
        <div class="quote-crease" aria-hidden="true"></div>
        <div class="quote-panels">
          <div class="quote-panel"><h3>Credit</h3><p class="amount" data-credit></p></div>
          <div class="quote-panel"><h3>New plan charge</h3><p class="amount" data-charge></p></div>
        </div>
        <p class="quote-total">Total <span data-quote-total></span></p>
      </section>
      <table class="quote-table" data-quote-table aria-label="Quote" hidden>
        <thead><tr><th scope="col">Credit</th><th scope="col">New plan charge</th></tr></thead>
        <tbody><tr><td data-credit></td><td data-charge></td></tr></tbody>
        <tfoot><tr><th scope="row">Total</th><td data-quote-total></td></tr></tfoot>
      </table>
    </div>
    <button type="button" class="primary" data-plan-confirm disabled>Confirm change</button>
    <button type="button" data-plan-keep>Keep current plan</button>
  </div>
</div>
<div data-cancel-dialog class="drawer" hidden>
  <div class="drawer-panel" role="dialog" aria-modal="true" aria-label="Cancel care plan">
    <button type="button" class="primary" data-plan-cancel-confirm>Cancel at period end</button>
    <button type="button" data-plan-keep>Keep plan</button>
  </div>
</div>
<p class="sr-only" role="status" aria-live="polite" data-plan-status></p>`;
    sendPage(ctx, 200, portalShell('Plan', user, 'plan', content));
    return;
  }
  const content = `<h1>Plan</h1><p>Your account has no care plan yet. <a href="/#pricing">Choose Care</a> to start one.</p>`;
  sendPage(ctx, 200, portalShell('Plan', user, 'plan', content));
}

function statusLabel(plan: ReturnType<typeof planView>): string {
  switch (plan.status) {
    case 'active': return plan.pauseOn ? `Pauses on ${plan.pauseOn}` : 'Active';
    case 'paused': return 'Paused';
    case 'pending_cancel': return `Ends on ${plan.endsOn}`;
    case 'past_due': return 'Past due';
    case 'cancelled': return 'Cancelled';
  }
}

async function portalInvoices(ctx: Ctx): Promise<void> {
  const user = await requirePageUser(ctx);
  if (!user || user.role !== 'client_owner') {
    redirectToSignIn(ctx, '/portal/invoices');
    return;
  }
  const account = (await import('./auth.js')).getAccount;
  const acct = await account(ctx.db, user.accountId!);
  let rows: Record<string, unknown>[] = [];
  if (acct?.killbillAccountId) {
    try {
      const invoices = await listAccountInvoicesSafe(acct.killbillAccountId);
      const records = await ctx.db.query('SELECT * FROM invoice_records WHERE account_id = $1', [user.accountId]);
      const byId = new Map((records.rows as { invoice_id: string; order_id: string | null; kind: string; pdf_stored_at: Date | null }[]).map((r) => [r.invoice_id, r]));
      rows = invoices.map((invoice) => {
        const record = byId.get(invoice.invoiceId);
        const kind = invoice.items.some((i) => i.itemType === 'REPAIR_ADJ') ? 'change' : (record?.kind ?? 'renewal');
        return invoiceToJson(invoice, kind, record?.order_id ?? null, record?.pdf_stored_at != null);
      });
      rows.sort((a, b) => String(b.number).localeCompare(String(a.number)));
    } catch {
      rows = [];
    }
  }
  const content = `<h1>Invoices</h1>
<table aria-label="Invoices" class="ledger-table">
<thead><tr><th scope="col">Number</th><th scope="col">Date</th><th scope="col">Description</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">PDF</th></tr></thead>
<tbody>
${rows.map((row) => `<tr data-invoice="${escapeHtml(String(row.id))}" data-invoice-status="${escapeHtml(String(row.status))}" data-order-id="${escapeHtml(String(row.orderId ?? ''))}">
<td>${escapeHtml(String(row.number))}</td>
<td>${escapeHtml(String(row.date))}</td>
<td>${escapeHtml(String(row.description))}</td>
<td class="amount">${escapeHtml(String(row.amount))}</td>
<td>${escapeHtml(String(row.status))}</td>
<td>${row.pdf ? `<button type="button" data-invoice-download="${escapeHtml(String(row.id))}">Download invoice ${escapeHtml(String(row.number))}</button>` : `<span class="muted" data-invoice-pending="${escapeHtml(String(row.id))}">PDF pending</span>`}
${row.status === 'open' && row.kind === 'balance' ? `<a class="primary" href="/checkout/${escapeHtml(String(row.orderId))}" data-pay-balance>Pay launch balance</a>` : ''}</td>
</tr>`).join('\n')}
</tbody>
</table>`;
  sendPage(ctx, 200, portalShell('Invoices', user, 'invoices', content));
}

async function studioConsole(ctx: Ctx): Promise<void> {
  const user = await requirePageUser(ctx);
  if (!user || user.role !== 'studio_owner') {
    redirectToSignIn(ctx, '/studio');
    return;
  }
  const { listAllOrders } = await import('./orders.js');
  const { getAccount } = await import('./auth.js');
  const { listEntries } = await import('./cms.js');
  const orders = await listAllOrders(ctx.db);
  const rows = await Promise.all(
    orders.map(async (order) => {
      const account = order.accountId ? await getAccount(ctx.db, order.accountId) : null;
      const payments = await listPayments(ctx.db, order.id);
      let refunded = 0n;
      let paid = 0n;
      for (const payment of payments) {
        paid += payment.amountMinor;
        const { refundedTotal } = await import('./orders.js');
        refunded += await refundedTotal(ctx.db, payment.id);
      }
      const project = order.projectId ? order.projectId : null;
      return { order, businessName: account?.businessName ?? '', paid, refunded, project };
    }),
  );
  let entries: { id: string; kind: string; slug: string; title: string; status: string }[] = [];
  let entriesOutage = false;
  try {
    const caseStudies = await listEntries('case_study');
    const journal = await listEntries('journal');
    entries = [...caseStudies, ...journal].map((e) => ({ id: e.id, kind: e.kind, slug: e.slug, title: e.title, status: e.status }));
  } catch {
    entriesOutage = true;
  }
  const contractors = await ctx.db.query("SELECT id, name FROM users WHERE role = 'contractor' ORDER BY name ASC");
  const contractorRows = contractors.rows as { id: string; name: string }[];
  const content = `<h1>Studio</h1>
<section aria-label="Orders" class="table-frame">
<h2>Orders</h2>
<table aria-label="Orders" class="ledger-table">
<thead><tr><th scope="col">Number</th><th scope="col">Client</th><th scope="col">Plan</th><th scope="col">Currency</th><th scope="col">State</th><th scope="col">Total</th><th scope="col">Paid</th><th scope="col">Refunded</th><th scope="col">Actions</th></tr></thead>
<tbody>
${rows.map((row) => `<tr data-studio-order="${escapeHtml(row.order.id)}" data-state="${escapeHtml(row.order.state)}" data-account-id="${escapeHtml(row.order.accountId ?? '')}" data-project-id="${escapeHtml(row.project ?? '')}">
<td>${escapeHtml(row.order.number)}</td>
<td>${escapeHtml(row.businessName)}</td>
<td>${escapeHtml(row.order.planName)}</td>
<td>${escapeHtml(row.order.currency)}</td>
<td>${escapeHtml(row.order.state.replace(/_/g, ' '))}</td>
<td class="amount">${escapeHtml(formatMoney(amountFromMinor(row.order.currency as Currency, BigInt(row.order.total_minor))))}</td>
<td class="amount">${escapeHtml(formatMoney(amountFromMinor(row.order.currency as Currency, row.paid)))}</td>
<td class="amount">${escapeHtml(formatMoney(amountFromMinor(row.order.currency as Currency, row.refunded)))}</td>
<td class="studio-actions">
${row.order.state === 'deposit_paid' && row.project ? `<button type="button" data-transition="${escapeHtml(row.order.id)}" data-to="in_build">Start build</button>
<label class="sr-only" for="contractor-${escapeHtml(row.order.id)}">Contractor</label>
<select id="contractor-${escapeHtml(row.order.id)}" data-assign-contractor data-project="${escapeHtml(row.project)}">${contractorRows.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}<option value="">Assign contractor…</option></select>` : ''}
${row.order.state === 'in_build' ? `<button type="button" data-transition="${escapeHtml(row.order.id)}" data-to="balance_invoiced">Invoice launch balance</button>` : ''}
${row.order.state === 'paid_in_full' && PLANS[row.order.plan].kind === 'build' ? `<button type="button" data-transition="${escapeHtml(row.order.id)}" data-to="closed">Close project</button>` : ''}
${(row.order.state === 'deposit_paid' || row.order.state === 'paid_in_full' || row.order.state === 'balance_invoiced' || row.order.state === 'in_build') ? `<button type="button" data-refund-open="${escapeHtml(row.order.id)}" data-order-number="${escapeHtml(row.order.number)}" data-currency="${escapeHtml(row.order.currency)}">Refund</button>` : ''}
</td>
</tr>`).join('\n')}
</tbody>
</table>
</section>
<div data-refund-dialog class="drawer" hidden>
  <div class="drawer-panel" role="dialog" aria-modal="true" aria-label="Issue refund">
    <div role="radiogroup" aria-label="Payment" class="radios">
      <label><input type="radio" name="refund-payment" value="deposit" checked> Deposit</label>
      <label><input type="radio" name="refund-payment" value="balance"> Launch balance</label>
    </div>
    <p data-refunded-so-far>Refunded so far —</p>
    <p data-refund-left>Left on this payment —</p>
    <label for="refund-amount">Amount</label><input id="refund-amount" data-refund-amount inputmode="decimal">
    <label for="refund-reason">Reason</label><input id="refund-reason" data-refund-reason>
    <button type="button" class="primary" data-refund-issue>Issue refund</button>
    <button type="button" data-refund-close>Close</button>
    <p class="sr-only" role="status" aria-live="polite" data-refund-status></p>
  </div>
</div>
<section aria-label="Peso prices" class="table-frame">
<h2>Peso prices</h2>
<form aria-label="Peso prices" data-price-form>
<label for="price-plan">Plan</label>
<select id="price-plan" name="plan">${(Object.keys(PLANS) as (keyof typeof PLANS)[]).map((plan) => `<option value="${plan}">${PLANS[plan].name}</option>`).join('')}</select>
<label for="price-amount">Amount (ARS)</label><input id="price-amount" name="amount" inputmode="decimal" required>
<label for="price-effective">Effective from</label><input id="price-effective" name="effectiveAt" type="datetime-local">
<button type="submit" class="primary">Schedule price</button>
</form>
<table aria-label="Price schedule" class="ledger-table">
<thead><tr><th scope="col">Plan</th><th scope="col">Currency</th><th scope="col">Amount</th><th scope="col">Effective from</th></tr></thead>
<tbody data-price-rows></tbody>
</table>
</section>
<section aria-label="Entries" class="table-frame">
<h2>Entries</h2>
${entriesOutage ? '<p class="outage-copy" role="status">Case studies are unavailable right now.</p>' : `<table aria-label="Entries" class="ledger-table">
<thead><tr><th scope="col">Title</th><th scope="col">Kind</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
<tbody>
${entries.map((entry) => `<tr data-entry="${escapeHtml(entry.id)}" data-status="${escapeHtml(entry.status)}"><td>${escapeHtml(entry.title)}</td><td>${escapeHtml(entry.kind)}</td><td>${escapeHtml(entry.status)}</td><td>${entry.status === 'draft' ? `<button type="button" data-entry-publish="${escapeHtml(entry.id)}">Publish</button>` : ''}${entry.status === 'published' ? `<button type="button" data-entry-withdraw="${escapeHtml(entry.id)}">Withdraw</button>` : ''}</td></tr>`).join('\n')}
</tbody>
</table>`}
</section>`;
  const extra = `<script type="application/json" id="studio-data">${JSON.stringify({ accounts: [] }).replace(/</g, '\\u003c')}</script>`;
  sendPage(ctx, 200, studioShell('Studio', user, content, extra));
}

function studioShell(title: string, user: UserRow, content: string, extra: string): string {
  const nav = `<a class="skip" href="#content">Skip to content</a>
<header class="site-header">
  <a class="brand" href="/">Pampero Build Co.</a>
  <div class="portal-links">
    <nav aria-label="Portal"><a href="/studio" aria-current="page">Studio</a></nav>
    <button type="button" class="sign-out" data-sign-out>Sign out</button>
  </div>
</header>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/assets/app.css">
<script defer src="/assets/app.js"></script>
${extra}
</head>
<body class="no-scene studio" data-user-role="${escapeHtml(user.role)}">
${nav}
<main id="content" class="portal-main studio-main">
${content}
</main>
<footer class="site-footer">
  <p>Pampero Build Co. · Buenos Aires · <a href="mailto:studio@pampero.build">studio@pampero.build</a></p>
  <p class="clock"><span id="studio-clock" role="timer" aria-label="Studio time" data-clock="${clockTime(new Date())}">Studio time ${clockTime(new Date())}</span></p>
</footer>
</body>
</html>`;
}

function redirectToSignIn(ctx: Ctx, next: string): void {
  ctx.res.writeHead(302, { Location: `/sign-in?next=${encodeURIComponent(next)}` });
  ctx.res.end();
}
