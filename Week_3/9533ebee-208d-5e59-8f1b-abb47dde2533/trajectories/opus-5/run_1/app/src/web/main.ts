/**
 * The app. One page, one origin, no cookies: choosing a member opens a bearer
 * session, and every view renders the server's own values.
 */

import { NOT_FOUND_HEADING } from '../domain/copy.ts';
import { request, lastActorId, rememberToken, storedToken } from './api.ts';
import { clear, el } from './dom.ts';
import { LiveRegions } from './parts/live.ts';
import { PoolColumn, PriceRail, ROLE_HOME, TopBar, WalletRegion } from './parts/shell.ts';
import { store, REFRESH_MS } from './store.ts';
import type { MemberDto } from './types.ts';
import { borrowView } from './views/borrow.ts';
import { ledgerView, readFilter, type LedgerFilter } from './views/ledger.ts';
import { liquidationsView } from './views/liquidations.ts';
import { positionView } from './views/position.ts';
import { receiptView } from './views/receipt.ts';
import { stewardView } from './views/steward.ts';
import { supplyView } from './views/supply.ts';
import { tradeView } from './views/trade.ts';
import type { View } from './views/view.ts';

const live = new LiveRegions();
const topBar = new TopBar((actorId) => void chooseMember(actorId));
const poolColumn = new PoolColumn();
const priceRail = new PriceRail();
const wallet = new WalletRegion();

const worksheet = el('main', { class: 'worksheet' }, [wallet.element]);
const viewHost = el('div', { class: 'view-host' });
worksheet.append(live.announcements, live.problems, viewHost);

const layout = el('div', { class: 'sheet' }, [
  priceRail.element,
  poolColumn.element,
  worksheet,
]);

const root = document.getElementById('app');
if (root !== null) {
  root.append(topBar.element, layout);
}

let current: View | null = null;
let currentPath = '';

function push(path: string): void {
  window.history.pushState({}, '', path);
}

function replace(path: string): void {
  window.history.replaceState({}, '', path);
}

/** A view with the Ledger's own URL hook, when it has one. */
type LedgerAwareView = View & {
  applyUrl?: (filter: LedgerFilter, needsReplace: boolean) => void;
};

function mount(view: View): void {
  current?.navigateAway();
  current = view;
  clear(viewHost);
  viewHost.append(view.element);
}

function render(path: string, search: URLSearchParams): void {
  currentPath = path;
  topBar.update(path);

  if (store.member === null) {
    mount(chooseMemberView());
    return;
  }

  if (path === '/') {
    const home = ROLE_HOME[store.member.role];
    replace(home);
    render(home, new URLSearchParams());
    return;
  }

  const position = /^\/positions\/([^/]+)$/.exec(path);
  if (position !== null && position[1] !== undefined) {
    mount(positionView(position[1], live, navigate));
    return;
  }
  const settlement = /^\/settlements\/([^/]+)$/.exec(path);
  if (settlement !== null && settlement[1] !== undefined) {
    mount(receiptView(settlement[1], live, navigate));
    return;
  }

  switch (path) {
    case '/trade':
      mount(tradeView(live, navigate));
      return;
    case '/borrow':
      mount(borrowView(live, navigate));
      return;
    case '/supply':
      mount(supplyView(live, navigate));
      return;
    case '/liquidations':
      mount(liquidationsView(live, navigate));
      return;
    case '/steward':
      mount(stewardView(live, navigate, () => current?.onPost()));
      return;
    case '/ledger': {
      const read = readFilter(search);
      const view = ledgerView(read.filter, live, navigate, push, replace);
      mount(view);
      // An unknown value is rewritten with a replace, never a push.
      if (read.corrected) replace(filterPath(read.filter));
      return;
    }
    default:
      mount(notFoundView());
  }
}

function filterPath(filter: LedgerFilter): string {
  const parts: string[] = [];
  if (filter.asset !== null) parts.push(`asset=${filter.asset}`);
  if (filter.limit !== '50') parts.push(`limit=${filter.limit}`);
  if (filter.from !== null) parts.push(`from=${filter.from}`);
  if (filter.to !== null) parts.push(`to=${filter.to}`);
  return parts.length === 0 ? '/ledger' : `/ledger?${parts.join('&')}`;
}

