// The console's shell: routes, navigation, the live-update stream,
// the footer and the shared dialogs. Each page renders into #app.

import { api, ApiError, NetworkError, deviceId, deviceName, DEVICES } from './api';
import { h, clear, perceivedLen, reducedMotion, utcStamp, hoursMinutes, countWord, setStatus, alertIcon, pad2 } from './ui';
import { openDialog, anyDialogOpen, closeAllDialogs, closeTopDialog } from './dialog';
import * as T from './types';
import { PensPage } from './pages/pens';
import { WorkspacePage } from './pages/workspace';
import { DivesPage } from './pages/dives';
import { ImportsPage } from './pages/imports';
import { ReportsPage } from './pages/reports';
import { DevicesPage } from './pages/devices';

export const routes = ['/', '/dives', '/imports', '/reports', '/devices'] as const;
export type Route = (typeof routes)[number] | { workspace: string };

let currentPage: { teardown?: () => void } | null = null;

export function navigate(path: string) {
  if (location.pathname !== path) history.pushState(null, '', path);
  render();
}

export function render() {
  currentPage?.teardown?.();
  closeAllDialogs();
  const app = document.getElementById('app')!;
  clear(app);

  const path = location.pathname;
  let page: { teardown?: () => void };
  if (path === '/' || path === '') {
    page = new PensPage(app);
  } else if (path.startsWith('/pens/')) {
    page = new WorkspacePage(app, path.slice('/pens/'.length).split('/')[0] || 'skv-01');
  } else if (path === '/dives') {
    page = new DivesPage(app);
  } else if (path === '/imports') {
    page = new ImportsPage(app);
  } else if (path === '/reports') {
    page = new ReportsPage(app);
  } else if (path === '/devices') {
    page = new DevicesPage(app);
  } else {
    app.append(h('div', { class: 'gone' }, h('h1', { text: 'Not found' })));
    page = {};
  }
  currentPage = page;
}

// ---------- live updates ----------

export type EventHandler = (e: Record<string, unknown>) => void;
const handlers = new Set<EventHandler>();

export interface EventUnsubscribe { (): void; clear(): void; }

export function onEvent(fn: EventHandler): EventUnsubscribe {
  handlers.add(fn);
  const stop: EventUnsubscribe = (() => { handlers.delete(fn); }) as EventUnsubscribe;
  stop.clear = () => { handlers.delete(fn); };
  return stop;
}

let es: EventSource | null = null;

export function startEvents() {
  try { es?.close(); } catch {}
  es = new EventSource('/api/events');
  es.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data) as Record<string, unknown>;
      for (const fn of handlers) fn(data);
    } catch {}
  };
}

export function announce(text: string) {
  const node = document.getElementById('console-updates');
  if (node) node.textContent = text;
}

export function copyForEvent(e: Record<string, unknown>): string | null {
  const kind = e.kind as string;
  const who = e.device_name as string | undefined;
  const id = e.defect_id as string | undefined;
  switch (kind) {
    case 'defect_created': return `${who} marked ${id}`;
    case 'defect_updated': return `${who} updated ${id}`;
    case 'defect_removed': return `${who} removed ${id}`;
    case 'defect_repaired': return `${who} recorded a repair on ${id}`;
    case 'revision_restored': return `${who} restored revision ${e.number} of ${e.pen_name ?? ''}`;
    case 'link_created': return 'Report link created';
    case 'link_regenerated': return 'Report link regenerated';
    case 'link_revoked': return 'Report link revoked';
    default: return null;
  }
}

function startHeartbeat() {
  const beat = () => api.post('/api/devices/' + deviceId() + '/heartbeat').catch(() => {});
  beat();
  setInterval(beat, 5000);
}

// ---------- shell ----------

export function buildShell(app: HTMLElement, active: string): { main: HTMLElement; updates: HTMLElement } {
  const phone = window.matchMedia('(max-width: 599px)').matches;

  const nav = h('nav', { class: 'center', 'aria-label': 'Main' });
  for (const r of ['/ Pens', '/dives Dives', '/imports Imports', '/reports Reports', '/devices Devices']) {
    const [path, label] = r.split(' ');
    nav.append(h('a', { href: path, 'aria-current': path === active ? 'page' : null, text: label }));
  }

  const bar = h('div', { class: 'topbar' },
    h('a', { class: 'wordmark', href: '/', 'aria-label': 'Pensight home', text: 'Pensight' }),
    phone ? h('button', { class: 'btn menu-btn', 'aria-label': 'Menu', text: 'Menu' }) : nav,
    h('div', { class: 'right' },
      h('button', { class: 'btn', 'aria-label': 'Search', text: 'Search', onclick: () => openSearch(null) }),
    ),
  );

  if (phone) {
    (bar.querySelector('.menu-btn') as HTMLElement).addEventListener('click', (e) => {
      openDialog({
        title: 'Menu',
        body: (root) => {
          const list = h('nav', { 'aria-label': 'Main' });
          for (const [path, label] of [['/', 'Pens'], ['/dives', 'Dives'], ['/imports', 'Imports'], ['/reports', 'Reports'], ['/devices', 'Devices']]) {
            list.append(h('a', { href: path, text: label, style: 'display:block;padding:12px 0;font-size:16px' }));
          }
          root.append(list);
        },
      }, e.currentTarget as HTMLElement);
    });
  }

  const updates = h('div', { id: 'console-updates', class: 'status num', role: 'status', 'aria-label': 'Console updates' });
  const main = h('div', { class: 'page' });
  app.append(bar, main, buildFooter(), updates);
  return { main, updates };
}

