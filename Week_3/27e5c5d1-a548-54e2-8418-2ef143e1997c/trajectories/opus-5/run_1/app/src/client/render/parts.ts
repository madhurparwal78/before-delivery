import type { MoverColour } from '../../shared/types';
import { el } from '../lib/dom';

export function lockIcon(): HTMLElement {
  const wrap = el('span', { class: 'lock', attrs: { role: 'img', 'aria-label': 'Private card' } });
  wrap.innerHTML =
    '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">' +
    '<rect x="3.5" y="7" width="9" height="6.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
    '<path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
  return wrap;
}

export function dotsIcon(): HTMLElement {
  const wrap = el('span', { class: 'dots', attrs: { 'aria-hidden': 'true' } });
  wrap.innerHTML =
    '<svg viewBox="0 0 16 16" width="16" height="16" focusable="false">' +
    '<circle cx="3" cy="8" r="1.4" fill="currentColor"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/>' +
    '<circle cx="13" cy="8" r="1.4" fill="currentColor"/></svg>';
  return wrap;
}

export function personChip(label: string, initials: string, colour: MoverColour, extraClass = ''): HTMLElement {
  return el('span', {
    class: `chip chip-${colour} ${extraClass}`.trim(),
    text: initials,
    attrs: { role: 'img', 'aria-label': label },
  });
}
