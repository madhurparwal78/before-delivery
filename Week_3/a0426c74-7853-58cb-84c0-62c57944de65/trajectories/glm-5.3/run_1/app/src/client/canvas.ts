import type { Entity, Pt, ResolvedEntity } from '../shared/geometry.js';
import { COLOUR_HEX, entityBounds, polylineLength, arcLength, lineLength, polygonArea, circleArea } from '../shared/geometry.js';
import { nearly } from '../shared/num.js';
import type { DrawingState, ViewState } from './store.js';
import { toScreen } from './ui.js';
import { dimensionText } from '../shared/derived.js';
import { cssEscape } from './constants.js';

// ---------------------------------------------------------------------------
// Canvas painting: one SVG element per entity, with the published data attrs.
// ---------------------------------------------------------------------------

export interface GripPoint {
  kind: string;
  point: Pt;
  index: number;
}

export function gripPoints(entity: ResolvedEntity): GripPoint[] {
  switch (entity.type) {
    case 'line':
      return [
        { kind: 'end', point: { x: entity.x1, y: entity.y1 }, index: 0 },
        { kind: 'mid', point: { x: (entity.x1 + entity.x2) / 2, y: (entity.y1 + entity.y2) / 2 }, index: 1 },
        { kind: 'end', point: { x: entity.x2, y: entity.y2 }, index: 2 },
      ];
    case 'circle':
      return [
        { kind: 'centre', point: { x: entity.cx, y: entity.cy }, index: 0 },
        { kind: 'quadrant', point: { x: entity.cx + entity.r, y: entity.cy }, index: 1 },
        { kind: 'quadrant', point: { x: entity.cx, y: entity.cy + entity.r }, index: 2 },
        { kind: 'quadrant', point: { x: entity.cx - entity.r, y: entity.cy }, index: 3 },
        { kind: 'quadrant', point: { x: entity.cx, y: entity.cy - entity.r }, index: 4 },
      ];
    case 'arc':
      return [
        { kind: 'centre', point: { x: entity.cx, y: entity.cy }, index: 0 },
        { kind: 'end', point: pointOnArc(entity, entity.start), index: 1 },
        { kind: 'end', point: pointOnArc(entity, entity.end), index: 2 },
      ];
    case 'pline':
      return entity.points.map((point, index) => ({ kind: 'vertex', point, index }));
    default:
      return [];
  }
}

function pointOnArc(entity: Extract<ResolvedEntity, { type: 'arc' }>, degrees: number): Pt {
  const radians = (degrees * Math.PI) / 180;
  return { x: entity.cx + entity.r * Math.cos(radians), y: entity.cy + entity.r * Math.sin(radians) };
}

export function gripResult(start: ResolvedEntity, kind: string, index: number, world: Pt): ResolvedEntity {
  switch (start.type) {
    case 'line':
      if (kind === 'mid') {
        const dx = world.x - (start.x1 + start.x2) / 2;
        const dy = world.y - (start.y1 + start.y2) / 2;
        return { ...start, x1: round(start.x1 + dx), y1: round(start.y1 + dy), x2: round(start.x2 + dx), y2: round(start.y2 + dy) };
      }
      if (index === 0) return { ...start, x1: round(world.x), y1: round(world.y) };
      return { ...start, x2: round(world.x), y2: round(world.y) };
    case 'circle':
      if (kind === 'centre') return { ...start, cx: round(world.x), cy: round(world.y) };
      return { ...start, r: round(Math.hypot(world.x - start.cx, world.y - start.cy)) };
    case 'arc':
      if (kind === 'centre') return { ...start, cx: round(world.x), cy: round(world.y) };
      {
        const angle = normalise((Math.atan2(world.y - start.cy, world.x - start.cx) * 180) / Math.PI);
        if (index === 1) return { ...start, start: round(angle) };
        return { ...start, end: round(angle) };
      }
    case 'pline': {
      const points = [...start.points];
      if (points[index]) points[index] = { x: round(world.x), y: round(world.y) };
      return { ...start, points };
    }
    default:
      return start;
  }
}

