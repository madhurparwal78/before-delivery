import { actorLabel } from './desk.js';
import { getActors, getMe, getToken, request, setToken } from './api.js';
import type { Actor, Position, Role } from './types.js';
import { clearProblem, createEl } from './ui.js';
import { renderPoolColumn, renderPriceRail, renderWallet, refreshWorld, type WorldState } from './world.js';
import {
  renderBorrow, renderLiquidations, renderLedger, renderPosition, renderSettlement,
  renderSteward, renderSupply, renderTrade, reportError,
} from './views.js';

const ROLE_HOME: Record<Role, string> = {
  risk_steward: '/steward',
  liquidity_provider: '/supply',
  trader: '/trade',
  borrower: '/borrow',
  liquidator: '/liquidations',
};

const ROLE_SECTIONS: Record<Role, string[]> = {
  risk_steward: ['/steward', '/ledger', '/liquidations'],
  liquidity_provider: ['/supply', '/trade'],
  trader: ['/trade'],
  borrower: ['/borrow'],
  liquidator: ['/liquidations'],
};

const SECTION_LABELS: Array<[string, string]> = [
  ['/steward', 'Steward'],
  ['/ledger', 'Ledger'],
  ['/liquidations', 'Liquidations'],
  ['/supply', 'Supply'],
  ['/trade', 'Trade'],
  ['/borrow', 'Borrow'],
];

interface ViewContext {
  main: HTMLElement;
  world: () => WorldState | null;
  actor: () => Actor | null;
  cleanup: (fn: () => void) => void;
}

let actor: Actor | null = null;
let world: WorldState | null = null;
const viewCleanup: Array<() => void> = [];

export async function start(): Promise<void> {
  buildShell();
  const params = new URLSearchParams(window.location.search);
  const actorParam = params.get('actor');
  if (actorParam !== null) {
    params.delete('actor');
    const url = `${window.location.pathname}${params.size > 0 ? `?${params.toString()}` : ''}`;
    window.history.replaceState({}, '', url);
    try {
      const actors = await getActors();
      const found = actors.find((item): boolean => item.actor_id === actorParam);
      if (found !== undefined) {
        await selectActor(found, false);
        return;
      }
    } catch {
      // fall through to the stored session
    }
  }
  const token = getToken();
  if (token !== null) {
    try {
      actor = await getMe();
      rebuildNav();
      await renderCurrentView();
      return;
    } catch {
      setToken(null);
    }
  }
  actor = null;
  rebuildNav();
  await renderCurrentView();
}

async function selectActor(next: Actor, navigate = true): Promise<void> {
  try {
    const session = await request<{ token: string }>('POST', '/api/sessions', { actor_id: next.actor_id });
    setToken(session.data.token);
    actor = next;
    rebuildNav();
    if (navigate && window.location.pathname !== ROLE_HOME[next.role]) {
      window.history.pushState({}, '', ROLE_HOME[next.role]);
    }
    await renderCurrentView();
  } catch (err) {
    reportError(err);
  }
}

function buildShell(): void {
  const app = document.getElementById('app');
  if (app === null) return;
  app.replaceChildren();
  const topbar = createEl('header', '', 'topbar');
  const brand = createEl('span', '', 'brand');
  brand.textContent = 'Quillmoor Reserve';
  topbar.append(brand);
  const nav = createEl('nav', 'Sections', '');
  topbar.append(nav);
  const actorBox = createEl('div', '', 'actor');
  const label = createEl('label', '', '');
  label.textContent = 'Acting as';
  label.setAttribute('for', 'acting-as');
  const select = document.createElement('select');
  select.id = 'acting-as';
  select.setAttribute('aria-label', 'Acting as');
  actorBox.append(label, select);
  topbar.append(actorBox);
  app.append(topbar);

  const zones = createEl('div', '', 'zones');
  const poolColumn = createEl('aside', '', 'poolcol');
  poolColumn.id = 'pool-column';
  const main = createEl('main', '', 'worksheet');
  main.id = 'worksheet';
  const priceRail = createEl('aside', '', 'pricerail');
  priceRail.id = 'price-rail';
  priceRail.setAttribute('role', 'complementary');
  priceRail.setAttribute('aria-label', 'Posted prices');
  zones.append(poolColumn, main, priceRail);
  app.append(zones);

  const announcements = createEl('div', 'Announcements', 'status-role');
  announcements.id = 'announcements';
  announcements.setAttribute('role', 'status');
  app.append(announcements);
  const problems = createEl('div', 'Problems', 'alert');
  problems.id = 'problems';
  problems.setAttribute('role', 'alert');
  app.append(problems);

  void getActors().then((actors): void => {
    const selector = document.getElementById('acting-as');
    if (selector === null) return;
    selector.replaceChildren();
    for (const item of actors) {
      const option = document.createElement('option');
      option.value = item.actor_id;
      option.textContent = actorLabel(item.name, item.role);
      selector.append(option);
    }
    if (actor !== null) (selector as HTMLSelectElement).value = actor.actor_id;
  }).catch((): void => undefined);

  select.addEventListener('change', async (): Promise<void> => {
    const chosen = (select as HTMLSelectElement).value;
    const actors = await getActors().catch((): Actor[] => []);
    const found = actors.find((item): boolean => item.actor_id === chosen);
    if (found !== undefined) await selectActor(found);
  });

  window.addEventListener('popstate', (): void => {
    void renderCurrentView();
  });
}

