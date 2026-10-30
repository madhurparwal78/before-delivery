import { svg } from '../dom.js';

/** Lucide line icons (ISC), drawn inline so nothing loads from another origin. */
const PATHS = {
  'chevron-left': ['M15 18l-6-6 6-6'],
  'chevron-right': ['M9 18l6-6-6-6'],
  flame: [
    'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z',
  ],
  clock: ['M12 6v6l4 2'],
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName): SVGSVGElement {
  const node = svg(
    'svg',
    {
      class: `icon icon-${name}`,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    PATHS[name].map((d) => svg('path', { d })),
  );
  if (name === 'clock') node.append(svg('circle', { cx: 12, cy: 12, r: 10 }));
  return node;
}
