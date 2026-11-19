// Not-found: a full-width maroon band with white text and a link home.

import { el } from '../dom';
import { COPY } from '../../shared/copy';

export function renderNotFound(main: HTMLElement): void {
  main.textContent = '';
  const band = el('div', { class: 'error-band' });
  band.append(el('h1', { class: 'display' }, COPY.fixed.notFound));
  const home = el('a', { class: 'pw-btn', href: '/' }, 'Pennywasher');
  home.style.background = '#ffffff';
  home.style.color = 'var(--maroon)';
  home.style.borderColor = '#ffffff';
  band.append(home);
  main.append(band);
}
