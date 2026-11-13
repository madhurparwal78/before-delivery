// Shared app chrome: the top strip, the service state region, dialogs and
// the board layout's drawers and sheets.

import { el, clear, announce, trapFocus } from './dom.js';
import { get, del } from './http.js';
import type { Move, Plan, User } from './domain.js';

export interface AppCtx {
  user: User | null;
  services: { billing: 'up' | 'down'; storage: 'up' | 'down'; mail: 'up' | 'down' };
  serviceAnnouncements: HTMLElement;
  container: HTMLElement;
  portNow: string;
}

export function topStrip(ctx: AppCtx, onSignOut: () => void): HTMLElement {
  const strip = el('header', { class: 'top-strip' });
  strip.append(el('span', { class: 'brand' }, 'Slackwater'));
  strip.append(el('span', { class: 'port num' }, ctx.portNow));
  strip.append(el('span', { class: 'role' }, ctx.user ? ctx.user.name : ''));
  const state = el('div', { role: 'region', 'aria-label': 'Service state', class: 'service-state' });
  renderServiceState(state, ctx.services);
  strip.append(state);
  strip.append(el('button', { class: 'link', onclick: '' }, 'Sign out').tap((b) => {
    b.addEventListener('click', () => void onSignOut());
  }));
  return strip;
}

declare global {
  interface HTMLElement {
    tap(fn: (node: HTMLElement) => void): HTMLElement;
  }
}

HTMLElement.prototype.tap = function tap(fn: (node: HTMLElement) => void): HTMLElement {
  fn(this);
  return this;
};

export function renderServiceState(node: HTMLElement, services: AppCtx['services']): void {
  clear(node);
  node.append(el('span', { class: `service billing ${services.billing}` }, `Billing ${services.billing}`));
  node.append(el('span', { class: `service storage ${services.storage}` }, `Storage ${services.storage}`));
  node.append(el('span', { class: `service mail ${services.mail}` }, `Mail ${services.mail}`));
}

export function renderOutageCopy(node: HTMLElement, services: AppCtx['services']): void {
  const lines: string[] = [];
  if (services.billing === 'down') lines.push('Billing provider unreachable - charges and invoices are pending and will post automatically.');
  if (services.storage === 'down') lines.push('Evidence store unreachable - photo uploads are paused until it returns.');
  if (services.mail === 'down') lines.push('Mail service unreachable - notices are pending and will send automatically.');
  announce(node, lines.join(' '));
}

// A dialog that holds focus while open and returns it on close.
export function openDialog(label: string, opener: HTMLElement | null): { dialog: HTMLElement; close: () => void } {
  const dialog = el('div', { role: 'dialog', 'aria-label': label, class: 'dialog', 'aria-modal': 'true' });
  const backdrop = el('div', { class: 'dialog-backdrop' });
  const close = (): void => {
    const exiting = dialog.classList.contains('exiting');
    if (exiting) return;
    dialog.classList.add('exiting');
    const finish = (): void => {
      dialog.remove();
      backdrop.remove();
      document.body.classList.remove('modal-open');
      if (opener && document.contains(opener)) opener.focus();
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else setTimeout(finish, 240);
  };
  dialog.addEventListener('keydown', (event) => {
    const key = event as KeyboardEvent;
    if (key.key === 'Escape') {
      key.preventDefault();
      close();
    } else if (key.key === 'Tab') {
      trapFocus(dialog, key);
    }
  });
  document.body.append(backdrop, dialog);
  document.body.classList.add('modal-open');
  const first = dialog.querySelector<HTMLElement>('input, button, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (first) first.focus();
  return { dialog, close };
}

export function moveSearch(
  label: string,
  moves: readonly Move[],
  render: (filtered: readonly Move[]) => void,
  announceTarget: HTMLElement,
  onQueryChange: (q: string) => void,
  initial: string,
): HTMLElement {
  const search = el('input', {
    type: 'search',
    'aria-label': label,
    class: 'search',
    placeholder: 'Search moves',
    value: initial,
  });
  let timer: number | undefined;
  search.addEventListener('input', () => {
    const q = search.value;
    onQueryChange(q);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const filtered = filterMoves(moves, q);
      render(filtered);
      announce(announceTarget, `${filtered.length} moves shown`);
    }, 250);
  });
  return search;
}

export function filterMoves(moves: readonly Move[], q: string): Move[] {
  if (q.trim() === '') return [...moves];
  const terms = q.toLowerCase().split(/\s+/);
  return moves.filter((m) => {
    const haystack = `${m.ref} ${m.vessel.name} ${m.status}`.toLowerCase();
    return terms.every((t) => t === '' || haystack.includes(t));
  });
}

export async function refreshServices(ctx: AppCtx): Promise<void> {
  const result = await get<{ billing: 'up' | 'down'; storage: 'up' | 'down'; mail: 'up' | 'down' }>('/api/services');
  if (result.ok) {
    ctx.services = result.value;
    const node = document.querySelector<HTMLElement>('[aria-label="Service state"]');
    if (node) renderServiceState(node, ctx.services);
    renderOutageCopy(ctx.serviceAnnouncements, ctx.services);
  }
}

export async function signOut(): Promise<void> {
  await del('/api/session');
  window.location.href = '/login';
}

export async function loadSession(): Promise<User | null> {
  const result = await get<{ user: User }>('/api/session');
  return result.ok ? result.value.user : null;
}

export async function loadPortNow(): Promise<string> {
  const result = await get<{ now: string }>('/api/port');
  return result.ok ? result.value.now : '';
}

export function notFoundPage(): HTMLElement {
  const page = el('div', { class: 'page' });
  page.append(el('h1', { class: 'notfound' }, "We can't find that record"));
  page.append(el('p', {}, 'The record does not exist, or you may not read it.'));
  return page;
}

export function moveToRoleScreen(user: User): void {
  const targets: Record<User['role'], string> = {
    dispatcher: '/board',
    agent: '/orders',
    pilot: '/pilot',
    clerk: '/accounts',
  };
  window.location.href = targets[user.role];
}

export const isDispatcher = (user: User | null): boolean => user?.role === 'dispatcher';
export type { Move, Plan };
