import { notices } from '../../shared/notices.js';
import type { Breakpoint, PlinthDocument, Role } from '../../shared/types.js';
import { BREAKPOINTS, FRAME_WIDTH, breakpointLabel } from '../../shared/types.js';
import { button, el, icon, patchChildren, setAttr, setText } from '../dom.js';
import { api } from '../net.js';
import { selectNode } from './actions.js';
import { openAddMenu } from './addmenu.js';
import { canvasElement, frameElement, renderCanvas } from './canvas.js';
import { loadThreads, mergeThread } from './comments.js';
import { openRestoreDialog, openSaveVersionDialog, openShareDialog } from './dialogs.js';
import { dragEnd, dragMove, dragStart, dragging } from './drag.js';
import { fanAvailable, toggleFan } from './fan.js';
import { installKeys } from './keys.js';
import { navigatorElement, navigatorVisible, renderNavigator } from './navigator.js';
import { loadImages, openPanel, renderSheet, sheetElement } from './panels.js';
import { checkStorage, loadPublish } from './publishing.js';
import {
  renderStylePanel,
  stylePanelElement,
  toggleStylePanel,
} from './stylepanel.js';
import {
  activeDoc,
  canEdit,
  connectLive,
  currentPage,
  nodeById,
  onAccepted,
  onLive,
  reloadDocument,
  render,
  sayWithToast,
  sendLive,
  setRenderHook,
  state,
  syncUrl,
  type Member,
  type Person,
  type PanelName,
} from './store.js';
import { applyUrlVersion, backToLatest, loadVersions, openPreview } from './versions.js';

interface Boot {
  workspaceId: string;
  workspaceName: string;
  user: { id: string; name: string };
  role: Role;
}

let pageSelect: HTMLSelectElement;
let breakpointRadios: Map<Breakpoint, HTMLInputElement>;
let presenceBar: HTMLElement;
let storageBanner: HTMLElement;
let modeBanner: HTMLElement;
let previewBanner: HTMLElement;
let phoneToolbar: HTMLElement;
const topButtons = new Map<string, HTMLButtonElement>();

function panelButton(label: string, panel: PanelName, iconName: string): HTMLButtonElement {
  const control = button(label, { id: `${panel}-button`, class: 'ghost' });
  control.prepend(icon(iconName));
  control.addEventListener('click', () => openPanel(panel));
  topButtons.set(label, control);
  return control;
}

