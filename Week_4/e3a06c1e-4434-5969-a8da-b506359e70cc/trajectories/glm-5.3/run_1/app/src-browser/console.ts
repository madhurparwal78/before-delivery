// The console shell: rail, navigation, search, service status, plus the session store.

import type { Member, ProjectSummary, Quota, Session, User } from '../src-shared/protocol';
import { el, getJson, navigate, registerRoute, statusRegion, setStatus, uuid } from './lib';
import { SERVICE_STATUS } from '../src-shared/copy';

export type Me = { user: User; org: { id: string; name: string; slug: string; plan: 'pilot' | 'scale' }; project_ids: string[] };

export type ConsoleState = {
  me: Me | null;
  serviceStatus: HTMLElement | null;
  /** The storage outage banner is sticky until a storage-touching request succeeds. */
  storageOutage: boolean;
  billingOutage: boolean;
};

export const consoleState: ConsoleState = { me: null, serviceStatus: null, storageOutage: false, billingOutage: false };

export async function loadMe(): Promise<Me | null> {
  try {
    const me = await getJson<Me>('/api/me');
    consoleState.me = me;
    return me;
  } catch {
    consoleState.me = null;
    return null;
  }
}

export function markStorageFailure(): void {
  consoleState.storageOutage = true;
  renderServiceStatus();
}

export function markStorageSuccess(): void {
  if (consoleState.storageOutage) {
    consoleState.storageOutage = false;
    renderServiceStatus();
  }
}

export function setBillingOutage(down: boolean): void {
  consoleState.billingOutage = down;
  renderServiceStatus();
}

function renderServiceStatus(): void {
  const region = consoleState.serviceStatus;
  if (!region) return;
  region.textContent = '';
  if (consoleState.storageOutage) {
    region.append(el('div', { class: 'banner', role: 'alert' }, SERVICE_STATUS.storage));
  }
  if (consoleState.billingOutage) {
    region.append(el('div', { class: 'banner', role: 'alert' }, SERVICE_STATUS.billing));
  }
}

/** Wraps a fetch to an audio/storage-touching URL so a failure raises the outage banner. */
export async function fetchAudio(url: string): Promise<Response> {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (res.ok) markStorageSuccess();
    else markStorageFailure();
    return res;
  } catch {
    markStorageFailure();
    throw new Error('storage');
  }
}

const NAV_ITEMS: { label: string; route: string; roles: User['role'][] }[] = [
  { label: 'Projects', route: '/console/projects', roles: ['admin', 'developer', 'reviewer', 'approver', 'billing'] },
  { label: 'Usage', route: '/console/usage', roles: ['admin', 'billing'] },
  { label: 'Members', route: '/console/org/members', roles: ['admin'] },
  { label: 'Plan', route: '/console/org/plan', roles: ['admin'] },
];

export async function renderConsoleShell(content: (me: Me) => Promise<HTMLElement>, opts?: { navRoute?: string }): Promise<void> {
  const root = document.getElementById('root')!;
  root.innerHTML = '';
  const me = consoleState.me ?? await loadMe();
  if (!me) { await navigate('/sign-in', true); return; }

  const shell = el('div', { class: 'console-shell' });
  const main = el('main', { class: 'console-main' });
  shell.append(main);

  // Rail for ≥1200px; top bar + Navigation dialog below.
  const isWideRail = window.matchMedia('(min-width: 1200px)').matches;

  const navContent = (nav: HTMLElement): void => {
    const list = el('ul', { class: 'nav-list' });
    for (const item of NAV_ITEMS) {
      if (!item.roles.includes(me.user.role)) continue;
      const li = el('li');
      const a = el('a', { href: item.route, class: opts?.navRoute === item.route ? 'current' : '' }, item.label);
      a.addEventListener('click', (ev) => { ev.preventDefault(); void navigate(item.route); });
      li.append(a);
      list.append(li);
    }
    nav.append(el('p', { class: 'wordmark' }, 'Lowfield'), list);
    if (['admin', 'developer', 'reviewer', 'approver'].includes(me.user.role)) {
      nav.append(buildSearch());
    }
    const signOut = el('button', { class: 'sign-out', type: 'button' }, 'Sign out');
    signOut.addEventListener('click', async () => {
      await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'same-origin' });
      consoleState.me = null;
      await navigate('/', true);
    });
    nav.append(signOut);
  };

  if (isWideRail) {
    const rail = el('nav', { class: 'rail', 'aria-label': 'Console' });
    navContent(rail);
    shell.prepend(rail);
  } else {
    const topbar = el('header', { class: 'topbar' });
    const menu = el('button', { type: 'button', class: 'menu' }, 'Menu');
    topbar.append(el('span', { class: 'wordmark' }, 'Lowfield'), menu);
    shell.prepend(topbar);
    menu.addEventListener('click', () => {
      openNavigationDialog(me);
    });
  }

  // Service status region directly under the top of the workspace.
  const serviceStatus = statusRegion('Service status');
  consoleState.serviceStatus = serviceStatus;
  main.append(serviceStatus);
  renderServiceStatus();

  main.append(await content(me));
  root.append(shell);
  document.title = 'Lowfield Console';
}

