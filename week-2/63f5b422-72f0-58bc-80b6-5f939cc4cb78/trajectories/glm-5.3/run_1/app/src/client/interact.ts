// Editor interactions: keyboard scope, Add menu, dialogs, Cascade Fan, drags.
import {
  BREAKPOINTS, BP_LABEL, BP_WIDTH, TYPE_LABEL, containerAccepts, resolveStyle, reachOfChange, joinBps,
  cascadeNotice, pipState, displayValue,
  type WorkspaceDocument, type DocumentNode, type Breakpoint, type StyleProperty, type NodeType,
} from '../shared/domain.js';
import { el } from './canvas.js';
import { announce, notices, publishStateText } from './announce.js';
import { toggleMotion, reducedMotion, timedEffect } from './motion.js';
import { navigatorVisible, focusRow } from './navigator.js';
import { renderStylePanel } from './stylepanel.js';

// filled by editor.ts at boot
export interface InteractContext {
  state: import('./state.js').EditorState;
  sendOp: (op: Record<string, unknown>, opts?: { optimistic?: () => void; rollback?: () => void }) => void;
  api: <T>(path: string, init?: RequestInit) => Promise<T>;
  renderAll: () => void;
  refreshThreads: () => Promise<void>;
  refreshPublish: () => Promise<void>;
  refreshImages: () => Promise<void>;
  refreshVersions: () => Promise<void>;
  reloadDocument: () => Promise<void>;
  openPanelRef: { current: string | null };
  setStorageBanner: (show: boolean) => void;
}

let ctx: InteractContext;
export function setInteractContext(c: InteractContext): void { ctx = c; }

const ADD_TYPES: NodeType[] = ['section', 'stack', 'heading', 'text', 'image', 'button', 'nav', 'collection_list'];

// ---- focus location ------------------------------------------------------

function inTextField(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable || t.hasAttribute('data-rename');
}

function focusLocation(target: EventTarget | null): 'row' | 'canvas' | 'controls' | 'field' | 'dialog' | 'menu' | null {
  const t = target as HTMLElement | null;
  if (!t) return null;
  if (inTextField(t)) return 'field';
  if (activeDialog) return 'dialog';
  if (activeMenu) return 'menu';
  const nav = t.closest('#navigator');
  if (nav && t.getAttribute('role') === 'treeitem') return 'row';
  if (t.closest('#canvas')) return 'canvas';
  if (t.closest('#top-bar') || t.closest('#style-panel') || t.closest('#sheet') || t.closest('[role="toolbar"]') || t.closest('#presence')) return 'controls';
  return null;
}

function selectedNode(): DocumentNode | null {
  const id = ctx.state.selectedNodeId;
  return id ? ctx.state.findNode(id) : null;
}

function insertTargetFor(node: DocumentNode | null): { parentId: string; index: number } | null {
  const page = ctx.state.page();
  if (!page) return null;
  if (!node || node.id === page.root.id) {
    return { parentId: page.root.id, index: page.root.children.length };
  }
  const ref = ctx.state.findNodeParent(node.id);
  if (!ref) return null;
  if (containerAccepts(node.type, 'section') || takesMore(node)) {
    const parentRef = ctx.state.findNodeParent(node.id);
    if (parentRef && parentRef.parent) {
      const idx = parentRef.parent.children.findIndex((c) => c.id === node.id);
      return { parentId: node.id, index: 0 };
    }
  }
  // insert after the closest node whose parent can take it
  let cur = node;
  let curParent = ref.parent;
  while (curParent) {
    const idx = curParent.children.findIndex((c) => c.id === cur.id);
    if (idx !== -1) return { parentId: curParent.id, index: idx + 1 };
    const up = ctx.state.findNodeParent(curParent.id);
    cur = curParent;
    curParent = up?.parent ?? null;
  }
  return null;
}

function takesMore(node: DocumentNode): boolean {
  if (node.type === 'collection_list') return node.children.length === 0;
  if (node.type === 'nav') return true;
  return containerAccepts(node.type, 'section');
}

// ---- menus ---------------------------------------------------------------

let activeMenu: HTMLElement | null = null;
let menuOpener: HTMLElement | null = null;

