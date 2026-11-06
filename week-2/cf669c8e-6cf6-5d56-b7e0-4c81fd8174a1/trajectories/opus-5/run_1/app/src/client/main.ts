/**
 * The shell: the router, the header, the outage banner and the sign-in dialog
 * a session ending mid-task raises.
 *
 * Reloading or opening any published address shows the same screen, because
 * every screen is rendered from the address and the server's answers.
 */

import { api } from './api.js';
import { MOTION, el, prefersReducedMotion, snapCounting } from './dom.js';
import { startStatusPolling, store, type SessionEndedRequest } from './state.js';
import { Panel } from './ui/dialog.js';
import { DRAWER_BREAKPOINT, Header } from './ui/header.js';
import { accountPage } from './pages/account.js';
import { bikePage, bikesPage } from './pages/bikes.js';
import { configurePage } from './pages/configure.js';
import { deskOrderPage, deskPage } from './pages/desk.js';
import { notFoundPage } from './pages/notFound.js';
import { orderPage, ordersPage } from './pages/orders.js';
import { ridePage, ridesPage } from './pages/rides.js';
import { storyPage } from './pages/story.js';

export interface Page {
  mount(container: HTMLElement): void | Promise<void>;
  unmount?(): void;
}

export interface PageContext {
  params: Record<string, string>;
  navigate: (href: string, options?: { replace?: boolean; silent?: boolean }) => void;
  header: Header;
}

export type PageFactory = (context: PageContext) => Page;

interface Route {
  pattern: RegExp;
  keys: string[];
  factory: PageFactory;
}

function route(path: string, factory: PageFactory): Route {
  const keys: string[] = [];
  const pattern = new RegExp(
    `^${path.replace(/:[A-Za-z]+/g, (match) => {
      keys.push(match.slice(1));
      return '([^/]+)';
    })}$`,
  );
  return { pattern, keys, factory };
}

const ROUTES: Route[] = [
  route('/', storyPage),
  route('/configure', configurePage),
  route('/bikes', bikesPage),
  route('/bikes/:id', bikePage),
  route('/rides', ridesPage),
  route('/rides/:id', ridePage),
  route('/orders', ordersPage),
  route('/orders/:id', orderPage),
  route('/sign-in', accountPage),
  route('/register', accountPage),
  route('/desk', deskPage),
  route('/desk/orders/:id', deskOrderPage),
];

const shell = document.getElementById('shell');
if (!shell) throw new Error('the shell container is missing');

const header = new Header((href) => navigate(href));
const main = el('main', { id: 'main', class: 'main', tabindex: -1 });
const sessionDialog = new Panel({ name: 'Sign in again', variant: 'dialog' });

shell.append(header.element, header.banner, main, sessionDialog.root);

let current: Page | null = null;

function matchRoute(pathname: string): { factory: PageFactory; params: Record<string, string> } {
  for (const candidate of ROUTES) {
    const found = candidate.pattern.exec(pathname);
    if (!found) continue;
    const params: Record<string, string> = {};
    candidate.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(found[index + 1] ?? '');
    });
    return { factory: candidate.factory, params };
  }
  return { factory: notFoundPage, params: {} };
}

/**
 * Move to an address.
 *
 * `silent` updates the address without re-rendering, which is how a screen
 * that holds its configuration in the address records a change: it adds a
 * history entry and updates its own figures in place. Back and forward still
 * re-render, so they restore the earlier configuration.
 */
export function navigate(
  href: string,
  options: { replace?: boolean; silent?: boolean } = {},
): void {
  const url = new URL(href, window.location.origin);
  const same = url.pathname === window.location.pathname && url.search === window.location.search;
  if (!same) {
    if (options.replace) window.history.replaceState({}, '', url);
    else window.history.pushState({}, '', url);
  }
  if (options.silent) return;
  void render();
}

async function render(): Promise<void> {
  current?.unmount?.();
  current = null;

  // A route change takes the published duration, as a cross-fade.
  main.dataset.routeState = 'leaving';
  const { factory, params } = matchRoute(window.location.pathname);

  while (main.firstChild) main.firstChild.remove();
  const page = factory({ params, navigate, header });
  current = page;
  await page.mount(main);

  main.dataset.routeState = 'entered';
  header.update();
}

window.addEventListener('popstate', () => void render());

/** Crossing 768 px closes an open drawer or sheet and leaves no scroll lock. */
let wasNarrow = window.innerWidth < DRAWER_BREAKPOINT;
window.addEventListener('resize', () => {
  const narrow = window.innerWidth < DRAWER_BREAKPOINT;
  if (narrow !== wasNarrow) {
    wasNarrow = narrow;
    header.handleBreakpointCross();
    window.dispatchEvent(new CustomEvent('breakpoint-cross'));
  }
});

/**
 * A session ending mid-task opens this dialog over the page, with the address
 * unchanged and every typed value kept. A money action is never re-sent
 * automatically.
 */
store.onSessionEnded((request: SessionEndedRequest) => {
  if (sessionDialog.isOpen) return;
  openSessionDialog(request);
});

function openSessionDialog(request: SessionEndedRequest): void {
  while (sessionDialog.content.firstChild) sessionDialog.content.firstChild.remove();

  const email = el('input', {
    type: 'email',
    id: 'session-email',
    value: store.user?.email ?? '',
    readonly: true,
    'aria-label': 'Email',
  });
  const password = el('input', { type: 'password', id: 'session-password', 'aria-label': 'Password' });
  const message = el('p', { class: 'dialog-message' }, ['Your session ended. Sign in to carry on.']);
  const failure = el('p', { class: 'field-error', hidden: true });
  const submit = el('button', { type: 'submit', class: 'primary' }, ['Sign in']);

  const form = el('form', { class: 'stack' }, [
    message,
    failure,
    el('label', { for: 'session-email' }, ['Email']),
    email,
    el('label', { for: 'session-password' }, ['Password']),
    password,
    submit,
  ]);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void api
      .signIn(email.value, password.value)
      .then(async (user) => {
        store.user = user;
        sessionDialog.close();
        // Signing in through the dialog does not navigate.
        header.update();
        request.opener?.focus();
        if (request.retryAutomatically) request.retry?.();
      })
      .catch(() => {
        failure.hidden = false;
        failure.textContent = 'Email or password is wrong.';
      });
  });

  sessionDialog.content.append(form);
  sessionDialog.open(request.opener);
}

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (sessionDialog.isOpen) sessionDialog.close();
});

/** Turning reduced motion on snaps any running motion to its end. */
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => {
  if (prefersReducedMotion()) snapCounting(document);
});

async function boot(): Promise<void> {
  await store.loadUser();
  startStatusPolling(() => header.update());
  await render();
}

void boot();

export { header, MOTION };
