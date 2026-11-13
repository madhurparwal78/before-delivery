import { publicPage } from './publicPage';
import { signInPage } from './signIn';
import { workspacePage } from './workspace';
import { teamPage } from './team';
import { widgetPage } from './widget';
import { el } from './publicPage';

function notFoundPage(root: HTMLElement): void {
  document.title = "There's no page here. — Hushline";
  const container = el('div', { class: 'column not-found' });
  container.append(el('h1', {}, "There's no page here."));
  container.append(el('p', {}, el('a', { href: '/inbox' }, 'Back to the inbox')));
  root.append(container);
}

async function start(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) return;
  const path = window.location.pathname;
  if (path === '/' || path === '') {
    publicPage(root);
    return;
  }
  if (path === '/signin') {
    signInPage(root, null);
    return;
  }
  if (path === '/team') {
    await teamPage(root);
    return;
  }
  if (path.startsWith('/inbox')) {
    await workspacePage(root);
    return;
  }
  if (path.startsWith('/widget/')) {
    await widgetPage(root);
    return;
  }
  notFoundPage(root);
}

void start();
