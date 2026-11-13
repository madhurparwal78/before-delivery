import { el, svgEl } from './ui.js';

// ---------------------------------------------------------------------------
// The landing strip: invented sheet frames drawn by the app, one lit at the
// centre, the rest dimmed to about half brightness.
// ---------------------------------------------------------------------------

export const STRIP_TITLES = [
  'Garden plan, Larch Row',
  'Shelf elevation, Unit 4',
  'Stage layout, Hall B',
  'Title block only',
  'Shed footing, Plot 9',
  'Bench section, Workshop',
  'Seating plan, Quay Room',
  'Raised beds, North Yard',
  'Counter detail, Kiosk 2',
  'Lighting grid, Hall B',
  'Fence run, Larch Row',
] as const;

export const CENTRED_FRAME = 'Stage layout, Hall B';

const INK = '#ece7db';
const MUTED = '#8a9187';

interface FrameSpec {
  width: number;
  height: number;
  draw: (group: SVGElement) => void;
}

function frameSvg(title: string, index: number): HTMLElement {
  const spec = frameSpec(index);
  const svg = svgEl('svg', {
    viewBox: `0 0 ${spec.width} ${spec.height}`,
    width: spec.width,
    height: spec.height,
    'aria-hidden': 'true',
  });
  const frame = svgEl('rect', { x: 0.5, y: 0.5, width: spec.width - 1, height: spec.height - 1, fill: '#1d2023', stroke: MUTED, 'stroke-width': 1 });
  svg.append(frame);
  spec.draw(svg);
  const wrap = el('div', { class: 'sheet-frame', 'data-frame-title': title });
  wrap.append(svg, el('span', { class: 'frame-title', text: title }));
  return wrap;
}

function frameSpec(index: number): FrameSpec {
  const specs: FrameSpec[] = [
    // Garden plan: beds and a path
    { width: 120, height: 84, draw: (g) => {
      g.append(rect(14, 16, 28, 22), rect(14, 48, 28, 22), rect(70, 16, 36, 54), line(60, 8, 60, 76), circle(90, 43, 8));
    } },
    // Shelf elevation: uprights and shelves
    { width: 130, height: 70, draw: (g) => {
      g.append(line(16, 8, 16, 62), line(112, 8, 112, 62), line(16, 20, 112, 20), line(16, 34, 112, 34), line(16, 48, 112, 48), rect(30, 10, 10, 10), rect(52, 10, 10, 10));
    } },
    // Stage layout: stage box and arcs
    { width: 150, height: 96, draw: (g) => {
      g.append(rect(30, 30, 90, 30), line(30, 30, 30, 24), line(120, 30, 120, 24), arc(75, 30, 34, 200, 340), circle(46, 12, 5), circle(104, 12, 5));
    } },
    // Title block only
    { width: 100, height: 70, draw: (g) => {
      g.append(rect(10, 46, 80, 18), line(10, 55, 90, 55), line(34, 46, 34, 64), line(62, 46, 62, 64));
    } },
    // Shed footing: rectangle with hatch marks
    { width: 90, height: 66, draw: (g) => {
      g.append(rect(24, 20, 42, 26), line(24, 20, 66, 46), line(24, 28, 58, 46), line(32, 20, 66, 38), rect(30, 26, 30, 14));
    } },
    // Bench section: legs and top
    { width: 110, height: 60, draw: (g) => {
      g.append(rect(20, 18, 70, 8), line(24, 26, 24, 50), line(86, 26, 86, 50), line(24, 38, 86, 38), line(24, 26, 86, 50));
    } },
    // Seating plan: table circles
    { width: 110, height: 88, draw: (g) => {
      g.append(circle(55, 44, 16), circle(30, 24, 6), circle(80, 24, 6), circle(30, 64, 6), circle(80, 64, 6), rect(48, 40, 14, 8));
    } },
    // Raised beds: L shapes
    { width: 96, height: 72, draw: (g) => {
      g.append(polyline('18,14 44,14 44,32 18,32'), polyline('52,14 78,14 78,40 52,40'), polyline('18,40 34,40 34,58 18,58'), polyline('60,48 78,48 78,58 60,58'));
    } },
    // Counter detail: counter line with stools
    { width: 104, height: 60, draw: (g) => {
      g.append(polyline('16,34 88,34'), line(16, 34, 16, 44), line(88, 34, 88, 44), circle(30, 16, 6), circle(52, 16, 6), circle(74, 16, 6));
    } },
    // Lighting grid: dots on a grid
    { width: 130, height: 70, draw: (g) => {
      for (let x = 20; x <= 110; x += 22) {
        g.append(line(x, 12, x, 58));
      }
      for (let y = 16; y <= 56; y += 16) {
        g.append(line(20, y, 110, y));
      }
      g.append(circle(42, 28, 3), circle(86, 28, 3), circle(42, 44, 3), circle(86, 44, 3));
    } },
    // Fence run: posts and rails
    { width: 140, height: 60, draw: (g) => {
      for (let x = 18; x <= 122; x += 26) {
        g.append(line(x, 14, x, 46));
      }
      g.append(line(18, 22, 122, 22), line(18, 38, 122, 38));
    } },
  ];
  return specs[index % specs.length];
}

function rect(x: number, y: number, w: number, h: number): SVGElement {
  return svgEl('rect', { x, y, width: w, height: h, fill: 'none', stroke: INK, 'stroke-width': 0.8 });
}
function line(x1: number, y1: number, x2: number, y2: number): SVGElement {
  return svgEl('line', { x1, y1, x2, y2, stroke: INK, 'stroke-width': 0.8 });
}
function circle(cx: number, cy: number, r: number): SVGElement {
  return svgEl('circle', { cx, cy, r, fill: 'none', stroke: INK, 'stroke-width': 0.8 });
}
function arc(cx: number, cy: number, r: number, start: number, end: number): SVGElement {
  const rad = (d: number) => (d * Math.PI) / 180;
  const x1 = cx + r * Math.cos(rad(start));
  const y1 = cy - r * Math.sin(rad(start));
  const x2 = cx + r * Math.cos(rad(end));
  const y2 = cy - r * Math.sin(rad(end));
  return svgEl('path', { d: `M ${x1} ${y1} A ${r} ${r} 0 ${end - start > 180 ? 1 : 0} 0 ${x2} ${y2}`, fill: 'none', stroke: INK, 'stroke-width': 0.8 });
}
function polyline(points: string): SVGElement {
  return svgEl('polyline', { points, fill: 'none', stroke: INK, 'stroke-width': 0.8 });
}

export function sheetStrip(): HTMLElement {
  const strip = el('div', { class: 'sheet-strip', role: 'region', 'aria-label': 'Sheet strip' });
  STRIP_TITLES.forEach((title, index) => {
    const frame = frameSvg(title, index);
    if (title === CENTRED_FRAME) frame.classList.add('lit');
    strip.append(frame);
  });
  // Settle with the lit frame centred.
  requestAnimationFrame(() => {
    const lit = strip.querySelector('.lit');
    if (lit) {
      lit.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'auto' });
    }
  });
  return strip;
}