function rebuildNav(): void {
  const nav = document.querySelector('nav[aria-label="Sections"]');
  if (nav === null) return;
  nav.replaceChildren();
  const sections = actor === null ? [] : ROLE_SECTIONS[actor.role];
  for (const [path, text] of SECTION_LABELS) {
    if (!sections.includes(path)) continue;
    const link = document.createElement('a');
    link.href = path;
    link.textContent = text;
    if (path === '/liquidations') {
      const badge = createEl('span', '', 'badge');
      badge.textContent = '0';
      badge.id = 'queue-badge';
      link.append(badge);
    }
    link.addEventListener('click', (event): void => {
      event.preventDefault();
      window.history.pushState({}, '', path);
      void renderCurrentView();
    });
    nav.append(link);
  }
}

async function renderCurrentView(): Promise<void> {
  for (const cleanup of viewCleanup.splice(0)) cleanup();
  const main = document.getElementById('worksheet');
  if (main === null) return;
  const path = window.location.pathname;
  clearProblem();
  try {
    world = await refreshWorld((fresh): void => {
      renderPoolColumn(document.getElementById('pool-column') ?? main, fresh);
      renderPriceRail(document.getElementById('price-rail') ?? main, fresh);
      const walletEl = document.getElementById('wallet-region');
      if (walletEl !== null) renderWallet(walletEl, fresh);
      updateQueueBadge();
    }, { needWallet: actor !== null });
  } catch (err) {
    reportError(err);
    return;
  }
  const ctx: ViewContext = {
    main,
    world: (): WorldState | null => world,
    actor: (): Actor | null => actor,
    cleanup: (fn: () => void): void => {
      viewCleanup.push(fn);
    },
  };
  if (actor === null) {
    renderNotSignedIn(main);
    return;
  }
  if (path === '/' || path === '') {
    window.history.replaceState({}, '', ROLE_HOME[actor.role]);
    await renderView(ctx, ROLE_HOME[actor.role]);
    return;
  }
  if (!isAllowed(path)) {
    renderNotFound(main);
    return;
  }
  await renderView(ctx, path);
}

function isAllowed(path: string): boolean {
  if (actor === null) return false;
  const sections = ROLE_SECTIONS[actor.role];
  if (sections.includes(path)) return true;
  return path.startsWith('/positions/') || path.startsWith('/settlements/');
}

async function renderView(ctx: ViewContext, path: string): Promise<void> {
  const main = ctx.main;
  main.replaceChildren();
  const wallet = createEl('section', 'Wallet', 'wallet');
  wallet.id = 'wallet-region';
  wallet.setAttribute('role', 'region');
  main.append(wallet);
  if (world !== null) renderWallet(wallet, world);
  const viewRoot = createEl('div', '', 'viewroot');
  viewRoot.id = 'view-root';
  main.append(viewRoot);
  const viewContext: ViewContext = { ...ctx, main: viewRoot };
  if (path.startsWith('/positions/')) {
    await renderPosition(viewContext, path.slice('/positions/'.length));
  } else if (path.startsWith('/settlements/')) {
    await renderSettlement(viewContext, path.slice('/settlements/'.length));
  } else if (path === '/trade') {
    await renderTrade(viewContext);
  } else if (path === '/borrow') {
    await renderBorrow(viewContext);
  } else if (path === '/supply') {
    await renderSupply(viewContext);
  } else if (path === '/liquidations') {
    await renderLiquidations(viewContext);
  } else if (path === '/steward') {
    await renderSteward(viewContext);
  } else if (path === '/ledger') {
    await renderLedger(viewContext);
  } else {
    viewRoot.replaceChildren();
    renderNotFound(viewRoot);
    return;
  }
  startWorldRefresh();
}

function renderNotSignedIn(main: HTMLElement): void {
  main.replaceChildren();
  const heading = document.createElement('h1');
  heading.textContent = 'Choose who you are acting as';
  main.append(heading);
  const paragraph = document.createElement('p');
  paragraph.textContent = 'Pick a member from the Acting as chooser to open a session.';
  main.append(paragraph);
}

function renderNotFound(main: HTMLElement): void {
  const heading = document.createElement('h1');
  heading.textContent = 'We couldn\u2019t find that page.';
  main.append(heading);
  const link = document.createElement('a');
  link.href = '/';
  link.textContent = 'Back to the home view';
  main.append(link);
}

function updateQueueBadge(): void {
  const badge = document.getElementById('queue-badge');
  if (badge === null) return;
  void request<{ positions: Position[] }>('GET', '/api/liquidations/queue').then((result): void => {
    const count = result.data.positions.length;
    badge.textContent = count.toString();
    badge.classList.toggle('nonzero', count > 0);
  }).catch((): void => undefined);
}

function startWorldRefresh(): void {
  const timer = setInterval((): void => {
    if (actor === null) return;
    void refreshWorld((fresh): void => {
      world = fresh;
      renderPoolColumn(document.getElementById('pool-column') ?? document.body, fresh);
      renderPriceRail(document.getElementById('price-rail') ?? document.body, fresh);
      const walletEl = document.getElementById('wallet-region');
      if (walletEl !== null) renderWallet(walletEl, fresh);
      updateQueueBadge();
    }, { needWallet: true }).catch((): void => undefined);
  }, 5_000);
  viewCleanup.push((): void => clearInterval(timer));
}
