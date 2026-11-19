// Source plate record cards: a white plate with an invented drawn mark, a title, body copy and
// an underlined link pinned to the bottom.

import { el, on, svg } from '../dom.js';
import { entrance } from '../ui/entrance.js';

const MARKS: Record<string, string> = {
  certificate: `<svg viewBox="0 0 120 70" class="plate-mark" role="presentation">
    <rect x="12" y="10" width="96" height="50" rx="6" fill="none" stroke="#1A0B54" stroke-width="3"/>
    <path d="M24 26 H84 M24 36 H72 M24 46 H60" stroke="#307FE2" stroke-width="4" stroke-linecap="round"/>
    <circle cx="94" cy="46" r="10" fill="#307FE2" opacity="0.25"/>
    <path d="M89 46 l4 5 l8 -11" fill="none" stroke="#1A0B54" stroke-width="3" stroke-linecap="round"/>
  </svg>`,
  gauge: `<svg viewBox="0 0 120 70" class="plate-mark" role="presentation">
    <path d="M18 54 A42 42 0 0 1 102 54" fill="none" stroke="#1A0B54" stroke-width="4"/>
    <path d="M18 54 A42 42 0 0 1 46 15" fill="none" stroke="#307FE2" stroke-width="7"/>
    <circle cx="60" cy="54" r="5" fill="#1A0B54"/>
    <path d="M60 54 L82 28" stroke="#1A0B54" stroke-width="4" stroke-linecap="round"/>
  </svg>`,
};

export function plateCard(options: {
  id: string;
  title: string;
  body: string;
  linkLabel: string;
  href: string;
  mark: 'certificate' | 'gauge';
  /** How the page moves to a section: a jump writes no seen record, so the page decides it. */
  onJump: (href: string) => void;
}): HTMLElement {
  const link = el('a', { class: 'text-link plate-link', href: options.href }, [options.linkLabel]);
  if (options.href.startsWith('#')) {
    on(link, 'click', (event) => {
      event.preventDefault();
      options.onJump(options.href);
    });
  }
  return entrance(el('article', {
    role: 'region',
    'aria-label': options.title,
    class: 'plate-card',
    id: options.id,
  }, [
    el('div', { class: 'plate' }, [svg(MARKS[options.mark])]),
    el('h3', { class: 'plate-title', tabindex: '-1' }, [options.title]),
    el('p', { class: 'plate-body' }, [options.body]),
    link,
  ]));
}
