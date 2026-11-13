import { matchRoute, ROLE_HOME, ROLE_ROUTES, type Role, type RouteName } from '../domain/routes.ts';
import { api, SessionEnded } from './api.ts';
import { copy } from './copy.ts';
import { clear, el } from './dom.ts';
import { navigate, onRouteChange, signedOutRedirect } from './navigation.ts';
import type { Screen } from './screen.ts';
import { searchBox, type SearchBox } from './search.ts';
import { getUser, refreshUser, setUser } from './session.ts';

import { signInScreen } from './screens/signIn.ts';
import { growerHomeScreen } from './screens/growerHome.ts';
import { orderFormScreen } from './screens/orderForm.ts';
import { orderPageScreen } from './screens/orderPage.ts';
import { fieldScreen } from './screens/field.ts';
import { boardScreen } from './screens/board.ts';
import { capacityScreen } from './screens/capacity.ts';
import { restrictionScreen } from './screens/restriction.ts';
import { packsScreen } from './screens/packs.ts';
import { packNewScreen } from './screens/packNew.ts';
import { packPageScreen } from './screens/packPage.ts';
import { contractorsScreen } from './screens/contractors.ts';
import { reviewScreen } from './screens/review.ts';

const LIVE_INTERVAL_MS = 2_000;

const NAV_LINKS: Record<Role, readonly { label: string; href: string }[]> = {
  grower: [
    { label: 'Your orders', href: '/grower' },
    { label: 'New order', href: '/grower/orders/new' },
  ],
  operator: [{ label: 'Field', href: '/field' }],
  dispatcher: [
    { label: 'Channel board', href: '/board' },
    { label: 'Contractors', href: '/contractors' },
  ],
  clerk: [
    { label: 'Packs', href: '/packs' },
    { label: 'Contractors', href: '/contractors' },
  ],
  reviewer: [{ label: 'Review', href: '/review' }],
};

const ROLE_LABELS: Record<Role, string> = {
  grower: 'Grower',
  operator: 'Channel operator',
  dispatcher: 'Dispatcher',
  clerk: 'Records clerk',
  reviewer: 'State regulator reviewer',
};

type ScreenFactory = (params: Record<string, string>) => Promise<Screen>;

const SCREENS: Record<RouteName, ScreenFactory> = {
  'sign-in': () => signInScreen(),
  'grower-home': () => growerHomeScreen(),
  'order-new': () => orderFormScreen(),
  order: (params) => orderPageScreen(params.orderNumber as string),
  field: () => fieldScreen(),
  board: () => boardScreen(),
  capacity: (params) => capacityScreen(params.channelId as string),
  restriction: (params) => restrictionScreen(params.restrictionId as string),
  contractors: () => contractorsScreen(),
  packs: () => packsScreen(),
  'pack-new': () => packNewScreen(),
  pack: (params) => packPageScreen(params.packId as string),
  review: () => reviewScreen(),
};

const root = document.getElementById('app') as HTMLElement;
let screen: Screen | null = null;
let search: SearchBox | null = null;
let renderToken = 0;

function topBar(bare: boolean): HTMLElement {
  const user = getUser();
  if (bare || user === null) {
    return el('header', {
      class: 'topbar',
      children: [el('span', { class: 'brand', text: 'Ditchbook' })],
    });
  }
  search = searchBox();
  return el('header', {
    class: 'topbar',
    children: [
      el('span', { class: 'brand', text: 'Ditchbook' }),
      el('nav', {
        class: 'nav',
        attrs: { 'aria-label': 'Ditchbook' },
        children: NAV_LINKS[user.role].map((link) =>
          el('a', { class: 'nav-link', text: link.label, attrs: { href: link.href } }),
        ),
      }),
      search.element,
      el('span', {
        class: 'whoami',
        text: `${user.name ?? ''}, ${ROLE_LABELS[user.role]}`,
      }),
      el('button', {
        class: 'button',
        text: 'Sign out',
        attrs: { type: 'button' },
        on: {
          click: () => {
            void signOut();
          },
        },
      }),
    ],
  });
}

async function signOut(): Promise<void> {
  try {
    await api.del('/api/session');
  } catch {
    // The session is gone either way; the browser returns to sign-in.
  }
  setUser(null);
  search = null;
  navigate('/sign-in');
}

function notFoundScreen(): Screen {
  return {
    element: el('main', {
      class: 'page page-narrow',
      children: [el('h1', { text: copy.pageNotFound })],
    }),
  };
}

async function render(): Promise<void> {
  const token = ++renderToken;
  const user = getUser();
  const pathname = window.location.pathname;
  const match = matchRoute(pathname);

  if (user === null) {
    if (match?.name !== 'sign-in') {
      signedOutRedirect();
      return;
    }
  } else if (match === null) {
    mount(notFoundScreen(), true);
    return;
  } else if (match.name === 'sign-in') {
    navigate(ROLE_HOME[user.role], { replace: true });
    return;
  } else if (!(ROLE_ROUTES[user.role] as readonly RouteName[]).includes(match.name)) {
    navigate(ROLE_HOME[user.role], { replace: true });
    return;
  }

  const name = (match as { name: RouteName }).name;
  const params = (match as { params: Record<string, string> }).params;
  try {
    const next = await SCREENS[name](params);
    if (token !== renderToken) return;
    mount(next, name === 'sign-in');
  } catch (cause) {
    if (cause instanceof SessionEnded) return;
    if (token !== renderToken) return;
    mount(notFoundScreen(), getUser() === null);
  }
}

function mount(next: Screen, bare: boolean): void {
  screen?.destroy?.();
  screen = next;
  clear(root);
  root.appendChild(topBar(bare));
  root.appendChild(next.element);
  window.scrollTo(0, 0);
}

async function tick(): Promise<void> {
  if (screen === null) return;
  try {
    await screen.refresh?.();
    await search?.refresh();
  } catch (cause) {
    if (cause instanceof SessionEnded) return;
  }
}

function interceptLinks(): void {
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const anchor = (event.target as HTMLElement | null)?.closest('a');
    if (anchor === null || anchor === undefined) return;
    if (anchor.hasAttribute('download') || anchor.target === '_blank') return;
    const href = anchor.getAttribute('href');
    if (href === null || !href.startsWith('/')) return;
    event.preventDefault();
    navigate(href);
  });
}

async function boot(): Promise<void> {
  await refreshUser();
  onRouteChange(() => void render());
  interceptLinks();
  await render();
  window.setInterval(() => void tick(), LIVE_INTERVAL_MS);
}

void boot();
