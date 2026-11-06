// The editor controller: wiring, keyboard scope, menus, dialogs, WebSocket.
import {
  BREAKPOINTS, BP_LABEL, BP_WIDTH, TYPE_LABEL, containerAccepts, resolveStyle, reachOfChange, joinBps,
  cascadeNotice, pipState, isTokenRef, displayValue,
  type WorkspaceDocument, type DocumentNode, type Breakpoint, type StyleProperty, type NodeType, type Page,
} from '../shared/domain.js';
import { computedDeclarations } from '../shared/style.js';
import { EditorState, nextOpId, findInTree, type Thread, type PublishStatusClient, type VersionSummaryClient, type ImageSummary } from './state.js';
import { el, renderCanvas, applyFanLayout, applySingleFrameLayout } from './canvas.js';
import { renderNavigator, toggleExpand, selectRow, focusRow, startRename, navigatorVisible } from './navigator.js';
import { renderStylePanel, isFanOpen, type PanelHandlers } from './stylepanel.js';
import { openSheet, renderEntryEditor, renderMembersList, setPanelState, versionLine, threadArticle, type PanelKind } from './panels.js';
import { announce, notices, publishStateText } from './announce.js';
import { toggleMotion, reducedMotion, timedEffect } from './motion.js';
import { renderPresence, renderCursors, renderPins, showPreviewBanner, syncUrl, applyLayoutMode, applyRoleMode } from './chrome.js';
import { setInteractContext, openAddMenu, toggleFan, openDeleteDialog, openSaveVersionDialog, openCreateSharedDialog, openPublishDialog, openRestoreDialog, openDialog, setPanelHandlers, isFanAvailable, closeDialog, closeMenu } from './interact.js';

const state = new EditorState();
let socket: WebSocket | null = null;
let openPanel: PanelKind = null;
let cursorThrottleLast = 0;
interface PendingOp {
  kind: string;
  op?: Record<string, unknown>;
  rollback: () => void;
}

const pendingOps = new Map<string, PendingOp>();

const ADD_TYPES: NodeType[] = ['section', 'stack', 'heading', 'text', 'image', 'button', 'nav', 'collection_list'];

// ---------------------------------------------------------------------------
// boot

async function boot(): Promise<void> {
  const root = document.getElementById('editor')!;
  state.workspaceId = root.dataset.workspaceId!;
  state.workspaceName = root.dataset.workspaceName!;
  state.userId = root.dataset.userId!;
  state.userName = root.dataset.userName!;
  state.role = (root.dataset.role as 'owner' | 'editor' | 'viewer') ?? 'viewer';
  state.canEdit = root.dataset.canEdit === 'true';
  state.isOwner = root.dataset.isOwner === 'true';
  state.versionId = root.dataset.version || null;
  state.readonly = state.versionId !== null;
  state.pageId = root.dataset.pageId || null;
  state.bp = ((root.dataset.bp as Breakpoint) in BP_WIDTH ? root.dataset.bp : 'desktop') as Breakpoint;
  applyRoleChrome();

  const doc = await api<WorkspaceDocument>(`/api/workspaces/${state.workspaceId}/document`);
  state.document = doc;
  state.seq = doc.seq;
  state.baseSeq = doc.seq;
  const page = state.page();
  if (page) {
    state.expanded.add(page.root.id);
    if (!state.pageId) state.pageId = page.id;
  }
  state.rovingRowId = page?.root.id ?? null;
  state.selectedNodeId = page?.root.id ?? null;

  if (state.versionId) {
    const version = await api<{ document: WorkspaceDocument } & VersionSummaryClient>(`/api/versions/${state.versionId}`);
    state.previewDocument = version.document;
    showPreviewBanner(state, version.name);
  }

  await Promise.all([
    refreshVersions(),
    refreshThreads(),
    refreshPublish(),
    refreshImages(),
    checkStorage(),
  ]);

  renderAll();
  connectSocket();
  wireTopBar();
  wireGlobalKeys();
  wirePointerEvents();
  applyLayoutMode();
  window.addEventListener('resize', () => { applyLayoutMode(); renderCanvas(state); });

  if (root.dataset.panel === 'publish') {
    openPanel = 'publish';
    openSheet('publish', state, document.getElementById('sheet')!);
    setTimeout(() => document.getElementById('publish-state')?.focus(), 0);
  }
}

function renderAll(): void {
  renderNavigator(state);
  renderCanvas(state);
  applySingleFrameLayout(document.getElementById('canvas')!);
  renderStylePanel(state, panelHandlers);
  renderPresence(state);
  renderPins(state);
  renderPageCombobox();
  syncUrl(state, openPanel);
}

/** The Page combobox in the top bar: shows pages, switches the current page. */
function renderPageCombobox(): void {
  const input = document.getElementById('page-select') as HTMLInputElement | null;
  if (!input) return;
  const doc = state.shownDocument();
  const page = state.page();
  if (!doc || !page) return;
  input.value = page.name;
  input.setAttribute('aria-expanded', 'false');
  if (input.dataset.wired === 'true') return;
  input.dataset.wired = 'true';
  input.addEventListener('focus', () => {
    const list = el('ul', { role: 'listbox', 'aria-label': 'Page', class: 'token-list page-list' });
    for (const p of doc.pages) {
      const li = el('li', { role: 'option', 'aria-selected': p.id === page.id ? 'true' : 'false' }, p.name);
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        state.pageId = p.id;
        state.selectedNodeId = p.root.id;
        state.rovingRowId = p.root.id;
        state.expanded = new Set([p.root.id]);
        list.remove();
        input.setAttribute('aria-expanded', 'false');
        void refreshPublish().then(() => renderAll());
      });
      list.appendChild(li);
    }
    const rect = input.getBoundingClientRect();
    list.style.left = `${rect.left}px`;
    list.style.top = `${rect.bottom}px`;
    document.body.appendChild(list);
    input.setAttribute('aria-expanded', 'true');
    const close = () => { list.remove(); input.setAttribute('aria-expanded', 'false'); };
    input.addEventListener('blur', close, { once: true });
    list.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); input.focus(); } });
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); (e.target as HTMLInputElement).blur(); }
    e.stopPropagation();
  });
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(body?.error?.message ?? `HTTP ${res.status}`);
    (err as Error & { code?: string; fields?: Record<string, string> }).code = body?.error?.code;
    (err as Error & { code?: string; fields?: Record<string, string> }).fields = body?.error?.fields;
    throw err;
  }
  return body as T;
}

// ---------------------------------------------------------------------------
// WebSocket

function connectSocket(): void {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${proto}//${location.host}/ws?workspace=${state.workspaceId}`);
  socket.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data as string);
    handleServerMessage(msg);
  });
  socket.addEventListener('close', () => {
    setTimeout(connectSocket, 1000);
  });
}