function buildFooter(): HTMLElement {
  const phone = window.matchMedia('(max-width: 599px)').matches;
  const footer = h('footer', { class: 'site-footer' });
  const inner = h('div', { class: 'footer-inner' });
  inner.append(h('div', { class: 'wordmark', text: 'Pensight' }));

  const mk = (title: string, items: (HTMLElement | string)[]) => {
    const col = h('div', { class: 'footer-col' });
    const head = h('button', { class: 'linkish', 'aria-expanded': 'false', text: title });
    const links = h('div', { class: 'links' });
    for (const it of items) links.append(typeof it === 'string' ? h('a', { href: it.split(' ')[0], text: it.split(' ')[1] }) : it);
    col.append(head, links);
    if (phone) {
      head.append(h('span', { class: 'plus', text: '+' }));
      head.addEventListener('click', () => {
        const open = col.classList.toggle('open');
        head.setAttribute('aria-expanded', open ? 'true' : 'false');
        head.querySelector('.plus')!.textContent = open ? '×' : '+';
      });
    }
    return col;
  };

  const shortcutsBtn = h('button', { class: 'linkish', text: 'Keyboard shortcuts', onclick: (e: Event) => openShortcuts(e.currentTarget as HTMLElement) });

  inner.append(
    mk('Console', ['/ Pens', '/dives Dives', '/imports Imports', '/reports Reports', '/devices Devices']),
    mk('Data', [h('a', { href: '/api/exports/defects.csv', download: 'defects.csv', text: 'Export all defects (CSV)' })]),
    mk('Help', [shortcutsBtn]),
  );
  footer.append(inner);
  return footer;
}

export function openShortcuts(opener: HTMLElement | null) {
  openDialog({
    title: 'Keyboard shortcuts',
    body: (root) => {
      const rows: [string, string][] = [
        ['Left / Right arrow', 'Orbit the camera 15°'],
        ['Up / Down arrow', 'Tilt the camera 10°'],
        ['+ / -', 'Zoom in / out'],
        ['U', 'Unwrap the pen'],
        ['W', 'Wrap the pen'],
        ['N / P', 'Next / previous defect'],
        ['E', 'Open the editor for the selected defect'],
        ['M', 'Toggle marking mode'],
        ['?', 'Open this dialog'],
      ];
      const table = h('table');
      for (const [k, v] of rows) {
        table.append(h('tr', {}, h('td', { text: k }), h('td', { text: v })));
      }
      root.append(table);
    },
  }, opener);
}

// ---------- search ----------

let searchSeq = 0;
export function openSearch(opener: HTMLElement | null) {
  openDialog({
    title: 'Search',
    body: (root) => {
      const box = h('input', { type: 'search', 'aria-label': 'Search farms, pens and defects', placeholder: 'Search farms, pens and defects' }) as HTMLInputElement;
      const list = h('ul', { 'aria-label': 'Search results', role: 'list', style: 'list-style:none;padding:0;margin:12px 0 0' });
      const status = h('div', { class: 'status num', role: 'status', 'aria-label': 'Search status', text: 'Type at least 2 characters' });
      root.append(box, status, list);

      let timer = 0;
      let sentSeq = searchSeq;
      box.addEventListener('input', () => {
        clearTimeout(timer);
        const text = box.value;
        timer = window.setTimeout(async () => {
          const trimmed = text.trim();
          const thisSeq = ++searchSeq;
          if (perceivedLen(trimmed) < 2) {
            clear(list);
            setStatus(status, 'Type at least 2 characters');
            return;
          }
          try {
            const res = await api.get<{ results: { kind: string; id: string; label: string }[] }>(`/api/search?q=${encodeURIComponent(trimmed)}`);
            if (thisSeq !== searchSeq) return;   // a newer query has been sent
            clear(list);
            for (const r of res.results) {
              const li = h('li');
              li.append(h('a', {
                href: r.kind === 'farm' ? '/#farm-' + r.id : r.kind === 'pen' ? '/pens/' + r.id : `/pens/${r.id.split(' — ')[1] ? '' : ''}`,
                text: r.label,
              }));
              if (r.kind === 'defect') {
                li.replaceChild(h('a', { href: `/pens/${(r.label.match(/^(D-\d+) — (.+)$/)?.[2]) ?? ''}?defect=${r.id.split(' ')[0]}`, text: r.label }), li.firstChild!);
              }
              list.append(li);
            }
            setStatus(status, countWord(res.results.length, 'result', 'results'));
          } catch (e) {
            if (thisSeq !== searchSeq) return;
            if (e instanceof ApiError && e.fields?.q) {
              clear(list);
              setStatus(status, e.fields.q, true);
            } else if (e instanceof NetworkError) {
              setStatus(status, e.message, true);
            }
          }
        }, 240);
      });
      setTimeout(() => box.focus(), 50);
    },
  }, opener);
}

// ---------- boot ----------

function boot() {
  startEvents();
  startHeartbeat();
  render();
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

window.addEventListener('popstate', () => render());

window.addEventListener('online', () => announce(''));
window.addEventListener('offline', () => announce('Pensight server unreachable — changes are not saved'));

document.addEventListener('keydown', (e) => {
  if (e.key === '?' && !anyDialogOpen()) {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
    e.preventDefault();
    openShortcuts(null);
  }
});
