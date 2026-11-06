import { UI } from '../../shared/copy.js';
import { bindText, el, say } from '../ui.js';

export function renderNotFound(main: HTMLElement): void {
  while (main.firstChild) main.firstChild.remove();
  const heading = el('h1', { class: 'page-heading' });
  bindText(heading, () => say(UI.notFoundHeading));
  const line = el('p', { class: 'not-found-line' });
  bindText(line, () => say(UI.notFoundLine));
  const link = el('a', { href: '/', class: 'link' });
  bindText(link, () => say(UI.navDrop));
  main.append(heading, line, link);
}
