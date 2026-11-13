import { CONNECTION_COPY, GLOBAL_COPY, waitingCount, signedOutLine } from '../shared/messages.js';
import { clear, el } from './dom.js';
import { regions } from './regions.js';
import { appState } from './state.js';
import { navigate, signOutAndLand } from './router.js';

let notOnThisDevice = false;

export function setNotOnThisDevice(value: boolean): void {
  notOnThisDevice = value;
  paintConnection();
}

function link(label: string, href: string): HTMLAnchorElement {
  return el('a', {
    class: 'nav-link',
    text: label,
    attrs: { href },
    on: {
      click: (event) => {
        event.preventDefault();
        navigate(href);
      },
    },
  });
}

export function internalLink(label: string, href: string, className = 'link'): HTMLAnchorElement {
  const node = link(label, href);
  node.className = className;
  return node;
}

function navigation(): HTMLElement {
  const signOut = el('button', {
    class: 'nav-link nav-button',
    text: 'Sign out',
    attrs: { type: 'button' },
    on: { click: () => void signOutAndLand() },
  });
  return el('nav', { class: 'nav', attrs: { 'aria-label': 'Main' } }, [
    link('Tonight', '/tonight'),
    link('Programs', '/programs'),
    link('Kit', '/kit'),
    signOut,
  ]);
}

export function paintConnection(): void {
  const node = regions.connection;
  if (!node) return;
  const state = appState();
  const lines: HTMLElement[] = [];
  if (state.offline && !state.signedOutWithWork) {
    lines.push(el('p', { class: 'banner', text: CONNECTION_COPY.offline }));
  }
  if (state.signedOutWithWork) {
    const current = `${window.location.pathname}${window.location.search}`;
    lines.push(
      el('p', { class: 'banner' }, [
        `${signedOutLine(state.waiting)} `,
        internalLink('Sign in', `/signin?next=${encodeURIComponent(current)}`),
      ]),
    );
  }
  if (notOnThisDevice) {
    lines.push(el('p', { class: 'banner', text: CONNECTION_COPY.not_on_device }));
  }
  if (state.waiting > 0) {
    lines.push(el('p', { class: 'banner', text: waitingCount(state.waiting) }));
  }
  clear(node);
  for (const line of lines) node.append(line);
}

export interface WorkingScreen {
  root: HTMLElement;
  content: HTMLElement;
}

/** Every working screen opens with the same navigation line, heading and banners. */
export function workingScreen(heading: string): WorkingScreen {
  const connection = el('div', {
    class: 'connection',
    attrs: { role: 'status', 'aria-label': 'Connection', 'aria-live': 'polite' },
  });
  const syncResults = el('div', {
    class: 'sync-results',
    attrs: { role: 'status', 'aria-label': 'Sync results', 'aria-live': 'polite' },
  });
  const content = el('div', { class: 'screen-content' });
  const column = el('div', { class: 'column' }, [
    navigation(),
    el('h1', { class: 'heading', text: heading }),
    connection,
    syncResults,
    content,
  ]);
  const root = el('div', { class: 'page' }, [column, footer()]);
  regions.connection = connection;
  regions.syncResults = syncResults;
  notOnThisDevice = false;
  queueMicrotask(paintConnection);
  return { root, content };
}

export function footer(): HTMLElement {
  return el('footer', { class: 'footer' }, [
    el('p', { text: 'Lowlamp Instruments · Lowlamp Field Log' }),
  ]);
}

export function notFoundScreen(): HTMLElement {
  const { root, content } = workingScreen('Not found');
  content.append(el('p', { class: 'banner', text: GLOBAL_COPY.not_found }));
  return root;
}

/**
 * Offline, an id the device doesn't hold shows the not-on-this-device sentence
 * and the Not found screen doesn't show. Online, it is a Not found.
 */
export function missingScreen(): HTMLElement {
  if (!appState().offline) return notFoundScreen();
  const { root } = workingScreen('Not on this device');
  setNotOnThisDevice(true);
  return root;
}

export function publicPage(children: Array<Node | string | null>): HTMLElement {
  return el('div', { class: 'page' }, [el('div', { class: 'column' }, children), footer()]);
}
