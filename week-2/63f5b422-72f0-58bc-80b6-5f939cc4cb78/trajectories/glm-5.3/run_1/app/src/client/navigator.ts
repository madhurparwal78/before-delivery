// The Navigator tree: single tab stop, roving rows, keyboard semantics.
import { containerAccepts, TYPE_LABEL, type DocumentNode, type Breakpoint } from '../shared/domain.js';
import { el } from './canvas.js';
import type { EditorState } from './state.js';

export function rowName(node: DocumentNode): string {
  let name = `${node.name}, ${node.type}`;
  if (node.shared) name += ', shared';
  if (node.bind && Object.keys(node.bind).length > 0) name += ', bound';
  return name;
}

export function renderNavigator(state: EditorState): void {
  const nav = document.getElementById('navigator')!;
  nav.innerHTML = '';
  const page = state.page();
  if (!page) return;
  const rows = state.visibleRows();
  const total = rows.length;
  rows.forEach((row, i) => {
    const { node, level } = row;
    const item = el('div', {
      role: 'treeitem',
      'data-node-id': node.id,
      'aria-level': String(level + 1),
      'aria-posinset': String(i + 1),
      'aria-setsize': String(total),
      'aria-selected': state.selectedNodeId === node.id ? 'true' : 'false',
      tabindex: state.rovingRowId === node.id ? '0' : '-1',
    });
    const hasChildren = node.children.length > 0;
    if (hasChildren) {
      item.setAttribute('aria-expanded', state.expanded.has(node.id) ? 'true' : 'false');
    }
    item.setAttribute('aria-label', rowName(node));
    item.style.paddingLeft = `${level * 16 + 8}px`;
    const twisty = el('span', { 'data-twisty': 'true' }, hasChildren ? (state.expanded.has(node.id) ? '▾' : '▸') : '');
    twisty.style.display = 'inline-block';
    twisty.style.width = '16px';
    item.appendChild(twisty);
    item.appendChild(document.createTextNode(node.name));
    const typeSpan = el('span', { class: 'muted row-type' }, ` ${TYPE_LABEL[node.type]}${node.shared ? ' · shared' : ''}${node.bind ? ' · bound' : ''}`);
    item.appendChild(typeSpan);
    item.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).hasAttribute('data-twisty') && hasChildren) {
        toggleExpand(state, node.id);
        item.focus();
        return;
      }
      selectRow(state, node.id);
    });
    item.addEventListener('dblclick', () => startRename(state, node.id));
    nav.appendChild(item);
  });
  const addPage = el('button', { id: 'btn-add-page' }, 'Add page');
  addPage.addEventListener('click', () => {
    const ev = new CustomEvent('plinth:add-page');
    document.dispatchEvent(ev);
  });
  nav.appendChild(addPage);
}

export function toggleExpand(state: EditorState, nodeId: string): void {
  if (state.expanded.has(nodeId)) state.expanded.delete(nodeId);
  else state.expanded.add(nodeId);
  renderNavigator(state);
}

export function selectRow(state: EditorState, nodeId: string): void {
  state.selectedNodeId = nodeId;
  state.rovingRowId = nodeId;
  renderNavigator(state);
  renderCanvasSafe();
  const ev = new CustomEvent('plinth:select', { detail: { nodeId } });
  document.dispatchEvent(ev);
}

export function renderCanvasSafe(): void {
  const ev = new CustomEvent('plinth:rerender');
  document.dispatchEvent(ev);
}

export function focusRow(nodeId: string): void {
  const row = document.querySelector<HTMLElement>(`#navigator [data-node-id="${nodeId}"]`);
  if (row) {
    row.setAttribute('tabindex', '0');
    row.focus();
  }
}

export function startRename(state: EditorState, nodeId: string): void {
  const row = document.querySelector<HTMLElement>(`#navigator [data-node-id="${nodeId}"]`);
  if (!row) return;
  const node = state.findNode(nodeId);
  if (!node) return;
  const input = el('input', { type: 'text', 'aria-label': 'Name', value: node.name }) as HTMLInputElement;
  input.className = 'rename-input';
  row.replaceChildren(input);
  input.focus();
  input.setSelectionRange(node.name.length, node.name.length);
  const commit = () => {
    const ev = new CustomEvent('plinth:rename', { detail: { nodeId, name: input.value } });
    document.dispatchEvent(ev);
  };
  const cancel = () => {
    renderNavigator(state);
    focusRow(nodeId);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
  });
  input.addEventListener('blur', () => {
    if (document.activeElement !== input) commit();
  });
}

/** Whether the Navigator is currently visible (affects focus targets). */
export function navigatorVisible(): boolean {
  const nav = document.getElementById('navigator');
  if (!nav) return false;
  if (nav.hasAttribute('inert') || nav.hasAttribute('hidden')) return false;
  return nav.getBoundingClientRect().width > 0;
}