function send(msg: Record<string, unknown>): void {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

interface ServerMessage {
  type: string; seq?: number; opId?: string; created?: Record<string, string>;
  error?: { code: string; message: string };
  author?: { id: string; name: string };
  op?: Record<string, unknown>;
  people?: { id: string; name: string; role: string }[];
  you?: { id: string; name: string; role: string };
  userId?: string; name?: string; pageId?: string; x?: number; y?: number;
  nodeId?: string | null;
  property?: string; value?: string; winner?: { id: string; name: string };
  role?: string;
  thread?: Thread;
  by?: { id: string; name: string }; versionName?: string;
  text?: string;
}

function handleServerMessage(msg: ServerMessage): void {
  // any message we receive is answered, so the server counts our heartbeat
  if (msg.type === 'ping') send({ type: 'pong' });
  switch (msg.type) {
    case 'hello':
      state.seq = msg.seq ?? state.seq;
      if (msg.you) { state.role = msg.you.role as 'owner'; applyRoleChrome(); }
      break;
    case 'presence':
      state.people = msg.people ?? [];
      renderPresence(state);
      break;
    case 'notice':
      if (msg.text) announce(notices.joined(msg.text.replace(' joined.', '')));
      break;
    case 'ack': {
      state.seq = msg.seq ?? state.seq;
      state.baseSeq = state.seq;
      const pending = msg.opId ? pendingOps.get(msg.opId) : undefined;
      if (msg.opId) pendingOps.delete(msg.opId);
      void reloadDocument().then(() => afterAck(pending, msg.created));
      break;
    }
    case 'reject': {
      const pending = msg.opId ? pendingOps.get(msg.opId) : undefined;
      if (msg.opId) pendingOps.delete(msg.opId);
      if (pending) pending.rollback();
      const code = msg.error?.code;
      if (code === 'node_deleted') {
        const nodeName = pending?.op?.nodeId ? (state.findNode(String(pending.op.nodeId))?.name ?? 'That node') : 'That node';
        announce(notices.deletedBy('Someone', nodeName));
      } else if (code === 'forbidden_role') {
        announce(notices.roleRefused());
      } else if (code === 'undo_skipped') {
        announce(msg.error?.message ?? notices.cantUndo('someone', 'it'));
      } else if (code === 'nothing_to_undo') {
        announce(notices.nothingToUndo());
      } else if (code === 'nothing_to_redo') {
        announce(notices.nothingToRedo());
      } else if (code === 'invalid_move') {
        announce(notices.refusedMove(String(pending?.op?.name ?? state.findNode(String(pending?.op?.nodeId ?? ''))?.name ?? 'that')));
      } else if (code === 'token_in_use' || code === 'component_in_use' || code === 'field_in_use') {
        announce(msg.error?.message ?? 'Request refused.');
      }
      void reloadDocument();
      break;
    }
    case 'op': {
      // apply a remote operation: never touch focus, open panels, or selection
      state.seq = msg.seq ?? state.seq;
      if (msg.author?.id !== state.userId) applyRemoteOp(msg);
      break;
    }
    case 'conflict': {
      announce(notices.conflict(msg.winner?.name ?? 'Someone', msg.property ?? '', msg.value ?? ''));
      break;
    }
    case 'cursor': {
      if (msg.userId && msg.userId !== state.userId) {
        state.cursors.set(msg.userId, { name: msg.name ?? '', x: msg.x ?? 0, y: msg.y ?? 0 });
        renderCursors(state);
      }
      break;
    }
    case 'selection': {
      if (msg.userId && msg.userId !== state.userId) {
        state.remoteSelections.set(msg.userId, msg.nodeId ?? null);
        renderCanvas(state);
      }
      break;
    }
    case 'role': {
      const newRole = msg.role as 'owner' | 'editor' | 'viewer';
      const wasEditor = state.role !== 'viewer';
      state.role = newRole;
      state.canEdit = newRole !== 'viewer';
      applyRoleChrome();
      announce(notices.roleChanged(newRole));
      renderAll();
      void wasEditor;
      break;
    }
    case 'comment': {
      if (msg.thread) {
        const idx = state.threads.findIndex((t) => t.id === msg.thread!.id);
        if (idx >= 0) state.threads[idx] = msg.thread;
        else state.threads.push(msg.thread);
        if (openPanel === 'comments') openSheet('comments', state, document.getElementById('sheet')!);
        renderPins(state);
      }
      break;
    }
    case 'restored': {
      void reloadDocument();
      announce(notices.restored(msg.by?.name ?? 'Someone', msg.versionName ?? ''));
      break;
    }
  }
}

async function reloadDocument(): Promise<void> {
  const doc = await api<WorkspaceDocument>(`/api/workspaces/${state.workspaceId}/document`);
  state.document = doc;
  state.seq = doc.seq;
  state.baseSeq = doc.seq;
  await refreshVersions();
  renderAll();
}

/** After our own operation is accepted: notices, selection and focus. */
function afterAck(pending: PendingOp | undefined, created: Record<string, string> | undefined): void {
  if (!pending?.op) return;
  const op = pending.op;
  const kind = pending.kind;
  const page = state.page();
  const doc = state.shownDocument();
  switch (kind) {
    case 'insert_node': case 'insert_instance': {
      const nodeId = created?.nodeId;
      if (!nodeId) return;
      state.selectedNodeId = nodeId;
      state.rovingRowId = nodeId;
      const node = state.findNode(nodeId);
      if (node) {
        announce(notices.inserted(node.name));
        if (page) state.expanded.add(page.root.id);
        renderAll();
        focusMovedRow(nodeId);
      }
      break;
    }
    case 'duplicate_node': {
      const nodeId = created?.nodeId;
      if (!nodeId) return;
      state.selectedNodeId = nodeId;
      state.rovingRowId = nodeId;
      renderAll();
      focusMovedRow(nodeId);
      break;
    }
    case 'rename_node': {
      announce(notices.inserted(String(op.name)));
      break;
    }
    case 'move_node': {
      const ref = state.findNodeParent(String(op.nodeId));
      if (ref?.parent) {
        const n = ref.parent.children.findIndex((c) => c.id === op.nodeId) + 1;
        announce(notices.moved(ref.node.name, n, ref.parent.children.length, ref.parent.name));
      }
      focusMovedRow(String(op.nodeId));
      break;
    }
    case 'delete_node': break; // announced by the delete dialog flow
    case 'add_page': {
      const pageId = created?.pageId;
      if (pageId) {
        state.pageId = pageId;
        state.selectedNodeId = created?.nodeId ?? null;
        state.rovingRowId = created?.nodeId ?? null;
        renderAll();
      }
      break;
    }
    case 'set_token': {
      const token = doc?.tokens.find((t) => t.name === op.name);
      const value = token?.kind === 'size' ? `${token?.value}${token?.unit ?? 'px'}` : String(token?.value ?? '');
      const uses = countTokenUses(doc!, String(op.name));
      announce(notices.token(String(op.name), value, uses));
      break;
    }
    case 'undo': case 'redo': break; // no notice of its own
    default: break;
  }
}

/** Move focus to a row when the Navigator is visible, else the canvas. */
function focusMovedRow(nodeId: string): void {
  if (navigatorVisible()) focusRow(nodeId);
  else document.getElementById('canvas')?.focus();
}

async function applyRemoteOp(msg: ServerMessage): Promise<void> {
  // Re-apply by refetching the document, then rerender everything except focus.
  // This keeps the client simple and exact; the doc is the source of truth.
  await reloadDocument();
  const op = msg.op;
  if (op?.kind === 'set_style' || op?.kind === 'clear_style') {
    // remote changes redraw values and pips, no ripple
    renderStylePanel(state, panelHandlers);
  }
}

// ---------------------------------------------------------------------------
// operations

interface SendOpOptions {
  optimistic?: () => void;
  rollback?: () => void;
  onComplete?: (created: Record<string, string> | undefined, seq: number) => void;
}

function sendOp(op: Record<string, unknown>, opts: SendOpOptions = {}): void {
  const full = { ...op, opId: nextOpId(), baseSeq: state.baseSeq };
  pendingOps.set(full.opId, {
    kind: String(op.kind),
    op,
    rollback: opts.rollback ?? (() => {}),
  });
  opts.optimistic?.();
  send({ type: 'op', op: full });
}

function refreshAfterLocalEdit(): void {
  renderAll();
}

async function refreshVersions(): Promise<void> {
  const res = await api<{ versions: VersionSummaryClient[] }>(`/api/workspaces/${state.workspaceId}/versions`);
  state.versions = res.versions;
}

async function refreshThreads(): Promise<void> {
  const pageId = state.pageId ?? '';
  const res = await api<{ threads: Thread[] }>(`/api/workspaces/${state.workspaceId}/comments?pageId=${encodeURIComponent(pageId)}`);
  state.threads = res.threads;
  renderPins(state);
}

async function refreshPublish(): Promise<void> {
  if (!state.pageId) return;
  try {
    state.publish = await api<PublishStatusClient>(`/api/pages/${state.pageId}/publish`);
  } catch { state.publish = { state: 'not_published', publishId: null, publishedSeq: null, url: null }; }
}

async function refreshImages(): Promise<void> {
  const res = await api<{ images: ImageSummary[] }>(`/api/workspaces/${state.workspaceId}/images`);
  state.images = res.images;
}

async function checkStorage(): Promise<void> {
  try {
    const res = await api<{ status: string }>(`/api/workspaces/${state.workspaceId}/storage`);
    setStorageBanner(res.status === 'unavailable');
  } catch {
    setStorageBanner(true);
  }
}

function setStorageBanner(show: boolean): void {
  state.storageOutage = show;
  const banner = document.getElementById('storage-banner')!;
  if (show) {
    banner.textContent = notices.storageBanner();
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}

// ---------------------------------------------------------------------------
// chrome wiring


const panelHandlers: PanelHandlers = {
  onSetStyle: (nodeId, bp, property, value) => {
    const node = state.findNode(nodeId);
    if (!node) return;
    const fanOpen = isFanOpenState();
    const preStyles = JSON.parse(JSON.stringify(node.styles));
    sendOp({ kind: 'set_style', nodeId, breakpoint: bp, property, value }, {
      rollback: () => { node.styles = preStyles; renderAll(); },
    });
    node.styles[bp] = { ...(node.styles[bp] ?? {}), [property]: value };
    afterLocalStyleChange(node, bp, property, fanOpen, 'set');
    renderAll();
  },
  onClearStyle: (nodeId, bp, property) => {
    const node = state.findNode(nodeId);
    if (!node) return;
    const fanOpen = isFanOpenState();
    const preValue = node.styles[bp]?.[property];
    const tokensByName = new Map((state.shownDocument() ?? state.document!)!.tokens.map((t) => [t.name, t]));
    sendOp({ kind: 'clear_style', nodeId, breakpoint: bp, property }, {
      rollback: () => {
        if (preValue !== undefined) node.styles[bp] = { ...(node.styles[bp] ?? {}), [property]: preValue };
        renderAll();
      },
    });
    if (node.styles[bp]) delete node.styles[bp]![property];
    const resolved = resolveStyle(node.styles, bp, property);
    if (fanOpen) clearFanRipple(bp);
    announce(notices.overrideCleared(property, BP_LABEL[bp], displayValue(resolved.value, tokensByName)));
    announceSharedIfInstance(node, [notices.overrideCleared(property, BP_LABEL[bp], displayValue(resolved.value, tokensByName))]);
    renderAll();
  },
  onSetProp: (nodeId, prop, value) => {
    const node = state.findNode(nodeId);
    if (!node) return;
    const prev = node.props[prop];
    sendOp({ kind: 'set_prop', nodeId, prop, value }, {
      rollback: () => { node.props[prop] = prev; renderAll(); },
    });
    node.props[prop] = value;
    renderAll();
  },
  onCreateShared: (nodeId) => {
    const node = state.findNode(nodeId);
    if (node) openCreateSharedDialog(node);
  },
  onDetach: (nodeId) => {
    sendOp({ kind: 'detach_instance', nodeId }, { rollback: () => renderAll() });
  },
  onBind: (nodeId, prop, field) => {
    sendOp({ kind: 'bind_prop', nodeId, prop, field }, { rollback: () => renderAll() });
  },
};

setPanelHandlers(panelHandlers);

function isFanOpenState(): boolean {
  const canvas = document.getElementById('canvas');
  const fan = canvas?.getAttribute('data-fan');
  return fan === 'open' || fan === 'opening';
}

function afterLocalStyleChange(node: DocumentNode, bp: Breakpoint, property: StyleProperty, fanOpen: boolean, kind: 'set'): void {
  const tokensByName = new Map((state.shownDocument() ?? state.document!)!.tokens.map((t) => [t.name, t]));
  const reach = reachOfChange(node.styles, property, bp);
  if (fanOpen) {
    const canvas = document.getElementById('canvas')!;
    for (const target of reach.inherited) {
      const frame = canvas.querySelector<HTMLElement>(`[data-frame="${target}"]`);
      if (frame) {
        if (reducedMotion()) {
          let tag = frame.querySelector<HTMLElement>('[data-updated-tag]');
          if (!tag) {
            tag = el('span', { 'data-updated-tag': 'true' }, 'Updated');
            frame.appendChild(tag);
          }
        } else {
          timedEffect(frame, 'data-ripple', 160);
        }
      }
    }
    for (const target of reach.kept) {
      const frame = canvas.querySelector<HTMLElement>(`[data-frame="${target}"]`);
      const pip = frame?.querySelector<HTMLElement>(`[data-prop="${property}"] [data-pip="${target}"]`)
        ?? document.querySelector<HTMLElement>(`#style-panel [data-prop="${property}"] [data-pip="${target}"]`);
      if (pip) timedEffect(pip, 'data-pulse', 160);
    }
  }
  const text = cascadeNotice(property, bp, node.styles);
  const insideInstance = findInstanceRootLocal(node);
  if (insideInstance) {
    announce(text);
    announceSharedEdit(insideInstance);
  } else {
    announce(text);
  }
}

function clearFanRipple(bp: Breakpoint): void {
  const canvas = document.getElementById('canvas')!;
  const frame = canvas.querySelector<HTMLElement>(`[data-frame="${bp}"]`);
  if (frame) {
    if (reducedMotion()) {
      const tag = el('span', { 'data-updated-tag': 'true' }, 'Updated');
      frame.appendChild(tag);
    } else {
      timedEffect(frame, 'data-ripple', 160);
    }
  }
}

function findInstanceRootLocal(node: DocumentNode): DocumentNode | null {
  let cur: DocumentNode | null = node;
  let guard = 0;
  while (cur && !cur.shared && guard++ < 500) {
    const ref = state.findNodeParent(cur.id);
    cur = ref?.parent ?? null;
  }
  return cur && cur.shared ? cur : null;
}

function announceSharedIfInstance(node: DocumentNode, _preceding: string[]): void {
  const instanceRoot = findInstanceRootLocal(node);
  if (instanceRoot) announceSharedEdit(instanceRoot);
}

function announceSharedEdit(instanceRoot: DocumentNode): void {
  const doc = state.shownDocument() ?? state.document!;
  const comp = doc.components.find((c) => c.id === instanceRoot.shared!.componentId);
  const n = countInstancesOf(doc, comp?.id ?? '');
  announce(notices.sharedEdit(n, comp?.name ?? ''));
}

function countInstancesOf(doc: WorkspaceDocument, componentId: string): number {
  let n = 0;
  for (const page of doc.pages) {
    const visit = (node: DocumentNode) => {
      if (node.shared?.componentId === componentId) n++;
      node.children.forEach(visit);
    };
    visit(page.root);
  }
  return n;
}

function applyRoleChrome(): void {
  applyRoleMode(state);
}

// ---------------------------------------------------------------------------
// top bar

function wireTopBar(): void {
  const on = (id: string, fn: () => void) => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', fn);
  };
  on('btn-add', () => { if (state.canEdit) openAddMenu(); });
  on('btn-tokens', () => togglePanel('tokens'));
  on('btn-collection', () => togglePanel('collection'));
  on('btn-images', () => togglePanel('images'));
  on('btn-history', () => togglePanel('history'));
  on('btn-comments', () => openCommentsSheet());
  on('btn-publish', () => {
    if (!state.canEdit) return;
    const page = state.page();
    if (!page) return;
    openPublishDialog(page.name, () => doPublish());
  });
  on('btn-save-version', () => {
    if (state.canEdit) openSaveVersionDialog();
  });
  on('btn-share', () => openShareDialog());
  on('btn-fan', () => toggleFan());
  on('btn-navigator', () => {
    const nav = document.getElementById('navigator')!;
    const open = nav.getAttribute('data-open') === 'true';
    if (open) {
      nav.setAttribute('data-open', 'false');
      nav.hidden = true;
      nav.setAttribute('inert', '');
      document.getElementById('btn-navigator')!.setAttribute('aria-expanded', 'false');
    } else {
      nav.setAttribute('data-open', 'true');
      nav.hidden = false;
      nav.removeAttribute('inert');
      document.getElementById('btn-navigator')!.setAttribute('aria-expanded', 'true');
      const row = document.querySelector<HTMLElement>('#navigator [tabindex="0"]');
      row?.focus();
    }
  });
  on('btn-style-panel', () => {
    const panel = document.getElementById('style-panel')!;
    const current = panel.getAttribute('data-motion') ?? 'open';
    const opening = current === 'closed' || current === 'closing';
    const btn = document.getElementById('btn-style-panel')!;
    btn.setAttribute('aria-expanded', opening ? 'true' : 'false');
    const apply = (progress: number) => {
      panel.style.width = `${304 * progress}px`;
      panel.style.opacity = String(progress);
    };
    toggleMotion(panel, opening, 200, 'data-motion', 'data-progress', apply, (s) => {
      if (s === 'closed') { panel.setAttribute('inert', ''); panel.style.visibility = 'hidden'; }
      else { panel.removeAttribute('inert'); panel.style.visibility = 'visible'; }
    });
    if (reducedMotion()) {
      if (opening) { panel.removeAttribute('inert'); panel.style.visibility = 'visible'; }
      else { panel.setAttribute('inert', ''); panel.style.visibility = 'hidden'; }
    }
  });

  // breakpoint radios
  for (const radio of [...document.querySelectorAll<HTMLInputElement>('input[name="bp"]')]) {
    radio.addEventListener('change', () => {
      state.bp = radio.value as Breakpoint;
      renderAll();
    });
  }

  // custom events from panels
  const listen = (name: string, fn: (detail: Record<string, unknown>) => void) => {
    document.addEventListener(name, (e) => fn((e as CustomEvent).detail ?? {}));
  };
  listen('plinth:set-token', (d) => {
    const token = state.document!.tokens.find((t) => t.name === d.name);
    const kind = token?.kind === 'size' ? 'size' : 'color';
    const value = kind === 'size' ? Number(d.value) : String(d.value);
    sendOp({ kind: 'set_token', name: d.name, tokenKind: kind, value, ...(kind === 'size' ? { unit: token?.unit ?? 'px' } : {}) },
      { rollback: () => renderAll() });
    const uses = countTokenUses(state.document!, String(d.name));
    announce(notices.token(String(d.name), String(d.value), uses));
  });
  listen('plinth:rename-token', (d) => {
    sendOp({ kind: 'rename_token', name: d.name, newName: d.newName }, { rollback: () => renderAll() });
  });
  listen('plinth:set-token-unit', (d) => {
    const token = state.document!.tokens.find((t) => t.name === d.name);
    if (!token || token.kind !== 'size') return;
    let value = Number(token.value);
    if (d.unit === 'rem' && token.unit === 'px') value = Math.round((value / 16) * 10000) / 10000;
    if (d.unit === 'px' && token.unit === 'rem') value = Math.round(value * 16 * 10000) / 10000;
    sendOp({ kind: 'set_token', name: d.name, tokenKind: 'size', value, unit: d.unit }, { rollback: () => renderAll() });
  });
  listen('plinth:add-token', (d) => {
    const kind = d.kind === 'color' ? 'color' : 'size';
    const value = kind === 'color' ? 'black' : 16;
    sendOp({ kind: 'set_token', name: d.name, tokenKind: kind, value, ...(kind === 'size' ? { unit: 'px' } : {}) },
      { rollback: () => renderAll() });
  });
  listen('plinth:delete-token', (d) => {
    const uses = countTokenUses(state.document!, String(d.name));
    if (uses > 0) { announce(notices.tokenInUse(String(d.name), uses)); return; }
    sendOp({ kind: 'delete_token', name: d.name }, { rollback: () => renderAll() });
  });
  listen('plinth:add-field', (d) => {
    const fields = state.document!.collection.fields.map((f) => ({ ...f }));
    fields.push({ name: String(d.name), kind: d.kind as 'text' });
    sendOp({ kind: 'set_fields', fields }, { rollback: () => renderAll() });
  });
  listen('plinth:save-entry', (d) => {
    sendOp({ kind: 'put_entry', ...(d.entryId ? { entryId: d.entryId } : {}), values: d.values }, { rollback: () => renderAll() });
  });
  listen('plinth:move-entry', (d) => {
    sendOp({ kind: 'move_entry', entryId: d.entryId, index: d.index }, { rollback: () => renderAll() });
  });
  listen('plinth:delete-entry', (d) => {
    sendOp({ kind: 'delete_entry', entryId: d.entryId }, { rollback: () => renderAll() });
  });
  listen('plinth:publish', () => doPublish());
  listen('plinth:unpublish', () => doUnpublish());
  listen('plinth:post-comment', (d) => doComment(String(d.body)));
  listen('plinth:reply-comment', async (d) => {
    try {
      await api(`/api/comments/${d.commentId}/replies`, { method: 'POST', body: JSON.stringify({ body: String(d.body) }) });
      await refreshThreads();
      if (openPanel === 'comments') openSheet('comments', state, document.getElementById('sheet')!);
    } catch (err) { void err; }
  });
  listen('plinth:resolve-comment', async (d) => {
    try {
      await api(`/api/comments/${d.commentId}/${d.resolve ? 'resolve' : 'reopen'}`, { method: 'POST' });
      await refreshThreads();
      if (openPanel === 'comments') openSheet('comments', state, document.getElementById('sheet')!);
    } catch (err) { void err; }
  });
  listen('plinth:upload-image', (d) => doUpload(d.file as File));
  listen('plinth:edit-entry', (d) => {
    openPanel = 'collection';
    openSheet('collection', state, document.getElementById('sheet')!);
    const region = document.getElementById('panel-collection');
    if (region) renderEntryEditor(region, state, (d.entryId as string) ?? null);
  });
  listen('plinth:preview-version', async (d) => {
    location.href = `${location.pathname}?version=${d.versionId}&page=${state.pageId ?? ''}`;
  });
  listen('plinth:restore-version', async () => {
    if (!state.versionId) return;
    await doRestore(state.versionId);
  });
  listen('plinth:rename', (d) => {
    sendOp({ kind: 'rename_node', nodeId: d.nodeId, name: d.name }, { rollback: () => renderAll() });
  });
  listen('plinth:add-page', () => {
    const name = `Page ${state.document!.pages.length + 1}`;
    sendOp({ kind: 'add_page', name }, { rollback: () => renderAll() });
  });
  listen('plinth:select', (d) => {
    send({ type: 'select', nodeId: d.nodeId ?? null });
  });
  // Share dialog events
  listen('plinth:send-invite', async (d) => {
    try {
      await api(`/api/workspaces/${state.workspaceId}/invites`, {
        method: 'POST', body: JSON.stringify({ email: d.email, role: d.role }),
      });
      announce(notices.inviteSent(String(d.email)));
      refreshShareMembers();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'already_member') announce(`${d.email} is already a member.`);
      else if (code === 'already_invited') announce(`${d.email} already has an invitation.`);
      else if (code === 'mail_unavailable') announce(notices.inviteFailed());
      else announce(notices.inviteFailed());
    }
  });
  listen('plinth:change-role', async (d) => {
    try {
      await api(`/api/workspaces/${state.workspaceId}/members/${d.userId}`, {
        method: 'PATCH', body: JSON.stringify({ role: d.role }),
      });
      refreshShareMembers();
    } catch (err) { void err; }
  });
  listen('plinth:revoke-invite', async (d) => {
    try {
      await api(`/api/invites/${d.inviteId}`, { method: 'DELETE' });
      refreshShareMembers();
    } catch (err) { void err; }
  });
  listen('plinth:remove-member', async (d) => {
    try {
      await api(`/api/workspaces/${state.workspaceId}/members/${d.userId}`, { method: 'DELETE' });
      refreshShareMembers();
    } catch (err) { void err; }
  });
  // Pins open the thread
  listen('plinth:open-thread', (d) => {
    if (window.innerWidth < 768) {
      openCommentsSheet();
    } else {
      openPanel = 'comments';
      openSheet('comments', state, document.getElementById('sheet')!);
    }
    const article = document.querySelector<HTMLElement>(`[data-thread-id="${d.threadId}"]`);
    article?.scrollIntoView({ block: 'center' });
  });
  // phone toolbar
  on('pt-comments', () => openCommentsSheet());
  on('pt-pages', () => openPagesSheet());
  on('pt-publish', () => openPublishStatusSheet());
}

