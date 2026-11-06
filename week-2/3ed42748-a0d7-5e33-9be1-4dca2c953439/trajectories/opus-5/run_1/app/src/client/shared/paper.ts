import { svg } from './dom.js';

const BITES_PER_100_PX = 10;
const BITE_WIDTH = 7;
const CORNER = 7;

let nextMaskId = 0;

interface Bite {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/** Evenly spaced bites along one edge, each a third as deep as it is wide. */
function bitesAlong(length: number, place: (centre: number) => { cx: number; cy: number }): Bite[] {
  const inner = length - CORNER * 2;
  if (inner <= BITE_WIDTH) return [];
  const count = Math.max(1, Math.round((length * BITES_PER_100_PX) / 100));
  const step = inner / count;
  const bites: Bite[] = [];
  for (let index = 0; index < count; index += 1) {
    const centre = CORNER + step * (index + 0.5);
    const { cx, cy } = place(centre);
    bites.push({ cx, cy, rx: BITE_WIDTH / 2, ry: BITE_WIDTH / 3 });
  }
  return bites;
}

function biteElements(width: number, height: number): SVGElement[] {
  const edges = [
    ...bitesAlong(width, (centre) => ({ cx: centre, cy: 0 })),
    ...bitesAlong(width, (centre) => ({ cx: centre, cy: height })),
    ...bitesAlong(height, (centre) => ({ cx: 0, cy: centre })),
    ...bitesAlong(height, (centre) => ({ cx: width, cy: centre })),
  ];
  const sideways = edges.map((bite) =>
    bite.cx === 0 || bite.cx === width
      ? svg('ellipse', { cx: bite.cx, cy: bite.cy, rx: bite.ry, ry: bite.rx, fill: '#000' })
      : svg('ellipse', { cx: bite.cx, cy: bite.cy, rx: bite.rx, ry: bite.ry, fill: '#000' }),
  );
  const corners = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ].map(([cx, cy]) => svg('circle', { cx: cx!, cy: cy!, r: CORNER, fill: '#000' }));
  return [...sideways, ...corners];
}

/**
 * Draws a card's warm paper ground as SVG, with a perforated edge whose bites cut right
 * through, so the planet or page shows between them.
 */
export function paperGround(host: HTMLElement): () => void {
  const maskId = `paper-bite-${(nextMaskId += 1)}`;
  const grainId = `paper-grain-${nextMaskId}`;
  const sheet = svg('svg', {
    class: 'paper-ground',
    'aria-hidden': 'true',
    focusable: 'false',
    preserveAspectRatio: 'none',
  });
  host.prepend(sheet);

  const redraw = (): void => {
    const width = Math.max(1, Math.round(host.clientWidth));
    const height = Math.max(1, Math.round(host.clientHeight));
    sheet.setAttribute('viewBox', `0 0 ${width} ${height}`);
    sheet.setAttribute('width', String(width));
    sheet.setAttribute('height', String(height));
    while (sheet.firstChild) sheet.firstChild.remove();

    const defs = svg('defs');
    const mask = svg('mask', { id: maskId, maskUnits: 'userSpaceOnUse' });
    mask.append(svg('rect', { x: 0, y: 0, width, height, fill: '#fff' }));
    for (const bite of biteElements(width, height)) mask.append(bite);
    const grain = svg('filter', { id: grainId, x: 0, y: 0, width: '100%', height: '100%' });
    grain.append(
      svg('feTurbulence', {
        type: 'fractalNoise',
        baseFrequency: '0.9',
        numOctaves: '2',
        stitchTiles: 'stitch',
      }),
    );
    grain.append(svg('feColorMatrix', { type: 'saturate', values: '0' }));
    defs.append(mask, grain);
    sheet.append(defs);

    const ground = svg('g', { mask: `url(#${maskId})` });
    ground.append(svg('rect', { x: 0, y: 0, width, height, fill: 'var(--paper)' }));
    ground.append(
      svg('rect', {
        x: 0,
        y: 0,
        width,
        height,
        filter: `url(#${grainId})`,
        opacity: '0.07',
      }),
    );
    ground.append(
      svg('rect', {
        x: 0.75,
        y: 0.75,
        width: Math.max(0, width - 1.5),
        height: Math.max(0, height - 1.5),
        fill: 'none',
        stroke: 'var(--ink)',
        'stroke-width': '1.5',
        opacity: '0.5',
      }),
    );
    sheet.append(ground);
  };

  redraw();
  const observer = new ResizeObserver(() => redraw());
  observer.observe(host);
  return () => observer.disconnect();
}
