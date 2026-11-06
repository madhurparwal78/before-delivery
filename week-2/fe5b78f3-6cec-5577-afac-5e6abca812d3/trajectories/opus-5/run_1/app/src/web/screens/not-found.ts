import { h } from '../dom';
import type { Screen, ScreenContext } from '../screen';

export function renderNotFound(context: ScreenContext): Screen {
  context.main.appendChild(h('div', { class: 'panel' }, [
    h('h1', {}, ['Page not found']),
    h('p', {}, ['That page is not part of Pakka Rail.']),
  ]));
  return { ribbon: [] };
}
