/** The custom cursor and the footer wordmark wave. */

import { FOOTER_WAVE_LINE } from '../shared/rules.js';
import { need, onScrollOrResize, query, reducedMotion } from './dom.js';

type CursorState = 'default' | 'link' | 'view' | 'drag';

const stateFor = (target: Element): CursorState => {
  if (target.closest('[data-project]') !== null) return 'view';
  if (target.closest('[data-review-track]') !== null) return 'drag';
  if (target.closest('a, button, [role="tab"], input, select, textarea, label') !== null) {
    return 'link';
  }
  return 'default';
};

const LABELS: Record<CursorState, string> = {
  default: '',
  link: '',
  view: 'View',
  drag: 'Drag',
};

export const setUpCursor = (): void => {
  const cursor = need<HTMLElement>('[data-cursor]');
  const label = need<HTMLElement>('[data-cursor-label]', cursor);

  const hide = (): void => {
    cursor.dataset.visible = 'false';
  };

  document.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse' || reducedMotion()) {
      hide();
      return;
    }
    cursor.style.left = `${event.clientX}px`;
    cursor.style.top = `${event.clientY}px`;
    cursor.dataset.visible = 'true';
    const target = event.target;
    const state = target instanceof Element ? stateFor(target) : 'default';
    cursor.dataset.cursorState = state;
    label.textContent = LABELS[state];
  });
  document.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse') hide();
  });
  document.addEventListener('mouseleave', hide);
  window.addEventListener('blur', hide);
};

export const setUpFooterWave = (): void => {
  const footer = query<HTMLElement>('[data-footer]');
  if (footer === null) return;
  onScrollOrResize(() => {
    if (footer.dataset.waved === 'true') return;
    if (footer.getBoundingClientRect().top <= window.innerHeight * FOOTER_WAVE_LINE) {
      footer.dataset.waved = 'true';
    }
  });
};
