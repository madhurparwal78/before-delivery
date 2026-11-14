import { h } from '../lib/dom.ts';
import { selectField } from './field.ts';

// The three panes sit side by side from 768 pixels; below that the `Pane` list shows exactly one of them. The
// switch is pure CSS on `data-pane`, so it needs no resize events.

const PANES = [
  { value: 'pages', label: 'Pages' },
  { value: 'canvas', label: 'Canvas' },
  { value: 'logic', label: 'Logic' },
];

export function builderLayout(pages: HTMLElement, canvas: HTMLElement, logic: HTMLElement): { switcher: HTMLElement; panes: HTMLElement } {
  const panes = h('div', { class: 'builder', 'data-pane': 'canvas' },
    h('div', { class: 'pane pane-pages' }, pages),
    h('div', { class: 'pane pane-canvas' }, canvas),
    h('div', { class: 'pane pane-logic' }, logic));
  const pane = selectField('Pane', PANES, (value) => { panes.dataset['pane'] = value; });
  pane.show('canvas');
  return { switcher: h('div', { class: 'pane-switch' }, pane.element), panes };
}