export function openAddMenu(): void {
  closeMenu();
  const menu = el('div', { role: 'menu', 'aria-label': 'Add component', class: 'menu' });
  const state = ctx.state;
  menuOpener = document.activeElement as HTMLElement;
  for (const type of ADD_TYPES) {
    const item = el('div', { role: 'menuitem', tabindex: '-1', 'data-add-type': type }, TYPE_LABEL[type]);
    item.addEventListener('click', () => chooseAdd(type));
    menu.appendChild(item);
  }
  const doc = state.shownDocument();
  if (doc && doc.components.length > 0) {
    const group = el('div', { role: 'group', 'aria-label': 'Insert shared component' });
    for (const comp of doc.components) {
      const item = el('div', { role: 'menuitem', tabindex: '-1', 'data-add-component': comp.id }, comp.name);
      item.addEventListener('click', () => chooseAddComponent(comp.id, comp.name));
      group.appendChild(item);
    }
    menu.appendChild(group);
  }
  document.getElementById('menus')!.appendChild(menu);
  activeMenu = menu;
  (menu.querySelector<HTMLElement>('[role="menuitem"]'))?.focus();
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      closeMenu();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
      const idx = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'ArrowDown' ? items[idx + 1] ?? items[0] : items[idx - 1] ?? items[items.length - 1];
      next.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      (document.activeElement as HTMLElement).click();
    }
    e.stopPropagation();
  });
}

export function closeMenu(): void {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
    menuOpener?.focus();
  }
}

function chooseAdd(type: NodeType): void {
  const state = ctx.state;
  closeMenu();
  if (type === 'image') {
    openPlaceImageDialog();
    return;
  }
  const target = insertTargetFor(selectedNode());
  if (!target) return;
  ctx.sendOp({
    kind: 'insert_node', pageId: state.pageId, parentId: target.parentId, index: target.index, type,
  }, {
    optimistic: () => { /* server ack rerenders */ },
    rollback: () => ctx.renderAll(),
  });
}

function chooseAddComponent(componentId: string, _name: string): void {
  const state = ctx.state;
  closeMenu();
  const target = insertTargetFor(selectedNode());
  if (!target) return;
  ctx.sendOp({
    kind: 'insert_instance', pageId: state.pageId, parentId: target.parentId, index: target.index, componentId,
  }, { rollback: () => ctx.renderAll() });
}

// ---- dialogs ------------------------------------------------------------

let activeDialog: HTMLElement | null = null;
let dialogOpener: HTMLElement | null = null;

export function openDialog(name: string, build: (dialog: HTMLElement) => void, opener: HTMLElement | null): void {
  closeDialog();
  const dialog = el('div', { role: 'dialog', 'aria-label': name, class: 'dialog' });
  dialogOpener = opener ?? (document.activeElement as HTMLElement);
  build(dialog);
  document.getElementById('dialogs')!.appendChild(dialog);
  activeDialog = dialog;
  trapFocus(dialog);
  (dialog.querySelector<HTMLElement>('input, button, select, textarea') ?? dialog).focus();
}

export function closeDialog(): void {
  if (activeDialog) {
    const wasDelete = activeDialog.getAttribute('data-dialog-kind') === 'delete';
    activeDialog.remove();
    activeDialog = null;
    dialogOpener?.focus();
    dialogOpener = null;
    void wasDelete;
  }
}

function trapFocus(dialog: HTMLElement): void {
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      const confirmDelete = dialog.getAttribute('data-dialog-kind') === 'delete';
      closeDialog();
      if (confirmDelete) {
        // focus the row that took the deleted row's place, else the parent's row
        const state = ctx.state;
        const target = state.pendingDeleteTarget;
        if (target) focusRow(target);
        state.pendingDeleteTarget = null;
      }
      return;
    }
    if (e.key === 'Tab') {
      const focusables = [...dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')];
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    e.stopPropagation();
  });
}

export function openDeleteDialog(node: DocumentNode): void {
  const state = ctx.state;
  const ref = state.findNodeParent(node.id);
  openDialog(`Delete ${node.name}?`, (dialog) => {
    dialog.setAttribute('data-dialog-kind', 'delete');
    dialog.appendChild(el('p', {}, `Delete ${node.name}?`));
    const del = el('button', { class: 'primary' }, 'Delete');
    const cancel = el('button', {}, 'Cancel');
    del.addEventListener('click', () => {
      const parent = ref?.parent;
      const idx = parent ? parent.children.findIndex((c) => c.id === node.id) : -1;
      ctx.sendOp({ kind: 'delete_node', nodeId: node.id }, {
        rollback: () => ctx.renderAll(),
      });
      // focus target: the row that takes its place, else the parent's row
      const siblings = parent?.children ?? [];
      const next = siblings[idx] ?? siblings[idx - 1] ?? parent;
      state.pendingDeleteTarget = next?.id ?? null;
      closeDialog();
      announce(notices.deleted(node.name));
      focusRow(state.pendingDeleteTarget ?? node.id);
      state.pendingDeleteTarget = null;
      ctx.renderAll();
    });
    cancel.addEventListener('click', () => closeDialog());
    dialog.append(del, cancel);
  }, null);
}

