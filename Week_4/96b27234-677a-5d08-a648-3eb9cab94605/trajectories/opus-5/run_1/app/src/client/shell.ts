import { api } from './api.js';
import { clear, el } from './dom.js';
import type { Me } from './types.js';

export const NOTICE = {
  removedByVote: 'The room voted to remove you.',
  removedByModerator: 'A moderator has removed you from this session.',
  warned: 'A moderator has warned you.',
  outOfCommunity: 'You are no longer in this community.'
} as const;

export const HEADING = {
  unavailableSession: "This session isn't available.",
  deadInvite: "This invite isn't available.",
  deadConfirm: "This link isn't available.",
  notFound: 'Page not found.'
} as const;

let alertsNode: HTMLElement | null = null;

export function mountShell(me: Me | null): { main: HTMLElement } {
  const app = document.querySelector('#app');
  if (app === null) throw new Error('missing app root');
  clear(app);
  if (me !== null) {
    const links = [
      el('a', { href: '/sessions', text: 'Sessions' }),
      el('a', { href: '/friends', text: 'Friends' }),
      el('a', { href: '/studio', text: 'Studio' }),
      el('a', { href: '/communities', text: 'Communities' })
    ];
    if (me.siteRole === 'moderator') links.push(el('a', { href: '/moderation', text: 'Moderation' }));
    const signOut = el('button', { type: 'button', text: 'Sign out', class: 'plain' });
    signOut.addEventListener('click', () => {
      void api.post('/api/signout').then(() => {
        window.location.assign('/signin');
      });
    });
    app.append(
      el('header', { class: 'top' }, [
        el('nav', { 'aria-label': 'Main', class: 'nav' }, links),
        signOut
      ])
    );
  }
  const main = el('main', {});
  const alerts = el('div', { class: 'alerts' });
  alertsNode = alerts;
  app.append(main, alerts);
  return { main };
}

export function showAlert(text: string): void {
  if (alertsNode === null) return;
  const existing = [...alertsNode.children].some((child) => child.textContent === text);
  if (existing) return;
  alertsNode.append(el('p', { role: 'alert', class: 'alert', text }));
}

export function clearAlerts(): void {
  if (alertsNode !== null) clear(alertsNode);
}

export function heading(main: HTMLElement, text: string): HTMLElement {
  const node = el('h1', { text, tabindex: '-1' });
  main.append(node);
  return node;
}

export function navigate(path: string): void {
  window.location.assign(path);
}
