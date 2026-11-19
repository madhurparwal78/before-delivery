import { PORTS, findShape, isLayerLocked } from '../../shared/document.js';
import { nudgeStep } from '../../shared/geometry.js';
import type { Workspace } from './controller.js';
import { wirePointer } from './pointer.js';
import { currentPage, focusOrder, selectedShapes } from './store.js';

const ARROW_DELTAS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Every pointer action has a keyboard path, from the published shortcut table. */
export function wireKeyboard(workspace: Workspace): void {
  const state = workspace.state;

  window.addEventListener('keydown', (event) => {
    const target = event.target;
    const typing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement;
    const onCanvas =
      target === workspace.canvas.svg ||
      (target instanceof Element && workspace.canvas.svg.contains(target));
    const control = event.ctrlKey || event.metaKey;

    if (!typing && control && event.altKey) {
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        workspace.addPage();
        return;
      }
      if (event.key.toLowerCase() === 'o') {
        event.preventDefault();
        workspace.toggleOutline(true);
        return;
      }
      if (event.key.toLowerCase() === 'h') {
        event.preventDefault();
        if (workspace.layout() === 'narrow') workspace.openSheet('history');
        else workspace.setInspectorTab('history');
        return;
      }
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        workspace.openSaveVersion();
        return;
      }
    }

    if (!typing && control && event.shiftKey && event.key.toLowerCase() === 'e') {
      event.preventDefault();
      workspace.openExport();
      return;
    }

    if (!typing && control && (event.key === 'PageDown' || event.key === 'PageUp')) {
      event.preventDefault();
      workspace.nextPage(event.key === 'PageDown' ? 1 : -1);
      return;
    }

    if (!typing && control && (event.key === '=' || event.key === '+' || event.key === '-' || event.key === '0')) {
      event.preventDefault();
      if (event.key === '0') workspace.resetZoom();
      else workspace.zoomStep(event.key === '-' ? -1 : 1);
      return;
    }

    if (!typing && control && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) workspace.redo();
      else workspace.undo();
      return;
    }

    if (!typing && event.altKey && event.shiftKey) {
      const key = event.key.toLowerCase();
      const sides: Record<string, 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom'> = {
        l: 'left',
        c: 'centre',
        r: 'right',
        t: 'top',
        m: 'middle',
        b: 'bottom',
      };
      if (sides[key]) {
        event.preventDefault();
        workspace.align(sides[key]);
        return;
      }
      if (key === 'h' || key === 'v') {
        event.preventDefault();
        workspace.distribute(key === 'h' ? 'horizontal' : 'vertical');
        return;
      }
    }

    if (typing || !onCanvas) return;

    if (state.connect) {
      handleConnectKeys(workspace, event);
      return;
    }

    const delta = ARROW_DELTAS[event.key];
    if (delta && event.altKey) {
      event.preventDefault();
      const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
      moveRovingFocus(workspace, forward ? 1 : -1);
      return;
    }
    if (delta) {
      event.preventDefault();
      const step = nudgeStep(event.shiftKey);
      workspace.nudge(delta[0] * step, delta[1] * step);
      return;
    }

    if (control && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      workspace.selectAll();
      return;
    }
    if (control && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      workspace.duplicateSelection();
      return;
    }
    if (control && (event.key === ']' || event.key === '[')) {
      event.preventDefault();
      workspace.reorderSelection(event.key === ']' ? 'forward' : 'backward');
      return;
    }
    if (control && event.key.toLowerCase() === 'g') {
      event.preventDefault();
      if (event.shiftKey) workspace.ungroupSelection();
      else workspace.groupSelection();
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      workspace.deleteSelection();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      workspace.clearSelection();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleActivate(workspace, event.shiftKey);
      return;
    }
    if (event.key === 'F10' && event.shiftKey) {
      event.preventDefault();
      const selected = selectedShapes(state)[0];
      if (!selected) return;
      const node = workspace.canvas.shapes.get(selected.id);
      const box = node?.getBoundingClientRect();
      workspace.openShapeActions({ x: box?.left ?? 0, y: box?.bottom ?? 0 });
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 'r' && !control) {
      event.preventDefault();
      workspace.insertShape('rectangle');
      return;
    }
    if (key === 'c' && !control) {
      event.preventDefault();
      workspace.startConnect();
      return;
    }
    if (key === 'm' && !control) {
      event.preventDefault();
      const selected = state.selection[0];
      if (selected !== undefined) workspace.commentOnShape(selected);
    }
  });
}

function handleConnectKeys(workspace: Workspace, event: KeyboardEvent): void {
  const connect = workspace.state.connect;
  if (!connect) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    workspace.cancelConnect();
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    workspace.commitConnect();
    return;
  }
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault();
    workspace.moveConnectHighlight(1);
    return;
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault();
    workspace.moveConnectHighlight(-1);
    return;
  }
  const index = Number(event.key) - 1;
  const port = PORTS[index];
  if (port !== undefined) {
    event.preventDefault();
    workspace.setConnectPort(port);
  }
}

/** Alt+Arrow moves the roving focus through the shapes in reading order. */
function moveRovingFocus(workspace: Workspace, step: 1 | -1): void {
  const page = currentPage(workspace.state);
  const order = focusOrder(page);
  if (order.length === 0) return;
  const current = order.findIndex((shape) => shape.id === workspace.state.focusedShape);
  const next = order[Math.min(order.length - 1, Math.max(0, current + step))] ?? order[0];
  if (next) workspace.focusShape(next.id);
}

function handleActivate(workspace: Workspace, shiftHeld: boolean): void {
  const state = workspace.state;
  const focused = state.focusedShape;
  if (focused === null) return;
  const page = currentPage(state);
  const shape = findShape(page, focused);
  if (!shape) return;
  if (isLayerLocked(page, shape.layer)) {
    workspace.announceLocked(shape);
    return;
  }
  if (shiftHeld) {
    workspace.toggleSelected(focused);
    return;
  }
  if (!state.selection.includes(focused)) {
    workspace.select([focused]);
    return;
  }
  workspace.openLabelEditor(focused);
}

/** The canvas is one tab stop: Tab into it focuses the last or first shape in reading order. */
export function wireCanvasFocus(workspace: Workspace): void {
  const svg = workspace.canvas.svg;
  svg.addEventListener('focus', () => {
    const page = currentPage(workspace.state);
    const order = focusOrder(page);
    if (order.length === 0) return;
    const remembered = workspace.state.focusedShape;
    const target = order.find((shape) => shape.id === remembered) ?? order[0];
    if (target) workspace.focusShape(target.id);
  });
  for (const [id, node] of workspace.canvas.shapes) {
    node.addEventListener('focus', () => {
      workspace.state.focusedShape = id;
    });
  }
}

/** Wiring a rebuilt canvas needs: the roving focus listeners. */
export function wireCanvasInput(workspace: Workspace): void {
  wireCanvasFocus(workspace);
}

/** Wiring attached once: pointer gestures on the persistent host and the shortcuts. */
export function wireWorkspaceInput(workspace: Workspace): void {
  wirePointer(workspace);
  wireKeyboard(workspace);
}
