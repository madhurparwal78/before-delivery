import { copy } from './copy.js';
import { clear, el } from './dom.js';
import { icon } from './icons.js';
import { type Route } from './router.js';
import { isOwner, subscribe } from './store.js';

export type ModuleId = 'issues' | 'cycle' | 'chat' | 'docs' | 'office' | 'settings' | 'account';

export type ModuleContext = {
  list: HTMLElement;
  detail: HTMLElement;
  openDetail: (returnFocus: HTMLElement | null) => void;
  showList: () => void;
  announce: (text: string) => void;
};

export type ModuleHandle = {
  id: ModuleId;
  firstPane: 'list' | 'detail';
  route: (route: Route) => void;
  destroy: () => void;
};

export type ModuleFactory = (context: ModuleContext) => ModuleHandle;

const root = document.getElementById('app') as HTMLElement;

let notices: HTMLElement;
let announcements: HTMLElement;
let navigation: HTMLElement;
let listPane: HTMLElement;
let detailPane: HTMLElement;
let backButton: HTMLButtonElement;
let shellBuilt = false;
let current: ModuleHandle | null = null;
let pane: 'list' | 'detail' = 'list';
let returnFocus: HTMLElement | null = null;
let returnFocusKey: string | null = null;

const moduleLinks: { id: ModuleId; label: string; href: string; glyph: string }[] = [
  { id: 'issues', label: 'Issues', href: '/issues', glyph: 'issues' },
  { id: 'cycle', label: 'Cycle', href: '/cycle', glyph: 'cycle' },
  { id: 'chat', label: 'Chat', href: '/chat/inbox', glyph: 'chat' },
  { id: 'docs', label: 'Docs', href: '/docs', glyph: 'docs' },
  { id: 'office', label: 'Office', href: '/office', glyph: 'office' },
  { id: 'settings', label: 'Settings', href: '/settings', glyph: 'settings' },
];

export function announce(text: string): void {
  if (!shellBuilt) return;
  announcements.textContent = '';
  window.setTimeout(() => {
    announcements.textContent = text;
  }, 20);
}

export function noticesRegion(): HTMLElement {
  return notices;
}

export function buildShell(): void {
  if (shellBuilt) {
    renderNav();
    return;
  }
  clear(root);
  notices = el('div', { id: 'service-notices', class: 'notices', role: 'region', 'aria-label': 'Service notices' });
  announcements = el('div', { class: 'announcements', role: 'status', 'aria-live': 'polite', 'aria-label': 'Announcements' });
  navigation = el('nav', { class: 'rail', 'aria-label': 'Modules', 'aria-orientation': 'vertical' });
  listPane = el('section', { class: 'pane list', role: 'region', 'aria-label': 'List' });
  detailPane = el('section', { class: 'pane detail', role: 'region', 'aria-label': 'Detail' });
  backButton = el('button', { type: 'button', class: 'back', text: 'Back' });
  backButton.addEventListener('click', () => {
    showList();
    const row =
      returnFocus !== null && document.contains(returnFocus)
        ? returnFocus
        : returnFocusKey === null
          ? null
          : listPane.querySelector<HTMLElement>(`[data-key="${returnFocusKey}"]`);
    row?.focus();
  });

  const frame = el('div', { class: 'frame' }, [navigation, listPane, detailPane]);
  root.append(notices, announcements, frame);
  shellBuilt = true;
  renderNav();
  subscribe((keys) => {
    if (keys.has('person') || keys.has('workspace') || keys.has('unread')) renderNav();
  });
  window.addEventListener('resize', applyPanes);
}

export function shellIsBuilt(): boolean {
  return shellBuilt;
}

export function teardownShell(): void {
  current?.destroy();
  current = null;
  shellBuilt = false;
  clear(root);
}