function buildTopbar(): HTMLElement {
  pageSelect = el('select', { 'aria-label': 'Page', id: 'page-select' });
  pageSelect.addEventListener('change', () => {
    state.pageId = pageSelect.value;
    state.selectedId = null;
    syncUrl();
    render();
    void Promise.all([loadPublish(), loadThreads()]);
  });
  breakpointRadios = new Map();
  const group = el('div', { role: 'radiogroup', 'aria-label': 'Breakpoint', id: 'breakpoints' });
  for (const bp of BREAKPOINTS) {
    const radio = el('input', {
      type: 'radio',
      name: 'breakpoint',
      'aria-label': `${breakpointLabel(bp)} ${FRAME_WIDTH[bp]}`,
      id: `bp-${bp}`,
    });
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      state.bp = bp;
      syncUrl();
      render();
    });
    breakpointRadios.set(bp, radio);
    group.append(
      el('label', { class: 'bp-label', for: `bp-${bp}` }, [
        radio,
        el('span', { class: 'mono' }, [`${breakpointLabel(bp)} ${FRAME_WIDTH[bp]}`]),
      ]),
    );
  }

  const add = button('Add', { id: 'add-button', class: 'primary' });
  add.prepend(icon('plus'));
  add.addEventListener('click', () => openAddMenu());
  topButtons.set('Add', add);

  const saveVersion = button('Save version', { id: 'save-version-button', class: 'ghost' });
  saveVersion.prepend(icon('save'));
  saveVersion.addEventListener('click', () => openSaveVersionDialog());
  topButtons.set('Save version', saveVersion);

  const share = button('Share', { id: 'share-button', class: 'ghost' });
  share.prepend(icon('share'));
  share.addEventListener('click', () => openShareDialog());
  topButtons.set('Share', share);

  const fan = button('Fan', { id: 'fan-button', class: 'ghost' });
  fan.prepend(icon('fan'));
  fan.addEventListener('click', () => toggleFan());
  topButtons.set('Fan', fan);

  const stylePanelToggle = button('Style panel', {
    id: 'style-panel-button',
    class: 'ghost',
    'aria-expanded': 'true',
    'aria-controls': 'style-panel',
  });
  stylePanelToggle.prepend(icon('panel'));
  stylePanelToggle.addEventListener('click', () => toggleStylePanel());
  topButtons.set('Style panel', stylePanelToggle);

  const navigatorToggle = button('Navigator', {
    id: 'navigator-button',
    class: 'ghost',
    'aria-expanded': 'false',
    'aria-controls': 'navigator',
  });
  navigatorToggle.prepend(icon('layers'));
  navigatorToggle.addEventListener('click', () => {
    state.navigatorOpen = !state.navigatorOpen;
    render();
    if (state.navigatorOpen) {
      const page = currentPage();
      const id = state.selectedId ?? page?.root.id;
      if (id !== undefined) {
        document.querySelector<HTMLElement>(`[role="treeitem"][data-node-id="${id}"]`)?.focus();
      }
    }
  });
  topButtons.set('Navigator', navigatorToggle);

  presenceBar = el('div', { id: 'presence', class: 'presence' });

  return el('header', { role: 'banner', id: 'topbar' }, [
    el('span', { class: 'brand' }, [state.workspaceName]),
    pageSelect,
    group,
    add,
    panelButton('Tokens', 'tokens', 'palette'),
    panelButton('Collection', 'collection', 'database'),
    panelButton('Images', 'images', 'image'),
    panelButton('History', 'history', 'history'),
    saveVersion,
    panelButton('Comments', 'comments', 'message'),
    share,
    panelButton('Publish', 'publish', 'globe'),
    fan,
    stylePanelToggle,
    navigatorToggle,
    presenceBar,
  ]);
}

function buildBanners(): HTMLElement {
  storageBanner = el('div', { id: 'storage-banner', role: 'alert', hidden: true }, [
    notices.storageBanner,
  ]);
  modeBanner = el('div', { id: 'mode-banner', hidden: true });
  const restore = button('Restore this version', { class: 'primary' });
  restore.addEventListener('click', () => {
    const versionId = state.previewVersion?.id;
    if (versionId !== undefined) openRestoreDialog(versionId);
  });
  const back = button('Back to latest', { class: 'ghost' });
  back.addEventListener('click', () => backToLatest());
  previewBanner = el('div', { id: 'preview-banner', hidden: true }, [
    el('span', { class: 'preview-text' }),
    restore,
    back,
  ]);
  return el('div', { id: 'banners' }, [storageBanner, modeBanner, previewBanner]);
}

function buildPhoneToolbar(): HTMLElement {
  const comments = button('Comments', { class: 'ghost' });
  comments.addEventListener('click', () => openPanel('comments'));
  const pages = button('Pages', { class: 'ghost' });
  pages.addEventListener('click', () => openPagesSheet());
  const publishStatus = button('Publish status', { class: 'ghost' });
  publishStatus.addEventListener('click', () => openPanel('publish'));
  phoneToolbar = el('div', { role: 'toolbar', 'aria-label': 'Preview tools', id: 'phone-toolbar' }, [
    comments,
    pages,
    publishStatus,
  ]);
  return phoneToolbar;
}

function openPagesSheet(): void {
  const existing = document.getElementById('pages-sheet');
  existing?.remove();
  const list = el(
    'ul',
    {},
    activeDoc().pages.map((page) =>
      el('li', {}, [
        el('a', { href: `/w/${state.workspaceId}/edit?page=${page.id}` }, [page.name]),
      ]),
    ),
  );
  const close = button('Close', { class: 'ghost' });
  const sheet = el('div', { role: 'dialog', 'aria-label': 'Pages', id: 'pages-sheet' }, [
    el('h2', {}, ['Pages']),
    list,
    close,
  ]);
  close.addEventListener('click', () => sheet.remove());
  sheet.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') sheet.remove();
  });
  document.body.append(sheet);
  close.focus();
}

