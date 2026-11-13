import { SCREEN_STATES } from '../../shared/copy.js';
import { element } from '../dom.js';
import type { Screen, ScreenContext } from './screen.js';

export function renderNotFound({ shell }: ScreenContext): Screen {
  shell.main.append(element('h1', {}, ['Not in your deck']));
  shell.field.showMessage(SCREEN_STATES.unknown);
  return { destroy: () => undefined };
}
