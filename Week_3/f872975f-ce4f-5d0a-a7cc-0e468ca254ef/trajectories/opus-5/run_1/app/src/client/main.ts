import { installRouter, navigate, render } from './router';
import { Page, installShell, mountPage } from './shell';
import { loadSession, startServiceWatch, store } from './store';
import { installSharedDefs } from './strip';
import { accountPage } from './pages/account';
import { boardPage } from './pages/board';
import { notFoundPage } from './pages/notfound';
import { ownerPage } from './pages/owner';
import { rackPage } from './pages/rack';
import { signInPage } from './pages/signin';
import { ticketPage } from './pages/ticket';
import { yardPage } from './pages/yard';

const SIGNED_IN_ONLY = ['/account', '/yard', '/owner'];

async function resolve(path: string, search: URLSearchParams): Promise<Page> {
  if (store.user === null && (SIGNED_IN_ONLY.includes(path) || path.startsWith('/tickets/'))) {
    await loadSession();
    if (store.user === null) {
      navigate(`/sign-in?next=${path}`, true);
      return signInPage(new URLSearchParams(`next=${path}`));
    }
  }
  if (path === '/') return rackPage(search);
  if (path === '/sign-in') return signInPage(search);
  if (path === '/account') return store.user?.role === 'maker' ? accountPage() : notFoundPage();
  if (path === '/yard') return store.user?.role === 'maker' ? notFoundPage() : yardPage();
  if (path === '/owner') return store.user?.role === 'owner' ? ownerPage() : notFoundPage();
  if (path.startsWith('/boards/')) return boardPage(decodeURIComponent(path.slice('/boards/'.length)));
  if (path.startsWith('/tickets/')) return ticketPage(decodeURIComponent(path.slice('/tickets/'.length)));
  return notFoundPage();
}

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (root === null) return;
  installSharedDefs();
  await loadSession();
  installShell(root);
  installRouter(resolve, mountPage);
  startServiceWatch();
  await render();
}

void boot();