export function openPlaceImageDialog(): void {
  const state = ctx.state;
  openDialog('Place image', (dialog) => {
    const imageCombo = el('select', { 'aria-label': 'Image' }) as HTMLSelectElement;
    for (const img of state.images) {
      const o = el('option', { value: img.id }, img.fileName) as HTMLOptionElement;
      imageCombo.appendChild(o);
    }
    const alt = el('input', { type: 'text', 'aria-label': 'Alt text' }) as HTMLInputElement;
    const place = el('button', { class: 'primary' }, 'Place');
    const cancel = el('button', {}, 'Cancel');
    place.addEventListener('click', () => {
      if (alt.value.trim() === '') {
        announce(notices.altRequired());
        alt.focus();
        return;
      }
      const target = insertTargetFor(selectedNode());
      closeDialog();
      if (!target) return;
      ctx.sendOp({
        kind: 'insert_node', pageId: state.pageId, parentId: target.parentId, index: target.index,
        type: 'image', props: { imageId: imageCombo.value, alt: alt.value, focalX: 50, focalY: 50 },
      }, { rollback: () => ctx.renderAll() });
    });
    cancel.addEventListener('click', () => closeDialog());
    const rows = el('div', { class: 'dialog-body' });
    rows.append(imageCombo, alt, place, cancel);
    dialog.appendChild(rows);
  }, null);
}

export function openSaveVersionDialog(): void {
  const state = ctx.state;
  openDialog('Save version', (dialog) => {
    const name = el('input', { type: 'text', 'aria-label': 'Version name' }) as HTMLInputElement;
    const save = el('button', { class: 'primary' }, 'Save');
    const cancel = el('button', {}, 'Cancel');
    save.addEventListener('click', async () => {
      save.setAttribute('aria-busy', 'true');
      save.disabled = true;
      try {
        await ctx.api(`/api/workspaces/${state.workspaceId}/versions`, {
          method: 'POST', body: JSON.stringify({ name: name.value.trim() || undefined }),
        });
        announce(notices.versionSaved(name.value.trim() || 'the version'));
        await ctx.refreshVersions();
      } finally {
        closeDialog();
      }
    });
    cancel.addEventListener('click', () => closeDialog());
    dialog.append(name, save, cancel);
  }, document.activeElement as HTMLElement);
}

export function openCreateSharedDialog(node: DocumentNode): void {
  const state = ctx.state;
  openDialog('Create shared component', (dialog) => {
    const name = el('input', { type: 'text', 'aria-label': 'Component name' }) as HTMLInputElement;
    name.value = node.name;
    const create = el('button', { class: 'primary' }, 'Create');
    const cancel = el('button', {}, 'Cancel');
    create.addEventListener('click', () => {
      ctx.sendOp({ kind: 'create_component', nodeId: node.id, name: name.value }, { rollback: () => ctx.renderAll() });
      closeDialog();
    });
    cancel.addEventListener('click', () => closeDialog());
    dialog.append(name, create, cancel);
  }, null);
}

export function openPublishDialog(pageName: string, onPublish: () => void): void {
  openDialog('Publish page', (dialog) => {
    dialog.appendChild(el('p', {}, 'Publish this page?'));
    const pub = el('button', { class: 'primary' }, 'Publish now');
    const cancel = el('button', {}, 'Cancel');
    pub.addEventListener('click', () => {
      closeDialog();
      onPublish();
    });
    cancel.addEventListener('click', () => closeDialog());
    dialog.append(pub, cancel);
  }, document.activeElement as HTMLElement);
}

export function openRestoreDialog(versionName: string, onRestore: () => void): void {
  openDialog('Restore version', (dialog) => {
    dialog.appendChild(el('p', {}, `Restore ${versionName}?`));
    const restore = el('button', { class: 'primary' }, 'Restore');
    const cancel = el('button', {}, 'Cancel');
    restore.addEventListener('click', async () => {
      restore.setAttribute('aria-busy', 'true');
      restore.disabled = true;
      announce(notices.restoreProgress(versionName));
      try {
        onRestore();
      } finally {
        closeDialog();
      }
    });
    cancel.addEventListener('click', () => closeDialog());
    dialog.append(restore, cancel);
  }, document.activeElement as HTMLElement);
}

