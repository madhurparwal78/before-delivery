import { COPY } from '../copy.js';
import { h } from '../dom.js';

export function notFoundScreen(): Node {
  return h('section', { class: 'screen narrow' }, [
    h('h1', { text: 'Page not found' }),
    h('p', { text: COPY.pageNotFound }),
  ]);
}
