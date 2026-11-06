import { isTextEntry } from '../dom.js';
import {
  chooseBreakpoint,
  duplicateNode,
  moveByKeyboard,
  redo,
  selectNode,
  undo,
} from './actions.js';
import { addMenuOpen, closeAddMenu, openAddMenu } from './addmenu.js';
import { canvasElement, pageNodeIds } from './canvas.js';
import { closeDialog, dialogOpen, openCreateComponentDialog, openDeleteDialog } from './dialogs.js';
import { closeFan, fanShowing, focusFrame, toggleFan } from './fan.js';
import {
  focusNodeRow,
  navigatorVisible,
  renameFocusedRow,
  rowElement,
  rows,
  setRoving,
} from './navigator.js';
import { closePanel, openPanel } from './panels.js';
import { canEdit, currentPage, nodeById, render, state } from './store.js';
import type { Breakpoint } from '../../shared/types.js';

type Place = 'row' | 'canvas' | 'controls' | 'elsewhere';

function placeOf(target: HTMLElement | null): Place {
  if (!target) return 'elsewhere';
  if (target.closest('[role="treeitem"]')) return 'row';
  if (target.id === 'canvas' || target.closest('[data-frame]')) return 'canvas';
  const tag = target.tagName;
  if (tag === 'BUTTON' || tag === 'A') return 'controls';
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    if (type === 'radio' || type === 'range' || type === 'checkbox' || type === 'file') {
      return 'controls';
    }
  }
  return 'elsewhere';
}

function rowIds(): string[] {
  return rows().map((row) => row.node.id);
}

function focusedRowId(): string | undefined {
  const active = document.activeElement as HTMLElement | null;
  const row = active?.closest<HTMLElement>('[role="treeitem"]');
  return row?.dataset['nodeId'];
}

function moveRowFocus(delta: number): void {
  const ids = rowIds();
  const current = focusedRowId();
  const index = current === undefined ? -1 : ids.indexOf(current);
  const next = ids[Math.min(ids.length - 1, Math.max(0, index + delta))];
  if (next === undefined) return;
  setRoving(next);
  rowElement(next)?.focus();
}

function moveCanvasSelection(delta: number): void {
  const ids = pageNodeIds();
  const index = state.selectedId === null ? -1 : ids.indexOf(state.selectedId);
  const next = ids[Math.min(ids.length - 1, Math.max(0, index + delta))];
  if (next !== undefined) selectNode(next);
}

function expandOrEnter(): void {
  const id = focusedRowId();
  if (id === undefined) return;
  const node = nodeById(id);
  if (!node) return;
  if (node.children.length > 0 && state.collapsed.has(id)) {
    state.collapsed.delete(id);
    render();
    focusNodeRow(id);
    return;
  }
  const child = node.children[0];
  if (child) {
    setRoving(child.id);
    rowElement(child.id)?.focus();
  }
}

function collapseOrLeave(): void {
  const id = focusedRowId();
  if (id === undefined) return;
  const node = nodeById(id);
  if (!node) return;
  if (node.children.length > 0 && !state.collapsed.has(id)) {
    state.collapsed.add(id);
    render();
    focusNodeRow(id);
    return;
  }
  const parent = rows().find((row) => row.node.id === id)?.parentId;
  if (parent) {
    setRoving(parent);
    rowElement(parent)?.focus();
  }
}

function escapePressed(event: KeyboardEvent): void {
  if (state.panel !== 'none') {
    const opener = document.getElementById(`${state.panel}-button`);
    closePanel();
    opener?.focus();
    event.preventDefault();
    return;
  }
  if (state.layout === 'tablet' && state.navigatorOpen) {
    state.navigatorOpen = false;
    render();
    document.getElementById('navigator-button')?.focus();
    event.preventDefault();
    return;
  }
  if (fanShowing()) {
    closeFan();
    event.preventDefault();
  }
}