function layoutOf(width: number): 'desktop' | 'tablet' | 'phone' {
  if (width >= 1280) return 'desktop';
  if (width >= 768) return 'tablet';
  return 'phone';
}

function renderTopbar(): void {
  patchChildren(
    pageSelect,
    activeDoc().pages,
    (page) => page.id,
    () => el('option'),
    (option, page) => {
      (option as HTMLOptionElement).value = page.id;
      setText(option, page.name);
    },
  );
  pageSelect.value = state.pageId;
  for (const [bp, radio] of breakpointRadios) radio.checked = state.bp === bp;
  const editing = canEdit();
  const phone = state.layout === 'phone';
  const show = (label: string, visible: boolean): void => {
    const control = topButtons.get(label);
    if (control) control.hidden = !visible;
  };
  show('Add', editing && !phone);
  show('Tokens', editing && !phone);
  show('Collection', editing && !phone);
  show('Images', editing && !phone);
  show('Save version', editing && !phone);
  show('Share', state.role === 'owner' && !phone);
  show('Publish', editing && !phone);
  show('History', !phone);
  show('Comments', !phone);
  show('Fan', !phone);
  show('Style panel', editing && !phone);
  show('Navigator', state.layout === 'tablet');
  const fan = topButtons.get('Fan');
  if (fan) fan.disabled = !fanAvailable();
  const navigatorToggle = topButtons.get('Navigator');
  if (navigatorToggle) {
    navigatorToggle.setAttribute('aria-expanded', state.navigatorOpen ? 'true' : 'false');
  }
  const styleToggle = topButtons.get('Style panel');
  if (styleToggle) {
    styleToggle.setAttribute(
      'aria-expanded',
      state.stylePanel.motion === 'closed' ? 'false' : 'true',
    );
  }
  document.getElementById('breakpoints')!.hidden = phone;
  patchChildren<Person>(
    presenceBar,
    orderedPresence(),
    (person) => person.id,
    () => button('', { class: 'avatar' }),
    (element, person) => {
      const label = `${person.name}, ${person.role === 'viewer' ? 'viewing' : 'editing'}`;
      setAttr(element, 'aria-label', label);
      setText(element, person.name.slice(0, 1).toUpperCase());
    },
  );
}

function orderedPresence(): Person[] {
  const me = state.presence.find((person) => person.id === state.user.id);
  const others = state.presence.filter((person) => person.id !== state.user.id);
  return me ? [me, ...others] : others;
}

function renderBanners(): void {
  storageBanner.hidden = !state.storageDown;
  const viewer = state.role === 'viewer';
  modeBanner.hidden = !viewer;
  if (viewer) {
    const owner = state.members.find((member) => member.role === 'owner');
    setText(modeBanner, notices.commentMode(owner?.name ?? owner?.email ?? 'the owner'));
  }
  previewBanner.hidden = state.previewVersion === null;
  if (state.previewVersion) {
    setText(
      previewBanner.querySelector<HTMLElement>('.preview-text')!,
      notices.previewBanner(state.previewVersion.name),
    );
    const restore = previewBanner.querySelector('button')!;
    restore.hidden = state.role === 'viewer';
    restore.disabled = state.busy.restore;
    if (state.busy.restore) restore.setAttribute('aria-busy', 'true');
    else restore.removeAttribute('aria-busy');
  }
  phoneToolbar.hidden = state.layout !== 'phone';
}

function renderAll(): void {
  state.layout = layoutOf(window.innerWidth);
  if (state.layout === 'phone') state.bp = 'phone';
  document.body.dataset['layout'] = state.layout;
  renderTopbar();
  renderBanners();
  renderNavigator();
  renderCanvas();
  renderStylePanel();
  renderSheet();
  keepFocusInEditor();
}

