import { type Port, findShape, isLayerLocked } from '../../shared/document.js';
import { boxOf, defaultPortPair } from '../../shared/geometry.js';
import { s } from '../dom.js';
import type { Workspace } from './controller.js';
import { hasOpenPanel } from './dialogs.js';
import { hitTest, marqueeSelection, startMove, startResize, startSimple } from './interactions.js';
import { currentPage } from './store.js';

const LONG_PRESS_MS = 500;
const DRAG_THRESHOLD = 3;
const ZOOM_MIN = 25;
const ZOOM_MAX = 400;

/**
 * Tap, one-finger drag, pinch and a 500 ms long press select, pan, move, zoom and open
 * Shape actions. The listeners sit on the persistent canvas host, so a canvas rebuilt
 * mid-drag never interrupts the gesture.
 */
export function wirePointer(workspace: Workspace): void {
  const host = workspace.canvasHostElement;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { distance: number; zoom: number; centre: { x: number; y: number } } | null = null;
  let longPress: number | null = null;
  let pressedShape: string | null = null;
  let pressPoint: { x: number; y: number } | null = null;
  let connectFrom: { shape: string; port: Port } | null = null;
  let marquee: SVGRectElement | null = null;
  let tracking = false;

  const cancelLongPress = (): void => {
    if (longPress !== null) window.clearTimeout(longPress);
    longPress = null;
  };

  const stopTracking = (): void => {
    if (!tracking) return;
    tracking = false;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
  };

  const startTracking = (): void => {
    if (tracking) return;
    tracking = true;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  function onMove(event: PointerEvent): void {
    const tracked = pointers.get(event.pointerId);
    if (tracked) {
      tracked.x = event.clientX;
      tracked.y = event.clientY;
    }
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      if (!a || !b) return;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const next = Math.round((pinch.zoom * distance) / pinch.distance);
      workspace.setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)), pinch.centre);
      return;
    }
    if (pressPoint && Math.hypot(event.clientX - pressPoint.x, event.clientY - pressPoint.y) > DRAG_THRESHOLD) {
      cancelLongPress();
    }
    const point = workspace.documentPointOf(event.clientX, event.clientY);
    const drag = workspace.drag;
    if (!drag) return;
    if (drag.kind === 'pan') {
      const factor = workspace.state.zoom / 100;
      const previous = drag.latest;
      drag.latest = point;
      workspace.panBy((previous.x - point.x) * factor, (previous.y - point.y) * factor);
      return;
    }
    workspace.updateDrag(point, event.altKey);
    if (drag.kind === 'marquee') {
      marquee ??= s('rect', { class: 'marquee' }) as SVGRectElement;
      if (marquee.parentNode === null) workspace.canvas.overlay.appendChild(marquee);
      marquee.setAttribute('x', String(Math.min(drag.origin.x, drag.latest.x)));
      marquee.setAttribute('y', String(Math.min(drag.origin.y, drag.latest.y)));
      marquee.setAttribute('width', String(Math.abs(drag.latest.x - drag.origin.x)));
      marquee.setAttribute('height', String(Math.abs(drag.latest.y - drag.origin.y)));
    }
  }

  function onUp(event: PointerEvent): void {
    cancelLongPress();
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) stopTracking();
    const drag = workspace.drag;
    const point = workspace.documentPointOf(event.clientX, event.clientY);

    if (drag?.kind === 'marquee') {
      const ids = marqueeSelection(workspace.state, { ...drag, latest: point });
      marquee?.remove();
      marquee = null;
      workspace.cancelDrag();
      workspace.select(ids);
      return;
    }
    if (drag?.kind === 'connect') {
      const from = connectFrom;
      connectFrom = null;
      workspace.cancelDrag();
      if (from) finishConnect(workspace, from, point);
      workspace.render();
      return;
    }
    if (drag?.kind === 'pan') {
      workspace.cancelDrag();
      return;
    }
    const moved = drag?.moved === true;
    workspace.endDrag();
    if (pressedShape !== null) {
      // A click without movement selects just that shape.
      if (!moved) workspace.select([pressedShape]);
      workspace.canvas.shapes.get(pressedShape)?.focus();
      pressedShape = null;
    }
    pressPoint = null;
  }

  function onCancel(event: PointerEvent): void {
    cancelLongPress();
    pointers.delete(event.pointerId);
    pinch = null;
    if (pointers.size === 0) stopTracking();
    marquee?.remove();
    marquee = null;
    workspace.cancelDrag();
  }

  host.addEventListener('pointerdown', (event) => {
    if (hasOpenPanel()) return;
    // The canvas manages its own roving focus, so the browser must not move focus here.
    event.preventDefault();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    startTracking();
    const state = workspace.state;

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      if (a && b) {
        pinch = {
          distance: Math.hypot(a.x - b.x, a.y - b.y),
          zoom: state.zoom,
          centre: workspace.documentPointOf((a.x + b.x) / 2, (a.y + b.y) / 2),
        };
      }
      workspace.cancelDrag();
      return;
    }

    const point = workspace.documentPointOf(event.clientX, event.clientY);
    pressPoint = { x: event.clientX, y: event.clientY };
    pressedShape = null;
    const hit = hitTest(state, point);

    if (hit.shape && isLayerLocked(currentPage(state), hit.shape.layer)) {
      workspace.announceLocked(hit.shape);
      return;
    }

    if (event.pointerType === 'touch' && hit.shape) {
      const shapeId = hit.shape.id;
      const at = { x: event.clientX, y: event.clientY };
      longPress = window.setTimeout(() => {
        longPress = null;
        workspace.cancelDrag();
        workspace.select([shapeId]);
        workspace.openShapeActions(at);
      }, LONG_PRESS_MS);
    }

    if (!workspace.editable) {
      if (hit.shape) {
        workspace.select([hit.shape.id]);
        workspace.focusShape(hit.shape.id);
      } else {
        workspace.clearSelection();
        workspace.canvas.svg.focus();
      }
      return;
    }

    if (hit.port && hit.shape) {
      connectFrom = hit.port;
      workspace.beginDrag(startSimple(state, 'connect', event.pointerId, point, hit.port));
      return;
    }
    if (hit.corner && hit.shape) {
      workspace.beginDrag(startResize(state, event.pointerId, point, hit.shape, hit.corner, event.altKey));
      return;
    }
    if (hit.shape) {
      if (event.shiftKey) {
        workspace.toggleSelected(hit.shape.id);
        workspace.focusShape(hit.shape.id);
        return;
      }
      pressedShape = hit.shape.id;
      if (!state.selection.includes(hit.shape.id)) workspace.select([hit.shape.id]);
      workspace.focusShape(hit.shape.id);
      const session = startMove(workspace.state, event.pointerId, point, event.altKey);
      if (session) workspace.beginDrag(session);
      return;
    }
    if (event.pointerType === 'touch') {
      workspace.beginDrag(startSimple(state, 'pan', event.pointerId, point, null));
      return;
    }
    workspace.clearSelection();
    workspace.canvas.svg.focus();
    workspace.beginDrag(startSimple(workspace.state, 'marquee', event.pointerId, point, null));
  });

  host.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      if (event.ctrlKey) {
        const centre = workspace.documentPointOf(event.clientX, event.clientY);
        workspace.zoomBy(event.deltaY < 0 ? 1 : -1, centre);
        return;
      }
      workspace.panBy(event.deltaX, event.deltaY);
    },
    { passive: false },
  );

  host.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const hit = hitTest(workspace.state, workspace.documentPointOf(event.clientX, event.clientY));
    if (!hit.shape) return;
    workspace.select([hit.shape.id]);
    workspace.openShapeActions({ x: event.clientX, y: event.clientY });
  });

  host.addEventListener('pointermove', (event) => {
    const point = workspace.documentPointOf(event.clientX, event.clientY);
    workspace.live.sendCursor(workspace.state.pageId, Math.round(point.x), Math.round(point.y));
  });
}

/** A drag from a port dot to a port on another shape creates a connector. */
function finishConnect(
  workspace: Workspace,
  from: { shape: string; port: Port },
  point: { x: number; y: number },
): void {
  const page = currentPage(workspace.state);
  const hit = hitTest(workspace.state, point);
  const target = hit.shape;
  if (!target || target.id === from.shape) return;
  if (isLayerLocked(page, target.layer)) {
    workspace.announceLocked(target);
    return;
  }
  const source = findShape(page, from.shape);
  if (!source) return;
  const port =
    hit.port?.shape === target.id ? hit.port.port : defaultPortPair(boxOf(source), boxOf(target)).to;
  workspace.live.send({
    kind: 'add_connector',
    page: page.id,
    from,
    to: { shape: target.id, port },
    label: '',
    clientRef: 'drag-connect',
  });
}