export function installKeys(): void {
  document.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    if (dialogOpen() || addMenuOpen()) {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        if (addMenuOpen()) closeAddMenu();
        else closeDialog();
        event.preventDefault();
      }
      return;
    }
    if (event.key === 'Escape') {
      escapePressed(event);
      return;
    }
    if (isTextEntry(target)) return;
    const place = placeOf(target);
    const selected = state.selectedId;
    const inEditor = place !== 'elsewhere';
    if (event.altKey && !event.ctrlKey && !event.metaKey && /^[123]$/.test(event.key) && inEditor) {
      const map: Record<string, Breakpoint> = { '1': 'desktop', '2': 'tablet', '3': 'phone' };
      const bp = map[event.key]!;
      event.preventDefault();
      chooseBreakpoint(bp);
      if (fanShowing()) focusFrame(bp);
      return;
    }
    if (event.ctrlKey && event.altKey && inEditor) {
      const key = event.key.toLowerCase();
      if (key === 'h') {
        event.preventDefault();
        openPanel('history');
        return;
      }
      if (key === 'p') {
        event.preventDefault();
        openPanel('publish');
        return;
      }
      if (key === 'k') {
        event.preventDefault();
        if (selected !== null) openCreateComponentDialog();
        return;
      }
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && inEditor) {
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) void redo();
        else void undo();
        return;
      }
      if (key === 'd') {
        event.preventDefault();
        if (selected !== null && canEdit() && (place === 'row' || place === 'canvas')) {
          void duplicateNode(selected);
        }
        return;
      }
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (place === 'row') {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveRowFocus(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveRowFocus(-1);
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        expandOrEnter();
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        collapseOrLeave();
        return;
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const ids = rowIds();
        const id = event.key === 'Home' ? ids[0] : ids[ids.length - 1];
        if (id !== undefined) {
          setRoving(id);
          rowElement(id)?.focus();
        }
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const id = focusedRowId();
        if (id !== undefined) {
          selectNode(id);
          if (state.layout === 'tablet' && state.navigatorOpen) {
            state.navigatorOpen = false;
            render();
            canvasElement().focus();
          }
        }
        return;
      }
      if (event.key === 'F2') {
        event.preventDefault();
        const id = focusedRowId();
        if (id !== undefined) {
          state.selectedId = id;
          renameFocusedRow();
        }
        return;
      }
    }
    if (place === 'canvas') {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveCanvasSelection(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveCanvasSelection(-1);
        return;
      }
    }
    if ((place === 'row' || place === 'canvas') && event.key === 'Delete') {
      event.preventDefault();
      const id = place === 'row' ? focusedRowId() : (selected ?? undefined);
      const page = currentPage();
      if (id !== undefined && canEdit() && id !== page?.root.id) openDeleteDialog(id);
      return;
    }
    if (place === 'row' && event.altKey) return;
    if (!inEditor) return;
    const key = event.key.toLowerCase();
    if (key === 'a') {
      event.preventDefault();
      openAddMenu();
      return;
    }
    if (key === 'f') {
      event.preventDefault();
      toggleFan();
      return;
    }
    if (key === 'm') {
      event.preventDefault();
      openPanel('comments');
      document.querySelector<HTMLTextAreaElement>('[aria-label="Comment"]')?.focus();
    }
  });

  document.addEventListener(
    'keydown',
    (event) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (isTextEntry(target)) return;
      const row = target?.closest<HTMLElement>('[role="treeitem"]');
      if (!row) return;
      const nodeId = row.dataset['nodeId'];
      if (nodeId === undefined || !navigatorVisible()) return;
      const directions: Record<string, 'up' | 'down' | 'indent' | 'outdent'> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowRight: 'indent',
        ArrowLeft: 'outdent',
      };
      const direction = directions[event.key];
      if (direction === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      moveByKeyboard(nodeId, direction);
    },
    true,
  );
}
