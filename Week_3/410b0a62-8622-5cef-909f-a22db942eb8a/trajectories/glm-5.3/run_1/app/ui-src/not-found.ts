import { h } from './dom.js';

export function renderNotFound(): HTMLElement {
  return h(
    'section',
    { class: 'notfound' },
    h('h1', { class: 'display' }, 'Not found'),
    h('p', {}, "This page isn't available to you."),
    h('a', { class: 'pill pill-primary', href: '/' }, 'Back to home')
  );
}

export function notFoundSignal(): { notFound: true } {
  return { notFound: true };
}
