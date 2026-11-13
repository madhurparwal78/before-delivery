import { svg } from './dom.js';

const GROUNDS = ['#f04a26', '#1b46d2', '#1f7a4d', '#d9a21b', '#7a2fb0', '#0e8fa8', '#c2185b', '#4a4a4a'];

/** The 24 avatars are drawn by the app: three marks over eight grounds. */
export function avatarSvg(n: number): SVGElement {
  const index = Math.min(Math.max(n, 1), 24) - 1;
  const ground = GROUNDS[index % GROUNDS.length];
  const mark = Math.floor(index / GROUNDS.length);
  const ink = '#121212';
  const light = '#fbf7f2';

  const marks: SVGElement[][] = [
    [
      svg('circle', { cx: 32, cy: 25, r: 11, fill: light, stroke: ink, 'stroke-width': 3 }),
      svg('path', { d: 'M12 56 C12 42 52 42 52 56', fill: light, stroke: ink, 'stroke-width': 3 }),
    ],
    [
      svg('rect', { x: 18, y: 16, width: 28, height: 28, fill: light, stroke: ink, 'stroke-width': 3 }),
      svg('path', { d: 'M18 52 H46', stroke: ink, 'stroke-width': 5 }),
      svg('circle', { cx: 27, cy: 30, r: 3.5, fill: ink }),
      svg('circle', { cx: 37, cy: 30, r: 3.5, fill: ink }),
    ],
    [
      svg('circle', { cx: 32, cy: 32, r: 18, fill: 'none', stroke: light, 'stroke-width': 5 }),
      svg('circle', { cx: 32, cy: 32, r: 7, fill: light, stroke: ink, 'stroke-width': 3 }),
    ],
  ];

  return svg(
    'svg',
    { viewBox: '0 0 64 64', 'aria-hidden': 'true', focusable: 'false' },
    [svg('rect', { width: 64, height: 64, fill: ground }), ...marks[mark]],
  );
}
