import { copy, groupName } from '../../shared/copy.js';
import {
  type Connector,
  type Page,
  type Shape,
  findLayer,
  findShape,
  isLayerLocked,
  layersBottomFirst,
  shapeLabel,
  shownConnectors,
  visibleShapes,
} from '../../shared/document.js';
import { type Box, boxOf, connectorLabelPoint, portPoint } from '../../shared/geometry.js';
import type { RoutedConnector } from '../../shared/router.js';
import { h, s } from '../dom.js';
import { lockBadge } from '../icons.js';
import { type WorkspaceState, currentPage, focusOrder } from './store.js';

const GRID_FINE = 24;
const GRID_STRONG = 120;

export interface ConnectorParts {
  group: SVGGElement;
  path: SVGPathElement;
  label: SVGTextElement | null;
}

export interface CanvasElements {
  svg: SVGSVGElement;
  pins: HTMLElement;
  shapes: Map<string, SVGGElement>;
  connectors: Map<string, ConnectorParts>;
  cursors: Map<string, SVGGElement>;
  overlay: SVGGElement;
}

/** Converts a point in CSS pixels inside the canvas box to a document point. */
export function documentPoint(
  state: WorkspaceState,
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const box = svg.getBoundingClientRect();
  const factor = state.zoom / 100;
  return {
    x: state.view.x + (clientX - box.left) / factor,
    y: state.view.y + (clientY - box.top) / factor,
  };
}

/** The document point drawn at the centre of the canvas's on-screen box. */
export function canvasCentre(state: WorkspaceState, svg: SVGSVGElement): { x: number; y: number } {
  const box = svg.getBoundingClientRect();
  const factor = state.zoom / 100;
  return {
    x: state.view.x + box.width / 2 / factor,
    y: state.view.y + box.height / 2 / factor,
  };
}

function shapeBody(shape: Shape, box: Box): SVGElement {
  const { x, y, w, h } = box;
  switch (shape.kind) {
    case 'ellipse':
      return s('ellipse', {
        class: 'shape-body',
        cx: x + w / 2,
        cy: y + h / 2,
        rx: w / 2,
        ry: h / 2,
      });
    case 'diamond':
      return s('polygon', {
        class: 'shape-body',
        points: `${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`,
      });
    case 'text':
      return s('rect', { class: 'shape-body shape-body-text', x, y, width: w, height: h });
    case 'rectangle':
      return s('rect', { class: 'shape-body', x, y, width: w, height: h });
  }
}

function pointsAttribute(route: readonly (readonly [number, number])[]): string {
  return route.map((point) => `${point[0]},${point[1]}`).join(' ');
}

