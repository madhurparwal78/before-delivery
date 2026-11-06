import { crossingsOfZone, derivedZone } from '../../shared/derive';
import { labelRuns, plainLabel } from '../../shared/labels';
import { portPoint } from '../../shared/geometry';
import { systemKindName } from '../../shared/kinds';
import { readingOrder } from '../../shared/editing';
import { zoneTally } from '../../shared/copy';
import type { Connector, CrossingDirection, PageDocument, Shape, Zone } from '../../shared/types';
import { svgEl } from '../dom';
import type { EditorState } from './state';

export interface View {
  zoom: number;
  panX: number;
  panY: number;
}

const ZONE_HEADER_HEIGHT = 28;

const ZONE_DASH: Record<string, string> = {
  cde: '8 4',
  connected: '14 6',
  out_of_scope: '2 5',
};

export interface CanvasRefs {
  pane: HTMLElement;
  svg: SVGElement;
  viewport: SVGElement;
  zones: SVGElement;
  shapes: SVGElement;
  connectors: SVGElement;
  markers: SVGElement;
  ports: SVGElement;
  focus: SVGElement;
  grid: SVGElement;
  pattern: SVGElement;
}

export function createCanvas(): CanvasRefs {
  const pattern = svgEl('pattern', {
    id: 'dot-grid',
    width: 24,
    height: 24,
    patternUnits: 'userSpaceOnUse',
  });
  pattern.append(svgEl('circle', { cx: 1, cy: 1, r: 1, fill: 'var(--hairline)' }));
  const defs = svgEl('defs', {}, [pattern]);
  const grid = svgEl('rect', { x: 0, y: 0, width: '100%', height: '100%', fill: 'url(#dot-grid)' });
  const zones = svgEl('g', { 'data-layer': 'zones' });
  const shapes = svgEl('g', { 'data-layer': 'shapes' });
  const connectors = svgEl('g', { 'data-layer': 'connectors' });
  const markers = svgEl('g', { 'data-layer': 'markers' });
  const ports = svgEl('g', { 'data-layer': 'ports' });
  const focus = svgEl('g', { 'data-layer': 'focus' });
  const viewport = svgEl('g', { 'data-viewport': 'true' }, [zones, shapes, connectors, markers, ports, focus]);
  const svg = svgEl('svg', { role: 'presentation' }, [defs, grid, viewport]);
  const pane = document.createElement('div');
  pane.className = 'canvas-pane';
  pane.setAttribute('role', 'application');
  pane.setAttribute('aria-label', 'Diagram canvas');
  pane.tabIndex = 0;
  pane.append(svg);
  return { pane, svg, viewport, zones, shapes, connectors, markers, ports, focus, grid, pattern };
}

export function applyView(refs: CanvasRefs, view: View): void {
  refs.viewport.setAttribute('transform', `translate(${view.panX},${view.panY}) scale(${view.zoom})`);
  refs.pattern.setAttribute(
    'patternTransform',
    `translate(${view.panX},${view.panY}) scale(${view.zoom})`,
  );
}

function appendFormattedText(target: SVGElement, label: string, x: number, y: number, lineHeight: number): void {
  let line = svgEl('tspan', { x, y });
  target.append(line);
  for (const run of labelRuns(label)) {
    if (run.kind === 'break') {
      y += lineHeight;
      line = svgEl('tspan', { x, y });
      target.append(line);
      continue;
    }
    const span = svgEl('tspan', {
      'font-weight': run.bold ? 600 : null,
      'font-style': run.italic ? 'italic' : null,
    });
    span.textContent = run.text;
    line.append(span);
  }
}

