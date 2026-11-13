import { svg } from './dom';

/** Lucide line icons (ISC), drawn at hairline weight and never part of an accessible name. */
const PATHS: Readonly<Record<string, ReadonlyArray<[string, Record<string, string | number>]>>> = {
  clock: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['polyline', { points: '12 6 12 12 16 14' }],
  ],
  'chevron-left': [['path', { d: 'm15 18-6-6 6-6' }]],
  'chevron-right': [['path', { d: 'm9 18 6-6-6-6' }]],
  'calendar-days': [
    ['path', { d: 'M8 2v4' }],
    ['path', { d: 'M16 2v4' }],
    ['rect', { width: 18, height: 18, x: 3, y: 4, rx: 2 }],
    ['path', { d: 'M3 10h18' }],
  ],
  snowflake: [
    ['line', { x1: 2, x2: 22, y1: 12, y2: 12 }],
    ['line', { x1: 12, x2: 12, y1: 2, y2: 22 }],
    ['path', { d: 'm20 16-4-4 4-4' }],
    ['path', { d: 'm4 8 4 4-4 4' }],
    ['path', { d: 'm16 4-4 4-4-4' }],
    ['path', { d: 'm8 20 4-4 4 4' }],
  ],
};

export function icon(name: keyof typeof PATHS): SVGElement {
  const root = svg('svg', {
    viewBox: '0 0 24 24',
    width: 16,
    height: 16,
    class: 'icon',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  for (const [tag, attrs] of PATHS[name] ?? []) root.append(svg(tag, attrs));
  return root;
}
