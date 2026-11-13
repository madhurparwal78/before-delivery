/**
 * Icons from the Lucide set, shipped with the desk as inline outlines so nothing is fetched
 * from another site. Each one sits beside its own text label and is marked decorative, so
 * no control depends on an icon for its accessible name.
 */

import { h } from '../shared/html';

/** The `d` attributes of each Lucide glyph, taken from lucide-static (ISC). */
const GLYPHS = {
  wrench: [
    'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
  ],
  'package-search': [
    'M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14',
    'm7.5 4.27 9 5.15',
    'M3.29 7 12 12l8.71-5',
    'M12 22V12',
    'M16.5 17.5 19 20',
    'M20 14a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
  ],
} as const;

export type IconName = keyof typeof GLYPHS;

export function icon(name: IconName): string {
  return h(
    'svg',
    {
      class: `lucide lucide-${name}`,
      xmlns: 'http://www.w3.org/2000/svg',
      width: 20,
      height: 20,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    ...GLYPHS[name].map((path) => h('path', { d: path })),
  );
}
