import { M65 } from '../../shared/messages.ts';
import { api } from './api.ts';
import { byId, h, replaceChildren, svg } from './dom.ts';

// The frame every screen shares: the live regions already sit in the HTML shell; this builds the owner navigation,
// the one <main> and the loading state (the dim page map, never a spinner).

export type FormPage = 'edit' | 'summary' | 'responses' | 'editions';
interface FrameOptions { owner?: boolean; form?: { id: string; current: FormPage; showState?: boolean } }

/** The dim page map: three rooms and the path between them, drawn in the dim tone. */
function dimMap(): SVGSVGElement {
  const room = (x: number, y: number, w: number): SVGRectElement => svg('rect', { x, y, width: w, height: 14, fill: 'currentColor' });
  return svg('svg', { class: 'dim-map', viewBox: '0 0 320 150', 'aria-hidden': 'true', focusable: 'false' },
    room(0, 0, 120), room(0, 24, 80), room(0, 48, 100),
    room(150, 0, 130), room(150, 24, 90), room(150, 48, 110), room(150, 72, 70),
    room(0, 100, 150), room(0, 124, 110));
}

export function frame(options: FrameOptions = {}): HTMLElement {
  const root = byId('root');
  if (!root) throw new Error('The page has no root.');
  const main = h('main', { id: 'main', 'aria-busy': 'true', tabindex: '-1' }, dimMap());
  const parts: Node[] = [];
  if (options.owner) {
    parts.push(h('header', { class: 'site-bar' },
      h('nav', { 'aria-label': 'Main', class: 'site-nav' },
        h('a', { href: '/forms' }, 'Forms'),
        h('button', { type: 'button', class: 'plain', onclick: () => { void signOut(); } }, 'Sign out'))));
  }
  if (options.form) {
    const { id, current } = options.form;
    const link = (page: FormPage, label: string, path: string): HTMLAnchorElement =>
      h('a', { href: `/forms/${id}/${path}`, ...(current === page ? { 'aria-current': 'page' } : {}) }, label);
    parts.push(h('div', { class: 'form-bar' },
      h('nav', { 'aria-label': 'Form', class: 'form-nav' }, link('edit', 'Edit', 'edit'), link('summary', 'Summary', 'summary'), link('responses', 'Responses', 'responses'), link('editions', 'Editions', 'editions')),
      options.form.showState === false ? null : h('span', { id: 'form-state', class: 'badge' })));
  }
  replaceChildren(root, ...parts, main);
  return main;
}

/** First data has arrived: drop the loading map and set the document title. */
export function ready(main: HTMLElement, title: string): void {
  main.querySelector(':scope > .dim-map')?.remove();
  main.removeAttribute('aria-busy');
  document.title = title;
}

export function stateText(state: string): string {
  return state === 'draft' ? 'Draft' : state === 'closed' ? 'Closed' : 'Open';
}

export function showFormState(state: string): void {
  const badge = byId('form-state');
  if (badge) badge.textContent = stateText(state);
}

/** The session ends and the sign-in screen is drawn in place, so no second page load can collide with one already under way. */
async function signOut(): Promise<void> {
  await api('DELETE', '/api/session');
  history.replaceState(null, '', '/signin');
  await (await import('../screens/signin.ts')).render();
}

export function notFound(): void {
  const main = frame();
  ready(main, `${M65} - Nightform`);
  main.append(h('h1', {}, M65), h('p', {}, h('a', { href: '/' }, 'Nightform')));
}

/** The one heading and at most one action of the expired, already-sent and not-found pages. */
export function messagePage(heading: string, action?: { href: string; text: string }): void {
  const main = frame();
  ready(main, `${heading} - Nightform`);
  const title = h('h1', { tabindex: '-1' }, heading);
  main.append(title);
  if (action) main.append(h('p', {}, h('a', { href: action.href }, action.text)));
  title.focus();
}
