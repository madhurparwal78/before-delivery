import { api, ApiCallError, type ClientConfig, type TeamMembership, type User } from './api.js';
import { clear, h, icon, mascot } from './dom.js';
import { openLiveChannel, type LiveEvent } from './live.js';
import { renderWorkbench } from './workbench.js';
import { renderLibrary } from './screens/library.js';
import { renderHistory } from './screens/history.js';
import { renderImporter } from './screens/importer.js';
import { renderTeamSettings } from './screens/team.js';
import { renderSnapshot } from './screens/snapshot.js';
import { renderSignUp, renderSignIn, renderVerify, renderInvite } from './screens/account.js';

export interface Session {
  user: User;
  teams: TeamMembership[];
}

export interface Screen {
  onLiveEvent?(event: LiveEvent): void;
  onReconnect?(): void;
}

export interface Shell {
  readonly config: ClientConfig;
  readonly session: Session | null;
  navigate(path: string): void;
  reloadSession(): Promise<void>;
}

const root = document.getElementById('app')!;
const screenHost = h('main', { class: 'screen', id: 'screen' });
const noticeLine = h('div', {
  class: 'notice-line-strip',
  role: 'status',
  'aria-live': 'off',
  'aria-label': 'Service notice',
});
const stripLinks = h('nav', { class: 'strip-links' });
const infoStrip = h('header', { class: 'info-strip' }, [
  h('div', { class: 'brand' }, [mascot('brand-mascot'), h('span', { class: 'brand-name', text: 'Wringbench' })]),
  noticeLine,
  stripLinks,
]);

let config: ClientConfig;
let session: Session | null = null;
let current: Screen = {};

function textLink(label: string, href: string, iconName: string): HTMLElement {
  const link = h('a', { class: 'strip-link', href }, [icon(iconName), h('span', { text: label })]);
  link.addEventListener('click', (event) => {
    if (event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    navigate(href);
  });
  return link;
}

function renderStrip(): void {
  clear(stripLinks);
  stripLinks.append(
    textLink('Library', '/library', 'library'),
    textLink('Import', '/import', 'file-input'),
    textLink('Team settings', '/team', 'users'),
  );
  if (session === null) {
    stripLinks.append(textLink('Sign in', '/signin', 'log-in'));
    return;
  }
  const signOut = h('button', { type: 'button', class: 'strip-link' }, [
    icon('log-out'),
    h('span', { text: 'Sign out' }),
  ]);
  signOut.addEventListener('click', () => {
    void api.signout().then(() => {
      session = null;
      renderStrip();
      navigate('/');
    });
  });
  stripLinks.append(signOut);
}

const shell: Shell = {
  get config() {
    return config;
  },
  get session() {
    return session;
  },
  navigate: (path: string) => navigate(path),
  reloadSession: async () => {
    await loadSession();
    renderStrip();
  },
};

async function loadSession(): Promise<void> {
  try {
    const me = await api.me();
    session = { user: me.user, teams: me.teams };
  } catch (cause) {
    if (!(cause instanceof ApiCallError)) throw cause;
    session = null;
  }
}

function navigate(path: string): void {
  const here = window.location.pathname + window.location.search + window.location.hash;
  if (path !== here) window.history.pushState({}, '', path);
  route();
}

function route(): void {
  const path = window.location.pathname;
  const search = new URLSearchParams(window.location.search);
  clear(screenHost);
  document.body.classList.toggle('on-workbench', path === '/' || path === '/w');

  if (path === '/' || path === '/w') {
    const recipeId = search.get('recipe');
    const version = search.get('version');
    current = renderWorkbench(screenHost, {
      config,
      session,
      recipeRequest: recipeId === null ? null : { id: recipeId, version: version === null ? null : Number(version) },
    });
    return;
  }
  if (path === '/library') {
    current = renderLibrary(screenHost, shell);
    return;
  }
  const historyMatch = /^\/library\/([^/]+)$/.exec(path);
  if (historyMatch !== null) {
    current = renderHistory(screenHost, shell, historyMatch[1]!);
    return;
  }
  if (path === '/import') {
    current = renderImporter(screenHost, shell);
    return;
  }
  if (path === '/team') {
    current = renderTeamSettings(screenHost, shell);
    return;
  }
  if (path === '/signup') {
    current = renderSignUp(screenHost, shell);
    return;
  }
  if (path === '/signin') {
    current = renderSignIn(screenHost, shell);
    return;
  }
  const verifyMatch = /^\/verify\/([^/]+)$/.exec(path);
  if (verifyMatch !== null) {
    current = renderVerify(screenHost, shell, verifyMatch[1]!);
    return;
  }
  const inviteMatch = /^\/invite\/([^/]+)$/.exec(path);
  if (inviteMatch !== null) {
    current = renderInvite(screenHost, shell, inviteMatch[1]!);
    return;
  }
  const snapshotMatch = /^\/s\/([^/]+)$/.exec(path);
  if (snapshotMatch !== null) {
    current = renderSnapshot(screenHost, shell, snapshotMatch[1]!);
    return;
  }
  screenHost.append(h('p', { class: 'muted-note', text: 'This page does not exist.' }));
}

window.addEventListener('popstate', () => route());

async function start(): Promise<void> {
  config = await api.config();
  await loadSession();
  root.append(infoStrip, screenHost);
  renderStrip();
  route();
  if (session !== null) {
    openLiveChannel({
      onEvent: (event) => current.onLiveEvent?.(event),
      onStateChange: (connected) => {
        noticeLine.textContent = connected ? '' : 'Live updates paused. Reconnecting…';
      },
      onReconnect: () => current.onReconnect?.(),
    });
  }
}

void start();