function renderNav(): void {
  if (!shellBuilt) return;
  clear(navigation);
  const links = moduleLinks.filter((link) => link.id !== 'settings' || isOwner());
  for (const link of links) {
    const anchor = el('a', { href: link.href, class: 'module-link' }, [
      icon(link.glyph),
      el('span', { class: 'module-label', text: link.label }),
    ]);
    if (current?.id === link.id) anchor.setAttribute('aria-current', 'page');
    navigation.append(anchor);
  }
  if (!isOwner()) {
    const account = el('a', { href: '/account', class: 'module-link' }, [
      icon('account'),
      el('span', { class: 'module-label', text: 'Account' }),
    ]);
    if (current?.id === 'account') account.setAttribute('aria-current', 'page');
    navigation.append(account);
  }
  const signOut = el('button', { type: 'button', class: 'module-link sign-out' }, [
    icon('signout'),
    el('span', { class: 'module-label', text: 'Sign out' }),
  ]);
  signOut.addEventListener('click', () => {
    void signOutNow();
  });
  navigation.append(signOut);
}

let signOutHandler: () => Promise<void> = async () => undefined;

export function setSignOutHandler(handler: () => Promise<void>): void {
  signOutHandler = handler;
}

async function signOutNow(): Promise<void> {
  await signOutHandler();
}

export function mountModule(id: ModuleId, factory: ModuleFactory, route: Route): void {
  buildShell();
  if (current?.id === id) {
    current.route(route);
    renderNav();
    return;
  }
  current?.destroy();
  clear(listPane);
  clear(detailPane);
  const context: ModuleContext = {
    list: listPane,
    detail: detailPane,
    openDetail,
    showList,
    announce,
  };
  current = factory(context);
  pane = current.firstPane;
  renderNav();
  applyPanes();
  current.route(route);
}

function openDetail(focusReturn: HTMLElement | null): void {
  if (focusReturn !== null) {
    returnFocus = focusReturn;
    returnFocusKey = focusReturn.dataset.key ?? null;
  }
  pane = 'detail';
  applyPanes();
  focusDetailTitle();
}

/**
 * Opening an item on a phone moves focus to the detail sheet's title, after the
 * hidden pane has given its own focus up.
 */
export function focusDetailTitle(): void {
  if (!shellBuilt || !narrow() || pane !== 'detail') return;
  const focusTitle = (): void => {
    if (!narrow() || pane !== 'detail') return;
    const title = detailPane.querySelector<HTMLElement>('[data-detail-title]');
    if (title === null) return;
    title.setAttribute('tabindex', '-1');
    title.focus();
  };
  focusTitle();
  window.setTimeout(focusTitle, 0);
}

function showList(): void {
  pane = 'list';
  applyPanes();
}

export function narrow(): boolean {
  return window.innerWidth < 768;
}

export function applyPanes(): void {
  if (!shellBuilt) return;
  const isNarrow = narrow();
  const showingList = !isNarrow || pane === 'list';
  const showingDetail = !isNarrow || pane === 'detail';
  setHidden(listPane, !showingList);
  setHidden(detailPane, !showingDetail);
  if (isNarrow && pane === 'detail') {
    if (backButton.parentElement !== detailPane) detailPane.prepend(backButton);
  } else {
    backButton.remove();
  }
  document.body.classList.toggle('narrow', isNarrow);
}

function setHidden(node: HTMLElement, hidden: boolean): void {
  if (hidden) {
    node.setAttribute('hidden', '');
    node.setAttribute('aria-hidden', 'true');
    node.inert = true;
  } else {
    node.removeAttribute('hidden');
    node.removeAttribute('aria-hidden');
    node.inert = false;
  }
}

/** The ruled title block in the corner of a detail sheet. */
export function titleBlock(name: string, status: string, changed: string): HTMLElement {
  return el('div', { class: 'title-block' }, [
    el('span', { class: 'tb-name mono', text: name }),
    el('span', { class: 'tb-state', text: status }),
    el('span', { class: 'tb-date mono', text: changed }),
  ]);
}

export function notFoundSheet(): HTMLElement {
  return el('div', { class: 'not-found' }, [
    el('h1', { 'data-detail-title': 'true', text: copy.notFoundHeading }),
    el('p', { text: copy.notFoundBody }),
  ]);
}