function refreshShareMembers(): void {
  const list = document.querySelector<HTMLElement>('[aria-label="Members"]');
  if (list) renderMembersList(list);
}

function openShareDialog(): void {
  openDialog(`Share ${state.workspaceName}`, (dialog) => {
    dialog.setAttribute('data-dialog-kind', 'share');
    const email = el('input', { type: 'text', 'aria-label': 'Email' }) as HTMLInputElement;
    const role = el('select', { 'aria-label': 'Role' }) as HTMLSelectElement;
    for (const rl of ['Editor', 'Viewer']) {
      const o = el('option', { value: rl.toLowerCase() }, rl) as HTMLOptionElement;
      role.appendChild(o);
    }
    const send = el('button', { class: 'primary' }, 'Send invite');
    send.addEventListener('click', () => {
      const ev = new CustomEvent('plinth:send-invite', { detail: { email: email.value, role: role.value } });
      document.dispatchEvent(ev);
      email.value = '';
    });
    const list = el('ul', { role: 'list', 'aria-label': 'Members', class: 'member-list' });
    setPanelState(state);
    renderMembersList(list);
    const row = el('div', { class: 'new-row' });
    row.append(email, role, send);
    dialog.append(row, list);
  }, document.activeElement as HTMLElement);
}

function openCommentsSheet(): void {
  const isPhone = window.innerWidth < 768;
  const sheet = document.getElementById('sheet')!;
  if (isPhone) {
    // phone: bottom-sheet dialog
    sheet.innerHTML = '';
    sheet.hidden = false;
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'Comments');
    sheet.classList.add('bottom-sheet');
    const region = el('div', { role: 'region', 'aria-label': 'Comments' });
    const composer = el('div', { class: 'composer' });
    const input = el('textarea', { 'aria-label': 'Comment', rows: '2' }) as HTMLTextAreaElement;
    const post = el('button', { class: 'primary' }, 'Post comment');
    composer.append(input, post);
    post.addEventListener('click', () => {
      const ev = new CustomEvent('plinth:post-comment', { detail: { body: input.value } });
      document.dispatchEvent(ev);
      input.value = '';
    });
    region.appendChild(composer);
    const threads = state.threads.filter((t) => t.status === 'open' && t.pageId === state.pageId);
    for (const thread of threads) region.appendChild(threadArticle(thread, state));
    sheet.appendChild(region);
    input.focus();
  } else {
    sheet.removeAttribute('role');
    sheet.classList.remove('bottom-sheet');
    openPanel = 'comments';
    openSheet('comments', state, sheet);
    const input = document.querySelector<HTMLElement>('#sheet textarea');
    input?.focus();
  }
  syncUrl(state, 'comments');
}

