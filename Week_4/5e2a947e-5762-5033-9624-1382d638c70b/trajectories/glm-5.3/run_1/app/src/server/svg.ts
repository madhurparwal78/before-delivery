import type { TopicNode } from '../shared/types.js';
import { layoutMap } from '../shared/layout.js';
import { COLOUR_HEX } from '../shared/style.js';
import { escapeHtml } from './text.js';

/**
 * SVG export: one standalone file with no external reference and no
 * script, laying out every topic I can see with nothing collapsed.
 */

export function svgFor(topics: TopicNode[], layout: 'map' | 'org' | 'list'): string {
  const nodes = topics;
  const res = layoutMap(nodes, layout, new Set());
  const boxes: string[] = [];
  const MINX = [0, 0, 0, 0];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [id, b] of res.boxes) {
    const x = b.x - b.w / 2;
    const y = b.y - b.h / 2;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + b.w); maxY = Math.max(maxY, y + b.h);
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 100; maxY = 100; }
  const w = maxX - minX + 80;
  const h = maxY - minY + 80;
  void MINX;
  const esc = (s: string) => escapeHtml(s);
  for (const t of nodes) {
    const b = res.boxes.get(t.id);
    if (!b) continue;
    const colour = (t.colour && COLOUR_HEX[t.colour]) || COLOUR_HEX.accent;
    const rx = 14;
    boxes.push(
      `  <g data-topic-id="${esc(t.id)}" data-x="${b.x}" data-y="${b.y}" data-w="${b.w}" data-h="${b.h}">
` +
      `    <rect x="${b.x - b.w / 2}" y="${b.y - b.h / 2}" width="${b.w}" height="${b.h}" rx="${rx}" fill="#ffffff" stroke="${colour}" stroke-width="3"/>
` +
      `    <text x="${b.x}" y="${b.y + 5}" text-anchor="middle" font-family="Figtree, sans-serif" font-size="15" fill="#241b33">${esc(t.title)}</text>
` +
      `  </g>`
    );
  }
  const connectors: string[] = [];
  for (const t of nodes) {
    if (!t.parent_id) continue;
    const cb = res.boxes.get(t.id);
    const pb = res.boxes.get(t.parent_id);
    if (!cb || !pb) continue;
    connectors.push(
      `  <path d="M ${pb.x} ${pb.y} L ${cb.x} ${cb.y}" stroke="#b9b3c9" stroke-width="3" fill="none"/>`
    );
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="${Math.round(h)}" viewBox="${Math.round(minX - 40)} ${Math.round(minY - 40)} ${Math.round(w)} ${Math.round(h)}" font-family="Figtree, sans-serif">
${connectors.join('\n')}
${boxes.join('\n')}
</svg>
`;
}
