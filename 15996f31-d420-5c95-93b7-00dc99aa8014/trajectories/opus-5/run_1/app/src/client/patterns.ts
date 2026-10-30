import { NOT_INSPECTED_LABEL, tierLabel, type Tier } from '../shared/labels';
import { el } from './core';

const INK = '#16251c';
const AMBER = '#9a5f04';

function dataUri(width: number, height: number, body: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function hexagonPath(centreX: number, centreY: number, radius: number): string {
  const half = (Math.sqrt(3) * radius) / 2;
  const points: Array<[number, number]> = [
    [centreX, centreY - radius],
    [centreX - half, centreY - radius / 2],
    [centreX - half, centreY + radius / 2],
    [centreX, centreY + radius],
    [centreX + half, centreY + radius / 2],
    [centreX + half, centreY - radius / 2],
  ];
  return `M${points.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L')}Z`;
}

/** A dense ink cross-hatch. */
function crossHatch(): string {
  const tile = 6;
  const lines = [
    `M-1 1L1 -1`,
    `M0 ${tile}L${tile} 0`,
    `M${tile - 1} ${tile + 1}L${tile + 1} ${tile - 1}`,
    `M-1 ${tile - 1}L1 ${tile + 1}`,
    `M0 0L${tile} ${tile}`,
    `M${tile - 1} -1L${tile + 1} 1`,
  ]
    .map((path) => `<path d="${path}" />`)
    .join('');
  return dataUri(tile, tile, `<g stroke="${INK}" stroke-width="0.6" fill="none">${lines}</g>`);
}

/** Widely spaced amber dots. */
function amberDots(): string {
  return dataUri(
    18,
    18,
    `<circle cx="9" cy="9" r="2" fill="${AMBER}" /><circle cx="0" cy="0" r="2" fill="${AMBER}" /><circle cx="18" cy="18" r="2" fill="${AMBER}" />`,
  );
}

/** Amber diagonal hairlines all running the same way. */
function amberDiagonals(): string {
  return dataUri(
    8,
    8,
    `<g stroke="${AMBER}" stroke-width="1" fill="none"><path d="M-2 2L2 -2" /><path d="M-2 10L10 -2" /><path d="M6 10L10 6" /></g>`,
  );
}

/** A close amber honeycomb. */
function amberHoneycomb(): string {
  const radius = 6;
  const width = Number((Math.sqrt(3) * radius).toFixed(2));
  const height = radius * 3;
  const body = [
    hexagonPath(width / 2, 0, radius),
    hexagonPath(width / 2, height, radius),
    hexagonPath(0, height / 2, radius),
    hexagonPath(width, height / 2, radius),
  ]
    .map((path) => `<path d="${path}" />`)
    .join('');
  return dataUri(
    width,
    height,
    `<g stroke="${AMBER}" stroke-width="0.9" fill="none">${body}</g>`,
  );
}

const TIER_PATTERNS: Record<Tier, string> = {
  none: crossHatch(),
  reduced: amberDots(),
  standard: amberDiagonals(),
  bonus: amberHoneycomb(),
};

export function tierPattern(tier: Tier | null): string {
  return tier === null ? 'none' : (TIER_PATTERNS[tier] as string);
}

const TIER_LEGEND: ReadonlyArray<{ tier: Tier | null; label: string }> = [
  { tier: 'none', label: tierLabel('none') },
  { tier: 'reduced', label: tierLabel('reduced') },
  { tier: 'standard', label: tierLabel('standard') },
  { tier: 'bonus', label: tierLabel('bonus') },
  { tier: null, label: NOT_INSPECTED_LABEL },
];

/** The tier legend: one item per tier label with its pattern swatch. */
export function tierLegend(): HTMLElement {
  const items = TIER_LEGEND.map((entry) => {
    const swatch = el('span', {
      class: 'legend__swatch',
      'data-tier': entry.tier ?? 'none-yet',
      'aria-hidden': 'true',
    });
    swatch.style.backgroundImage = tierPattern(entry.tier);
    return el('li', { class: 'legend__item' }, [
      swatch,
      el('span', { class: 'legend__label', text: entry.label }),
    ]);
  });
  return el('div', { class: 'legend' }, [
    el('h3', { class: 'legend__title', text: 'Tier legend' }),
    el('ul', { class: 'legend__list', 'aria-label': 'Tier legend' }, items),
  ]);
}
