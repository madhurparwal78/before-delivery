import { COPY } from '../../shared/domain.js';
import { el } from './dom.js';

let activityRegion: HTMLElement;
let connectionRegion: HTMLElement;
let viewRoot: HTMLElement;
let topBar: HTMLElement;

export function buildShell(): void {
  topBar = el('header', { class: 'topbar' }, [
    el('span', { class: 'brand' }, ['Snaglight']),
    el('nav', { class: 'topnav' }, [
      el('a', { href: '/jobs', 'data-link': 'true' }, ['Your jobs']),
      el('a', { href: '/account', 'data-link': 'true' }, ['Account']),
      el('button', { type: 'button', id: 'signout' }, ['Sign out']),
    ]),
  ]);
  connectionRegion = el('div', { class: 'connection', role: 'status', 'aria-label': 'Connection' });
  viewRoot = el('main', { class: 'view', id: 'view' });
  activityRegion = el('div', { class: 'activity', role: 'status', 'aria-label': 'Activity' });
  document.body.append(topBar, connectionRegion, viewRoot, activityRegion);
}

export function view(): HTMLElement {
  return viewRoot;
}

export function announce(message: string): void {
  activityRegion.textContent = message;
}

export function setOffline(offline: boolean): void {
  connectionRegion.textContent = offline ? COPY.offlineBanner : '';
  document.body.classList.toggle('is-offline', offline);
}

export function isOffline(): boolean {
  return document.body.classList.contains('is-offline');
}

export function showTopBar(visible: boolean): void {
  topBar.hidden = !visible;
}

export function signOutButton(): HTMLButtonElement {
  return document.getElementById('signout') as HTMLButtonElement;
}

export function errorSummary(
  errors: { field: string; message: string; focus: () => void }[],
): HTMLElement | null {
  if (errors.length === 0) return null;
  const list = el('ul', {});
  for (const entry of errors) {
    const link = el('a', { href: '#', class: 'errorlink' }, [entry.message]);
    link.addEventListener('click', (event) => {
      event.preventDefault();
      entry.focus();
    });
    list.append(el('li', {}, [link]));
  }
  return el('div', { class: 'errorsummary', role: 'alert', 'aria-label': 'There is a problem' }, [
    el('h2', {}, ['There is a problem']),
    list,
  ]);
}
