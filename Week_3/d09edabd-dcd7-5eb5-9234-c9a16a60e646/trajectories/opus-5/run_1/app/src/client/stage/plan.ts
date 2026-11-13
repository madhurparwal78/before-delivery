import { copy } from '../../shared/copy.js';
import type { Placement } from '../../shared/types.js';
import { el } from '../dom.js';
import type { RoomSize } from './geometry.js';

/** The flat top-down floor plan that replaces the 3D view without WebGL. */
export function floorPlan(room: RoomSize, placements: Placement[]): HTMLElement {
  const holder = el('div', { class: 'floorplan' });
  holder.append(el('p', { class: 'floorplan-notice', role: 'note', text: copy.noWebgl }));
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', `-200 -200 ${room.widthMm + 400} ${room.depthMm + 400}`);
  svg.setAttribute('width', '70%');
  svg.setAttribute('aria-label', 'Floor plan');
  svg.setAttribute('role', 'img');

  const outline = document.createElementNS(svgNs, 'rect');
  outline.setAttribute('x', '0');
  outline.setAttribute('y', '0');
  outline.setAttribute('width', String(room.widthMm));
  outline.setAttribute('height', String(room.depthMm));
  outline.setAttribute('fill', '#121922');
  outline.setAttribute('stroke', '#2b3542');
  outline.setAttribute('stroke-width', '30');
  svg.append(outline);

  for (const placement of placements) {
    const label = document.createElementNS(svgNs, 'text');
    label.setAttribute('x', String(placement.xMm));
    label.setAttribute('y', String(placement.zMm - placement.depthMm / 2 - 60));
    label.setAttribute('fill', '#9aa7b6');
    label.setAttribute('font-size', '140');
    label.setAttribute('text-anchor', 'middle');
    label.textContent = placement.entry ? `${placement.label} (entry)` : placement.label;
    if (placement.kind === 'cylinder') {
      const circle = document.createElementNS(svgNs, 'circle');
      circle.setAttribute('cx', String(placement.xMm));
      circle.setAttribute('cy', String(placement.zMm));
      circle.setAttribute('r', String(placement.widthMm / 2));
      circle.setAttribute('fill', '#b08d57');
      svg.append(circle);
    } else {
      const rect = document.createElementNS(svgNs, 'rect');
      rect.setAttribute('x', String(placement.xMm - placement.widthMm / 2));
      rect.setAttribute('y', String(placement.zMm - placement.depthMm / 2));
      rect.setAttribute('width', String(placement.widthMm));
      rect.setAttribute('height', String(placement.depthMm));
      rect.setAttribute('fill', placement.kind === 'door' ? '#2f6f7f' : '#8a5a2b');
      svg.append(rect);
    }
    svg.append(label);
  }
  holder.append(svg);
  return holder;
}

/** The same flat plan, drawn into a canvas for a room card thumbnail. */
export function planThumbnail(room: RoomSize, placements: Placement[]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  context.fillStyle = '#0b0f14';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(
    (canvas.width - 24) / room.widthMm,
    (canvas.height - 24) / room.depthMm,
  );
  const offsetX = (canvas.width - room.widthMm * scale) / 2;
  const offsetY = (canvas.height - room.depthMm * scale) / 2;
  context.strokeStyle = '#2b3542';
  context.lineWidth = 2;
  context.strokeRect(offsetX, offsetY, room.widthMm * scale, room.depthMm * scale);
  for (const placement of placements) {
    context.fillStyle =
      placement.kind === 'door' ? '#2f6f7f' : placement.kind === 'cylinder' ? '#b08d57' : '#8a5a2b';
    const width = placement.widthMm * scale;
    const depth = placement.depthMm * scale;
    const x = offsetX + placement.xMm * scale - width / 2;
    const y = offsetY + placement.zMm * scale - depth / 2;
    if (placement.kind === 'cylinder') {
      context.beginPath();
      context.arc(x + width / 2, y + depth / 2, width / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      context.fillRect(x, y, width, depth);
    }
  }
  return canvas;
}
