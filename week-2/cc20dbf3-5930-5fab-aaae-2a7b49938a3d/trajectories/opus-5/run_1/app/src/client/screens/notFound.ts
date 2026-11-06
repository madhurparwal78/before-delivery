import { homePath, state, type Screen } from '../shell.js';
import { element } from '../ui/dom.js';

export function notFoundScreen(): Screen {
  const home = state.user === null ? '/' : homePath(state.user);
  return {
    node: element('div', { class: 'box' }, [
      element('h1', {}, ['Not found']),
      element('a', { href: home }, ['Back to my home screen']),
    ]),
  };
}