function openPagesSheet(): void {
  const sheet = document.getElementById('sheet')!;
  sheet.innerHTML = '';
  sheet.hidden = false;
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Pages');
  const list = el('ul', { role: 'list', 'aria-label': 'Pages' });
  for (const page of state.document!.pages) {
    const li = el('li');
    const a = el('a', { href: `#` }, page.name);
    a.addEventListener('click', (e) => {
      e.preventDefault();
      state.pageId = page.id;
      state.selectedNodeId = page.root.id;
      state.rovingRowId = page.root.id;
      state.expanded = new Set([page.root.id]);
      sheet.hidden = true;
      renderAll();
    });
    li.appendChild(a);
    list.appendChild(li);
  }
  sheet.appendChild(list);
  (list.querySelector<HTMLElement>('a'))?.focus();
}

function openPublishStatusSheet(): void {
  const sheet = document.getElementById('sheet')!;
  sheet.innerHTML = '';
  sheet.hidden = false;
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Publish status');
  const p = el('p', { id: 'publish-state', tabindex: '-1' }, publishStateText[state.publish.state] ?? state.publish.state);
  sheet.appendChild(p);
  if (state.publish.url) {
    const a = el('a', { href: state.publish.url.replace(/^https?:\/\/[^/]+/, '') }, state.publish.url);
    sheet.appendChild(a);
  }
  p.focus();
}