export function fieldChanges(before: ResolvedEntity, after: ResolvedEntity): Record<string, unknown> | null {
  const set: Record<string, unknown> = {};
  switch (before.type) {
    case 'line': {
      if (after.type !== 'line') return null;
      if (!nearly(before.x1, after.x1)) set.x1 = after.x1;
      if (!nearly(before.y1, after.y1)) set.y1 = after.y1;
      if (!nearly(before.x2, after.x2)) set.x2 = after.x2;
      if (!nearly(before.y2, after.y2)) set.y2 = after.y2;
      break;
    }
    case 'circle': {
      if (after.type !== 'circle') return null;
      if (!nearly(before.cx, after.cx)) set.cx = after.cx;
      if (!nearly(before.cy, after.cy)) set.cy = after.cy;
      if (!nearly(before.r, after.r)) set.r = after.r;
      break;
    }
    case 'arc': {
      if (after.type !== 'arc') return null;
      if (!nearly(before.cx, after.cx)) set.cx = after.cx;
      if (!nearly(before.cy, after.cy)) set.cy = after.cy;
      if (!nearly(before.r, after.r)) set.r = after.r;
      if (!nearly(before.start, after.start)) set.start = after.start;
      if (!nearly(before.end, after.end)) set.end = after.end;
      break;
    }
    case 'pline': {
      if (after.type !== 'pline' || before.points.length !== after.points.length) return null;
      set.points = after.points;
      break;
    }
    default:
      return null;
  }
  return Object.keys(set).length ? set : null;
}

function round(value: number): number {
  const factor = 10 ** 6;
  const scaled = value * factor;
  const rounded = Math.abs(scaled) % 1 >= 0.5 ? Math.trunc(scaled) + Math.sign(scaled) : Math.trunc(scaled);
  return rounded / factor;
}

function normalise(degrees: number): number {
  let a = degrees % 360;
  if (a < 0) a += 360;
  return a;
}

