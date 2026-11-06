// The not-found page: one dimmed blank frame, one sentence, one gold way back.
import { COPY } from '../boot.js';
import { el } from '../dom.js';
import { drawBlankFrame } from '../hero.js';

export function blankFramePrint(width = 240, height = 160) {
  const canvas = el('canvas', {
    width,
    height,
    role: 'img',
    'aria-label': 'Blank frame',
    class: 'print blank',
  });
  drawBlankFrame(canvas);
  return canvas;
}

export async function render() {
  return el('section', { class: 'empty-state' }, [
    blankFramePrint(),
    el('div', {}, [
      el('p', { class: 'muted', text: COPY.empty.not_found }),
      el('a', { href: '/archive', class: 'solid', text: 'Archive' }),
    ]),
  ]);
}
