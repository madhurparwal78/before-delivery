import { el, svg } from './dom.js';
import type { DisplayState } from './types.js';

export type StateStyle = {
  label: string;
  lowercase: string;
  fill: string;
  ringWidth: number;
  dash: string;
  hatched: boolean;
};

/** The one definition that drives the markers, the map legend and the shops table. */
export const STATE_STYLES: Readonly<Record<DisplayState, StateStyle>> = {
  open: {
    label: 'Open',
    lowercase: 'open',
    fill: 'var(--state-open)',
    ringWidth: 2,
    dash: 'none',
    hatched: false,
  },
  closing_soon: {
    label: 'Closing soon',
    lowercase: 'closing soon',
    fill: 'var(--state-closing)',
    ringWidth: 3,
    dash: '6 4',
    hatched: false,
  },
  closed: {
    label: 'Closed',
    lowercase: 'closed',
    fill: 'var(--state-closed)',
    ringWidth: 1,
    dash: '2 3',
    hatched: false,
  },
  stock_critical: {
    label: 'Stock critical',
    lowercase: 'stock critical',
    fill: 'var(--state-critical)',
    ringWidth: 4,
    dash: '3 3',
    hatched: false,
  },
  suspended: {
    label: 'Suspended',
    lowercase: 'suspended',
    fill: 'var(--state-suspended)',
    ringWidth: 2,
    dash: '1 5',
    hatched: true,
  },
};

export const STATE_ORDER: readonly DisplayState[] = [
  'open',
  'closing_soon',
  'closed',
  'stock_critical',
  'suspended',
];

const HATCH_ID = 'tramela-hatch';

export function hatchDefinition(): SVGElement {
  return svg('defs', {}, [
    svg(
      'pattern',
      { id: HATCH_ID, width: 4, height: 4, patternTransform: 'rotate(45)', patternUnits: 'userSpaceOnUse' },
      [
        svg('rect', { width: 4, height: 4, fill: 'var(--state-suspended)' }),
        svg('line', { x1: 0, y1: 0, x2: 0, y2: 4, stroke: 'var(--carmine)', 'stroke-width': 1.5 }),
      ],
    ),
  ]);
}

/** The swatch and ring sample shared by markers, the legend and the table's State column. */
function stateSwatch(state: DisplayState, size = 22): SVGElement {
  const style = STATE_STYLES[state];
  const radius = size / 2 - style.ringWidth;
  return svg(
    'svg',
    {
      class: 'state-swatch',
      width: size,
      height: size,
      viewBox: `0 0 ${size} ${size}`,
      'aria-hidden': 'true',
      focusable: 'false',
    },
    [
      hatchDefinition(),
      svg('circle', {
        cx: size / 2,
        cy: size / 2,
        r: radius,
        fill: style.hatched ? `url(#${HATCH_ID})` : style.fill,
        stroke: 'var(--ink)',
        'stroke-width': style.ringWidth,
        'stroke-dasharray': style.dash === 'none' ? null : style.dash,
      }),
    ],
  );
}

export function stateCell(state: DisplayState): HTMLElement {
  return el('span', { class: 'state-cell' }, [
    stateSwatch(state),
    el('span', { class: 'state-word' }, STATE_STYLES[state].label),
  ]);
}
