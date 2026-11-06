/**
 * The not-found copy: an unknown session or address renders inside the normal
 * chrome, with a link back to the agenda.
 */

import { el } from '../dom.js';

export function renderSessionNotFound(): HTMLElement {
  return el('div', { class: 'not-found' },
    el('h1', { class: 'page-title' }, 'We could not find that session.'),
    el('p', {}, el('a', { href: '/agenda' }, 'Go to the agenda')),
  );
}

export function renderNotFound(): Promise<void> {
  const app = document.getElementById('app') as HTMLElement;
  const main = el('main', { id: 'main' });
  app.textContent = '';
  app.append(main);
  main.append(
    el('div', { class: 'not-found' },
      el('h1', { class: 'page-title' }, 'We could not find that page.'),
      el('p', {}, el('a', { href: '/agenda' }, 'Go to the agenda')),
    ),
  );
  return Promise.resolve();
}