/** Focus never stays on the page body after a change. */
function keepFocusInEditor(): void {
  const active = document.activeElement;
  if (active !== null && active !== document.body && active.isConnected) return;
  if (state.selectedId !== null && navigatorVisible()) {
    const row = document.querySelector<HTMLElement>(
      `[role="treeitem"][data-node-id="${state.selectedId}"]`,
    );
    if (row) {
      row.focus();
      return;
    }
  }
  canvasElement().focus();
}

function installPointer(): void {
  const canvas = canvasElement();
  canvas.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-node-id]');
    if ((event.target as HTMLElement).closest('a')) event.preventDefault();
    if (!target) return;
    const nodeId = target.dataset['nodeId'];
    if (nodeId !== undefined) selectNode(nodeId);
  });
  canvas.addEventListener('mousedown', (event) => {
    if (!canEdit()) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-node-id]');
    const nodeId = target?.dataset['nodeId'];
    if (nodeId === undefined || nodeId !== state.selectedId) return;
    const page = currentPage();
    if (page && nodeId === page.root.id) return;
    const node = nodeById(nodeId);
    if (!node) return;
    const from = { x: event.clientX, y: event.clientY };
    let started = false;
    const move = (moveEvent: MouseEvent): void => {
      if (!started) {
        if (Math.abs(moveEvent.clientX - from.x) + Math.abs(moveEvent.clientY - from.y) < 5) return;
        started = true;
        dragStart({ kind: 'node', type: node.type, nodeId });
      }
      dragMove(moveEvent.clientX, moveEvent.clientY);
    };
    const up = (): void => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (started) dragEnd();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
  canvas.addEventListener('dragover', (event) => {
    if (!dragging()) return;
    event.preventDefault();
    dragMove(event.clientX, event.clientY);
  });
  canvas.addEventListener('drop', (event) => {
    if (!dragging()) return;
    event.preventDefault();
    dragEnd();
  });
  document.getElementById('navigator')?.addEventListener('dragover', (event) => {
    if (!dragging()) return;
    event.preventDefault();
    dragMove(event.clientX, event.clientY);
  });

  let lastCursor = 0;
  canvas.addEventListener('mousemove', (event) => {
    const now = performance.now();
    if (now - lastCursor < 50) return;
    lastCursor = now;
    const frame = frameElement(state.bp);
    const rect = frame.getBoundingClientRect();
    const scale = rect.width / FRAME_WIDTH[state.bp] || 1;
    sendCursor((event.clientX - rect.left) / scale, (event.clientY - rect.top) / scale);
  });
}

function sendCursor(x: number, y: number): void {
  const page = currentPage();
  if (!page) return;
  sendLive({ type: 'cursor', pageId: page.id, x, y });
}

function cursorElement(userId: string, name: string): HTMLElement {
  const existing = document.getElementById(`cursor-${userId}`);
  if (existing) return existing;
  const made = el('div', { id: `cursor-${userId}`, 'aria-hidden': 'true', class: 'cursor' }, [
    name,
  ]);
  canvasElement().append(made);
  return made;
}

