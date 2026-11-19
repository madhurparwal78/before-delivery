// The pegboard: an SVG board, holes 32 pixels apart, with traced part silhouettes.

import type { Board, Item, Part } from './types';
import { outlineStateWord } from './format';

export const HOLE = 32;
export const COLUMNS = 10;
const PADDING = 10;

export interface OutlineHit {
  part: Part;
  item: Item;
}

/** Accessible name for a part outline button. */
export function outlineName(item: Item, part: Part): string {
  return `${item.name} — ${part.name}, ${outlineStateWord(part, item)}`;
}

/** Board order: top row, then left column. */
export function boardOrder(items: Item[]): { item: Item; part: Part }[] {
  const out: { item: Item; part: Part }[] = [];
  for (const item of items) {
    for (const part of item.parts) out.push({ item, part });
  }
  out.sort((a, b) => (a.part.row === b.part.row ? a.part.col - b.part.col : a.part.row - b.part.row));
  return out;
}

/** Draw the pegboard into an SVG node. */
export function renderBoard(
  board: Board,
  svg: SVGSVGElement,
  onPick: (hit: OutlineHit) => void,
  highlightPartId: number | null,
  hungDuringCheckin: Set<number>,
): void {
  const order = boardOrder(board.items);
  const rows = Math.max(board.rows, 1);
  const width = COLUMNS * HOLE + PADDING * 2;
  const height = rows * HOLE + PADDING * 2;
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.replaceChildren();

  // perforated holes
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < COLUMNS; col++) {
      const hole = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      hole.setAttribute('cx', String(PADDING + col * HOLE + HOLE / 2));
      hole.setAttribute('cy', String(PADDING + row * HOLE + HOLE / 2));
      hole.setAttribute('r', '3');
      hole.setAttribute('fill', 'var(--hole)');
      hole.setAttribute('opacity', '0.55');
      svg.append(hole);
    }
  }

  for (const { item, part } of order) {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('role', 'button');
    group.setAttribute('tabindex', '0');
    group.setAttribute('aria-label', outlineName(item, part));
    group.classList.add('peg-outline');
    group.setAttribute('data-part-id', String(part.id));
    group.setAttribute('data-item-id', String(item.id));

    const x = PADDING + part.col * HOLE + 4;
    const y = PADDING + part.row * HOLE + 4;
    const w = part.width * HOLE - 8;
    const h = part.height * HOLE - 8;

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(w));
    rect.setAttribute('height', String(h));
    rect.setAttribute('class', 'outline-rect');
    const hungNow = part.state === 'hung' || hungDuringCheckin.has(part.id);
    if (part.state === 'missing') {
      rect.setAttribute('fill', 'none');
      rect.setAttribute('stroke', 'var(--ink)');
      rect.setAttribute('stroke-dasharray', '6 4');
    } else if (!hungNow) {
      rect.setAttribute('fill', 'none');
      rect.setAttribute('stroke', 'var(--ink)');
      rect.setAttribute('stroke-dasharray', part.state === 'out' && item.status === 'pending-photo' ? '2 4' : '6 4');
    } else if (item.status === 'held') {
      rect.setAttribute('fill', 'none');
      rect.setAttribute('stroke', 'var(--ink)');
      rect.setAttribute('stroke-dasharray', 'none');
      const inner = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      inner.setAttribute('x', String(x + 4));
      inner.setAttribute('y', String(y + 4));
      inner.setAttribute('width', String(w - 8));
      inner.setAttribute('height', String(h - 8));
      inner.setAttribute('fill', 'none');
      inner.setAttribute('stroke', 'var(--ink)');
      group.append(inner);
    } else if (item.status === 'reserved') {
      rect.setAttribute('fill', 'none');
      rect.setAttribute('stroke', 'var(--ink)');
      rect.setAttribute('stroke-dasharray', 'none');
    } else {
      rect.setAttribute('fill', 'none');
      rect.setAttribute('stroke', 'var(--olive)');
    }
    group.append(rect);

    // the traced silhouette inside the outline
    const silhouette = drawSilhouette(part, x, y, w, h, hungNow);
    group.append(silhouette);

    if (part.state === 'missing') {
      const cross1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      cross1.setAttribute('x1', String(x + 2));
      cross1.setAttribute('y1', String(y + 2));
      cross1.setAttribute('x2', String(x + 10));
      cross1.setAttribute('y2', String(y + 10));
      cross1.setAttribute('class', 'missing-cross');
      group.append(cross1);
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', String(x + w / 2));
      label.setAttribute('y', String(y + h / 2 + 4));
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('class', 'state-word');
      label.textContent = 'missing';
      group.append(label);
    }

    if (highlightPartId === part.id) {
      rect.setAttribute('stroke', 'var(--focus)');
      rect.setAttribute('stroke-width', '4');
    }

    const activate = (event: Event) => {
      event.preventDefault();
      onPick({ part, item });
    };
    group.addEventListener('click', activate);
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') activate(event);
    });
    svg.append(group);
  }
}

/** Silhouette path per shape kind, drawn inside the outline box. */
function drawSilhouette(part: Part, x: number, y: number, w: number, h: number, hung: boolean): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  node.setAttribute('d', silhouettePath(part.shape, x, y, w, h));
  node.setAttribute('class', `silhouette${hung ? '' : ' dashed'}`);
  if (hung) {
    node.setAttribute('fill', 'var(--ink)');
    node.setAttribute('stroke', 'none');
  } else {
    node.setAttribute('fill', 'none');
    node.setAttribute('stroke', 'var(--ink)');
    node.setAttribute('stroke-dasharray', '5 3');
  }
  return node;
}

