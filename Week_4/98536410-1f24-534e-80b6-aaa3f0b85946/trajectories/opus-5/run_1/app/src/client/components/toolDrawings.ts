import { el, svg } from '../lib/dom.js';

function paintTin(): SVGElement {
  return svg('svg', { viewBox: '0 0 120 140', class: 'tool-drawing', 'aria-hidden': 'true' }, [
    svg('rect', { x: 20, y: 36, width: 80, height: 86, rx: 6, class: 'draw-fill' }),
    svg('rect', { x: 14, y: 26, width: 92, height: 14, rx: 4, class: 'draw-stroke' }),
    svg('path', { d: 'M24 30 C40 2, 80 2, 96 30', class: 'draw-stroke-line' }),
    svg('rect', { x: 34, y: 58, width: 52, height: 30, rx: 3, class: 'draw-label' }),
  ]);
}

function brush(): SVGElement {
  return svg('svg', { viewBox: '0 0 120 140', class: 'tool-drawing', 'aria-hidden': 'true' }, [
    svg('rect', { x: 50, y: 10, width: 20, height: 64, rx: 6, class: 'draw-stroke' }),
    svg('rect', { x: 42, y: 70, width: 36, height: 16, rx: 3, class: 'draw-fill' }),
    svg('path', { d: 'M40 86 L80 86 L74 130 L46 130 Z', class: 'draw-fill' }),
    svg('path', { d: 'M48 96 L48 126 M60 96 L60 126 M72 96 L72 126', class: 'draw-stroke-line' }),
  ]);
}

function wrench(): SVGElement {
  return svg('svg', { viewBox: '0 0 120 140', class: 'tool-drawing', 'aria-hidden': 'true' }, [
    svg('path', {
      d: 'M44 14 L76 14 L76 34 L66 42 L66 104 L54 104 L54 42 L44 34 Z',
      class: 'draw-fill',
    }),
    svg('circle', { cx: 60, cy: 118, r: 14, class: 'draw-stroke' }),
  ]);
}

function padlock(): SVGElement {
  return svg('svg', { viewBox: '0 0 120 140', class: 'tool-drawing', 'aria-hidden': 'true' }, [
    svg('path', { d: 'M38 62 L38 42 C38 20, 82 20, 82 42 L82 62', class: 'draw-stroke-line' }),
    svg('rect', { x: 26, y: 62, width: 68, height: 60, rx: 6, class: 'draw-fill' }),
    svg('circle', { cx: 60, cy: 88, r: 8, class: 'draw-label' }),
    svg('rect', { x: 56, y: 92, width: 8, height: 18, class: 'draw-label' }),
  ]);
}

function shears(): SVGElement {
  return svg('svg', { viewBox: '0 0 120 140', class: 'tool-drawing', 'aria-hidden': 'true' }, [
    svg('path', { d: 'M34 18 L62 72 L50 80 L26 30 Z', class: 'draw-fill' }),
    svg('path', { d: 'M86 18 L58 72 L70 80 L94 30 Z', class: 'draw-fill' }),
    svg('circle', { cx: 44, cy: 110, r: 16, class: 'draw-stroke' }),
    svg('circle', { cx: 76, cy: 110, r: 16, class: 'draw-stroke' }),
  ]);
}

/** Tool and paint-tin drawings the app generates as vector shapes on charcoal. */
export function toolDrawings(): HTMLElement {
  return el('div', { class: 'tool-drawings charcoal-panel' }, [
    paintTin(),
    brush(),
    wrench(),
    padlock(),
    shears(),
  ]);
}
