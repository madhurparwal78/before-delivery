// The offline fallback: the app shell loaded with no network (DP-07).

import { h } from './ui.js';

export function renderOffline(shell) {
  shell.append(
    h('nav', { class: 'landmark', 'aria-label': 'Workspace' },
      h('a', { href: '/sites', 'data-link': '' }, 'Walls'),
      h('a', { href: '/kit', 'data-link': '' }, 'Shelf'),
      h('a', { href: '/hire', 'data-link': '' }, 'Hire')),
    h('h1', { class: 'sentence' }, 'NOTHING HERE'));
}
