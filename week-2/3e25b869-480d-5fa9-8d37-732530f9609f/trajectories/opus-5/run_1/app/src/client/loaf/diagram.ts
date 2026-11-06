import { BAR_STATE_WORDS } from '../../shared/copy.js';
import type { Locale } from '../../shared/types.js';
import { PALETTE } from '../palette.js';
import { svg } from '../ui.js';
import type { BarMark } from './scene.js';

const WIDTH = 480;
const HEIGHT = 220;
const BAR_TOP = 48;
const BAR_HEIGHT = 110;

export type DiagramInput = {
  marks: BarMark[];
  cutStep: number;
  label: string;
  locale: Locale;
};

/** The flat stand-in for the scene: N bars in a row, each drawn in its state shape, with the wire. */
export function buildDiagram(input: DiagramInput): SVGElement {
  const total = input.marks.length;
  const root = svg('svg', {
    role: 'img',
    'aria-label': input.label,
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    class: 'loaf-diagram-svg',
  });
  const margin = 24;
  const slot = total > 0 ? (WIDTH - margin * 2) / total : WIDTH - margin * 2;
  input.marks.forEach((mark, index) => {
    const x = margin + index * slot;
    if (mark === 'S') {
      root.append(
        svg('rect', {
          x: x + 2,
          y: BAR_TOP,
          width: Math.max(2, slot - 4),
          height: BAR_HEIGHT,
          fill: 'none',
          stroke: PALETTE.inkSoft,
          'stroke-width': 2,
          'stroke-dasharray': '6 4',
        }),
      );
      return;
    }
    root.append(
      svg('rect', {
        x: x + 2,
        y: BAR_TOP,
        width: Math.max(2, slot - 4),
        height: BAR_HEIGHT,
        fill: mark === 'H' ? PALETTE.kraft : PALETTE.sage,
      }),
    );
    if (mark === 'H') {
      root.append(
        svg('path', {
          d: `M ${x + slot - 14} ${BAR_TOP} L ${x + slot - 2} ${BAR_TOP} L ${x + slot - 2} ${BAR_TOP + 12} Z`,
          fill: PALETTE.ground,
        }),
      );
    }
  });
  const wireX = margin + Math.min(total, input.cutStep) * slot;
  root.append(
    svg('line', {
      x1: wireX,
      y1: BAR_TOP - 18,
      x2: wireX,
      y2: BAR_TOP + BAR_HEIGHT + 18,
      stroke: PALETTE.accent,
      'stroke-width': 3,
    }),
  );
  const words = input.marks.map((mark) =>
    BAR_STATE_WORDS[mark === 'A' ? 'available' : mark === 'H' ? 'held' : 'sold'][input.locale],
  );
  const caption = svg('text', {
    x: margin,
    y: HEIGHT - 16,
    fill: PALETTE.ink,
    'font-size': 14,
  });
  caption.textContent = [...new Set(words)].join(' \u00B7 ');
  root.append(caption);
  return root;
}
