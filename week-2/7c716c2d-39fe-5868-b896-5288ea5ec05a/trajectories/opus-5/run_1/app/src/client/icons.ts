import { svg } from './dom.js';

/** Thin line icons from Lucide (ISC), drawn inline so no asset is fetched. */
const paths: Record<string, string[]> = {
  issues: ['M13 5h8', 'M13 12h8', 'M13 19h8', 'm3 17 2 2 4-4', 'm3 7 2 2 4-4'],
  cycle: ['M8 2v3', 'M16 2v3', 'M3 9h18', 'M8 13h.01', 'M12 13h.01', 'M16 13h.01', 'M8 17h.01', 'M12 17h.01'],
  chat: [
    'M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
    'M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1',
  ],
  docs: [
    'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z',
    'M14 2v5a1 1 0 0 0 1 1h5',
    'M10 9H8',
    'M16 13H8',
    'M16 17H8',
  ],
  office: ['M10 21H2', 'M10 3H7a2 2 0 0 0-2 2v16', 'M14 12h.01', 'M22 21h-3', 'M19 21V5a2 2 0 0 0-2-2h-5v18'],
  settings: [
    'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915',
  ],
  account: ['M20 21a8 8 0 0 0-16 0'],
  signout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9'],
};

const circles: Record<string, { cx: number; cy: number; r: number }[]> = {
  settings: [{ cx: 12, cy: 12, r: 3 }],
  account: [{ cx: 12, cy: 8, r: 5 }],
};

export function icon(name: string): SVGElement {
  const children: Element[] = [];
  for (const path of paths[name] ?? []) children.push(svg('path', { d: path }));
  for (const shape of circles[name] ?? []) children.push(svg('circle', shape));
  return svg(
    'svg',
    {
      class: 'icon',
      viewBox: '0 0 24 24',
      width: 20,
      height: 20,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.5,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    children,
  );
}
