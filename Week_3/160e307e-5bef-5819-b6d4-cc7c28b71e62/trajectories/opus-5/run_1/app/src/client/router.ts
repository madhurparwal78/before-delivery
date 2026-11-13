import { clear, el, need } from './dom.js';
import { applyOutageState } from './store.js';

export interface Route {
  path: string;
  render: (params: Record<string, string>, view: HTMLElement) => void | Promise<void>;
}

const routes: Route[] = [];
let teardown: (() => void) | null = null;

export function route(path: string, render: Route['render']): void {
  routes.push({ path, render });
}

export function onLeave(fn: () => void): void {
  const previous = teardown;
  teardown = () => {
    previous?.();
    fn();
  };
}

function match(pathname: string): { route: Route; params: Record<string, string> } | null {
  const parts = pathname.split('/').filter(Boolean);
  for (const candidate of routes) {
    const pattern = candidate.path.split('/').filter(Boolean);
    if (pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < pattern.length; i += 1) {
      if (pattern[i].startsWith(':')) params[pattern[i].slice(1)] = decodeURIComponent(parts[i]);
      else if (pattern[i] !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route: candidate, params };
  }
  return null;
}

export function setPageStatus(text: string): void {
  need('page-status').textContent = text;
}

export function navigate(path: string, replace = false): void {
  if (replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  void render();
}

export function loading(view: HTMLElement): void {
  clear(view);
  const pockets = [
    '<circle cx="18" cy="18" r="11"/>',
    '<circle cx="74" cy="18" r="11"/>',
    '<circle cx="18" cy="74" r="11"/>',
    '<circle cx="74" cy="74" r="11"/>',
  ].join('');
  const wrapper = el('div', { class: 'loading' });
  wrapper.innerHTML = `<svg viewBox="0 0 92 92" aria-hidden="true" focusable="false" fill="currentColor">${pockets}</svg>`;
  view.append(wrapper);
}

export async function render(): Promise<void> {
  teardown?.();
  teardown = null;
  const view = need('view');
  setPageStatus('');
  const found = match(window.location.pathname);
  if (found === null) {
    clear(view);
    view.append(
      el('section', { class: 'field field--ground' }, [
        el('h1', { class: 'display', text: 'Page not found' }),
        el('p', {}, [el('a', { href: '/', text: 'Home' })]),
      ]),
    );
    return;
  }
  loading(view);
  await found.route.render(found.params, view);
  applyOutageState();
}

export function startRouter(): void {
  window.addEventListener('popstate', () => void render());
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const anchor = (event.target as Element | null)?.closest('a');
    if (anchor === null || anchor === undefined) return;
    const href = anchor.getAttribute('href');
    if (href === null || !href.startsWith('/') || anchor.hasAttribute('download')) return;
    event.preventDefault();
    navigate(href);
  });
  void render();
}
