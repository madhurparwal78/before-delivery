import type { SummaryRow } from '../../shared/types.ts';
import { svg } from '../lib/dom.ts';

// A bar chart as an inline SVG: one `rect` per option whose width is the option's count over the largest count,
// so a zero count has zero width. Widths are in the drawing's own units, never in percent.

const DRAWING_WIDTH = 360;
const LINE_HEIGHT = 40;
const LABEL_BASELINE = 15;
const BAR_TOP = 22;
const BAR_HEIGHT = 12;

const round = (value: number): number => Math.round(value * 100) / 100;

export function barChart(name: string, rows: SummaryRow[]): SVGSVGElement {
  const largest = Math.max(0, ...rows.map((row) => Number(row.count)));
  const lines = rows.flatMap((row, index) => {
    const top = index * LINE_HEIGHT;
    const label = svg('text', { class: 'chart-label', x: 0, y: top + LABEL_BASELINE });
    label.textContent = row.label;
    const width = largest === 0 ? 0 : round((DRAWING_WIDTH * Number(row.count)) / largest);
    return [
      label,
      svg('rect', { class: 'chart-track', x: 0, y: top + BAR_TOP, width: DRAWING_WIDTH, height: BAR_HEIGHT }),
      svg('rect', { class: 'chart-bar', x: 0, y: top + BAR_TOP, width, height: BAR_HEIGHT, 'data-option': row.value, 'data-count': row.count }),
    ];
  });
  return svg('svg', {
    class: 'chart', role: 'img', 'aria-label': `${name} chart`, tabindex: 0,
    viewBox: `0 0 ${DRAWING_WIDTH} ${rows.length * LINE_HEIGHT}`,
  }, ...lines);
}