function handleLive(message: Record<string, unknown>): void {
  const type = message['type'];
  if (type === 'hello') {
    const you = message['you'] as { role: Role };
    state.role = you.role;
    state.seq = Number(message['seq'] ?? 0);
    render();
    return;
  }
  if (type === 'presence') {
    const people = message['people'] as Person[];
    const before = new Set(state.presence.map((person) => person.id));
    state.presence = people;
    for (const person of people) {
      if (person.id !== state.user.id && !before.has(person.id)) {
        sayWithToast(notices.joined(person.name));
      }
    }
    for (const id of before) {
      if (!people.some((person) => person.id === id)) {
        document.getElementById(`cursor-${id}`)?.remove();
        state.remoteSelections.delete(id);
      }
    }
    render();
    return;
  }
  if (type === 'cursor') {
    const userId = String(message['userId']);
    const pageId = String(message['pageId'] ?? '');
    if (pageId !== state.pageId) {
      document.getElementById(`cursor-${userId}`)?.remove();
      return;
    }
    const cursor = cursorElement(userId, String(message['name'] ?? ''));
    const frame = frameElement(state.bp);
    const frameRect = frame.getBoundingClientRect();
    const canvasRect = canvasElement().getBoundingClientRect();
    const scale = frameRect.width / FRAME_WIDTH[state.bp] || 1;
    cursor.style.left = `${frameRect.left - canvasRect.left + Number(message['x']) * scale + canvasElement().scrollLeft}px`;
    cursor.style.top = `${frameRect.top - canvasRect.top + Number(message['y']) * scale + canvasElement().scrollTop}px`;
    return;
  }
  if (type === 'selection') {
    const userId = String(message['userId']);
    const nodeId = message['nodeId'];
    if (typeof nodeId === 'string') state.remoteSelections.set(userId, nodeId);
    else state.remoteSelections.delete(userId);
    render();
    return;
  }
  if (type === 'conflict') {
    const winner = message['winner'] as { name: string };
    sayWithToast(
      notices.conflict(winner.name, String(message['property']), String(message['value'])),
    );
    return;
  }
  if (type === 'role') {
    const role = message['role'] as Role;
    state.role = role;
    sayWithToast(notices.roleChanged(role === 'viewer' ? 'viewer' : 'editor'));
    const active = document.activeElement as HTMLElement | null;
    render();
    if (active === null || !active.isConnected || active.hidden) canvasElement().focus();
    return;
  }
  if (type === 'comment') {
    mergeThread(message['thread'] as Parameters<typeof mergeThread>[0]);
    render();
    return;
  }
  if (type === 'restored') {
    const by = message['by'] as { id: string; name: string };
    sayWithToast(notices.restored(by.name, String(message['versionName'])));
    void reloadDocument().then(() => loadVersions());
    return;
  }
}

export async function mountEditor(root: HTMLElement, boot: Boot): Promise<void> {
  state.workspaceId = boot.workspaceId;
  state.workspaceName = boot.workspaceName;
  state.user = boot.user;
  state.role = boot.role;
  const url = new URL(window.location.href);
  const doc = await api.get<PlinthDocument>(`/api/workspaces/${boot.workspaceId}/document`);
  state.doc = doc;
  state.seq = doc.seq;
  const wantedPage = url.searchParams.get('page');
  state.pageId =
    wantedPage !== null && doc.pages.some((page) => page.id === wantedPage)
      ? wantedPage
      : (doc.pages[0]?.id ?? '');
  const wantedBp = url.searchParams.get('bp');
  if (wantedBp === 'tablet' || wantedBp === 'phone' || wantedBp === 'desktop') state.bp = wantedBp;
  if (url.searchParams.get('panel') === 'publish') state.panel = 'publish';
  state.layout = layoutOf(window.innerWidth);
  setRenderHook(renderAll);
  onLive(handleLive);

  root.replaceChildren(
    buildTopbar(),
    buildBanners(),
    el('div', { id: 'workbench' }, [
      navigatorElement(),
      canvasElement(),
      stylePanelElement(),
      sheetElement(),
    ]),
    buildPhoneToolbar(),
  );
  installKeys();
  installPointer();
  window.addEventListener('resize', () => render());
  window.addEventListener('popstate', () => {
    void applyUrlVersion();
  });
  onAccepted(() => {
    void loadPublish();
  });
  render();

  connectLive();
  const members = await api.get<{ members: Member[] }>(
    `/api/workspaces/${boot.workspaceId}/members`,
  );
  state.members = members.members;
  await Promise.all([loadPublish(), loadImages(), loadVersions(), loadThreads()]);
  void checkStorage();
  const versionId = url.searchParams.get('version');
  if (versionId !== null) await openPreview(versionId);
  syncUrl();
  render();
  if (document.activeElement === null || document.activeElement === document.body) {
    canvasElement().focus();
  }
}
