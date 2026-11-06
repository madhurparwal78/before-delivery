// The client entry: register every screen, then route.
import { bootRouter, registerScreen, renderRoute, setNotFoundRenderer, navigate } from './router.js';
import { loadSession, stopAllPolling, takeStash } from './state.js';
import { renderPublicHome, renderJurisdictionPage, renderExchangePage, renderNotFound } from './public.js';
import { renderRequestPage, renderSignIn } from './request-signin.js';
import { renderCases } from './screens-cases.js';
import { renderCasePage } from './case-page.js';
import { renderReview, renderMessages, renderMessagePage } from './screens-review.js';
import { renderCounterparties, renderCounterpartyPage, renderImport } from './screens-counterparties.js';
import { renderRules, renderRulePage, renderDailyReport, renderMonths, renderMonthPage } from './screens-rules.js';
import { renderFiles, renderPartnerKeys, renderMembers, renderListing } from './screens-admin.js';

const WS = '(neris|kallang)';
const ID = '[A-Za-z0-9_-]+';

export function boot(): void {
  const root = document.getElementById('root');
  if (root === null) return;
  bootRouter(root);

  registerScreen('sign-in', /^\/sign-in$/, async (el) => {
    await renderSignIn(el);
  });
  registerScreen('public-home', /^\/$/, async (el) => {
    await renderPublicHome(el);
  });
  registerScreen('jurisdiction', /^\/jurisdictions\/(?<code>[A-Z]{2})$/, async (el, ctx) => {
    await renderJurisdictionPage(el, ctx.params.code ?? '');
  });
  registerScreen('exchange', /^\/exchanges\/(?<slug>[a-z0-9-]+)$/, async (el, ctx) => {
    await renderExchangePage(el, ctx.params.slug ?? '');
  });
  registerScreen('request-page', new RegExp(`^\\/r\\/(?<token>${ID})$`), async (el, ctx) => {
    await renderRequestPage(el, ctx.params.token ?? '');
  });
  registerScreen('cases', new RegExp(`^\\/w\\/(?<slug>${WS})\\/cases$`), async (el, ctx) => {
    await guard(el, ctx.params.slug ?? 'neris', renderCases);
  });
  registerScreen('case', new RegExp(`^\\/w\\/(?<slug>${WS})\\/cases\\/(?<id>${ID})$`), async (el, ctx) => {
    await guard(el, ctx.params.slug ?? 'neris', async (el2, slug) => renderCasePage(el2, slug, ctx.params.id ?? ''));
  });
  registerScreen('review', new RegExp(`^\\/w\\/(?<slug>${WS})\\/review$`), async (el, ctx) => {
    await guard(el, ctx.params.slug ?? 'neris', renderReview);
  });
  registerScreen('messages', new RegExp(`^\\/w\\/(?<slug>${WS})\\/messages$`), async (el, ctx) => {
    await guard(el, ctx.params.slug ?? 'neris', renderMessages);
  });
  registerScreen('message', new RegExp(`^\\/w\\/(?<slug>${WS})\\/messages\\/(?<id>${ID})$`), async (el, ctx) => {
    await guard(el, ctx.params.slug ?? 'neris', async (el2, slug) => renderMessagePage(el2, slug, ctx.params.id ?? ''));
  });
  registerScreen('counterparties', new RegExp(`^\\/w\\/(?<slug>${WS})\\/counterparties$`), async (el, ctx) => {
    await guard(el, ctx.params.slug ?? 'neris', renderCounterparties);
  });
  registerScreen('import', new RegExp(`^\\/w\\/(?<slug>${WS})\\/counterparties\\/import$`), async (el, ctx) => {
    await guard(el, ctx.params.slug ?? 'neris', renderImport);
  });
  registerScreen('counterparty', new RegExp(`^\\/w\\/(?<slug>${WS})\\/counterparties\\/(?<id>${ID})$`), async (el, ctx) => {
    await guard(el, ctx.params.slug ?? 'neris', async (el2, slug) => renderCounterpartyPage(el2, slug, ctx.params.id ?? ''));
  });
  registerScreen('rules', new RegExp(`^\\/w\\/(?<slug>${WS})\\/rules$`), async (el, ctx) => {
    await guard(el, ctx.params.slug ?? 'neris', renderRules);
  });
  registerScreen('rule', new RegExp(`^\\/w\\/(?<slug>${WS})\\/rules\\/(?<code>[A-Z]{2})$`), async (el, ctx) => {
    await guard(el, ctx.params.slug ?? 'neris', async (el2, slug) => renderRulePage(el2, slug, ctx.params.code ?? ''));
  });
  registerScreen('daily-report', new RegExp(`^\\/w\\/(?<slug>${WS})\\/reports\\/daily$`), async (el, ctx) => {
    await guard(el, ctx.params.slug ?? 'neris', renderDailyReport);
  });
  registerScreen('months', new RegExp(`^\\/w\\/(?<slug>${WS})\\/months$`), async (el, ctx) => {
    await guard(el, ctx.params.slug ?? 'neris', renderMonths);
  });
  registerScreen('month', new RegExp(`^\\/w\\/(?<slug>${WS})\\/months\\/(?<month>\\d{4}-\\d{2})$`), async (el, ctx) => {
    await guard(el, ctx.params.slug ?? 'neris', async (el2, slug) => renderMonthPage(el2, slug, ctx.params.month ?? ''));
  });
  registerScreen('files', new RegExp(`^\\/w\\/(?<slug>${WS})\\/files$`), async (el, ctx) => {
    await guard(el, ctx.params.slug ?? 'neris', renderFiles);
  });
  registerScreen('partner-keys', new RegExp(`^\\/w\\/(?<slug>${WS})\\/partner-keys$`), async (el, ctx) => {
    await guard(el, ctx.params.slug ?? 'neris', renderPartnerKeys);
  });
  registerScreen('members', new RegExp(`^\\/w\\/(?<slug>${WS})\\/members$`), async (el, ctx) => {
    await guard(el, ctx.params.slug ?? 'neris', renderMembers);
  });
  registerScreen('listing', new RegExp(`^\\/w\\/(?<slug>${WS})\\/listing$`), async (el, ctx) => {
    await guard(el, ctx.params.slug ?? 'neris', renderListing);
  });

  setNotFoundRenderer((el) => {
    renderNotFound(el);
  });

  void begin();
}

async function begin(): Promise<void> {
  const current = location.pathname;
  const isStaffRoute = current.startsWith('/w/');
  if (isStaffRoute || current === '/sign-in') await loadSession();
  if (isStaffRoute) {
    const { getSession, saveStash } = await import('./state.js');
    if (getSession() === null) {
      // a signed-out visit shows /sign-in, then returns after sign-in
      saveStash({ reason: 'session_ended', route: current, dialog: 'none', values: {} });
    }
  }
  await renderRoute();
  void takeStash();
}

async function guard(root: HTMLElement, slug: string, render: (root: HTMLElement, slug: string) => Promise<void>): Promise<void> {
  const { getSession, saveStash } = await import('./state.js');
  if (getSession() === null) {
    saveStash({ reason: 'session_ended', route: location.pathname, dialog: 'none', values: {} });
    navigate('/sign-in', true);
    return;
  }
  stopAllPolling();
  await render(root, slug);
}