function countTokenUses(doc: WorkspaceDocument, name: string): number {
  let n = 0;
  const visit = (node: DocumentNode) => {
    for (const bp of BREAKPOINTS) {
      const styles = node.styles[bp];
      if (!styles) continue;
      for (const v of Object.values(styles)) {
        if (typeof v === 'object' && v !== null && (v as { token: string }).token === name) { n++; break; }
      }
    }
    for (const c of node.children) visit(c);
  };
  for (const page of doc.pages) visit(page.root);
  for (const comp of doc.components) visit(comp.root);
  return n;
}

function togglePanel(kind: PanelKind): void {
  if (openPanel === kind) {
    document.getElementById('sheet')!.hidden = true;
    openPanel = null;
  } else {
    openPanel = kind;
    openSheet(kind, state, document.getElementById('sheet')!);
  }
  syncUrl(state, openPanel);
}

// ---------------------------------------------------------------------------
// publishing, comments, versions, uploads

async function doPublish(): Promise<void> {
  const page = state.page();
  if (!page) return;
  const publishBtn = document.getElementById('btn-publish-now') as HTMLButtonElement | null;
  if (publishBtn) { publishBtn.setAttribute('aria-busy', 'true'); publishBtn.disabled = true; }
  announce(notifiesProgress(page.name));
  try {
    const result = await api<PublishStatusClient>(`/api/pages/${page.id}/publish`, { method: 'POST' });
    state.publish = result;
    state.publishFailed = false;
    setStorageBanner(false);
    announce(notices.publishSuccess(page.name, result.url ?? ''));
    openPanel = 'publish';
    openSheet('publish', state, document.getElementById('sheet')!);
    history.replaceState(null, '', `${location.pathname}?page=${page.id}&panel=publish`);
    await refreshPublish();
    openSheet('publish', state, document.getElementById('sheet')!);
    document.getElementById('publish-state')?.focus();
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'storage_unavailable') {
      setStorageBanner(true);
      state.publishFailed = true;
      announce(notices.publishFailed(page.name));
    } else if (code === 'publish_in_progress') {
      // a second press while running does nothing
    } else {
      announce(notices.publishFailed(page.name));
    }
  } finally {
    if (publishBtn) { publishBtn.removeAttribute('aria-busy'); publishBtn.disabled = false; }
  }
}

