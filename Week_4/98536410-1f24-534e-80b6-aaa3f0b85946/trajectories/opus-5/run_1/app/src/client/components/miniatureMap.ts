import { el, svg } from '../lib/dom.js';
import { loadCoastline, projectRing } from '../lib/coastline.js';

const VIEW_WIDTH = 760;
const VIEW_HEIGHT = 250;

/** A still miniature of the estate map, drawn from the bundled coastline geometry. */
export function miniatureMap(): HTMLElement {
  const paths = svg('g', { class: 'mini-land' });
  const frame = svg(
    'svg',
    {
      class: 'mini-map',
      viewBox: `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`,
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img',
      'aria-label': 'Miniature map of mainland Portugal and the Azores',
    },
    [svg('rect', { width: VIEW_WIDTH, height: VIEW_HEIGHT, class: 'mini-sea' }), paths],
  );

  void loadCoastline().then((rings) => {
    for (const ring of rings) {
      const points = projectRing(ring, {
        width: VIEW_WIDTH,
        height: VIEW_HEIGHT,
        minLon: -31.6,
        maxLon: -6.2,
        minLat: 36.4,
        maxLat: 42.4,
      });
      paths.appendChild(
        svg('path', { d: `M${points.map(([x, y]) => `${x} ${y}`).join('L')}Z`, class: 'mini-shape' }),
      );
    }
  });

  return el('div', { class: 'mini-map-holder charcoal-panel' }, frame);
}
