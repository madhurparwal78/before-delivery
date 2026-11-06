// Top bar, route ribbon, live regions and the page shell.

import { el, currentAccount } from './ui.js';
import { formatPaise } from './format.js';

export interface Station { code: string; name: string }

let stations: Station[] | null = null;

export async function getStations(): Promise<Station[]> {
  if (stations) return stations;
  const r = await fetch('/api/stations');
  const d = await r.json() as { stations: Station[] };
  stations = d.stations;
  return stations;
}

export function stationName(code: string): string {
  return stations?.find((s) => s.code === code)?.name ?? code;
}

export interface RibbonStop { code: string; name: string; time: string | null; terminal?: boolean }

export function renderRibbon(stops: RibbonStop[]): HTMLElement {
  const region = el('div', { class: 'ribbon', role: 'region', 'aria-label': 'Route', tabindex: '0' });
  const strip = el('div', { class: 'strip' });
  for (const s of stops) {
    const stop = el('div', { class: 'stop' + (s.terminal ? ' terminal' : '') });
    stop.appendChild(el('span', { class: 'code' }, s.code));
    stop.appendChild(el('span', { class: 'name' }, s.name));
    if (s.time) stop.appendChild(el('span', { class: 'time' }, s.time));
    strip.appendChild(stop);
  }
  region.appendChild(strip);
  return region;
}

export interface ShellOpts { ribbon?: HTMLElement }

// Lucide line icons, inlined at the stroke weight of the body text.
const LUCIDE = {
  train: '<line x1="5" y1="22" x2="19" y2="22"/><line x1="8" y1="2" x2="8" y2="22"/><line x1="16" y1="2" x2="16" y2="22"/><circle cx="10.5" cy="13.5" r="1"/><circle cx="13.5" cy="15.5" r="1"/>',
  ticket: '<path d="M4 8V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/><line x1="2" x2="22" y1="12" y2="12"/><path d="M6 12h.01M10 12h.01M14 12h.01M18 12h.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
};

export function lucideIcon(name: keyof typeof LUCIDE, label: string | null = null): HTMLElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  }
  svg.innerHTML = LUCIDE[name];
  return svg as unknown as HTMLElement;
}

export function renderShell(main: HTMLElement, opts: ShellOpts = {}): void {
  const app = document.getElementById('app')!;
  app.innerHTML = '';
  const top = el('header', { class: 'top-bar' });
  const mark = el('span', { class: 'wordmark' });
  mark.appendChild(lucideIcon('train'));
  mark.appendChild(document.createTextNode('Pakka Rail '));
  mark.appendChild(el('span', { class: 'num' }, 'पक्का'));
  const nav = el('nav', { class: 'main-nav', 'aria-label': 'Main' });
  const links: [string, string][] = [
    ['/trains', 'Search trains'],
    ['/bookings', 'My bookings'],
    ['/pnr', 'PNR status'],
  ];
  for (const [href, label] of links) {
    const a = el('a', { href }, label);
    nav.appendChild(a);
  }
  if (currentAccount()) {
    const btn = el('button', { class: 'sign-out' }, 'Sign out');
    btn.addEventListener('click', async () => {
      await fetch('/api/session', { method: 'DELETE' });
      sessionStorage.clear();
      location.href = '/';
    });
    nav.appendChild(btn);
  } else {
    nav.appendChild(el('a', { href: '/signin' }, 'Sign in'));
  }
  top.appendChild(mark);
  top.appendChild(nav);
  app.appendChild(top);
  if (opts.ribbon) app.appendChild(opts.ribbon);

  const live = el('div', { id: 'live-regions', role: 'region', 'aria-label': 'Live updates' });
  app.appendChild(live);
  app.appendChild(main);
  void formatPaise;
}

export function mainContainer(): HTMLElement {
  return el('main', { id: 'main' });
}

/** Every screen calls this to attach a document title. */
export function setTitle(t: string): void {
  document.title = `${t} — Pakka Rail`;
}
