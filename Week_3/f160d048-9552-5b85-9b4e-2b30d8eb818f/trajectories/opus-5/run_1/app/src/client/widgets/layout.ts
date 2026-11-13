import { el } from '../core/dom';

export function splitStage(reading: HTMLElement, field: HTMLElement): HTMLElement {
  reading.classList.add('reading-column');
  field.classList.add('pinned-field');
  return el('div', { class: 'split-stage' }, [reading, field]);
}

export function narrowForm(heading: string, children: ReadonlyArray<Node>): HTMLElement {
  return el('div', { class: 'narrow-page' }, [el('h1', { text: heading }), ...children]);
}

export function emptyState(sentence: string, action: Node): HTMLElement {
  return el('div', { class: 'empty-state' }, [el('p', { text: sentence }), action]);
}

export function isPhone(): boolean {
  return window.innerWidth < 640;
}
