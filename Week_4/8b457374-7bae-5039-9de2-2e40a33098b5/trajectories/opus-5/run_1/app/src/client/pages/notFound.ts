import { NOT_FOUND_HEADING } from '../../shared/copy.js';
import { el } from '../dom.js';

export function renderNotFound(main: HTMLElement): void {
  main.replaceChildren(
    el(
      'section',
      { class: 'page page--narrow not-found' },
      el('h1', { class: 'page-heading' }, NOT_FOUND_HEADING),
      el('p', {}, el('a', { href: '/', class: 'button button--stadium' }, 'Back to campaigns')),
    ),
  );
}
