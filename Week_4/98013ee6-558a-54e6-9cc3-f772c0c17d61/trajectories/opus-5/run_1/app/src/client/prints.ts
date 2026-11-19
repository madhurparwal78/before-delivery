const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(width: number, height: number, className: string): SVGSVGElement {
  const node = document.createElementNS(SVG_NS, 'svg');
  node.setAttribute('viewBox', `0 0 ${width} ${height}`);
  node.setAttribute('class', className);
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('focusable', 'false');
  return node;
}

function shape(
  parent: SVGElement,
  name: 'path' | 'line' | 'circle' | 'rect' | 'ellipse',
  attrs: Record<string, string | number>,
): SVGElement {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  parent.append(node);
  return node;
}

const LINE = { fill: 'none', stroke: 'var(--bone)', 'stroke-width': 1.4 } as const;

/** The larger print: a moth on a lit window sash, upright 4:5. */
export function mothPrint(): SVGSVGElement {
  const node = svg(400, 500, 'print print-moth');
  const frame = document.createElementNS(SVG_NS, 'g');
  node.append(frame);
  shape(frame, 'rect', { x: 60, y: 60, width: 280, height: 380, ...LINE });
  shape(frame, 'rect', { x: 76, y: 76, width: 248, height: 348, ...LINE, 'stroke-width': 0.8 });
  shape(frame, 'line', { x1: 200, y1: 76, x2: 200, y2: 424, ...LINE });
  shape(frame, 'line', { x1: 76, y1: 250, x2: 324, y2: 250, ...LINE });
  for (let step = 0; step < 7; step += 1) {
    const offset = 96 + step * 30;
    shape(frame, 'line', {
      x1: offset,
      y1: 92,
      x2: offset - 14,
      y2: 236,
      ...LINE,
      'stroke-width': 0.5,
      opacity: 0.5,
    });
  }
  const moth = document.createElementNS(SVG_NS, 'g');
  node.append(moth);
  shape(moth, 'ellipse', { cx: 200, cy: 300, rx: 9, ry: 42, ...LINE });
  shape(moth, 'path', {
    d: 'M196 268 C150 236 108 260 96 302 C86 340 128 356 176 332 Z',
    ...LINE,
  });
  shape(moth, 'path', {
    d: 'M204 268 C250 236 292 260 304 302 C314 340 272 356 224 332 Z',
    ...LINE,
  });
  shape(moth, 'path', { d: 'M196 330 C166 346 148 374 164 392 C178 406 192 376 198 344 Z', ...LINE });
  shape(moth, 'path', { d: 'M204 330 C234 346 252 374 236 392 C222 406 208 376 202 344 Z', ...LINE });
  shape(moth, 'path', { d: 'M196 262 C188 246 176 238 162 236', ...LINE, 'stroke-width': 1 });
  shape(moth, 'path', { d: 'M204 262 C212 246 224 238 238 236', ...LINE, 'stroke-width': 1 });
  for (let step = 0; step < 4; step += 1) {
    shape(moth, 'line', {
      x1: 120 + step * 14,
      y1: 292 + step * 4,
      x2: 150 + step * 12,
      y2: 310 + step * 4,
      ...LINE,
      'stroke-width': 0.6,
      opacity: 0.7,
    });
    shape(moth, 'line', {
      x1: 280 - step * 14,
      y1: 292 + step * 4,
      x2: 250 - step * 12,
      y2: 310 + step * 4,
      ...LINE,
      'stroke-width': 0.6,
      opacity: 0.7,
    });
  }
  return node;
}

/** The smaller square print: a fern frond. */
export function fernPrint(): SVGSVGElement {
  const node = svg(300, 300, 'print print-fern');
  shape(node, 'path', { d: 'M40 268 C96 236 150 180 196 104 C214 74 228 52 240 36', ...LINE });
  for (let step = 0; step < 12; step += 1) {
    const t = step / 11;
    const x = 40 + (240 - 40) * t * 0.92;
    const y = 268 - (268 - 36) * Math.pow(t, 1.08);
    const size = 46 * (1 - t * 0.72) + 8;
    shape(node, 'path', {
      d: `M${x} ${y} C${x - size * 0.4} ${y - size * 0.5} ${x - size} ${y - size * 0.4} ${x - size * 1.05} ${y + size * 0.1}`,
      ...LINE,
      'stroke-width': 0.9,
    });
    shape(node, 'path', {
      d: `M${x} ${y} C${x + size * 0.5} ${y - size * 0.6} ${x + size * 0.9} ${y - size * 0.9} ${x + size * 1.0} ${y - size * 0.3}`,
      ...LINE,
      'stroke-width': 0.9,
    });
  }
  return node;
}

/** The lit print used by empty and not-found states. */
export function lampPrint(): SVGSVGElement {
  const node = svg(240, 240, 'print print-lamp');
  shape(node, 'circle', { cx: 120, cy: 104, r: 46, ...LINE });
  shape(node, 'circle', { cx: 120, cy: 104, r: 62, ...LINE, 'stroke-width': 0.6, opacity: 0.6 });
  shape(node, 'line', { x1: 120, y1: 150, x2: 120, y2: 206, ...LINE });
  shape(node, 'line', { x1: 86, y1: 206, x2: 154, y2: 206, ...LINE });
  shape(node, 'path', { d: 'M96 96 C84 80 92 62 110 60 C126 58 134 74 126 92 Z', ...LINE, 'stroke-width': 0.9 });
  shape(node, 'path', { d: 'M144 96 C156 80 148 62 130 60 C114 58 106 74 114 92 Z', ...LINE, 'stroke-width': 0.9 });
  return node;
}