function renderZone(state: EditorState, zone: Zone): SVGElement {
  const summary = derivedZone(state.derived, zone.id);
  const selected = state.selection.has(zone.id);
  const group = svgEl('g', {
    role: 'button',
    tabindex: -1,
    'aria-label': `Zone ${zone.name}`,
    'aria-pressed': selected ? 'true' : 'false',
    'data-id': zone.id,
    'data-kind': 'zone',
    class: `zone zone-${zone.kind}${selected ? ' selected' : ''}`,
  });
  const colour = zone.kind === 'cde' ? 'var(--scope-red)' : 'var(--ink)';
  group.append(
    svgEl('rect', {
      x: zone.x,
      y: zone.y,
      width: zone.width,
      height: zone.height,
      fill: 'none',
      stroke: colour,
      'stroke-width': 2,
      'stroke-dasharray': ZONE_DASH[zone.kind] ?? '8 4',
    }),
  );
  group.append(
    svgEl('rect', {
      'data-zone-header': 'true',
      x: zone.x,
      y: zone.y,
      width: zone.width,
      height: ZONE_HEADER_HEIGHT,
      fill: zone.kind === 'cde' ? 'var(--scope-red)' : 'var(--paper-deep)',
      stroke: colour,
      'stroke-width': 1,
    }),
  );
  const name = svgEl('text', {
    x: zone.x + 8,
    y: zone.y + 19,
    'font-family': 'var(--condensed)',
    'font-size': 14,
    'font-weight': 600,
    fill: zone.kind === 'cde' ? 'var(--paper)' : 'var(--ink)',
  });
  name.textContent = zone.name;
  group.append(name);

  const tally = svgEl('g', { role: 'group', 'aria-label': `${zone.name} tally`, 'data-tally': zone.id });
  const tallyText = svgEl('text', {
    x: zone.x + zone.width - 8,
    y: zone.y + 19,
    'text-anchor': 'end',
    'font-family': 'var(--mono)',
    'font-size': 12,
    fill: zone.kind === 'cde' ? 'var(--paper)' : 'var(--ink)',
  });
  tallyText.textContent = zoneTally(summary.systems, summary.crossings);
  tally.append(tallyText);
  group.append(tally);

  if (zone.note.trim().length > 0) {
    const note = svgEl('g', { role: 'note', 'aria-label': `${zone.name} note`, class: 'zone-note' });
    const text = svgEl('text', {
      'font-family': 'var(--sans)',
      'font-size': 12,
      fill: 'var(--ink-soft)',
    });
    appendFormattedText(text, zone.note, zone.x + 8, zone.y + ZONE_HEADER_HEIGHT + 16, 14);
    note.append(text);
    group.append(note);
  }
  return group;
}

function renderShape(state: EditorState, shape: Shape): SVGElement {
  const selected = state.selection.has(shape.id);
  const group = svgEl('g', {
    role: 'button',
    tabindex: -1,
    'aria-label': `${plainLabel(shape.label)}, ${systemKindName(shape.kind)}`,
    'aria-pressed': selected ? 'true' : 'false',
    'data-id': shape.id,
    'data-kind': 'shape',
    class: `shape${selected ? ' selected' : ''}`,
  });
  group.append(
    svgEl('rect', {
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
      fill: 'var(--paper)',
      stroke: selected ? 'var(--ink)' : 'var(--ink)',
      'stroke-width': selected ? 2 : 1,
    }),
  );
  const label = svgEl('text', {
    'font-family': 'var(--sans)',
    'font-size': 13,
    fill: 'var(--ink)',
  });
  appendFormattedText(label, shape.label, shape.x + 10, shape.y + 26, 15);
  group.append(label);
  const kind = svgEl('text', {
    x: shape.x + 10,
    y: shape.y + shape.height - 12,
    'font-family': 'var(--sans)',
    'font-size': 11,
    fill: 'var(--ink-soft)',
  });
  kind.textContent = systemKindName(shape.kind);
  group.append(kind);
  return group;
}

/** The label sits on the longest straight run of the route, clear of the shapes. */
function longestSegmentMidpoint(connector: Connector): { x: number; y: number } {
  let best = { x: connector.points[0]?.[0] ?? 0, y: connector.points[0]?.[1] ?? 0 };
  let bestLength = -1;
  for (let i = 1; i < connector.points.length; i += 1) {
    const a = connector.points[i - 1];
    const b = connector.points[i];
    if (!a || !b) continue;
    const length = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
    if (length > bestLength) {
      bestLength = length;
      best = { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 };
    }
  }
  return best;
}

function renderConnector(state: EditorState, connector: Connector): SVGElement {
  const selected = state.selection.has(connector.id);
  const source = state.doc.shapes.find((shape) => shape.id === connector.from.shapeId);
  const target = state.doc.shapes.find((shape) => shape.id === connector.to.shapeId);
  const group = svgEl('g', {
    role: 'button',
    tabindex: -1,
    'aria-label': `Connector from ${source ? plainLabel(source.label) : ''} to ${
      target ? plainLabel(target.label) : ''
    }`,
    'aria-pressed': selected ? 'true' : 'false',
    'data-id': connector.id,
    'data-kind': 'connector',
    class: `connector${selected ? ' selected' : ''}`,
  });
  const points = connector.points.map(([x, y]) => `${x},${y}`).join(' ');
  group.append(
    svgEl('polyline', {
      points,
      fill: 'none',
      stroke: 'transparent',
      'stroke-width': 14,
      'data-hit': 'true',
    }),
  );
  group.append(
    svgEl('polyline', {
      points,
      fill: 'none',
      stroke: 'var(--teal)',
      'stroke-width': selected ? 3 : 2,
      'data-line': connector.id,
    }),
  );
  const anchor = longestSegmentMidpoint(connector);
  const label = svgEl('text', {
    'font-family': 'var(--sans)',
    'font-size': 12,
    fill: 'var(--teal)',
    'text-anchor': 'middle',
  });
  appendFormattedText(label, connector.label, anchor.x, anchor.y - 6, 14);
  group.append(label);
  return group;
}

