/** Lucide line icons (https://lucide.dev), ISC license, inlined as SVG. */
export type IconName = 'rotate-ccw' | 'rotate-cw' | 'chevron-left' | 'chevron-right' | 'x' | 'menu' | 'arrow-right';

const PATHS: Record<IconName, string> = {
  'rotate-ccw': 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8',
  'rotate-cw': 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8',
  'chevron-left': 'm15 18-6-6 6-6',
  'chevron-right': 'm9 18 6-6-6-6',
  x: 'M18 6 6 18M6 6l12 12',
  menu: 'M4 6h16M4 12h16M4 18h16',
  'arrow-right': 'M5 12h14m-6-6 6 6-6 6',
};

export function lucideIcon(name: IconName, size = 24, label?: string): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', PATHS[name]);
  svg.append(path);
  return svg;
}
