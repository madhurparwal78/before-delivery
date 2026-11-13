import { escapeHtml } from '../domain/text.js';
import { pageHtml, htmlPageHeaders } from './shell.js';

export type ConsoleRoute =
  | 'sign-in'
  | 'home'
  | 'content/new'
  | 'content'
  | 'rows'
  | 'requisitions'
  | 'requisition'
  | 'application'
  | 'benefits'
  | 'grants'
  | 'audit'
  | 'jobs';

export async function renderConsolePage(
  ctx: import('../http/dispatch.js').RequestCtx,
  route: string,
): Promise<void> {
  const session = ctx.session;
  const { sendHtml } = await import('../http/plumbing.js');
  if (route === 'sign-in') {
    sendHtml(ctx.res, 200, signInHtml(), htmlPageHeaders(ctx.rateHeaders));
    return;
  }
  if (!session) {
    sendHtml(ctx.res, 303, '', { Location: '/console/sign-in' });
    ctx.res.end();
    return;
  }
  const body = consoleShellHtml(route, session.email, session.name, session.grants.map((g) => g.role));
  sendHtml(ctx.res, 200, body, htmlPageHeaders(ctx.rateHeaders));
}

function signInHtml(): string {
  return pageHtml({
    title: 'Sign in — Aldermoor Open Record',
    description: 'Console sign-in for Aldermoor staff.',
    bodyClass: 'console sign-in-page',
    body: `<section class="sign-in card">
      <h1 class="display">Sign in to the console</h1>
      <form class="sign-in-form" id="sign-in-form">
        <div class="field">
          <label for="email">Email</label>
          <input type="email" id="email" name="email" autocomplete="username" required>
          <p class="field-error" hidden></p>
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input type="password" id="password" name="password" autocomplete="current-password" required>
          <p class="field-error" hidden></p>
        </div>
        <button type="submit" class="button">Sign in</button>
      </form>
      <p class="status" id="sign-in-status" role="status" aria-live="polite"></p>
    </section>`,
  });
}

function consoleShellHtml(
  route: string,
  email: string,
  name: string,
  roles: string[],
): string {
  const nav = [
    ['/console', 'Work queue', 'home'],
    ['/console/content/new?kind=model', 'New model route', 'content/new'],
    ['/console/content/new?kind=news', 'New news post', 'content/news'],
    ['/console/rows', 'Benchmark rows', 'rows'],
    ['/console/requisitions', 'Requisitions', 'requisitions'],
    ['/console/benefits', 'Benefits', 'benefits'],
    ['/console/grants', 'Grants', 'grants'],
    ['/console/audit', 'Audit record', 'audit'],
    ['/console/jobs', 'Jobs', 'jobs'],
  ];
  const navHtml = nav
    .map(([href, label, key]) => {
      const active = route === key || (route.startsWith('content/') && key.startsWith('content/') === false && key !== 'content/new') ;
      return `<a class="console-nav-link${active ? ' current' : ''}" href="${href}">${escapeHtml(label)}</a>`;
    })
    .join('\n');
  return pageHtml({
    title: 'Console — Aldermoor Open Record',
    description: 'The governed console of Aldermoor Labs.',
    bodyClass: 'console',
    body: `<header class="console-head">
      <div class="console-head-inner">
        <a class="brand-link" href="/">Open Record</a>
        <p class="console-who">${escapeHtml(name)} · ${roles.map(escapeHtml).join(', ') || 'no active roles'}</p>
        <button type="button" class="button subtle" id="sign-out">Sign out</button>
      </div>
    </header>
    <div class="console-status-banner" id="service-status" role="status" aria-live="polite"></div>
    <p class="status" id="console-status" role="status" aria-live="polite"></p>
    <div class="console-body">
      <nav class="console-nav" aria-label="Console">
        ${navHtml}
      </nav>
      <div class="console-detail" id="console-detail" data-route="${escapeHtml(route)}" data-email="${escapeHtml(email)}">
        <p class="muted">Loading…</p>
      </div>
    </div>`,
  });
}
