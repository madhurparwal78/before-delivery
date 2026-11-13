import { el } from './dom.js';

export function notFoundView(): HTMLElement {
  return el('main', {
    class: 'not-found',
    children: [
      el('h1', { class: 'display-line', text: 'Not found' }),
      el('p', { text: "This page isn't available to you." }),
      el('a', { class: 'pill pill-ink', text: 'Back to home', attrs: { href: '/' } }),
    ],
  });
}