function openNavigationDialog(me: Me): void {
  const existing = document.getElementById('nav-dialog') as HTMLDialogElement | null;
  if (existing) { existing.showModal(); return; }
  const dlg = el('dialog', { id: 'nav-dialog', 'aria-label': 'Navigation' }) as HTMLDialogElement;
  const nav = el('nav', { 'aria-label': 'Console' });
  const list = el('ul', { class: 'nav-list' });
  for (const item of NAV_ITEMS) {
    if (!item.roles.includes(me.user.role)) continue;
    const li = el('li');
    const a = el('a', { href: item.route }, item.label);
    a.addEventListener('click', (ev) => { ev.preventDefault(); closeDialog(dlg); void navigate(item.route); });
    li.append(a);
    list.append(li);
  }
  nav.append(list);
  if (['admin', 'developer', 'reviewer', 'approver'].includes(me.user.role)) nav.append(buildSearch());
  const close = el('button', { type: 'button' }, 'Close');
  close.addEventListener('click', () => closeDialog(dlg));
  const body = el('div', { class: 'dialog-body' });
  body.append(nav, close);
  dlg.append(body);
  dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); closeDialog(dlg); });
  document.body.append(dlg);
  dlg.showModal();
  close.focus();
}

/** Close helper that never lets a leftover timer re-hide a reopened dialog. */
export function closeDialog(dlg: HTMLDialogElement): void {
  dlg.close();
  dlg.remove();
}

// ---------- search ----------

function buildSearch(): HTMLElement {
  const wrap = el('div', { class: 'search' });
  const input = el('input', { type: 'search', 'aria-label': 'Search sessions', placeholder: 'Search sessions', autocomplete: 'off' });
  const resultsStatus = statusRegion('Search results');
  const list = el('ul', { class: 'search-results', 'aria-label': 'Session results', hidden: 'true' });
  const statusWrap = el('div', { id: `search-status-${uuid()}` });
  resultsStatus.id = statusWrap.id;
  let timer: number | null = null;
  let seq = 0;

  input.addEventListener('input', () => {
    if (timer !== null) clearTimeout(timer);
    const text = input.value;
    if (text === '') {
      // Clearing empties the list and status, sends nothing, announces nothing.
      seq++;
      setStatus(resultsStatus, '');
      list.textContent = '';
      list.hidden = true;
      return;
    }
    // 250 ms after the last keystroke.
    timer = window.setTimeout(async () => {
      const mySeq = ++seq;
      try {
        const res = await fetch(`/api/sessions/search?q=${encodeURIComponent(text)}`, { credentials: 'same-origin' });
        if (res.status === 422) {
          // A 422 leaves the previous results and status in place and announces nothing.
          return;
        }
        const data = (await res.json()) as { total: number; sessions: Session[] };
        // Only the reply for the box's current text may update the list or the status.
        if (mySeq !== seq || input.value !== text) return;
        list.textContent = '';
        for (const s of data.sessions) {
          const li = el('li');
          const a = el('a', { href: `/console/sessions/${s.id}` }, s.label || 'Untitled session');
          a.addEventListener('click', (ev) => { ev.preventDefault(); void navigate(`/console/sessions/${s.id}`); });
          li.append(a);
          list.append(li);
        }
        list.hidden = false;
        setStatus(resultsStatus, data.total === 1 ? '1 session found.' : `${data.total} sessions found.`);
      } catch {
        // Network errors leave the previous results in place.
      }
    }, 250);
  });
  wrap.append(input, resultsStatus, list);
  return wrap;
}

// ---------- quota meter ----------

export function quotaMeter(quota: Quota): { progressbar: HTMLElement; label: string; pct: number } {
  const pct = Math.min(100, Math.round((quota.used_seconds / Math.max(1, quota.limit_minutes * 60)) * 100));
  const usedMin = (quota.used_seconds / 60).toFixed(2);
  const label = `${usedMin} / ${quota.limit_minutes} min`;
  const bar = el('div', { class: 'progressbar', role: 'progressbar', 'aria-label': 'Quota used', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuetext': label });
  const fill = el('div', { class: 'fill' });
  fill.style.width = `${pct}%`;
  bar.append(fill);
  if (quota.exhausted) bar.classList.add('halted');
  return { progressbar: bar, label, pct };
}

export async function visibleProjects(me: Me): Promise<ProjectSummary[]> {
  const data = await getJson<{ projects: ProjectSummary[] }>('/api/projects');
  void me;
  return data.projects;
}
