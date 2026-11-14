import { h } from '../lib/dom.ts';

/** `#page`: the one element whose content is the current page, the closed panel or the confirmation. */
export function mountPage(main: HTMLElement): HTMLElement {
  main.classList.add('respondent');
  const host = h('div', { id: 'page' });
  main.append(host);
  return host;
}

/** Starts the `page-fade` animation again; the stylesheet removes it under reduced motion. */
export function restartFade(host: HTMLElement): void {
  host.classList.remove('fading');
  void host.offsetWidth; // reading the layout makes the next class change start a new animation
  host.classList.add('fading');
}