export function entityMarkup(entity: ResolvedEntity, state: DrawingState, view: ViewState, selected: boolean): SVGElement {
  const layer = state.layers[entity.layer];
  const colour = COLOUR_HEX[layer?.colour ?? 'white'] ?? COLOUR_HEX.white;
  const linetype = layer?.linetype ?? 'Continuous';
  const dash = dashFor(linetype);
  const common: Record<string, string | number> = {
    stroke: selected ? '#f7f3ea' : colour,
    'stroke-width': selected ? 2 : 1,
    fill: 'none',
    'data-entity-id': entity.handle,
    'data-type': entity.type,
    'data-layer': entity.layer,
  };
  if (dash) common['stroke-dasharray'] = dash;
  const screen = toScreen(view, firstPoint(entity));
  common['data-screen-x'] = String(screen.x);
  common['data-screen-y'] = String(screen.y);
  let node: SVGElement;
  switch (entity.type) {
    case 'line': {
      const a = toScreen(view, { x: entity.x1, y: entity.y1 });
      const b = toScreen(view, { x: entity.x2, y: entity.y2 });
      node = svgNode('line', { ...common, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      node.setAttribute('data-x1', String(entity.x1));
      node.setAttribute('data-y1', String(entity.y1));
      node.setAttribute('data-x2', String(entity.x2));
      node.setAttribute('data-y2', String(entity.y2));
      break;
    }
    case 'circle': {
      const c = toScreen(view, { x: entity.cx, y: entity.cy });
      node = svgNode('circle', { ...common, cx: c.x, cy: c.y, r: entity.r * view.zoom });
      node.setAttribute('data-cx', String(entity.cx));
      node.setAttribute('data-cy', String(entity.cy));
      node.setAttribute('data-r', String(entity.r));
      break;
    }
    case 'arc': {
      const c = toScreen(view, { x: entity.cx, y: entity.cy });
      const r = entity.r * view.zoom;
      const startRad = (entity.start * Math.PI) / 180;
      const endRad = (entity.end * Math.PI) / 180;
      const x1 = c.x + r * Math.cos(startRad);
      const y1 = c.y - r * Math.sin(startRad);
      const x2 = c.x + r * Math.cos(endRad);
      const y2 = c.y - r * Math.sin(endRad);
      const large = entity.end - entity.start > 180 ? 1 : 0;
      node = svgNode('path', { ...common, d: `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}` });
      node.setAttribute('data-cx', String(entity.cx));
      node.setAttribute('data-cy', String(entity.cy));
      node.setAttribute('data-r', String(entity.r));
      node.setAttribute('data-start', String(entity.start));
      node.setAttribute('data-end', String(entity.end));
      break;
    }
    case 'pline': {
      const points = entity.points.map((p) => toScreen(view, p)).map((p) => `${p.x},${p.y}`).join(' ');
      node = svgNode(entity.closed ? 'polygon' : 'polyline', { ...common, points });
      node.setAttribute('data-points', entity.points.map((p) => `${p.x},${p.y}`).join(' '));
      node.setAttribute('data-closed', String(entity.closed));
      break;
    }
    case 'insert': {
      const c = toScreen(view, { x: entity.x, y: entity.y });
      node = svgNode('g', { ...common });
      node.setAttribute('data-block', entity.block);
      node.setAttribute('data-x', String(entity.x));
      node.setAttribute('data-y', String(entity.y));
      node.setAttribute('data-scale', String(entity.scale));
      node.setAttribute('data-rotation', String(entity.rotation));
      node.append(svgNode('rect', { x: c.x - 6, y: c.y - 6, width: 12, height: 12, fill: 'none', stroke: common.stroke, 'stroke-width': 1 }));
      break;
    }
    case 'hatch': {
      const polygon = entity.polygon ?? [];
      if (polygon.length >= 3) {
        const points = polygon.map((p) => toScreen(view, p)).map((p) => `${p.x},${p.y}`).join(' ');
        node = svgNode('polygon', { ...common, points, fill: colour, 'fill-opacity': 0.25 });
      } else {
        const c = toScreen(view, { x: entity.seed_x, y: entity.seed_y });
        node = svgNode('rect', { ...common, x: c.x - 2, y: c.y - 2, width: 4, height: 4, fill: colour });
      }
      node.setAttribute('data-area', String(entity.area));
      node.setAttribute('data-associative', String(entity.associative));
      break;
    }
    case 'dimension': {
      const c = toScreen(view, { x: entity.text_x, y: entity.text_y });
      const text = dimensionText({ entities: state.entities as never, dim_styles: state.dimStyles } as never, entity);
      const group = svgNode('g', { ...common });
      group.append(svgNode('line', { x1: c.x - 24, y1: c.y, x2: c.x + 24, y2: c.y, stroke: common.stroke, 'stroke-width': 1 }));
      const label = svgNode('text', { x: c.x, y: c.y - 4, fill: common.stroke, 'text-anchor': 'middle', 'font-size': 11 });
      label.textContent = text;
      group.append(label);
      group.setAttribute('data-kind', entity.kind);
      group.setAttribute('data-value', String(entity.value ?? ''));
      group.setAttribute('data-associative', String(entity.associative));
      node = group;
      break;
    }
  }
  return node;
}

function svgNode(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }
  return node;
}

function dashFor(linetype: string): string | null {
  if (linetype === 'Dashed') return '6 4';
  if (linetype === 'Dotted') return '1 3';
  if (linetype === 'Centre') return '12 4 3 4';
  return null;
}

export function firstPoint(entity: ResolvedEntity): Pt {
  switch (entity.type) {
    case 'line': return { x: entity.x1, y: entity.y1 };
    case 'circle': return { x: entity.cx, y: entity.cy };
    case 'arc': return { x: entity.cx, y: entity.cy };
    case 'pline': return entity.points[0] ?? { x: 0, y: 0 };
    case 'insert': return { x: entity.x, y: entity.y };
    case 'hatch': return { x: entity.seed_x, y: entity.seed_y };
    case 'dimension': return { x: entity.text_x, y: entity.text_y };
  }
}

export function snapCandidates(entity: ResolvedEntity, handle: string): Array<{ kind: string; point: Pt }> {
  const out: Array<{ kind: string; point: Pt }> = [];
  switch (entity.type) {
    case 'line':
      out.push({ kind: 'endpoint', point: { x: entity.x1, y: entity.y1 } }, { kind: 'endpoint', point: { x: entity.x2, y: entity.y2 } });
      out.push({ kind: 'midpoint', point: { x: (entity.x1 + entity.x2) / 2, y: (entity.y1 + entity.y2) / 2 } });
      break;
    case 'circle':
      out.push({ kind: 'centre', point: { x: entity.cx, y: entity.cy } });
      break;
    case 'arc':
      out.push(
        { kind: 'endpoint', point: pointOnArc(entity, entity.start) },
        { kind: 'endpoint', point: pointOnArc(entity, entity.end) },
        { kind: 'midpoint', point: pointOnArc(entity, (entity.start + entity.end) / 2) },
        { kind: 'centre', point: { x: entity.cx, y: entity.cy } },
      );
      break;
    case 'pline':
      for (const point of entity.points) out.push({ kind: 'endpoint', point });
      for (let i = 0; i < entity.points.length - 1; i++) {
        const a = entity.points[i];
        const b = entity.points[i + 1];
        out.push({ kind: 'midpoint', point: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } });
      }
      break;
    default:
      break;
  }
  void handle;
  return out;
}