function notifiesProgress(pageName: string): string {
  return notices.publishProgress(pageName);
}

async function doUnpublish(): Promise<void> {
  const page = state.page();
  if (!page) return;
  try {
    await api(`/api/pages/${page.id}/unpublish`, { method: 'POST' });
    state.publish = { state: 'unpublished', publishId: null, publishedSeq: null, url: null };
    announce(notices.unpublished(page.name));
    if (openPanel === 'publish') openSheet('publish', state, document.getElementById('sheet')!);
  } catch (err) { void err; }
}

async function doComment(body: string): Promise<void> {
  if (!state.selectedNodeId || body.trim().length === 0) return;
  const node = state.findNode(state.selectedNodeId);
  const nodeName = node?.name ?? '';
  try {
    await api(`/api/workspaces/${state.workspaceId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ pageId: state.pageId, nodeId: state.selectedNodeId, body }),
    });
    await refreshThreads();
    if (openPanel === 'comments') openSheet('comments', state, document.getElementById('sheet')!);
    announce(notices.commentPosted(nodeName));
  } catch (err) { void err; }
}

async function doUpload(file: File): Promise<void> {
  announce(notices.uploadProgress(file.name));
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`/api/workspaces/${state.workspaceId}/images`, { method: 'POST', body: form });
  if (res.status === 201) {
    announce(notices.uploadSuccess(file.name));
    await refreshImages();
    if (openPanel === 'images') openSheet('images', state, document.getElementById('sheet')!);
  } else if (res.status === 413) {
    announce(notices.tooBig());
  } else if (res.status === 415) {
    announce(notices.wrongType());
  } else if (res.status === 503) {
    setStorageBanner(true);
    announce(notices.uploadOutage(file.name));
  }
}

async function doRestore(versionId: string): Promise<void> {
  const version = state.versions.find((v) => v.id === versionId);
  const name = version?.name ?? 'the version';
  announce(notices.restoreProgress(name));
  try {
    await api(`/api/versions/${versionId}/restore`, { method: 'POST' });
    await reloadDocument();
    location.href = `${location.pathname}?page=${state.pageId ?? ''}`;
  } catch (err) { void err; }
}

// ---------------------------------------------------------------------------
// keyboard scope

function wireGlobalKeys(): void {
  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    // text fields keep their typing behaviour; Escape does what the field defines

    if (e.key === 'Escape') {
      handledEscape(e, target);
      return;
    }
    const inField = target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
    if (inField) return;

    const loc = focusLocation(target);
    if (loc === 'dialog' || loc === 'menu') return;

    if (e.key === 'a' || e.key === 'A') {
      if (loc === 'row' || loc === 'canvas' || loc === 'controls') {
        if (!state.canEdit) return;
        e.preventDefault();
        openAddMenu();
      }
      return;
    }
    if (e.key === 'f' || e.key === 'F') {
      if (loc === 'row' || loc === 'canvas' || loc === 'controls') {
        if (!isFanAvailable()) return;
        e.preventDefault();
        toggleFan();
      }
      return;
    }
    if (e.key === 'm' || e.key === 'M') {
      if (loc === 'row' || loc === 'canvas' || loc === 'controls') {
        e.preventDefault();
        openPanel = 'comments';
        openSheet('comments', state, document.getElementById('sheet')!);
        const input = document.querySelector<HTMLElement>('#sheet textarea');
        input?.focus();
        syncUrl(state, openPanel);
      }
      return;
    }
    if (e.ctrlKey && e.altKey && (e.key === 'h' || e.key === 'H')) {
      e.preventDefault();
      togglePanel('history');
      return;
    }
    if (e.ctrlKey && e.altKey && (e.key === 'p' || e.key === 'P')) {
      e.preventDefault();
      openPanel = 'publish';
      openSheet('publish', state, document.getElementById('sheet')!);
      document.getElementById('publish-state')?.focus();
      syncUrl(state, openPanel);
      return;
    }
    if (e.ctrlKey && e.altKey && (e.key === 'k' || e.key === 'K')) {
      if (loc === 'row' || loc === 'canvas' || loc === 'controls') {
        if (!state.canEdit) return;
        const node = selectedNode();
        if (node && node.type !== 'page') {
          e.preventDefault();
          openCreateSharedDialog(node);
        }
      }
      return;
    }
    if (e.altKey && (e.key === '1' || e.key === '2' || e.key === '3')) {
      if (loc === 'row' || loc === 'canvas' || loc === 'controls') {
        e.preventDefault();
        const bp = (['desktop', 'tablet', 'phone'] as const)[Number(e.key) - 1];
        state.bp = bp;
        const radio = document.querySelector<HTMLInputElement>(`input[name="bp"][value="${bp}"]`);
        if (radio) radio.checked = true;
        // while the Fan is open, Alt+N also moves focus to that frame
        if (isFanOpenState()) {
          const frame = document.querySelector<HTMLElement>(`#canvas [data-frame="${bp}"]`);
          frame?.focus();
        }
        renderAll();
      }
      return;
    }
    if (e.ctrlKey && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
      if (loc === 'row' || loc === 'canvas' || loc === 'controls') {
        e.preventDefault();
        sendOp({ kind: 'undo' }, { rollback: () => renderAll() });
      }
      return;
    }
    if (e.ctrlKey && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      if (loc === 'row' || loc === 'canvas' || loc === 'controls') {
        e.preventDefault();
        sendOp({ kind: 'redo' }, { rollback: () => renderAll() });
      }
      return;
    }
    if (e.ctrlKey && (e.key === 'd' || e.key === 'D')) {
      if (loc === 'row' || loc === 'canvas') {
        const node = selectedNode();
        const page = state.page();
        if (node && page && node.id !== page.root.id) {
          e.preventDefault();
          sendOp({ kind: 'duplicate_node', nodeId: node.id }, {
            rollback: () => renderAll(),
          });
        }
      }
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (loc === 'row' || loc === 'canvas') {
        const node = selectedNode();
        const page = state.page();
        if (node && page && node.id !== page.root.id && state.canEdit) {
          e.preventDefault();
          openDeleteDialog(node);
        }
      }
      return;
    }
    // row navigation
    if (loc === 'row') {
      rowKeys(e);
      return;
    }
    if (loc === 'canvas') {
      canvasKeys(e);
    }
  });
}

