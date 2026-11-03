import { notices } from '../../shared/notices.js';
import { accepts } from '../../shared/tree.js';
import type { NodeType } from '../../shared/types.js';
import { el, setAttr } from '../dom.js';
import { insertNodeAt, moveAllowed, moveNodeTo } from './actions.js';
import { canvasElement } from './canvas.js';
import { canEdit, currentPage, nodeById, sayWithToast } from './store.js';

interface DragSource {
  kind: 'palette' | 'node';
  type: NodeType;
  nodeId?: string;
}

interface DropTarget {
  parentId: string;
  index: number;
}

let source: DragSource | undefined;
let target: DropTarget | undefined;

function indicator(): HTMLElement {
  const existing = document.getElementById('drop-indicator');
  if (existing) return existing;
  const made = el('div', { id: 'drop-indicator', 'aria-hidden': 'true', hidden: true });
  canvasElement().append(made);
  return made;
}

function nodeIdFromPoint(x: number, y: number): { nodeId: string; rect: DOMRect } | undefined {
  for (const element of document.elementsFromPoint(x, y)) {
    const holder = (element as HTMLElement).closest<HTMLElement>('[data-node-id]');
    if (holder && !holder.closest('#add-menu')) {
      return { nodeId: holder.dataset['nodeId']!, rect: holder.getBoundingClientRect() };
    }
  }
  return undefined;
}

function computeTarget(x: number, y: number, type: NodeType): DropTarget | undefined {
  const page = currentPage();
  if (!page) return undefined;
  const hit = nodeIdFromPoint(x, y);
  if (!hit) return { parentId: page.root.id, index: page.root.children.length };
  const node = nodeById(hit.nodeId);
  if (!node) return undefined;
  const middle = hit.rect.top + hit.rect.height / 2;
  if (accepts(node, type)) return { parentId: node.id, index: node.children.length };
  const parent = findParentOf(hit.nodeId);
  if (!parent) return { parentId: page.root.id, index: page.root.children.length };
  const index = parent.children.findIndex((child) => child.id === hit.nodeId);
  return { parentId: parent.id, index: y > middle ? index + 1 : index };
}

function findParentOf(nodeId: string) {
  const page = currentPage();
  if (!page) return undefined;
  const walk = (candidate: ReturnType<typeof nodeById>): ReturnType<typeof nodeById> => {
    if (!candidate) return undefined;
    if (candidate.children.some((child) => child.id === nodeId)) return candidate;
    for (const child of candidate.children) {
      const found = walk(child);
      if (found) return found;
    }
    return undefined;
  };
  return walk(page.root);
}

function showIndicator(x: number, y: number): void {
  const element = indicator();
  if (!target) {
    element.hidden = true;
    return;
  }
  element.hidden = false;
  setAttr(element, 'data-parent', target.parentId);
  setAttr(element, 'data-index', String(target.index));
  const canvasRect = canvasElement().getBoundingClientRect();
  element.style.left = `${x - canvasRect.left + canvasElement().scrollLeft}px`;
  element.style.top = `${y - canvasRect.top + canvasElement().scrollTop}px`;
}

export function dragMove(x: number, y: number): void {
  if (!source) return;
  target = computeTarget(x, y, source.type);
  showIndicator(x, y);
}

export function dragStart(next: DragSource): void {
  if (!canEdit()) return;
  source = next;
  target = undefined;
}

export function dragEnd(): void {
  const current = source;
  const slot = target;
  source = undefined;
  target = undefined;
  indicator().hidden = true;
  if (!current || !slot) return;
  if (current.kind === 'palette') {
    if (!acceptsHere(slot, current.type)) {
      sayWithToast(notices.refusedMove(current.type));
      return;
    }
    void insertNodeAt(current.type, slot.parentId, slot.index);
    return;
  }
  const nodeId = current.nodeId!;
  if (!moveAllowed(nodeId, slot.parentId, slot.index)) {
    sayWithToast(notices.refusedMove(nodeById(nodeId)?.name ?? 'that node'));
    return;
  }
  moveNodeTo(nodeId, slot.parentId, slot.index);
}

function acceptsHere(slot: DropTarget, type: NodeType): boolean {
  const parent = nodeById(slot.parentId);
  return parent !== undefined && accepts(parent, type);
}

export function dragging(): boolean {
  return source !== undefined;
}
