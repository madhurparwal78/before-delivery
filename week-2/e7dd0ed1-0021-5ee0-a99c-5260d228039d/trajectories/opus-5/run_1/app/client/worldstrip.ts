import { dotGrid } from '../src/worldmap';
import { svgEl } from './dom';

/** The flat dot-grid strip, shared by the marketing page and the replica map. */
export function dotGridSvg(width: number, height: number, step = 5): SVGElement {
  const grid = dotGrid(width, height, step);
  const group = svgEl('g', { class: 'world-dots' });
  for (const dot of grid.dots) {
    group.append(svgEl('circle', { cx: dot.x.toFixed(1), cy: dot.y.toFixed(1), r: 1, class: 'world-dot' }));
  }
  return group;
}