function handledEscape(e: KeyboardEvent, target: HTMLElement | null): void {
  if (activeDialogOpen()) {
    e.preventDefault();
    closeDialog();
    return;
  }
  if (activeMenuOpen()) {
    e.preventDefault();
    closeMenu();
    return;
  }
  // close an open sheet, else the Fan
  const sheet = document.getElementById('sheet')!;
  if (!sheet.hidden) {
    e.preventDefault();
    sheet.hidden = true;
    openPanel = null;
    syncUrl(state, null);
    return;
  }
  if (isFanOpenState()) {
    e.preventDefault();
    toggleFan();
  }
}

function activeDialogOpen(): boolean {
  return document.querySelector('[role="dialog"]') !== null;
}
function activeMenuOpen(): boolean {
  return document.querySelector('[role="menu"]') !== null;
}

function focusLocation(target: HTMLElement | null): 'row' | 'canvas' | 'controls' | 'dialog' | 'menu' | 'field' | null {
  if (!target) return null;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return 'field';
  if (target.closest('[role="dialog"]')) return 'dialog';
  if (target.closest('[role="menu"]')) return 'menu';
  if (target.closest('#navigator') && target.getAttribute('role') === 'treeitem') return 'row';
  if (target.closest('#canvas')) return 'canvas';
  if (target.closest('#top-bar') || target.closest('#style-panel') || target.closest('#sheet') || target.closest('[role="toolbar"]') || target.closest('#presence') || target.closest('#preview-banner')) return 'controls';
  return null;
}

function selectedNode(): DocumentNode | null {
  const id = state.selectedNodeId;
  return id ? state.findNode(id) : null;
}

