import { s } from './dom.js';

/** Thin line icons, drawn from the Lucide icon set (ISC). */
const PATHS: Record<string, string[]> = {
  square: ['M3 3h18v18H3z'],
  circle: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z'],
  diamond: ['M12 2 22 12 12 22 2 12z'],
  type: ['M4 7V4h16v3', 'M9 20h6', 'M12 4v16'],
  grid: ['M3 9h18', 'M3 15h18', 'M9 3v18', 'M15 3v18'],
  'align-left': ['M3 3v18', 'M7 7h10', 'M7 13h7'],
  undo: ['M3 7v6h6', 'M3 13a9 9 0 1 0 3-7'],
  redo: ['M21 7v6h-6', 'M21 13a9 9 0 1 1-3-7'],
  'zoom-out': ['M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', 'M21 21l-4.3-4.3', 'M8 11h6'],
  'zoom-in': ['M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', 'M21 21l-4.3-4.3', 'M8 11h6', 'M11 8v6'],
  maximize: ['M3 9V3h6', 'M21 9V3h-6', 'M3 15v6h6', 'M21 15v6h-6'],
  layers: ['M12 2 2 7l10 5 10-5z', 'M2 13l10 5 10-5'],
  panel: ['M3 3h18v18H3z', 'M15 3v18'],
  plus: ['M12 5v14', 'M5 12h14'],
  eye: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  'eye-off': ['M3 3l18 18', 'M10.6 5.2A10 10 0 0 1 22 12s-1.3 2.5-3.8 4.4', 'M6.2 7.6A13 13 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 3.2-.5'],
  lock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  unlock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 7.5-2'],
  share: ['M12 3v12', 'M8 7l4-4 4 4', 'M4 15v6h16v-6'],
  download: ['M12 3v12', 'M8 11l4 4 4-4', 'M4 19h16'],
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
  chevronLeft: ['M15 18l-6-6 6-6'],
  chevronRight: ['M9 6l6 6-6 6'],
  'more-horizontal': ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  message: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  history: ['M3 3v6h6', 'M3.5 9a9 9 0 1 0 2.1-3.4L3 9', 'M12 8v4l3 2'],
  image: ['M3 3h18v18H3z', 'M3 15l5-5 4 4 3-3 6 6'],
};

export function icon(name: keyof typeof PATHS | string): SVGElement {
  const paths = PATHS[name] ?? [];
  return s(
    'svg',
    {
      class: 'icon',
      viewBox: '0 0 24 24',
      width: '16',
      height: '16',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.5',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    ...paths.map((d) => s('path', { d })),
  );
}

/** The line padlock drawn at the top-left corner of a shape on a locked layer. */
export function lockBadge(x: number, y: number): SVGElement {
  return s(
    'g',
    { class: 'lock-icon', 'aria-hidden': 'true', transform: `translate(${x - 2} ${y - 2})` },
    s('rect', { x: '0', y: '5', width: '10', height: '7', rx: '1' }),
    s('path', { d: 'M2.4 5V3.4a2.6 2.6 0 0 1 5.2 0V5' }),
  );
}
