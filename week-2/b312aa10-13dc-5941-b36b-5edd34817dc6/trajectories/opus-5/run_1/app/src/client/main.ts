import { get, onSessionEnd } from './api.js';
import { clear } from './dom.js';
import {
  isScreenPath,
  roleReaches,
  signInAddressFor,
  validNext,
  type ScreenPath,
} from './routes.js';
import { roleRefusalCopy, type Screen, type ScreenContext } from './screen.js';
import { Shell, type SessionInfo } from './shell.js';
import { boardScreen } from './screens/board.js';
import { bookingsScreen } from './screens/bookings.js';
import { documentsScreen } from './screens/documents.js';
import { inspectorScreen } from './screens/inspect.js';
import { invoicesScreen } from './screens/invoices.js';
import { reportsScreen } from './screens/reports.js';
import { sanitationScreen } from './screens/sanitation.js';
import { settingsScreen } from './screens/settings.js';
import { signInScreen } from './screens/signin.js';

const mount = document.getElementById('app')!;
const shell = new Shell();
mount.appendChild(shell.root);

let session: SessionInfo | null = null;
let screen: Screen | null = null;
let drawnKey = '';

function navigate(href: string, options: { replace?: boolean } = {}): void {
  if (options.replace) window.history.replaceState(null, '', href);
  else window.history.pushState(null, '', href);
  render();
}

shell.setNavigator((href) => navigate(href));

onSessionEnd(() => {
  session = null;
  screen?.destroy?.();
  screen = null;
  drawnKey = '';
  shell.reset();
  shell.setSession(null, '/');
  const path = window.location.pathname;
  if (isScreenPath(path)) {
    window.history.replaceState(null, '', signInAddressFor(path, window.location.search));
  }
  render();
});

function contextFor(path: string, query: URLSearchParams): ScreenContext {
  return {
    session,
    path,
    query,
    navigate,
    fillAddress: (href) => {
      window.history.replaceState(null, '', href);
      drawnKey = `${window.location.pathname}?${new URLSearchParams(window.location.search).toString()}`;
    },
    announce: (message) => shell.announce(message),
    showAlert: (message) => shell.showAlert(message),
    clearAlert: () => shell.clearAlert(),
    setHourBank: (bank) => shell.setHourBank(bank),
    refreshBanner: () => shell.refreshBanner(),
    onSignedIn: (info) => {
      session = info;
      const next = validNext(new URLSearchParams(window.location.search).get('next'));
      shell.reset();
      drawnKey = '';
      navigate(next ?? '/board', { replace: true });
    },
  };
}

function build(path: ScreenPath, context: ScreenContext): Screen {
  switch (path) {
    case '/board':
      return boardScreen(context);
    case '/bookings':
      return bookingsScreen(context);
    case '/documents':
      return documentsScreen(context);
    case '/invoices':
      return invoicesScreen(context);
    case '/reports':
      return reportsScreen(context);
    case '/sanitation':
      return sanitationScreen(context);
    case '/settings':
      return settingsScreen(context);
  }
}

function render(): void {
  const path = window.location.pathname;
  const query = new URLSearchParams(window.location.search);

  const inspectorMatch = /^\/inspect\/([^/]+)$/.exec(path);
  if (inspectorMatch) {
    if (drawnKey === path) return;
    drawnKey = path;
    screen?.destroy?.();
    shell.setSession(null, path);
    clear(shell.main);
    const view = inspectorScreen(decodeURIComponent(inspectorMatch[1]!));
    shell.main.appendChild(view.element);
    screen = view;
    return;
  }

  if (session === null) {
    if (isScreenPath(path)) {
      window.history.replaceState(null, '', signInAddressFor(path, window.location.search));
      render();
      return;
    }
    const key = `signin:${window.location.search}`;
    if (drawnKey === key) return;
    drawnKey = key;
    screen?.destroy?.();
    shell.setSession(null, '/');
    clear(shell.main);
    const view = signInScreen(contextFor('/', query));
    shell.main.appendChild(view.element);
    screen = view;
    return;
  }

  if (path === '/' || !isScreenPath(path)) {
    const next = validNext(query.get('next'));
    navigate(next ?? '/board', { replace: true });
    return;
  }

  if (!roleReaches(session.user.role, path)) {
    shell.showAlert(roleRefusalCopy);
    window.history.replaceState(null, '', '/board');
    render();
    return;
  }

  const key = `${path}?${query.toString()}`;
  if (drawnKey === key) return;
  drawnKey = key;
  screen?.destroy?.();
  shell.setSession(session, path);
  shell.foldMenu(false);
  clear(shell.main);
  const view = build(path, contextFor(path, query));
  shell.main.appendChild(view.element);
  screen = view;
}

window.addEventListener('popstate', () => {
  drawnKey = '';
  shell.clearAlert();
  render();
});

window.addEventListener('resize', () => {
  shell.applyLayout();
  screen?.onResize?.();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && shell.menuIsOpen()) {
    shell.foldMenu(true);
  }
});

async function boot(): Promise<void> {
  try {
    const result = await get<SessionInfo>('/api/session');
    session = result.body;
  } catch {
    session = null;
  }
  drawnKey = '';
  render();
}

void boot();