function rowKeys(e: KeyboardEvent): void {
  const rows = state.visibleRows();
  const focused = document.activeElement as HTMLElement | null;
  const focusedId = focused?.getAttribute('data-node-id') ?? state.rovingRowId;
  const idx = rows.findIndex((r) => r.node.id === focusedId);
  const row = idx >= 0 ? rows[idx] : null;
  if (!row) return;
  const node = row.node;
  const setRoving = (id: string) => {
    state.rovingRowId = id;
    renderNavigator(state);
    const elRow = document.querySelector<HTMLElement>(`#navigator [data-node-id="${id}"]`);
    elRow?.focus();
  };
  switch (e.key) {
    case 'ArrowDown': {
      e.preventDefault();
      const next = rows[idx + 1];
      if (next) setRoving(next.node.id);
      else announce(notices.refusedMove(node.name));
      break;
    }
    case 'ArrowUp': {
      e.preventDefault();
      const prev = rows[idx - 1];
      if (prev) setRoving(prev.node.id);
      else announce(notices.refusedMove(node.name));
      break;
    }
    case 'ArrowRight': {
      e.preventDefault();
      if (node.children.length > 0 && !state.expanded.has(node.id)) {
        state.expanded.add(node.id);
        renderNavigator(state);
        document.querySelector<HTMLElement>(`#navigator [data-node-id="${node.id}"]`)?.focus();
      } else if (node.children.length > 0) {
        const child = rows[idx + 1];
        if (child && child.level > row.level) setRoving(child.node.id);
      }
      break;
    }
    case 'ArrowLeft': {
      e.preventDefault();
      if (node.children.length > 0 && state.expanded.has(node.id)) {
        state.expanded.delete(node.id);
        renderNavigator(state);
        document.querySelector<HTMLElement>(`#navigator [data-node-id="${node.id}"]`)?.focus();
      } else {
        const parent = state.findNodeParent(node.id)?.parent;
        if (parent) setRoving(parent.id);
      }
      break;
    }
    case 'Home': e.preventDefault(); if (rows[0]) setRoving(rows[0].node.id); break;
    case 'End': e.preventDefault(); if (rows[rows.length - 1]) setRoving(rows[rows.length - 1].node.id); break;
    case 'Enter': case ' ': {
      e.preventDefault();
      state.selectedNodeId = node.id;
      send({ type: 'select', nodeId: node.id });
      renderAll();
      const canvasNode = document.querySelector<HTMLElement>(`#canvas [data-node-id="${node.id}"]`);
      canvasNode?.scrollIntoView({ block: 'nearest' });
      break;
    }
    case 'F2': {
      e.preventDefault();
      startRename(state, node.id);
      break;
    }
    default:
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        altArrowMove(node, e.key);
      }
      break;
  }
}

function altArrowMove(node: DocumentNode, key: string): void {
  const ref = state.findNodeParent(node.id);
  if (!ref || !ref.parent) {
    announce(notices.refusedMove(node.name));
    return;
  }
  const parent = ref.parent;
  const idx = parent.children.findIndex((c) => c.id === node.id);
  const page = state.page()!;
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    const delta = key === 'ArrowUp' ? -1 : 1;
    const target = idx + delta;
    if (target < 0 || target >= parent.children.length) {
      announce(notices.refusedMove(node.name));
      return;
    }
    sendOp({ kind: 'move_node', nodeId: node.id, parentId: parent.id, index: target }, { rollback: () => renderAll() });
    announce(notices.moved(node.name, target + 1, parent.children.length, parent.name));
    renderAll();
    focusRow(node.id);
    return;
  }
  if (key === 'ArrowRight') {
    // indent: become the last child of the previous sibling
    if (idx === 0) { announce(notices.refusedMove(node.name)); return; }
    const sibling = parent.children[idx - 1];
    if (!containerAccepts(sibling.type, node.type)) { announce(notices.refusedMove(node.name)); return; }
    sendOp({ kind: 'move_node', nodeId: node.id, parentId: sibling.id, index: sibling.children.length }, { rollback: () => renderAll() });
    state.expanded.add(sibling.id);
    announce(notices.moved(node.name, sibling.children.length, sibling.children.length, sibling.name));
    renderAll();
    focusRow(node.id);
    return;
  }
  if (key === 'ArrowLeft') {
    // outdent: become the next sibling after the parent
    if (parent.id === page.root.id) { announce(notices.refusedMove(node.name)); return; }
    const grandRef = state.findNodeParent(parent.id);
    if (!grandRef?.parent) { announce(notices.refusedMove(node.name)); return; }
    const grand = grandRef.parent;
    const parentIdx = grand.children.findIndex((c) => c.id === parent.id);
    if (!containerAccepts(grand.type, node.type)) { announce(notices.refusedMove(node.name)); return; }
    sendOp({ kind: 'move_node', nodeId: node.id, parentId: grand.id, index: parentIdx + 1 }, { rollback: () => renderAll() });
    announce(notices.moved(node.name, parentIdx + 2, grand.children.length + 1, grand.name));
    renderAll();
    focusRow(node.id);
  }
}

function canvasKeys(e: KeyboardEvent): void {
  const nodes = state.visibleRows().map((r) => r.node);
  const selIdx = nodes.findIndex((n) => n.id === state.selectedNodeId);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const next = e.key === 'ArrowDown' ? nodes[selIdx + 1] : nodes[selIdx - 1];
    if (next) {
      state.selectedNodeId = next.id;
      state.rovingRowId = next.id;
      send({ type: 'select', nodeId: next.id });
      renderAll();
    }
    return;
  }
  if (e.key === 'Delete') {
    const node = selectedNode();
    const page = state.page();
    if (node && page && node.id !== page.root.id && state.canEdit) {
      e.preventDefault();
      openDeleteDialog(node);
    }
  }
}

// ---------------------------------------------------------------------------
// pointer events

function wirePointerEvents(): void {
  const canvas = document.getElementById('canvas')!;
  canvas.addEventListener('pointerdown', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-node-id]');
    if (target) {
      const nodeId = target.getAttribute('data-node-id')!;
      state.selectedNodeId = nodeId;
      state.rovingRowId = nodeId;
      send({ type: 'select', nodeId });
      renderNavigator(state);
      renderCanvas(state);
      renderStylePanel(state, panelHandlers);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const now = performance.now();
    if (now - cursorThrottleLast < 50) return;
    cursorThrottleLast = now;
    const rect = canvas.getBoundingClientRect();
    send({ type: 'cursor', pageId: state.pageId, x: e.clientX - rect.left, y: e.clientY - rect.top });
  });
}

setInteractContext({
  state,
  sendOp,
  api,
  renderAll,
  refreshThreads,
  refreshPublish,
  refreshImages,
  refreshVersions,
  reloadDocument,
  openPanelRef: { get current() { return openPanel; }, set current(v: string | null) { openPanel = v as PanelKind; } } as { current: string | null },
  setStorageBanner,
});


void boot();


