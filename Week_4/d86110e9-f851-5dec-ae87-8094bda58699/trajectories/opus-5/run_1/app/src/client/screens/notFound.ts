import { h } from '../dom';
import { intercept } from '../shell';

export async function renderNotFound(): Promise<HTMLElement> {
  return h(
    'section',
    { class: 'panel panel-dark not-found' },
    h('h1', { class: 'display', text: "We couldn't find that page" }),
    h('p', { class: 'body-text', text: 'It may have moved, or you may not have access to it.' }),
    h('a', { class: 'link-action', href: '/', onclick: intercept, text: 'Back to start' }),
  );
}
