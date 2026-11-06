// A tiny client-side router with a stone route wipe. Every screen registers
// itself here, and layout classes switch at exactly 768 and 1024 pixels.
import { el } from './ui.js';

export type RenderFn = (root: HTMLElement, params: Record<string, string>) => Promise<HTMLElement | null>;

interface Route { pattern: RegExp; fn: RenderFn; }

export const routes: Route[] = [];

export function route(pattern: string, fn: RenderFn): void {
  const source = pattern.replace(/:([a-zA-Z]+)/g, (_m, name) => `(?<${name}>[^/]+)`);
  routes.push({ pattern: new RegExp(`^${source}$`), fn });
}

let currentHeading: HTMLElement | null = null;

export function layoutClass(): void {
  const w = window.innerWidth;
  const cls = w < 768 ? 'phone' : w < 1024 ? 'tablet' : 'desktop';
  document.documentElement.classList.remove('phone', 'tablet', 'desktop');
  document.documentElement.classList.add(cls);
}

let reduceMotion = false;
function refreshReducedMotion(): void {
  reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
refreshReducedMotion();
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', refreshReducedMotion);

export function prefersReducedMotion(): boolean { return reduceMotion; }

export async function navigate(path: string, opts: { push?: boolean; wipe?: boolean; back?: boolean } = {}): Promise<void> {
  layoutClass();
  const app = document.getElementById('app');
  if (!app) return;
  const useWipe = opts.wipe !== false && !reduceMotion && !sameScreen(path);
  if (useWipe) {
    const wipe = el('div', { class: `wipe ${opts.back ? 'reverse' : ''}` });
    document.body.append(wipe);
    await new Promise(r => setTimeout(r, 300));
    await render(path, app);
    setTimeout(() => wipe.remove(), 300);
  } else {
    await render(path, app);
  }
  if (opts.push !== false && location.pathname + location.search !== path && !opts.back) {
    history.pushState({}, '', path);
  }
  if (currentHeading) {
    currentHeading.setAttribute('tabindex', '-1');
    currentHeading.focus({ preventScroll: false });
    if (!useWipe) currentHeading.scrollIntoView({ behavior: 'instant', block: 'start' });
  }
}

let lastPath = '';
function sameScreen(path: string): boolean {
  return path.split('?')[0] === lastPath.split('?')[0];
}

async function render(path: string, app: HTMLElement): Promise<void> {
  const clean = path.split('?')[0];
  lastPath = path;
  const params = parseParams(path);
  for (const r of routes) {
    const m = r.pattern.exec(clean);
    if (m) {
      const named: Record<string, string> = { ...params, ...(m.groups ?? {}) };
      app.replaceChildren();
      const main = el('main', { id: 'main' });
      app.append(main);
      const h = await r.fn(main, named);
      currentHeading = h ?? main.querySelector('h1');
      return;
    }
  }
  const main = el('main', { id: 'main' });
  app.replaceChildren(main);
  main.append(notFoundScreen());
  currentHeading = main.querySelector('h1');
}

function parseParams(path: string): Record<string, string> {
  const idx = path.indexOf('?');
  const out: Record<string, string> = {};
  if (idx === -1) return out;
  for (const pair of path.slice(idx + 1).split('&')) {
    const eq = pair.indexOf('=');
    if (eq === -1) out[decodeURIComponent(pair)] = '';
    else out[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1));
  }
  return out;
}

export function queryOf(path: string): URLSearchParams {
  return new URLSearchParams(path.slice(path.indexOf('?') + 1));
}

export function notFoundScreen(): HTMLElement {
  const root = el('div', {});
  const h = el('h1', {}, 'Page not found');
  root.append(h, el('a', { href: '/', text: 'Back to the drop calendar' }));
  return root;
}

export function startRouter(): void {
  window.addEventListener('popstate', () => {
    void navigate(location.pathname + location.search, { push: false, wipe: true });
  });
  layoutClass();
  window.addEventListener('resize', layoutClass);
  void navigate(location.pathname + location.search, { push: false, wipe: false });
  document.addEventListener('click', (e: MouseEvent) => {
    const target = (e.target as HTMLElement).closest('a');
    if (!target) return;
    const href = target.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('mailto:') || target.hasAttribute('download')) return;
    if (target.hasAttribute('data-external')) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    void navigate(href, { wipe: true });
  });
}

// The intro roll: the tagline's city word steps through the markets and settles
// on Copenhagen, once per browser session.
export function introRoll(host: HTMLElement): void {
  if (sessionStorage.getItem('hourline-intro') === '1') return;
  sessionStorage.setItem('hourline-intro', '1');
  if (reduceMotion) return;
  const cities = ['Stockholm', 'Paris', 'London', 'New York', 'Tokyo', 'Copenhagen'];
  let i = 0;
  const step = (): void => {
    const span = host.querySelector<HTMLElement>('.intro-city');
    if (!span) return;
    i += 1;
    span.textContent = cities[i];
    if (i < cities.length - 1) setTimeout(step, 560);
  };
  setTimeout(step, 560);
}