export function perpendicularFoot(state: DrawingState, world: Pt, lastPoint: Pt, aperture: number): Pt | null {
  let best: Pt | null = null;
  let bestDistance = aperture;
  for (const handle of state.order) {
    const entity = state.entities[handle];
    if (!entity) continue;
    const layer = state.layers[entity.layer];
    if (!layer || !layer.on || layer.frozen) continue;
    const segments = segmentsOf(entity);
    for (const [a, b] of segments) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      let t = ((lastPoint.x - a.x) * dx + (lastPoint.y - a.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const foot = { x: a.x + dx * t, y: a.y + dy * t };
      const distance = Math.hypot(world.x - foot.x, world.y - foot.y);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = foot;
      }
    }
  }
  return best;
}

export function tangentPoint(state: DrawingState, world: Pt, lastPoint: Pt, aperture: number): Pt | null {
  let best: Pt | null = null;
  let bestDistance = aperture;
  for (const handle of state.order) {
    const entity = state.entities[handle];
    if (!entity) continue;
    const layer = state.layers[entity.layer];
    if (!layer || !layer.on || layer.frozen) continue;
    const circles: Array<{ cx: number; cy: number; r: number }> = [];
    if (entity.type === 'circle') circles.push({ cx: entity.cx, cy: entity.cy, r: entity.r });
    if (entity.type === 'arc') circles.push({ cx: entity.cx, cy: entity.cy, r: entity.r });
    for (const circle of circles) {
      const distance = Math.hypot(lastPoint.x - circle.cx, lastPoint.y - circle.cy);
      if (distance <= circle.r) continue;
      const angle = Math.acos(circle.r / distance);
      const base = Math.atan2(circle.cy - lastPoint.y, circle.cx - lastPoint.x);
      for (const offset of [angle, -angle]) {
        const radians = base + offset;
        const point = { x: circle.cx + circle.r * Math.cos(radians), y: circle.cy + circle.r * Math.sin(radians) };
        const screenDistance = Math.hypot(world.x - point.x, world.y - point.y);
        if (screenDistance <= bestDistance) {
          bestDistance = screenDistance;
          best = point;
        }
      }
    }
  }
  return best;
}

export function segmentsOf(entity: ResolvedEntity): Array<[Pt, Pt]> {
  switch (entity.type) {
    case 'line':
      return [[{ x: entity.x1, y: entity.y1 }, { x: entity.x2, y: entity.y2 }]];
    case 'pline': {
      const out: Array<[Pt, Pt]> = [];
      const last = entity.closed ? entity.points.length : entity.points.length - 1;
      for (let i = 0; i < last; i++) {
        out.push([entity.points[i], entity.points[(i + 1) % entity.points.length]]);
      }
      return out;
    }
    default:
      return [];
  }
}

export function lengthOf(entity: ResolvedEntity): number | null {
  switch (entity.type) {
    case 'line': return lineLength(entity.x1, entity.y1, entity.x2, entity.y2);
    case 'pline': return polylineLength(entity);
    case 'arc': return arcLength(entity);
    default: return null;
  }
}

export function areaOf(entity: ResolvedEntity): number | null {
  switch (entity.type) {
    case 'circle': return circleArea(entity.r);
    case 'pline': return entity.closed ? polygonArea(entity.points) : null;
    case 'hatch': return entity.area;
    default: return null;
  }
}

export { entityBounds, cssEscape };
export type { Entity, ResolvedEntity, Pt };
