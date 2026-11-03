import type { NodeType } from '../../shared/types.js';
import { INSERTABLE_TYPES, NODE_TYPE_LABELS } from '../../shared/types.js';
import { el } from '../dom.js';
import { insertInstance, insertNode } from './actions.js';
import { openPlaceImageDialog } from './dialogs.js';
import { dragEnd, dragMove, dragStart } from './drag.js';
import { canEdit, state } from './store.js';

let menu: HTMLElement | undefined;
let opener: HTMLElement | undefined;

export function addMenuOpen(): boolean {
  return menu !== undefined;
}

export function closeAddMenu(restoreFocus = true): void {
  if (!menu) return;
  menu.remove();
  menu = undefined;
  if (restoreFocus) opener?.focus();
  opener = undefined;
}

function items(): HTMLElement[] {
  return menu === undefined
    ? []
    : [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

function moveFocus(delta: number): void {
  const all = items();
  const index = all.indexOf(document.activeElement as HTMLElement);
  const next = all[(index + delta + all.length) % all.length];
  next?.focus();
}

function menuItem(label: string, choose: () => void, type?: NodeType): HTMLElement {
  const item = el('button', { type: 'button', role: 'menuitem', tabindex: '-1' }, [label]);
  item.addEventListener('click', () => {
    closeAddMenu(false);
    choose();
  });
  if (type !== undefined) {
    item.addEventListener('mousedown', (event) => {
      const from = { x: event.clientX, y: event.clientY };
      let started = false;
      const move = (moveEvent: MouseEvent): void => {
        if (!started) {
          if (Math.abs(moveEvent.clientX - from.x) + Math.abs(moveEvent.clientY - from.y) < 5) {
            return;
          }
          started = true;
          dragStart({ kind: 'palette', type });
        }
        dragMove(moveEvent.clientX, moveEvent.clientY);
      };
      const up = (): void => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        if (!started) return;
        closeAddMenu(false);
        dragEnd();
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
    item.draggable = true;
    item.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('text/plain', type);
      dragStart({ kind: 'palette', type });
    });
    item.addEventListener('dragend', () => {
      closeAddMenu(false);
      dragEnd();
    });
  }
  return item;
}

export function openAddMenu(): void {
  if (!canEdit()) return;
  if (menu) {
    closeAddMenu(false);
    return;
  }
  opener = (document.activeElement as HTMLElement | null) ?? undefined;
  const typeItems = INSERTABLE_TYPES.map((type) =>
    menuItem(
      NODE_TYPE_LABELS[type],
      () => {
        if (type === 'image') openPlaceImageDialog();
        else void insertNode(type);
      },
      type,
    ),
  );
  const group = el(
    'div',
    { role: 'group', 'aria-label': 'Insert shared component' },
    state.doc.components.map((component) =>
      menuItem(component.name, () => void insertInstance(component.id)),
    ),
  );
  menu = el('div', { role: 'menu', 'aria-label': 'Add component', id: 'add-menu' }, [
    ...typeItems,
    group,
  ]);
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveFocus(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(-1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeAddMenu();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      moveFocus(event.shiftKey ? -1 : 1);
    }
  });
  const anchor = document.getElementById('add-button');
  const rect = anchor?.getBoundingClientRect();
  if (rect) {
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 4}px`;
  }
  document.body.append(menu);
  items()[0]?.focus();
}
