import { deleteJson } from './api';
import { clear, el, setText } from './dom';
import { navigate } from './router';
import { ServicesReport, onServicesChange, store } from './store';

export type BannerKind = 'billing' | 'storage';

export interface Page {
  element: HTMLElement;
  banners: BannerKind[];
  destroy?(): void;
  onServices?(report: ServicesReport): void;
}

const BANNER_COPY: Record<BannerKind, string> = {
  billing: 'Billing is offline. You can browse and plan cuts, but holds and purchases are paused.',
  storage: "Photo storage is offline. Tag boards now and add photos when it's back."
};

let topBar: HTMLElement | null = null;
let notice: HTMLElement | null = null;
let outlet: HTMLElement | null = null;
let current: Page | null = null;

function navLinks(): HTMLElement[] {
  const links: HTMLElement[] = [];
  const add = (href: string, text: string): void => {
    links.push(
      el('a', {
        text,
        attrs: { href },
        on: {
          click: (event) => {
            event.preventDefault();
            navigate(href);
          }
        }
      })
    );
  };
  add('/', 'Rack');
  const role = store.user?.role;
  if (role === 'maker') add('/account', 'Account');
  if (role === 'hand' || role === 'owner') add('/yard', 'Yard');
  if (role === 'owner') add('/owner', 'Owner');
  if (store.user === null) add('/sign-in', 'Sign in');
  return links;
}

export function renderTopBar(): void {
  if (topBar === null) return;
  clear(topBar);
  topBar.appendChild(
    el(
      'a',
      {
        class: 'wordmark',
        text: 'Kerfwell',
        attrs: { href: '/' },
        on: {
          click: (event) => {
            event.preventDefault();
            navigate('/');
          }
        }
      }
    )
  );
  topBar.appendChild(el('nav', { class: 'top-nav' }, navLinks()));
  const who = el('div', { class: 'who' });
  if (store.user !== null) {
    who.appendChild(el('span', { class: 'who-name', text: store.user.name }));
    who.appendChild(el('span', { class: 'who-role', text: roleLabel(store.user.role) }));
    who.appendChild(
      el('button', {
        class: 'linklike',
        text: 'Sign out',
        attrs: { type: 'button' },
        on: {
          click: () => {
            void signOut();
          }
        }
      })
    );
  }
  topBar.appendChild(who);
}

function roleLabel(role: 'owner' | 'hand' | 'maker'): string {
  if (role === 'owner') return 'Yard owner';
  if (role === 'hand') return 'Yard hand';
  return 'Maker';
}

async function signOut(): Promise<void> {
  await deleteJson('/api/session');
  store.user = null;
  renderTopBar();
  navigate('/');
}

/** Only the banner text changes here, so open work on the page is never disturbed. */
export function refreshBanners(): void {
  if (notice === null) return;
  const wanted = (current?.banners ?? []).filter((kind) => store.services[kind] === 'down');
  const existing = new Map<string, Element>();
  for (const node of [...notice.children]) {
    const kind = node.getAttribute('data-banner');
    if (kind !== null) existing.set(kind, node);
  }
  for (const [kind, node] of existing) {
    if (!wanted.includes(kind as BannerKind)) node.remove();
  }
  for (const kind of wanted) {
    const found = existing.get(kind);
    if (found !== undefined) {
      setText(found, BANNER_COPY[kind]);
      continue;
    }
    notice.appendChild(el('p', { class: 'banner', text: BANNER_COPY[kind], attrs: { 'data-banner': kind } }));
  }
}

export function installShell(root: HTMLElement): void {
  clear(root);
  topBar = el('header', { class: 'top-bar' });
  notice = el('div', { class: 'notice', attrs: { role: 'status', 'aria-label': 'Service notice' } });
  outlet = el('main', { class: 'outlet', attrs: { id: 'outlet' } });
  root.appendChild(topBar);
  root.appendChild(notice);
  root.appendChild(outlet);
  renderTopBar();
  onServicesChange((report) => {
    refreshBanners();
    current?.onServices?.(report);
  });
}

export function mountPage(page: Page): void {
  if (outlet === null) return;
  current?.destroy?.();
  current = page;
  clear(outlet);
  outlet.appendChild(page.element);
  refreshBanners();
  window.scrollTo(0, 0);
}