function notFoundView(): View {
  return {
    element: el('section', { class: 'worksheet-body' }, [
      el('h1', { class: 'view-head', text: NOT_FOUND_HEADING }),
      el('a', { href: '/', 'data-route': 'true', text: 'Back to Quillmoor Reserve' }),
    ]),
    update: () => undefined,
    navigateAway: () => undefined,
    onPost: () => undefined,
    navigate,
  };
}

function chooseMemberView(): View {
  const list = el('ul', { class: 'member-list' });
  for (const actor of store.actors) {
    const link = el('button', { type: 'button', class: 'action', text: actor.name });
    link.addEventListener('click', () => void chooseMember(actor.actor_id));
    list.append(el('li', {}, [link]));
  }
  return {
    element: el('section', { class: 'worksheet-body' }, [
      el('h1', { class: 'view-head', text: 'Choose who you are acting as' }),
      list,
    ]),
    update: () => undefined,
    navigateAway: () => undefined,
    onPost: () => undefined,
    navigate,
  };
}

function navigate(path: string): void {
  push(path);
  const url = new URL(path, window.location.origin);
  render(url.pathname, url.searchParams);
}

/**
 * Opens a session for a member, keeps the token for later visits and reloads
 * the data without a full page reload. Choosing a member moves to that role's
 * home view; restoring a remembered session on load keeps the path asked for,
 * so a reload stays where it was.
 */
async function chooseMember(actorId: string, goHome = true): Promise<void> {
  const existing = storedToken(actorId);
  let token = existing;
  if (token === null) {
    const reply = await request<{ token: string }>('POST', '/api/sessions', {
      body: { actor_id: actorId },
    });
    token = reply.token;
  }
  rememberToken(actorId, token);
  store.token = token;
  try {
    store.member = await request<MemberDto>('GET', '/api/me', { token });
  } catch {
    // The stored token is no longer known, so a fresh session is opened.
    const reply = await request<{ token: string }>('POST', '/api/sessions', {
      body: { actor_id: actorId },
    });
    rememberToken(actorId, reply.token);
    store.token = reply.token;
    store.member = await request<MemberDto>('GET', '/api/me', { token: reply.token });
  }
  live.clearProblems();
  live.announce('');
  await store.refresh();
  if (!goHome) return;
  const home = ROLE_HOME[store.member.role];
  push(home);
  render(home, new URLSearchParams());
}

// Clicks on in-app links are routed without a page load.
document.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>(
    'a[data-route]',
  );
  if (target === null || target === undefined) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
  event.preventDefault();
  navigate(target.getAttribute('href') ?? '/');
});

window.addEventListener('popstate', () => {
  const url = new URL(window.location.href);
  // Back and Forward restore the Ledger controls in place.
  if (url.pathname === '/ledger' && currentPath === '/ledger' && current !== null) {
    const view = current as LedgerAwareView;
    if (view.applyUrl !== undefined) {
      const read = readFilter(url.searchParams);
      view.applyUrl(read.filter, read.corrected);
      return;
    }
  }
  render(url.pathname, url.searchParams);
});

store.subscribe(() => {
  poolColumn.update();
  priceRail.update();
  wallet.update();
  topBar.update(currentPath);
  current?.update();
});

async function boot(): Promise<void> {
  await store.loadActors();
  const url = new URL(window.location.href);
  const asked = url.searchParams.get('actor');
  const actorId = asked ?? lastActorId();

  if (actorId !== null && store.actors.some((actor) => actor.actor_id === actorId)) {
    // `?actor=` moves to that role's home; a remembered session keeps the path.
    await chooseMember(actorId, asked !== null);
    if (asked !== null) {
      // The parameter is removed from the URL with a history replace.
      url.searchParams.delete('actor');
      const home = ROLE_HOME[store.member?.role ?? 'risk_steward'];
      replace(home);
      render(home, new URLSearchParams());
    } else {
      render(url.pathname, url.searchParams);
    }
  } else {
    render(url.pathname, url.searchParams);
  }

  store.startPolling();
  // Each view also refetches its own data on the same schedule.
  window.setInterval(() => current?.update(), REFRESH_MS);
}

void boot().catch((error: unknown) => {
  live.report(error);
});
