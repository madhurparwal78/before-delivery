import { NOT_FOUND_COPY } from '../copy.js';
import { el } from '../dom.js';
import type { Page } from '../router.js';

export function notFoundBlock(kind: 'session' | 'page'): HTMLElement {
  return el('div', { class: 'not-found' }, [
    el('h1', { text: 'Not found' }),
    el('p', { text: kind === 'session' ? NOT_FOUND_COPY.session : NOT_FOUND_COPY.page }),
    el('p', {}, [el('a', { href: '/agenda', text: 'Back to the agenda' })]),
  ]);
}

export function notFoundPage(): Page {
  return { element: el('main', { class: 'page page-not-found', id: 'main' }, [notFoundBlock('page')]) };
}
