import { takesChildren } from '../../shared/tree.js';
import type { PlinthNode } from '../../shared/types.js';
import { button, el, icon, patchChildren, setAttr, setText } from '../dom.js';
import { canvasElement } from './canvas.js';
import { addPage, renameNode, selectNode } from './actions.js';
import { canEdit, currentPage, state } from './store.js';

export interface Row {
  node: PlinthNode;
  level: number;
  position: number;
  setSize: number;
  parentId: string | null;
}

let container: HTMLElement | undefined;
let treeEl: HTMLElement | undefined;

export function rowName(node: PlinthNode): string {
  let name = `${node.name}, ${node.type}`;
  if (node.shared !== undefined) name += ', shared';
  if (node.bind !== undefined && Object.keys(node.bind).length > 0) name += ', bound';
  return name;
}

export function navigatorElement(): HTMLElement {
  if (container) return container;
  treeEl = el('div', { role: 'tree', 'aria-label': 'Navigator', id: 'navigator-tree' });
  const add = button('Add page', { class: 'ghost', id: 'add-page' });
  add.prepend(icon('plus'));
  add.addEventListener('click', () => {
    void addPage();
  });
  container = el('div', { id: 'navigator', class: 'panel-column' }, [
    el('div', { class: 'panel-head' }, [el('h2', {}, ['Navigator'])]),
    treeEl,
    add,
  ]);
  return container;
}

export function rows(): Row[] {
  const page = currentPage();
  if (!page) return [];
  const out: Row[] = [];
  const walk = (node: PlinthNode, level: number, position: number, setSize: number, parentId: string | null): void => {
    out.push({ node, level, position, setSize, parentId });
    if (state.collapsed.has(node.id)) return;
    node.children.forEach((child, index) => {
      walk(child, level + 1, index + 1, node.children.length, node.id);
    });
  };
  walk(page.root, 1, 1, 1, null);
  return out;
}

export function rowElement(nodeId: string): HTMLElement | undefined {
  return treeEl?.querySelector<HTMLElement>(`[role="treeitem"][data-node-id="${nodeId}"]`) ?? undefined;
}

export function navigatorVisible(): boolean {
  if (state.layout === 'desktop') return true;
  if (state.layout === 'phone') return false;
  return state.navigatorOpen;
}

/** Row focus is the target only while the Navigator is visible. */
export function focusNodeRow(nodeId: string): void {
  if (!navigatorVisible()) {
    canvasElement().focus();
    return;
  }
  const row = rowElement(nodeId);
  if (row) {
    setRoving(nodeId);
    row.focus();
    return;
  }
  canvasElement().focus();
}

export function setRoving(nodeId: string): void {
  for (const row of treeEl?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []) {
    row.tabIndex = row.dataset['nodeId'] === nodeId ? 0 : -1;
  }
}

function startRename(row: HTMLElement, node: PlinthNode): void {
  if (!canEdit()) return;
  const label = row.querySelector<HTMLElement>('.row-name');
  if (!label) return;
  const input = el('input', { type: 'text', 'aria-label': 'Name', class: 'rename' });
  input.value = node.name;
  label.hidden = true;
  row.append(input);
  input.focus();
  input.select();
  let done = false;
  const finishRename = (commit: boolean): void => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    if (input.parentNode !== null) input.parentNode.removeChild(input);
    label.hidden = false;
    row.focus();
    if (commit && value !== '' && value !== node.name) void renameNode(node.id, value);
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      finishRename(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finishRename(false);
    }
  });
  input.addEventListener('blur', () => {
    finishRename(true);
  });
}

export function renameFocusedRow(): void {
  const nodeId = state.selectedId;
  if (nodeId === null) return;
  const row = rowElement(nodeId);
  const node = currentPage() ? rowOf(nodeId) : undefined;
  if (row && node) startRename(row, node);
}

function rowOf(nodeId: string): PlinthNode | undefined {
  return rows().find((row) => row.node.id === nodeId)?.node;
}

export function renderNavigator(): void {
  navigatorElement();
  const list = rows();
  patchChildren<Row>(
    treeEl!,
    list,
    (row) => row.node.id,
    () => {
      const row = el('div', { role: 'treeitem', tabindex: '-1', class: 'nav-row' }, [
        el('span', { class: 'twisty', 'aria-hidden': 'true' }),
        el('span', { class: 'row-name' }),
      ]);
      row.addEventListener('click', () => {
        const nodeId = row.dataset['nodeId'];
        if (nodeId !== undefined) {
          setRoving(nodeId);
          row.focus();
          selectNode(nodeId);
        }
      });
      row.addEventListener('dblclick', () => {
        const node = rowOf(row.dataset['nodeId'] ?? '');
        if (node) startRename(row, node);
      });
      return row;
    },
    (element, row) => {
      setAttr(element, 'data-node-id', row.node.id);
      setAttr(element, 'aria-level', String(row.level));
      setAttr(element, 'aria-posinset', String(row.position));
      setAttr(element, 'aria-setsize', String(row.setSize));
      setAttr(element, 'aria-selected', state.selectedId === row.node.id ? 'true' : 'false');
      setAttr(element, 'aria-label', rowName(row.node));
      element.style.setProperty('--level', String(row.level));
      const hasChildren = takesChildren(row.node.type) && row.node.children.length > 0;
      if (hasChildren) {
        setAttr(element, 'aria-expanded', state.collapsed.has(row.node.id) ? 'false' : 'true');
      } else {
        element.removeAttribute('aria-expanded');
      }
      const twisty = element.querySelector<HTMLElement>('.twisty')!;
      setText(twisty, hasChildren ? (state.collapsed.has(row.node.id) ? '>' : 'v') : '');
      setText(element.querySelector<HTMLElement>('.row-name')!, rowName(row.node));
      element.classList.toggle('selected', state.selectedId === row.node.id);
    },
  );
  const rovingId =
    state.selectedId !== null && list.some((row) => row.node.id === state.selectedId)
      ? state.selectedId
      : list[0]?.node.id;
  if (rovingId !== undefined) setRoving(rovingId);
  const addButton = container!.querySelector<HTMLButtonElement>('#add-page')!;
  addButton.hidden = !canEdit();
  const visible = navigatorVisible();
  container!.hidden = !visible;
  if (visible) container!.removeAttribute('inert');
  else container!.setAttribute('inert', '');
  container!.classList.toggle('drawer', state.layout === 'tablet');
}
