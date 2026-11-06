// Pieces several pages use.
import { h } from '../dom.js';
import { paintProcedural } from '../prints.js';

export function notFoundPage(main) {
  const frame = h('canvas', { 'aria-hidden': 'true', class: 'blank-frame' });
  main.replaceChildren(h('div', { class: 'page-head' }, h('h1', {}, 'Not found')),
    h('div', { class: 'empty' }, frame, h('p', {}, 'Not in your archive.')),
    h('a', { class: 'button primary', href: '/archive' }, 'Archive'));
  paintProcedural(frame, 'blank');
}