function pathFor(route: readonly (readonly [number, number])[]): string {
  if (route.length === 0) return '';
  return route.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point[0]} ${point[1]}`).join(' ');
}

/** The box a shape is drawn at: its drag preview while dragging, else its stored box. */
export function drawnBox(state: WorkspaceState, shape: Shape): Box {
  return state.drag?.shapes.get(shape.id) ?? boxOf(shape);
}

/** The route a connector is drawn at: its drag preview while dragging, else the committed one. */
function drawnRoute(state: WorkspaceState, connector: Connector): { route: readonly (readonly [number, number])[]; blocked: boolean } {
  const preview = state.drag?.routes.get(connector.id);
  if (preview) return preview;
  const routed: RoutedConnector | undefined = state.routes.get(connector.id);
  return { route: connector.route, blocked: routed?.blocked === true };
}

/** Shapes in drawing order: by layer order, then z within the layer. */
function drawOrder(page: Page): Shape[] {
  const order = new Map(layersBottomFirst(page).map((layer, index) => [layer.id, index]));
  return [...visibleShapes(page)].sort(
    (a, b) => (order.get(a.layer) ?? 0) - (order.get(b.layer) ?? 0) || a.z - b.z,
  );
}

function gridPattern(): SVGElement {
  return s(
    'defs',
    {},
    s(
      'pattern',
      { id: 'graph-fine', width: GRID_FINE, height: GRID_FINE, patternUnits: 'userSpaceOnUse' },
      s('path', { class: 'grid-fine', d: `M ${GRID_FINE} 0 L 0 0 0 ${GRID_FINE}` }),
    ),
    s(
      'pattern',
      { id: 'graph-paper', width: GRID_STRONG, height: GRID_STRONG, patternUnits: 'userSpaceOnUse' },
      s('rect', { width: GRID_STRONG, height: GRID_STRONG, fill: 'url(#graph-fine)' }),
      s('path', { class: 'grid-strong', d: `M ${GRID_STRONG} 0 L 0 0 0 ${GRID_STRONG}` }),
    ),
  );
}

/**
 * Builds the canvas markup. Shapes on hidden layers, deleted shapes and connectors the
 * layer rule hides are not in the markup at all.
 */
export function renderCanvas(state: WorkspaceState): CanvasElements {
  const page = currentPage(state);
  const factor = state.zoom / 100;
  const shapes = new Map<string, SVGGElement>();
  const connectors = new Map<string, ConnectorParts>();
  const cursors = new Map<string, SVGGElement>();

  const world = s('g', {
    class: 'world',
    transform: `scale(${factor}) translate(${-state.view.x} ${-state.view.y})`,
  });
  world.appendChild(
    s('rect', {
      class: 'graph-paper',
      x: state.view.x - GRID_STRONG,
      y: state.view.y - GRID_STRONG,
      width: 6000,
      height: 6000,
      fill: 'url(#graph-paper)',
    }),
  );

  const content = s('g', { class: 'content' });
  const groupHosts = new Map<string, SVGGElement>();
  for (const group of page.groups) {
    const members = group.members
      .map((id) => findShape(page, id))
      .filter((shape): shape is Shape => shape !== undefined);
    if (members.length === 0) continue;
    const host = s('g', {
      id: `group-${group.id}`,
      role: 'group',
      'aria-label': groupName(members.length),
    }) as SVGGElement;
    groupHosts.set(group.id, host);
    content.appendChild(host);
  }

  for (const shape of drawOrder(page)) {
    const box = drawnBox(state, shape);
    const locked = isLayerLocked(page, shape.layer);
    const layer = findLayer(page, shape.layer);
    const group = s(
      'g',
      {
        id: `shape-${shape.id}`,
        role: 'graphics-symbol',
        'aria-roledescription': shape.kind,
        'aria-label': shapeLabel(shape),
        'data-x': Math.round(box.x),
        'data-y': Math.round(box.y),
        'data-w': Math.round(box.w),
        'data-h': Math.round(box.h),
        'data-layer': shape.layer,
        'data-selected': state.selection.includes(shape.id) ? 'true' : null,
        'aria-description': locked && layer ? copy.lockedLayerDescription(layer.name) : null,
        tabindex: '-1',
        class: 'shape',
      },
      shapeBody(shape, box),
      shape.label.length > 0
        ? s(
            'text',
            {
              class: 'shape-label',
              x: box.x + box.w / 2,
              y: box.y + box.h / 2,
              'text-anchor': 'middle',
              'dominant-baseline': 'central',
            },
            shape.label,
          )
        : null,
    ) as SVGGElement;
    shapes.set(shape.id, group);
    (shape.group !== null ? groupHosts.get(shape.group) ?? content : content).appendChild(group);
  }

  for (const connector of shownConnectors(page)) {
    const drawn = drawnRoute(state, connector);
    const from = findShape(page, connector.from.shape);
    const to = findShape(page, connector.to.shape);
    const name = drawn.blocked
      ? copy.blockedConnectorName(from ? shapeLabel(from) : '', to ? shapeLabel(to) : '')
      : copy.connectorName(from ? shapeLabel(from) : '', to ? shapeLabel(to) : '');
    const path = s('path', { class: 'connector-line', d: pathFor(drawn.route) }) as SVGPathElement;
    let label: SVGTextElement | null = null;
    if (connector.label.length > 0) {
      const at = connectorLabelPoint(drawn.route);
      label = s(
        'text',
        {
          class: 'connector-label',
          x: at[0],
          y: at[1],
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
        },
        connector.label,
      ) as SVGTextElement;
    }
    const group = s(
      'g',
      {
        id: `connector-${connector.id}`,
        role: 'graphics-symbol',
        'aria-roledescription': 'connector',
        'aria-label': name,
        'data-points': pointsAttribute(drawn.route),
        'data-from': `${connector.from.shape}:${connector.from.port}`,
        'data-to': `${connector.to.shape}:${connector.to.port}`,
        'data-blocked': drawn.blocked ? 'true' : null,
        class: 'connector',
      },
      path,
      label,
    ) as SVGGElement;
    connectors.set(connector.id, { group, path, label });
    content.appendChild(group);
  }
  world.appendChild(content);

  const overlay = s('g', { class: 'overlay' }) as SVGGElement;
  for (const shape of visibleShapes(page)) {
    if (!isLayerLocked(page, shape.layer)) continue;
    const box = drawnBox(state, shape);
    overlay.appendChild(lockBadge(box.x, box.y));
  }
  for (const dot of state.drag?.portDots ?? portDotsForConnect(state)) {
    overlay.appendChild(s('circle', { class: 'port-dot', cx: dot.x, cy: dot.y, r: 4 }));
  }
  for (const shape of state.selection
    .map((id) => findShape(page, id))
    .filter((shape): shape is Shape => shape !== undefined)) {
    const box = drawnBox(state, shape);
    for (const [cx, cy] of [
      [box.x, box.y],
      [box.x + box.w, box.y],
      [box.x + box.w, box.y + box.h],
      [box.x, box.y + box.h],
    ]) {
      overlay.appendChild(
        s('rect', { class: 'handle', x: (cx ?? 0) - 3.5, y: (cy ?? 0) - 3.5, width: 7, height: 7 }),
      );
    }
  }
  if (state.connect) {
    const target = state.connect.candidates[state.connect.highlight];
    const shape = target === undefined ? undefined : findShape(page, target);
    if (shape) {
      const box = boxOf(shape);
      overlay.appendChild(
        s('rect', {
          class: 'connect-target',
          x: box.x - 4,
          y: box.y - 4,
          width: box.w + 8,
          height: box.h + 8,
        }),
      );
    }
  }
  for (const cursor of state.cursors.values()) {
    if (cursor.page !== page.id) continue;
    const node = s(
      'g',
      {
        id: `cursor-${cursor.userId}`,
        'data-cursor-of': cursor.userId,
        'aria-hidden': 'true',
        class: 'remote-cursor',
        transform: `translate(${cursor.drawnX} ${cursor.drawnY})`,
      },
      s('path', { class: 'cursor-arrow', d: 'M0 0 L0 14 L4 10.5 L7 16 L9.5 15 L6.5 9.5 L11.5 9.5 Z' }),
      s('text', { class: 'cursor-name', x: 14, y: 12 }, cursor.name),
    ) as SVGGElement;
    cursors.set(cursor.userId, node);
    overlay.appendChild(node);
  }
  world.appendChild(overlay);

  const svg = s(
    'svg',
    {
      id: 'canvas',
      role: 'graphics-document',
      'aria-roledescription': 'diagram',
      'aria-label': `${page.name} canvas`,
      tabindex: focusOrder(page).length === 0 ? '0' : '-1',
    },
    gridPattern(),
    world,
  ) as SVGSVGElement;

  const pins = h('div', { class: 'pin-layer' });
  for (const comment of state.comments) {
    if (comment.parent !== null || comment.resolved || !comment.anchored) continue;
    if (comment.page !== page.id) continue;
    const shape = findShape(page, comment.shape);
    if (!shape) continue;
    const box = drawnBox(state, shape);
    const left = (box.x + box.w - state.view.x) * factor;
    const top = (box.y - state.view.y) * factor;
    pins.appendChild(
      h('button', {
        id: `pin-${comment.id}`,
        class: 'comment-pin',
        type: 'button',
        'aria-label': `Comment by ${comment.author.name} on ${shapeLabel(shape)}`,
        'data-comment': comment.id,
        'data-shape': comment.shape,
        style: `left:${left}px;top:${top}px`,
      }),
    );
  }

  return { svg, pins, shapes, connectors, cursors, overlay };
}

/** Port dots show on every candidate while connect mode is open. */
function portDotsForConnect(state: WorkspaceState): { x: number; y: number }[] {
  if (!state.connect) return [];
  const page = currentPage(state);
  const dots: { x: number; y: number }[] = [];
  for (const id of state.connect.candidates) {
    const shape = findShape(page, id);
    if (!shape) continue;
    for (const port of ['n', 'e', 's', 'w'] as const) {
      const point = portPoint(shape, port);
      dots.push({ x: point[0], y: point[1] });
    }
  }
  return dots;
}

/**
 * Updates the drawn geometry in place on every frame of a drag, so the shapes and every
 * affected connector redraw without rebuilding the canvas.
 */
export function updateDrawnGeometry(state: WorkspaceState, elements: CanvasElements): void {
  const page = currentPage(state);
  for (const [id, group] of elements.shapes) {
    const shape = findShape(page, id);
    if (!shape) continue;
    const box = drawnBox(state, shape);
    group.setAttribute('data-x', String(Math.round(box.x)));
    group.setAttribute('data-y', String(Math.round(box.y)));
    group.setAttribute('data-w', String(Math.round(box.w)));
    group.setAttribute('data-h', String(Math.round(box.h)));
    const body = group.querySelector('.shape-body');
    if (body) replaceGeometry(body, shape, box);
    const label = group.querySelector('.shape-label');
    if (label) {
      label.setAttribute('x', String(box.x + box.w / 2));
      label.setAttribute('y', String(box.y + box.h / 2));
    }
  }
  for (const [id, parts] of elements.connectors) {
    const connector = page.connectors.find((candidate) => candidate.id === id);
    if (!connector) continue;
    const drawn = drawnRoute(state, connector);
    parts.path.setAttribute('d', pathFor(drawn.route));
    parts.group.setAttribute('data-points', pointsAttribute(drawn.route));
    if (drawn.blocked) parts.group.setAttribute('data-blocked', 'true');
    else parts.group.removeAttribute('data-blocked');
    if (parts.label) {
      const at = connectorLabelPoint(drawn.route);
      parts.label.setAttribute('x', String(at[0]));
      parts.label.setAttribute('y', String(at[1]));
    }
  }
}

function replaceGeometry(body: Element, shape: Shape, box: Box): void {
  const { x, y, w, h } = box;
  if (shape.kind === 'ellipse') {
    body.setAttribute('cx', String(x + w / 2));
    body.setAttribute('cy', String(y + h / 2));
    body.setAttribute('rx', String(w / 2));
    body.setAttribute('ry', String(h / 2));
    return;
  }
  if (shape.kind === 'diamond') {
    body.setAttribute(
      'points',
      `${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`,
    );
    return;
  }
  body.setAttribute('x', String(x));
  body.setAttribute('y', String(y));
  body.setAttribute('width', String(w));
  body.setAttribute('height', String(h));
}

/** Eases the drawn line from the drag preview into the committed route during the settle. */
export function easeRoute(
  from: readonly (readonly [number, number])[],
  to: readonly (readonly [number, number])[],
  progress: number,
): string {
  if (from.length !== to.length) return pathFor(to);
  const blended = to.map((point, index) => {
    const start = from[index] ?? point;
    return [
      start[0] + (point[0] - start[0]) * progress,
      start[1] + (point[1] - start[1]) * progress,
    ] as const;
  });
  return pathFor(blended);
}

export { pathFor, pointsAttribute };
