import { raw, type Markup } from "./html.js";

/** Inline icons drawn for this site: plain strokes and fills on a 24 px grid, coloured by `currentColor`. */

function icon(body: string): Markup {
  return raw(`<svg class="icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">${body}</svg>`);
}

const STROKE = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"';

export const ICONS = {
  previous: icon(`<path d="M15 5 8 12l7 7" ${STROKE}/>`),
  next: icon(`<path d="m9 5 7 7-7 7" ${STROKE}/>`),
  pause: icon('<rect x="6" y="5" width="4" height="14" fill="currentColor"/><rect x="14" y="5" width="4" height="14" fill="currentColor"/>'),
  play: icon('<path d="M8 5v14l11-7z" fill="currentColor"/>'),
  close: icon(`<path d="M5 5l14 14M19 5 5 19" ${STROKE}/>`),
  menu: icon(`<path d="M4 8h16M4 16h16" ${STROKE}/>`),
  eye: icon(`<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" ${STROKE}/><circle cx="12" cy="12" r="3" ${STROKE}/>`),
} as const;
