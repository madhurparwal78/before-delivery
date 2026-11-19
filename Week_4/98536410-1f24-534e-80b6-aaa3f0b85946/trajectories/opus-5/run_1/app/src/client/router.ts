import { clear, el } from './lib/dom.js';
import { call, get, whenSessionEnds } from './lib/api.js';
import type { Me } from './lib/state.js';
import {
  clearTabState,
  dropSavedScreen,
  landingRoute,
  maybeMe,
  readSavedScreen,
  routeBelongsToRole,
  saveScreenForSignIn,
  setMe,
} from './lib/state.js';
import type { StorageState } from './lib/types.js';
import { applyStorageState, signedInHeader, signedOutHeader, storageNotice, wordmark } from './components/chrome.js';

export type Screen = {
  node: HTMLElement;
  destroy?: () => void;
  stateForSignIn?: () => Record<string, unknown> | null;
  afterMount?: () => void;
};

export type ScreenFactory = (params: Record<string, string>) => Screen | Promise<Screen>;

type Pattern = {
  match: (parts: string[]) => Record<string, string> | null;
  load: () => Promise<ScreenFactory>;
  published: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PATTERNS: Pattern[] = [
  {
    match: (parts) => (parts.length === 0 ? {} : null),
    load: async () => (await import('./screens/landing.js')).landingScreen,
    published: false,
  },
  {
    match: (parts) => (parts.length === 1 && parts[0] === 'sign-in' ? {} : null),
    load: async () => (await import('./screens/signIn.js')).signInScreen,
    published: false,
  },
  {
    match: (parts) => (parts.length === 1 && parts[0] === 'estate' ? {} : null),
    load: async () => (await import('./screens/estate.js')).estateScreen,
    published: true,
  },
  {
    match: (parts) =>
      parts.length === 2 && parts[0] === 'shop' ? { storeId: parts[1] as string } : null,
    load: async () => (await import('./screens/shop.js')).shopScreen,
    published: true,
  },
  {
    match: (parts) => (parts.length === 1 && parts[0] === 'care' ? {} : null),
    load: async () => (await import('./screens/care.js')).careSearchScreen,
    published: true,
  },
  {
    match: (parts) =>
      parts.length === 3 && parts[0] === 'care' && parts[1] === 'orders' && UUID.test(parts[2] as string)
        ? { orderId: parts[2] as string }
        : null,
    load: async () => (await import('./screens/careOrder.js')).careOrderScreen,
    published: true,
  },
  {
    match: (parts) => (parts.length === 1 && parts[0] === 'catalogue' ? {} : null),
    load: async () => (await import('./screens/catalogue.js')).catalogueScreen,
    published: true,
  },
  {
    match: (parts) =>
      parts.length === 2 && parts[0] === 'products' ? { sku: parts[1] as string } : null,
    load: async () => (await import('./screens/product.js')).productScreen,
    published: true,
  },
  {
    match: (parts) => (parts.length === 1 && parts[0] === 'cart' ? {} : null),
    load: async () => (await import('./screens/cart.js')).cartScreen,
    published: true,
  },
  {
    match: (parts) =>
      parts.length === 2 && parts[0] === 'orders' && UUID.test(parts[1] as string)
        ? { orderId: parts[1] as string }
        : null,
    load: async () => (await import('./screens/order.js')).orderScreen,
    published: true,
  },
];

let root: HTMLElement;
let headerSlot: HTMLElement;
let noticeSlot: HTMLElement;
let main: HTMLElement;
let current: Screen | null = null;
let bootNotFound = false;

export function startNotFound(): void {
  bootNotFound = true;
}

export async function navigate(
  target: string,
  options: { replace?: boolean; silent?: boolean } = {},
): Promise<void> {
  if (!options.silent) {
    if (options.replace) history.replaceState({}, '', target);
    else history.pushState({}, '', target);
  }
  await render();
}

export function replaceAddress(target: string): void {
  history.replaceState({}, '', target);
}

export function pushAddress(target: string): void {
  history.pushState({}, '', target);
}

async function notFoundScreen(): Promise<Screen> {
  const factory = (await import('./screens/notFound.js')).notFoundScreen;
  return factory();
}

async function render(): Promise<void> {
  const parts = location.pathname.split('/').filter((part) => part !== '');
  const pattern = PATTERNS.find((candidate) => candidate.match(parts) !== null);
  const me = maybeMe();

  let screen: Screen;
  if (bootNotFound && parts.length > 0) {
    bootNotFound = false;
    screen = await notFoundScreen();
  } else if (!pattern) {
    screen = await notFoundScreen();
  } else if (pattern.published && !me) {
    await navigate(`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`, {
      replace: true,
    });
    return;
  } else if (
    pattern.published &&
    me &&
    !routeBelongsToRole(location.pathname, me.user.role, me.store_ids)
  ) {
    screen = await notFoundScreen();
  } else {
    const factory = await pattern.load();
    screen = await factory(pattern.match(parts) as Record<string, string>);
  }

  bootNotFound = false;
  current?.destroy?.();
  current = screen;

  clear(headerSlot);
  if (location.pathname !== '/') {
    headerSlot.appendChild(maybeMe() ? signedInHeader() : signedOutHeader());
  }
  clear(noticeSlot);
  noticeSlot.appendChild(storageNotice());
  clear(main);
  main.appendChild(screen.node);
  document.body.dataset['signedIn'] = maybeMe() ? 'true' : 'false';
  screen.afterMount?.();
}

async function refreshMe(): Promise<Me | null> {
  try {
    const me = await get<Me>('/api/me');
    setMe(me);
    return me;
  } catch {
    setMe(null);
    return null;
  }
}

export async function signOut(): Promise<void> {
  await call('DELETE', '/api/session', { ignoreSessionEnd: true }).catch(() => undefined);
  current?.destroy?.();
  current = null;
  setMe(null);
  clearTabState();
  dropSavedScreen();
  await navigate('/sign-in');
}

/** After signing in again the browser returns to `next` and restores the saved screen. */
export async function afterSignIn(me: Me, next: string | null): Promise<void> {
  setMe(me);
  const saved = readSavedScreen();
  if (saved && saved.account !== me.user.id) dropSavedScreen();

  const wanted =
    next && routeBelongsToRole(next, me.user.role, me.store_ids)
      ? next
      : landingRoute(me.user.role, me.store_ids);
  await navigate(wanted, { replace: true });
}

function mountShell(): void {
  root = document.getElementById('root') as HTMLElement;
  headerSlot = el('div', { class: 'header-slot' });
  noticeSlot = el('div', { class: 'notice-slot' });
  main = el('main', { class: 'app-main', id: 'main' });
  clear(root);
  root.append(headerSlot, noticeSlot, main, wordmark());
}

export async function startRouter(signedIn: boolean): Promise<void> {
  mountShell();

  whenSessionEnds(() => {
    const me = maybeMe();
    if (!me) return;
    const saved = current?.stateForSignIn?.() ?? null;
    saveScreenForSignIn({
      account: me.user.id,
      next: location.pathname + location.search,
      sessionEnded: true,
      payload: saved ?? {},
    });
    setMe(null);
    void navigate(`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`, {
      replace: true,
    });
  });

  window.addEventListener('popstate', () => void render());

  if (signedIn) await refreshMe();
  await render();

  const poll = async (): Promise<void> => {
    try {
      const state = await get<StorageState>('/api/status');
      applyStorageState(state.storage === 'down');
    } catch {
      /* the next poll tries again */
    }
  };
  await poll();
  window.setInterval(() => void poll(), 3000);
}
