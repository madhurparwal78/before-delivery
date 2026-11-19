import {
  type Page,
  type Port,
  type Shape,
  findLayer,
  findShape,
  shapeLabel,
} from '../../shared/document.js';
import {
  type Box,
  type Corner,
  boxOf,
  moveOffset,
  portPoint,
  resizeBox,
} from '../../shared/geometry.js';
import { type RoutedConnector, routePage, sameRoute } from '../../shared/router.js';
import {
  type DragPreview,
  type WorkspaceState,
  currentPage,
  expandGroups,
  selectableShapes,
  selectedShapes,
  selectionBox,
} from './store.js';

export type DragKind = 'move' | 'resize' | 'marquee' | 'pan' | 'connect';

export interface DragSession {
  kind: DragKind;
  pointerId: number;
  /** The document point where the drag started. */
  origin: { x: number; y: number };
  /** The latest document point, read on each animation frame. */
  latest: { x: number; y: number };
  /** The boxes the moved or resized shapes started from. */
  startBoxes: Map<string, Box>;
  startSelectionBox: Box | null;
  corner: Corner | null;
  altHeld: boolean;
  shapeIds: string[];
  /** Where a connector drag started, as shape and port. */
  from: { shape: string; port: Port } | null;
  startView: { x: number; y: number };
  moved: boolean;
}

/** A page copy with the dragged shapes at their drawn positions, for the preview route. */
function pageWithBoxes(page: Page, boxes: Map<string, Box>): Page {
  return {
    ...page,
    shapes: page.shapes.map((shape) => {
      const box = boxes.get(shape.id);
      return box ? { ...shape, x: box.x, y: box.y, w: box.w, h: box.h } : shape;
    }),
  };
}

/**
 * The drag preview: shapes at the values the drop would commit and every connector whose
 * route comes out different from its committed route, bound to a dragged shape or not.
 */
export function buildDragPreview(state: WorkspaceState, session: DragSession): DragPreview {
  const page = currentPage(state);
  const boxes = plannedBoxes(state, session);
  const previewPage = pageWithBoxes(page, boxes);
  const routed = routePage(previewPage);
  const routes = new Map<string, RoutedConnector>();
  for (const connector of previewPage.connectors) {
    const next = routed.get(connector.id);
    if (!next) continue;
    if (!sameRoute(connector.route, next.route)) routes.set(connector.id, next);
  }
  return { shapes: boxes, routes, portDots: portDotsFor(previewPage, session.shapeIds) };
}

/** Port dots appear at both ends of every connector bound to the dragged shapes. */
function portDotsFor(page: Page, draggedIds: readonly string[]): { x: number; y: number }[] {
  const dots: { x: number; y: number }[] = [];
  for (const connector of page.connectors) {
    if (!draggedIds.includes(connector.from.shape) && !draggedIds.includes(connector.to.shape)) {
      continue;
    }
    for (const end of [connector.from, connector.to]) {
      const shape = findShape(page, end.shape);
      if (!shape) continue;
      const point = portPoint(shape, end.port);
      dots.push({ x: point[0], y: point[1] });
    }
  }
  return dots;
}

/** The boxes the drop would commit, under the snapping and resize rules. */
export function plannedBoxes(state: WorkspaceState, session: DragSession): Map<string, Box> {
  const boxes = new Map<string, Box>();
  const snapping = state.snapToGrid && !session.altHeld;
  if (session.kind === 'resize') {
    const id = session.shapeIds[0];
    const start = id === undefined ? undefined : session.startBoxes.get(id);
    if (id === undefined || !start || session.corner === null) return boxes;
    boxes.set(id, resizeBox(start, session.corner, session.latest.x, session.latest.y, snapping));
    return boxes;
  }
  if (session.kind !== 'move' || !session.startSelectionBox) return boxes;
  const offset = moveOffset(
    session.startSelectionBox,
    session.latest.x - session.origin.x,
    session.latest.y - session.origin.y,
    snapping,
  );
  for (const [id, start] of session.startBoxes) {
    boxes.set(id, { ...start, x: start.x + offset.dx, y: start.y + offset.dy });
  }
  return boxes;
}

export interface HitTest {
  shape: Shape | null;
  corner: Corner | null;
  port: { shape: string; port: Port } | null;
}

const HANDLE_RADIUS = 6;
const PORT_RADIUS = 7;