/** The inward direction at a crossing point tells the chevron where to point. */
function inwardVector(zone: Zone, x: number, y: number): { dx: number; dy: number } {
  if (x === zone.x) return { dx: 1, dy: 0 };
  if (x === zone.x + zone.width) return { dx: -1, dy: 0 };
  if (y === zone.y) return { dx: 0, dy: 1 };
  return { dx: 0, dy: -1 };
}

function renderMarker(zone: Zone, x: number, y: number, direction: CrossingDirection, connectorId: string): SVGElement {
  const inward = inwardVector(zone, x, y);
  const sign = direction === 'in' ? 1 : -1;
  const dx = inward.dx * sign;
  const dy = inward.dy * sign;
  const group = svgEl('g', {
    role: 'img',
    'aria-label': `Crossing on ${zone.name}, ${direction === 'in' ? 'entering' : 'leaving'}`,
    class: 'crossing-marker',
    'data-marker': `${zone.id}:${connectorId}:${x}:${y}`,
    'data-x': x,
    'data-y': y,
  });
  const scopeZone = zone.kind === 'cde';
  group.append(
    svgEl('path', {
      d: `M ${x} ${y - 7} L ${x + 7} ${y} L ${x} ${y + 7} L ${x - 7} ${y} Z`,
      fill: scopeZone ? 'var(--scope-red)' : 'none',
      stroke: scopeZone ? 'var(--scope-red)' : 'var(--ink)',
      'stroke-width': 1.5,
    }),
  );
  const tipX = x + dx * 3;
  const tipY = y + dy * 3;
  const backX = x - dx * 1.5;
  const backY = y - dy * 1.5;
  const perpX = dy * 3;
  const perpY = dx * 3;
  group.append(
    svgEl('path', {
      d: `M ${backX + perpX} ${backY + perpY} L ${tipX} ${tipY} L ${backX - perpX} ${backY - perpY}`,
      fill: 'none',
      stroke: scopeZone ? 'var(--paper)' : 'var(--ink)',
      'stroke-width': 1.6,
      'stroke-linecap': 'round',
    }),
  );
  return group;
}

/** A two-pixel ink ring with a paper-coloured gap, drawn around the focused item. */
export function renderFocusRing(refs: CanvasRefs, id: string | null): void {
  refs.focus.replaceChildren();
  if (!id) return;
  const element = itemElement(refs, id);
  if (!(element instanceof SVGGraphicsElement)) return;
  const box = element.getBBox();
  const gap = { x: box.x - 3, y: box.y - 3, width: box.width + 6, height: box.height + 6 };
  const ring = { x: box.x - 5, y: box.y - 5, width: box.width + 10, height: box.height + 10 };
  refs.focus.append(
    svgEl('rect', { ...gap, fill: 'none', stroke: 'var(--paper)', 'stroke-width': 2 }),
    svgEl('rect', { ...ring, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2 }),
  );
}

export function renderPorts(state: EditorState, refs: CanvasRefs, shapeId: string | null): void {
  refs.ports.replaceChildren();
  if (!shapeId || state.readOnly) return;
  const shape = state.doc.shapes.find((entry) => entry.id === shapeId);
  if (!shape) return;
  for (const port of ['n', 'e', 's', 'w'] as const) {
    const point = portPoint(shape, port);
    refs.ports.append(
      svgEl('circle', {
        cx: point.x,
        cy: point.y,
        r: 5,
        fill: 'var(--paper)',
        stroke: 'var(--ink)',
        'stroke-width': 1.5,
        'data-port': port,
        'data-port-shape': shape.id,
      }),
    );
  }
}

export function renderCanvas(state: EditorState, refs: CanvasRefs): void {
  const doc: PageDocument = state.doc;
  refs.zones.replaceChildren(...doc.zones.map((zone) => renderZone(state, zone)));
  refs.shapes.replaceChildren(
    ...doc.shapes
      .slice()
      .sort((a, b) => a.z - b.z)
      .map((shape) => renderShape(state, shape)),
  );
  refs.connectors.replaceChildren(...doc.connectors.map((connector) => renderConnector(state, connector)));
  const markers: SVGElement[] = [];
  for (const zone of doc.zones) {
    for (const crossing of crossingsOfZone(state.derived, zone.id)) {
      markers.push(renderMarker(zone, crossing.x, crossing.y, crossing.direction, crossing.connectorId));
    }
  }
  refs.markers.replaceChildren(...markers);
  refs.ports.replaceChildren();
  refs.focus.replaceChildren();
}

export function itemElement(refs: CanvasRefs, id: string): SVGElement | null {
  return refs.viewport.querySelector<SVGElement>(`[data-id="${CSS.escape(id)}"]`);
}

export function focusItem(refs: CanvasRefs, id: string): void {
  const element = itemElement(refs, id);
  if (element instanceof SVGElement) (element as unknown as HTMLElement).focus();
}

export function canvasReadingOrder(state: EditorState): string[] {
  return readingOrder(state.doc).map((entry) => entry.id);
}