// ---- Cascade Fan ---------------------------------------------------------

export function isFanAvailable(): boolean {
  return window.innerWidth >= 768 && ctx.state.selectedNodeId !== null;
}

export function toggleFan(): void {
  const canvas = document.getElementById('canvas')!;
  const current = canvas.getAttribute('data-fan') ?? 'closed';
  if (current === 'closed') {
    openFan();
  } else {
    closeFan();
  }
}

function openFan(): void {
  const canvas = document.getElementById('canvas')!;
  canvas.setAttribute('data-fan', 'opening');
  canvas.setAttribute('data-fan-progress', '0.00');
  ctx.renderAll(); // renders three frames
  const applyScale = (progress: number) => {
    const frames = [...canvas.querySelectorAll<HTMLElement>('[data-frame]')];
    const canvasWidth = canvas.clientWidth;
    const gap = 24;
    const total = BP_WIDTH.desktop + BP_WIDTH.tablet + BP_WIDTH.phone + gap * 2;
    const fitScale = Math.min(1, (canvasWidth - 32) / total);
    frames.forEach((frame, i) => {
      const scale = 1 + (fitScale - 1) * progress;
      frame.style.transform = `scale(${scale})`;
      frame.style.transformOrigin = 'top left';
      // tablet slides out to the right of desktop at start; phone 90 ms later
      const delay = i === 0 ? 0 : i === 1 ? 0 : 90 / 420;
      const t = Math.max(0, (progress - delay) / (1 - delay));
      frame.style.marginLeft = i === 0 ? '' : `${(BP_WIDTH.desktop + gap) * t * fitScale * 0 + gap * t}px`;
    });
    // cascade line joins the three outlines
    let line = canvas.querySelector<HTMLElement>('#cascade-line');
    if (!line) {
      line = el('div', { id: 'cascade-line', 'aria-hidden': 'true' });
      canvas.appendChild(line);
    }
    line.style.display = progress > 0.1 ? 'block' : 'none';
  };
  const done = (s: string) => {
    canvas.setAttribute('data-fan', s === 'open' ? 'open' : 'closed');
    if (s === 'closed') fanClosedFocus();
    renderStylePanel(ctx.state, panelHandlersStub);
  };
  if (reducedMotion()) {
    canvas.setAttribute('data-fan', 'open');
    canvas.setAttribute('data-fan-progress', '1.00');
    applyScale(1);
    done('open');
    return;
  }
  toggleMotion(canvas, true, 420, 'data-fan', 'data-fan-progress', applyScale, done);
}

function closeFan(): void {
  const canvas = document.getElementById('canvas')!;
  const applyScale = (progress: number) => {
    const frames = [...canvas.querySelectorAll<HTMLElement>('[data-frame]')];
    frames.forEach((frame) => {
      const fitScale = parseFloat(frame.dataset.scale ?? '1');
      const scale = 1 + (fitScale - 1) * progress;
      frame.style.transform = `scale(${scale})`;
    });
  };
  const done = (s: string) => {
    canvas.setAttribute('data-fan', s === 'open' ? 'open' : 'closed');
    if (s === 'closed') {
      canvas.querySelector('#cascade-line')?.remove();
      ctx.renderAll();
      fanClosedFocus();
    }
    renderStylePanel(ctx.state, panelHandlersStub);
  };
  if (reducedMotion()) {
    canvas.setAttribute('data-fan', 'closed');
    canvas.setAttribute('data-fan-progress', '0.00');
    done('closed');
    return;
  }
  toggleMotion(canvas, false, 420, 'data-fan', 'data-fan-progress', applyScale, done);
}

function fanClosedFocus(): void {
  const state = ctx.state;
  if (navigatorVisible() && state.selectedNodeId) {
    focusRow(state.selectedNodeId);
  } else {
    document.getElementById('canvas')?.focus();
  }
}

// The style panel re-renders need handlers; editor.ts provides them.
let panelHandlersStub: import('./stylepanel.js').PanelHandlers = {
  onSetStyle: () => {}, onClearStyle: () => {}, onSetProp: () => {},
  onCreateShared: () => {}, onDetach: () => {}, onBind: () => {},
};
export function setPanelHandlers(h: import('./stylepanel.js').PanelHandlers): void { panelHandlersStub = h; }