function silhouettePath(shape: string, x: number, y: number, w: number, h: number): string {
  const cx = x + w / 2;
  const r = Math.min(w, h) / 2;
  switch (shape) {
    case 'drill':
      return `M ${x + w * 0.2} ${y + h * 0.15} L ${x + w * 0.8} ${y + h * 0.15} L ${x + w * 0.62} ${y + h * 0.6} L ${x + w * 0.45} ${y + h * 0.6} L ${x + w * 0.45} ${y + h * 0.9} L ${x + w * 0.3} ${y + h * 0.9} L ${x + w * 0.3} ${y + h * 0.6} L ${x + w * 0.2} ${y + h * 0.6} Z`;
    case 'saw':
      return `M ${x + w * 0.1} ${y + h * 0.7} L ${x + w * 0.9} ${y + h * 0.7} L ${x + w * 0.9} ${y + h * 0.4} L ${x + w * 0.1} ${y + h * 0.4} Z M ${x + w * 0.15} ${y + h * 0.4} L ${x + w * 0.25} ${y + h * 0.25} L ${x + w * 0.35} ${y + h * 0.4} L ${x + w * 0.45} ${y + h * 0.25} L ${x + w * 0.55} ${y + h * 0.4}`;
    case 'ladder':
      return `M ${x + w * 0.3} ${y} L ${x + w * 0.4} ${y} L ${x + w * 0.4} ${y + h} L ${x + w * 0.3} ${y + h} Z M ${x + w * 0.6} ${y} L ${x + w * 0.7} ${y} L ${x + w * 0.7} ${y + h} L ${x + w * 0.6} ${y + h} Z M ${x + w * 0.32} ${y + h * 0.2} L ${x + w * 0.68} ${y + h * 0.2} L ${x + w * 0.68} ${y + h * 0.28} L ${x + w * 0.32} ${y + h * 0.28} Z M ${x + w * 0.32} ${y + h * 0.5} L ${x + w * 0.68} ${y + h * 0.5} L ${x + w * 0.68} ${y + h * 0.58} L ${x + w * 0.32} ${y + h * 0.58} Z M ${x + w * 0.32} ${y + h * 0.8} L ${x + w * 0.68} ${y + h * 0.8} L ${x + w * 0.68} ${y + h * 0.88} L ${x + w * 0.32} ${y + h * 0.88} Z`;
    case 'hammer':
      return `M ${x + w * 0.42} ${y + h * 0.1} L ${x + w * 0.7} ${y + h * 0.1} L ${x + w * 0.7} ${y + h * 0.25} L ${x + w * 0.52} ${y + h * 0.25} L ${x + w * 0.52} ${y + h * 0.95} L ${x + w * 0.42} ${y + h * 0.95} Z`;
    case 'wrench':
      return `M ${cx - r * 0.7} ${y + h * 0.1} a ${r * 0.5} ${r * 0.5} 0 0 1 ${r * 1.2} 0 L ${cx + r * 0.35} ${y + h * 0.9} L ${cx - r * 0.15} ${y + h * 0.9} Z`;
    case 'case':
      return `M ${x + w * 0.08} ${y + h * 0.25} L ${x + w * 0.92} ${y + h * 0.25} L ${x + w * 0.92} ${y + h * 0.9} L ${x + w * 0.08} ${y + h * 0.9} Z M ${x + w * 0.35} ${y + h * 0.25} L ${x + w * 0.35} ${y + h * 0.1} L ${x + w * 0.65} ${y + h * 0.1} L ${x + w * 0.65} ${y + h * 0.25}`;
    case 'battery':
      return `M ${x + w * 0.15} ${y + h * 0.2} L ${x + w * 0.85} ${y + h * 0.2} L ${x + w * 0.85} ${y + h * 0.8} L ${x + w * 0.15} ${y + h * 0.8} Z M ${cx - 4} ${y + h * 0.1} L ${cx + 4} ${y + h * 0.1} L ${cx + 4} ${y + h * 0.2} L ${cx - 4} ${y + h * 0.2} Z`;
    case 'cable':
      return `M ${cx - r * 0.8} ${y + h * 0.15} a ${r * 0.8} ${r * 0.8} 0 1 0 ${r * 1.6} 0 a ${r * 0.8} ${r * 0.8} 0 1 0 ${-r * 1.6} 0 M ${cx - 3} ${y + h * 0.3} L ${cx + 3} ${y + h * 0.3} L ${cx + 3} ${y + h * 0.85} L ${cx - 3} ${y + h * 0.85} Z`;
    case 'blade':
      return `M ${x + w * 0.2} ${y + h * 0.3} L ${x + w * 0.8} ${y + h * 0.3} L ${x + w * 0.8} ${y + h * 0.5} L ${x + w * 0.2} ${y + h * 0.5} Z M ${x + w * 0.2} ${y + h * 0.5} L ${x + w * 0.8} ${y + h * 0.5} L ${x + w * 0.75} ${y + h * 0.65} L ${x + w * 0.25} ${y + h * 0.65} Z`;
    default:
      return `M ${x + w * 0.15} ${y + h * 0.15} L ${x + w * 0.85} ${y + h * 0.15} L ${x + w * 0.85} ${y + h * 0.85} L ${x + w * 0.15} ${y + h * 0.85} Z`;
  }
}

/** The pixel position of a part's outline, for hit testing and keyboard steps. */
export function partRect(part: Part): { x: number; y: number; w: number; h: number } {
  return {
    x: PADDING + part.col * HOLE + 4,
    y: PADDING + part.row * HOLE + 4,
    w: part.width * HOLE - 8,
    h: part.height * HOLE - 8,
  };
}