/** What a press at a document point lands on: a handle, a port dot or a shape. */
export function hitTest(state: WorkspaceState, point: { x: number; y: number }): HitTest {
  const page = currentPage(state);
  const selected = selectedShapes(state);
  const factor = state.zoom / 100;
  const handleReach = HANDLE_RADIUS / factor;
  const portReach = PORT_RADIUS / factor;

  if (selected.length === 1 && selected[0] && selected[0].group === null) {
    const box = boxOf(selected[0]);
    const corners: [Corner, number, number][] = [
      ['nw', box.x, box.y],
      ['ne', box.x + box.w, box.y],
      ['se', box.x + box.w, box.y + box.h],
      ['sw', box.x, box.y + box.h],
    ];
    for (const [corner, cx, cy] of corners) {
      if (Math.abs(point.x - cx) <= handleReach && Math.abs(point.y - cy) <= handleReach) {
        return { shape: selected[0], corner, port: null };
      }
    }
  }

  for (const shape of selectableShapes(page)) {
    for (const port of ['n', 'e', 's', 'w'] as const) {
      const at = portPoint(shape, port);
      if (Math.abs(point.x - at[0]) <= portReach && Math.abs(point.y - at[1]) <= portReach) {
        return { shape, corner: null, port: { shape: shape.id, port } };
      }
    }
  }

  const stack = [...page.shapes]
    .filter((shape) => findLayer(page, shape.layer)?.visible === true)
    .sort((a, b) => b.z - a.z);
  for (const shape of stack) {
    const box = boxOf(shape);
    if (
      point.x >= box.x &&
      point.x <= box.x + box.w &&
      point.y >= box.y &&
      point.y <= box.y + box.h
    ) {
      return { shape, corner: null, port: null };
    }
  }
  return { shape: null, corner: null, port: null };
}

export function startMove(
  state: WorkspaceState,
  pointerId: number,
  point: { x: number; y: number },
  altHeld: boolean,
): DragSession | null {
  const page = currentPage(state);
  const ids = expandGroups(page, state.selection);
  if (ids.length === 0) return null;
  const startBoxes = new Map<string, Box>();
  for (const id of ids) {
    const shape = findShape(page, id);
    if (shape) startBoxes.set(id, boxOf(shape));
  }
  return {
    kind: 'move',
    pointerId,
    origin: point,
    latest: point,
    startBoxes,
    startSelectionBox: selectionBox(state),
    corner: null,
    altHeld,
    shapeIds: ids,
    from: null,
    startView: { ...state.view },
    moved: false,
  };
}

export function startResize(
  state: WorkspaceState,
  pointerId: number,
  point: { x: number; y: number },
  shape: Shape,
  corner: Corner,
  altHeld: boolean,
): DragSession {
  return {
    kind: 'resize',
    pointerId,
    origin: point,
    latest: point,
    startBoxes: new Map([[shape.id, boxOf(shape)]]),
    startSelectionBox: boxOf(shape),
    corner,
    altHeld,
    shapeIds: [shape.id],
    from: null,
    startView: { ...state.view },
    moved: false,
  };
}

export function startSimple(
  state: WorkspaceState,
  kind: 'marquee' | 'pan' | 'connect',
  pointerId: number,
  point: { x: number; y: number },
  from: { shape: string; port: Port } | null,
): DragSession {
  return {
    kind,
    pointerId,
    origin: point,
    latest: point,
    startBoxes: new Map(),
    startSelectionBox: null,
    corner: null,
    altHeld: false,
    shapeIds: [],
    from,
    startView: { ...state.view },
    moved: false,
  };
}

/** Shapes fully inside the marquee are selected. */
export function marqueeSelection(state: WorkspaceState, session: DragSession): string[] {
  const page = currentPage(state);
  const x1 = Math.min(session.origin.x, session.latest.x);
  const x2 = Math.max(session.origin.x, session.latest.x);
  const y1 = Math.min(session.origin.y, session.latest.y);
  const y2 = Math.max(session.origin.y, session.latest.y);
  const inside = selectableShapes(page).filter(
    (shape) => shape.x >= x1 && shape.y >= y1 && shape.x + shape.w <= x2 && shape.y + shape.h <= y2,
  );
  return expandGroups(page, inside.map((shape) => shape.id));
}

/** The label a moved notice names: one shape's label, or `<k> shapes`. */
export function movedLabel(state: WorkspaceState, ids: readonly string[]): string {
  const page = currentPage(state);
  if (ids.length === 1) {
    const shape = ids[0] === undefined ? undefined : findShape(page, ids[0]);
    return shape ? shapeLabel(shape) : '';
  }
  return `${ids.length} shapes`;
}
