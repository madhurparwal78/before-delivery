import { byFocusKey, captureCaret, restoreCaret, type CaretState } from '../lib/dom';
import { captureCardRects, playHandOffGlide } from '../motion';
import { state } from '../store';
import { renderBoardScreen, renderNotFound } from './board';
import { renderOverlay } from './dialogs';
import { renderPermissionLog } from './log';
import { renderSignIn } from './signin';

function captureScrolls(root: ParentNode): Map<string, number> {
  const scrolls = new Map<string, number>();
  for (const node of root.querySelectorAll<HTMLElement>('[data-list-id] .cards')) {
    const column = node.closest<HTMLElement>('[data-list-id]');
    const listId = column?.dataset['listId'];
    if (listId !== undefined) scrolls.set(listId, node.scrollTop);
  }
  const row = root.querySelector<HTMLElement>('.lists');
  if (row !== null) scrolls.set('#row', row.scrollLeft);
  return scrolls;
}

function restoreScrolls(root: ParentNode, scrolls: Map<string, number>): void {
  for (const node of root.querySelectorAll<HTMLElement>('[data-list-id] .cards')) {
    const column = node.closest<HTMLElement>('[data-list-id]');
    const listId = column?.dataset['listId'];
    const value = listId === undefined ? undefined : scrolls.get(listId);
    if (value !== undefined) node.scrollTop = value;
  }
  const row = root.querySelector<HTMLElement>('.lists');
  const left = scrolls.get('#row');
  if (row !== null && left !== undefined) row.scrollLeft = left;
}

function positionMenu(root: ParentNode): void {
  const menu = root.querySelector<HTMLElement>('.menu');
  if (menu === null) return;
  const anchorKey = menu.dataset['anchor'];
  const anchor = anchorKey === undefined ? null : byFocusKey(root, anchorKey);
  if (anchor === null) return;
  const anchorRect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const margin = 8;
  let left = anchorRect.left;
  let top = anchorRect.bottom + 4;
  if (left + menuRect.width > window.innerWidth - margin) left = window.innerWidth - menuRect.width - margin;
  if (left < margin) left = margin;
  if (top + menuRect.height > window.innerHeight - margin) {
    top = Math.max(margin, anchorRect.top - menuRect.height - 4);
  }
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

function applyLiftVisual(root: ParentNode): void {
  const lift = state.lift;
  if (lift === null || lift.mode !== 'pointer') return;
  const node = root.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(lift.cardId)}"]`);
  if (node === null) return;
  node.style.transform = `translate(${lift.pointerX - lift.grabX}px, ${lift.pointerY - lift.grabY}px)`;
}

function applyFocus(root: ParentNode, caret: CaretState | null): void {
  const pending = state.pendingFocus;
  if (pending === null) {
    restoreCaret(root, caret);
    return;
  }
  state.pendingFocus = null;
  if (pending === 'menu:first' || pending === 'sheet:first') {
    const first = root.querySelector<HTMLElement>(pending === 'menu:first' ? '.menu .menu-item' : '.sheet a, .sheet button');
    if (first !== null) {
      first.focus();
      return;
    }
  }
  const node = byFocusKey(root, pending);
  if (node !== null) {
    node.focus();
    return;
  }
  restoreCaret(root, caret);
}

function screenFragment(): DocumentFragment {
  switch (state.screen) {
    case 'signin':
      return renderSignIn();
    case 'board':
      return renderBoardScreen();
    case 'boardNotFound':
      return renderNotFound('board');
    case 'cardNotFound':
      return renderNotFound('card');
    case 'permissionLog':
      return renderPermissionLog();
    default:
      return document.createDocumentFragment();
  }
}

export function render(): void {
  const root = document.getElementById('app');
  if (root === null) return;
  const caret = captureCaret();
  const scrolls = captureScrolls(root);
  const rects = captureCardRects(root);
  const fragment = screenFragment();
  const overlay = state.screen === 'signin' || state.screen === 'permissionLog' ? null : renderOverlay();
  if (overlay !== null) fragment.append(overlay);
  root.replaceChildren(fragment);
  restoreScrolls(root, scrolls);
  playHandOffGlide(root, rects);
  positionMenu(root);
  applyLiftVisual(root);
  applyFocus(root, caret);
}
