import { request } from './api.js';
import type { User } from '../shared/api.js';
import { catalogueScreen } from './screens/catalogue.js';
import { counterScreen } from './screens/counter.js';
import { itemScreen } from './screens/item.js';
import { ledgerScreen } from './screens/ledger.js';
import { loanScreen } from './screens/loan.js';
import { myLoansScreen } from './screens/myLoans.js';
import { notFoundScreen } from './screens/notFound.js';
import { signInScreen } from './screens/signIn.js';
import {
  buildShell,
  homePath,
  isStaff,
  loadLibrary,
  mount,
  registerNavigate,
  state,
  type Screen,
} from './shell.js';

const root = document.body.appendChild(
  document.querySelector<HTMLElement>('#app') ?? document.createElement('div'),
);

let current: Screen | null = null;

function chooseScreen(path: string, replaceWithNotFound: () => void): Screen {
  const user = state.user;
  if (user === null) return signInScreen();
  if (path === '/' ) {
    history.replaceState(null, '', homePath(user));
    return chooseScreen(homePath(user), replaceWithNotFound);
  }
  if (path === '/catalogue') return catalogueScreen();
  const itemMatch = /^\/items\/([^/]+)$/.exec(path);
  if (itemMatch !== null) return itemScreen(itemMatch[1] as string, replaceWithNotFound);
  if (path === '/my-loans') {
    return user.role === 'member' ? myLoansScreen() : notFoundScreen();
  }
  const loanMatch = /^\/loans\/([^/]+)$/.exec(path);
  if (loanMatch !== null) return loanScreen(loanMatch[1] as string, replaceWithNotFound);
  if (path === '/counter') return isStaff(user) ? counterScreen() : notFoundScreen();
  if (path === '/ledger') return user.role === 'founder' ? ledgerScreen() : notFoundScreen();
  return notFoundScreen();
}

function render(path: string): void {
  current?.stop?.();
  const showNotFound = (): void => {
    const fallback = notFoundScreen();
    current?.stop?.();
    current = fallback;
    mount(root, buildShell(path, fallback.node));
  };
  const screen = chooseScreen(path, showNotFound);
  current = screen;
  mount(root, buildShell(path, screen.node));
  screen.start?.();
}

function navigateTo(path: string, replace = false): void {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  render(path);
}

registerNavigate(navigateTo);

document.addEventListener('click', (event: MouseEvent) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest('a');
  if (anchor === null) return;
  const href = anchor.getAttribute('href');
  if (href === null || href.startsWith('#') || href.startsWith('http')) return;
  event.preventDefault();
  navigateTo(href);
});

window.addEventListener('popstate', () => render(location.pathname));

async function boot(): Promise<void> {
  try {
    const answer = await request<{ user: User }>('/api/session');
    state.user = answer.user;
    await loadLibrary();
  } catch {
    state.user = null;
  }
  const path = location.pathname;
  if (state.user === null && path !== '/') {
    history.replaceState(null, '', '/');
    render('/');
    return;
  }
  render(path);
}

void boot();
