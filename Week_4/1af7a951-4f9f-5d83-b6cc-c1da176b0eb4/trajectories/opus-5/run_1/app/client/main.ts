import { api, type Session } from './api.js';
import { COPY } from './copy.js';
import { clear, h } from './dom.js';
import {
  clearSignOutPending,
  forgetSession,
  markSignOutPending,
  rememberSession,
  rememberedSession,
  signOutPending,
} from './me.js';
import { cohortsScreen } from './screens/cohorts.js';
import { enrollScreen } from './screens/enroll.js';
import { enrollmentScreen } from './screens/enrollment.js';
import { signInScreen } from './screens/signin.js';
import { notFoundScreen } from './screens/notfound.js';
import { logbookScreen } from './logbook/index.js';
import { coachScreen } from './screens/coach.js';

const root = document.getElementById('app');
if (root === null) throw new Error('Missing app root');

const main = h('main', { id: 'main' });
const header = h('header', { class: 'header' });
root.append(header, main);

let session: Session | null = null;

function keepSession(next: Session): void {
  session = next;
  rememberSession(next);
}

async function handleSignOut(): Promise<void> {
  if (!navigator.onLine) {
    markSignOutPending();
    forgetSession();
    session = null;
    navigate('/signin');
    return;
  }
  await api.signOut();
  clearSignOutPending();
  forgetSession();
  session = null;
  navigate('/signin');
}

function renderHeader(path: string): void {
  clear(header);
  header.append(h('p', { class: 'wordmark', text: 'Lanternfish' }));
  if (session !== null) {
    const signOut = h('button', { type: 'button', class: 'ghost', text: COPY.signOut });
    signOut.addEventListener('click', () => {
      void handleSignOut();
    });
    header.append(h('p', { class: 'who', text: session.name }), signOut);
    return;
  }
  if (path === '/') header.append(h('a', { href: '/signin', class: 'link', text: COPY.signIn }));
}

export function navigate(path: string): void {
  history.pushState({}, '', path);
  void render();
}

function screenFor(path: string, search: string): Node {
  if (path === '/') return cohortsScreen();
  if (path === '/signin') {
    return signInScreen({ next: new URLSearchParams(search).get('next'), onSignedIn: keepSession });
  }
  const enrollMatch = /^\/enroll\/([^/]+)$/.exec(path);
  if (enrollMatch !== null) return enrollScreen(enrollMatch[1] ?? '');
  const enrollmentMatch = /^\/enrollments\/([^/]+)$/.exec(path);
  if (enrollmentMatch !== null) return enrollmentScreen(enrollmentMatch[1] ?? '');
  if (path === '/logbook') {
    if (session === null || session.role !== 'dreamer') {
      return signInScreen({ next: '/logbook', onSignedIn: keepSession });
    }
    return logbookScreen(session);
  }
  if (path === '/coach') {
    if (session === null || session.role !== 'coach') {
      return signInScreen({ next: `/coach${search}`, onSignedIn: keepSession });
    }
    return coachScreen();
  }
  return notFoundScreen();
}

export async function render(): Promise<void> {
  const path = location.pathname;
  renderHeader(path);
  clear(main);
  main.append(screenFor(path, location.search));
}

async function refreshSession(): Promise<void> {
  if (!navigator.onLine) {
    session = rememberedSession();
    return;
  }
  const result = await api.session();
  if (result.ok && result.body !== null) {
    keepSession(result.body);
    return;
  }
  session = null;
  forgetSession();
}

async function sendPendingSignOut(): Promise<void> {
  if (!signOutPending() || !navigator.onLine) return;
  await api.signOut();
  clearSignOutPending();
  forgetSession();
}

window.addEventListener('popstate', () => {
  void render();
});

window.addEventListener('online', () => {
  void sendPendingSignOut();
});

async function start(): Promise<void> {
  await sendPendingSignOut();
  await refreshSession();
  await render();
  if ('serviceWorker' in navigator) {
    await navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }
}

void start();
