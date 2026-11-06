import { api, type SessionPerson } from './api.js';
import { renderEditor } from './editor/index.js';
import { renderHome } from './home.js';
import { clearBanners, setNavigator } from './shell.js';
import { renderSignIn } from './signin.js';
import { Connection } from './socket.js';

let connection: Connection | null = null;

function closeConnection(): void {
  connection?.close();
  connection = null;
}

async function currentPerson(): Promise<SessionPerson | null> {
  try {
    const result = await api.session();
    return result.person;
  } catch {
    return null;
  }
}

async function route(): Promise<void> {
  clearBanners();
  closeConnection();
  const path = location.pathname;
  if (path === '/sign-in') {
    const next = new URLSearchParams(location.search).get('next') ?? '/';
    renderSignIn(next);
    return;
  }
  const person = await currentPerson();
  if (!person) {
    const next = `${location.pathname}${location.search}`;
    navigateTo(`/sign-in?next=${encodeURIComponent(next)}`, { replace: true });
    return;
  }
  connection = new Connection();
  if (path === '/') {
    renderHome(person, connection);
    return;
  }
  const match = /^\/d\/([^/]+)$/u.exec(path);
  if (match) {
    await renderEditor(decodeURIComponent(match[1] as string), person, connection);
    return;
  }
  navigateTo('/', { replace: true });
}

function navigateTo(path: string, options?: { replace?: boolean }): void {
  if (options?.replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  void route();
}

setNavigator(navigateTo);
window.addEventListener('popstate', () => void route());
void route();
