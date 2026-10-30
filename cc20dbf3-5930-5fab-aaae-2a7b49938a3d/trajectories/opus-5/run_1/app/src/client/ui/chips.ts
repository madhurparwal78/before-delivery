import { element } from './dom.js';

/** Every status reads as a word next to its fill pattern, so it survives greyscale. */
export function statusChip(word: string): HTMLElement {
  return element('span', { class: 'chip' }, [
    element('span', { class: `swatch fill-${word.toLowerCase()}`, 'aria-hidden': 'true' }),
    word,
  ]);
}
