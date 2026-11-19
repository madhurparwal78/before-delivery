// Shared screen furniture: the form-problems summary, the top bar, the service banner.

import { el, clear } from './dom';
import type { App } from './app';
import { landingPath } from './router';

export const SUMMARY_COPY = 'Check the highlighted fields.';

export interface FieldTarget {
  focusField: (field: string) => void;
}

/** The page's single form-problems summary. Links move focus to their fields. */
export function renderProblems(
  container: HTMLElement,
  fields: Record<string, string>,
  findField: (field: string) => HTMLElement | null,
): void {
  clear(container);
  if (Object.keys(fields).length === 0) {
    container.removeAttribute('role');
    return;
  }
  container.setAttribute('role', 'alert');
  container.setAttribute('aria-label', 'Form problems');
  container.className = 'form-problems';
  const list = el('ul');
  for (const [field, message] of Object.entries(fields)) {
    const link = el('a', { href: '#', text: message });
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const target = findField(field);
      if (target !== null) {
        target.setAttribute('tabindex', '-1');
        target.focus();
        target.removeAttribute('tabindex');
      }
    });
    list.append(el('li', {}, link));
  }
  container.append(el('p', { text: SUMMARY_COPY }), list);
}

export function showFieldErrors(
  under: (field: string) => HTMLElement | null,
  fields: Record<string, string>,
): void {
  for (const [field, message] of Object.entries(fields)) {
    const holder = under(field);
    if (holder === null) continue;
    const existing = holder.querySelector('.field-error');
    if (existing !== null) existing.remove();
    holder.append(el('p', { class: 'field-error', text: message }));
  }
}

export function clearFieldErrors(under: (field: string) => HTMLElement | null, fields: string[]): void {
  for (const field of fields) {
    const holder = under(field);
    if (holder === null) continue;
    const existing = holder.querySelector('.field-error');
    if (existing !== null) existing.remove();
  }
}

/** The top bar: wordmark, board counts, role links, sign in/out. */
export function renderTopBar(app: App, container: HTMLElement, currentPath: string): void {
  clear(container);
  const wordmark = el('a', { class: 'wordmark', href: '/', text: 'Pegworth' });
  container.append(wordmark);

  const counts = el('div', {
    role: 'group',
    'aria-label': 'Board counts',
    class: 'board-counts mono',
  });
  if (app.board !== null) {
    counts.append(
      el('span', {}, el('span', { text: `On the wall ` }), el('span', { class: 'num', text: String(app.board.counts.on_wall) })),
      el('span', {}, el('span', { text: `Out on loan ` }), el('span', { class: 'num', text: String(app.board.counts.out) })),
      el('span', {}, el('span', { text: `Missing ` }), el('span', { class: 'num', text: String(app.board.counts.missing) })),
    );
  }
  container.append(counts);
  container.append(el('span', { class: 'spacer' }));

  const nav = el('nav');
  const role = app.role();
  nav.append(el('a', { href: '/', text: 'Pegboard' }));
  if (role === 'member') nav.append(el('a', { href: '/account', text: 'Account' }));
  if (role === 'volunteer' || role === 'coordinator') nav.append(el('a', { href: '/desk', text: 'Desk' }));
  if (role === 'coordinator') nav.append(el('a', { href: '/office', text: 'Office' }));
  container.append(nav);

  if (role === null) {
    const signin = el('a', { href: currentPath === '/' || currentPath === '' ? '/signin' : `/signin?next=${encodeURIComponent(currentPath)}`, text: 'Sign in' });
    // The top-bar link opens /signin with no next.
    signin.setAttribute('href', '/signin');
    container.append(el('a', { href: '/join', text: 'Join' }));
    container.append(signin);
  } else {
    const out = el('button', { text: 'Sign out' });
    out.addEventListener('click', async () => {
      await fetch('/api/session', { method: 'DELETE', credentials: 'same-origin' });
      window.location.href = '/';
    });
    container.append(out);
  }
}

/** The service-status banner, directly under the top bar. */
export function renderServiceBanner(container: HTMLElement, status: { storage: string; billing: string }): void {
  const parts: string[] = [];
  if (status.storage === 'down') {
    parts.push('Photo storage is down. Check-ins are held as pending photo until it is back.');
  }
  if (status.billing === 'down') {
    parts.push('Billing is down. Joins, payments, waivers and check-ins that raise a fee will wait until it is back.');
  }
  container.setAttribute('role', 'status');
  container.textContent = parts.join(' ');
}

/** A pending button: static pressed look, ignores further activation. */
export function setPending(button: HTMLButtonElement, pendingLabel: string): void {
  button.dataset.origLabel = button.textContent ?? '';
  button.textContent = pendingLabel;
  button.setAttribute('aria-busy', 'true');
  button.setAttribute('aria-disabled', 'true');
}

export function clearPending(button: HTMLButtonElement): void {
  button.textContent = button.dataset.origLabel ?? button.textContent ?? '';
  button.removeAttribute('aria-busy');
  button.removeAttribute('aria-disabled');
  delete button.dataset.origLabel;
}

export function focusAfterLoad(path: string, role: 'coordinator' | 'volunteer' | 'member' | null): string {
  if (role === null) return '/signin';
  return landingPath(role) + (path === '' ? '' : '');
}
