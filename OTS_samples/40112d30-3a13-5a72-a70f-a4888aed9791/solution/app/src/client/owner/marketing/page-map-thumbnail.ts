import { svg } from '../../lib/dom.ts';
import type { SampleForm } from './sample-forms.ts';

// A dim drawing of a form's page map: each page a title line with its question lines beneath, the pages the Lit path
// reaches drawn brighter than the skipped ones, and the pink Lit path marker at the last lit page.

const WIDTH = 160;
const HEIGHT = 120;
const GUTTER = 14;
const INDENT = 8;
const TITLE_WIDTH = 100;
const TITLE_HEIGHT = 5;
const LINE_HEIGHT = 3;
const LINE_PITCH = 6;
const TITLE_PITCH = 9;
const PAGE_GAP = 6;
const MARKER = 6;
const LINE_WIDTHS = [96, 72, 84, 60];

export function pageMapThumbnail(form: SampleForm): SVGSVGElement {
  const lastLit = form.pages.map((page) => page.lit).lastIndexOf(true);
  let top = 0;
  const pages = form.pages.map((page, index) => {
    const lines = Array.from({ length: page.questions }, (_, question) => svg('rect', {
      x: GUTTER + INDENT, y: top + TITLE_PITCH + question * LINE_PITCH, width: LINE_WIDTHS[question % LINE_WIDTHS.length] ?? 0, height: LINE_HEIGHT,
    }));
    const marker = index === lastLit ? svg('rect', { class: 'marker', x: 0, y: top - 0.5, width: MARKER, height: MARKER }) : null;
    const group = svg('g', { class: page.lit ? 'lit' : 'skipped' },
      svg('rect', { x: GUTTER, y: top, width: TITLE_WIDTH, height: TITLE_HEIGHT }), ...lines, marker);
    top += TITLE_PITCH + page.questions * LINE_PITCH + PAGE_GAP;
    return group;
  });
  return svg('svg', { class: 'thumbnail', viewBox: `0 0 ${WIDTH} ${HEIGHT}`, 'aria-hidden': 'true', focusable: 'false' }, ...pages);
}
