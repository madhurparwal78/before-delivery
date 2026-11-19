import { el } from '../lib/dom.js';
import { COPY } from '../lib/copy.js';
import type { Screen } from '../router.js';

export function notFoundScreen(): Screen {
  const title = el('h1', { class: 'blunt-field', tabindex: '-1' }, COPY.notFound);
  const node = el('section', { class: 'not-found-screen' }, [title]);
  return {
    node,
    afterMount: () => title.focus(),
  };
}
