import { el, openDialog, animate } from '../lib/dom.js';
import { api, errorOf, toast } from '../lib/api.js';
import { checkSession } from './home.js';
import { EditorStore } from '../lib/store.js';
import { buildCanvas, renderCanvas, fitBoxes, zoomAbout, toMap, type CanvasParts } from '../lib/canvas.js';
import {
  arrowTarget, moveOps, focusAfterDelete, homeTarget, endTarget, visibleOrder, treeLabel, makeTreeItem, siblingsOf, newOpId,
} from '../lib/tree.js';
import { renderNote } from '../lib/notes.js';
import type { MapPayload, Operation, Topic, CommentThread } from '../../shared/types.js';
import { may } from '../../shared/permissions.js';

/**
 * The editor: toolbar, canvas, outline, topic details, activity and
 * every dialog. One roving focus; every key acts on the focused topic.
 */

export async function renderEditor(root: HTMLElement, mapId: string, query: URLSearchParams): Promise<void> {
  const me = await checkSession();
  const out = await api<MapPayload>(`/api/maps/${mapId}`);
  if (!out.ok) {
    const err = errorOf(out);
    const page = el('main', { class: 'auth-form' });
    page.appendChild(el('h1', {}, err.code === 'not_found' ? "We couldn't find that map." : err.message));
    root.replaceChildren(page);
    return;
  }
  const payload = out.body as MapPayload;
  const store = new EditorStore(payload, me?.username ?? null);
  const readOnly = !may(store.state.myRole, 'edit');

  root.replaceChildren();
  const announcement = el('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  document.querySelectorAll('[role="status"][aria-label="Map announcements"]').forEach((n) => n.remove());
  announcement.setAttribute('aria-label', 'Map announcements');
  document.body.appendChild(announcement);
  store.setAnnouncement(announcement);

  const toolbar = el('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Map tools' });
  const undoBtn = el('button', { class: 'secondary', 'aria-label': 'Undo' }, 'Undo');
  const redoBtn = el('button', { class: 'secondary', 'aria-label': 'Redo' }, 'Redo');
  const layoutGroup = el('div', { role: 'radiogroup', 'aria-label': 'Layout' });
  const themeGroup = el('div', { role: 'radiogroup', 'aria-label': 'Theme' });
  for (const [value, text] of [['map', 'Mind map'], ['org', 'Org chart'], ['list', 'List']] as const) {
    const radio = el('input', { type: 'radio', name: 'layout', id: `layout-${value}`, role: 'radio', 'aria-label': text, ...(store.state.map.layout === value ? { checked: '' } : {}) }) as HTMLInputElement;
    radio.addEventListener('change', () => { void switchLayout(value); });
    layoutGroup.append(radio, el('label', { for: `layout-${value}` }, text));
  }
  for (const [value, text] of [['daylight', 'Daylight'], ['paper', 'Paper'], ['dusk', 'Dusk']] as const) {
    const radio = el('input', { type: 'radio', name: 'theme', id: `theme-${value}`, role: 'radio', 'aria-label': text, ...(store.state.map.theme === value ? { checked: '' } : {}) }) as HTMLInputElement;
    radio.addEventListener('change', () => { void store.send([{ op_id: newOpId(), kind: 'theme', theme: value }]); });
    themeGroup.append(radio, el('label', { for: `theme-${value}` }, text));
  }
  const fitBtn = el('button', { class: 'secondary', 'aria-label': 'Fit to screen' }, 'Fit to screen');
  const focusBtn = el('button', { class: 'secondary', 'aria-label': 'Focus branch' }, 'Focus branch');
  const crossLinkBtn = el('button', { class: 'secondary', 'aria-label': 'Add cross-link' }, 'Add cross-link');
  const boundaryBtn = el('button', { class: 'secondary', 'aria-label': 'Add boundary' }, 'Add boundary');
  const findBtn = el('button', { class: 'secondary', 'aria-label': 'Find' }, 'Find');
  const saveVersionBtn = el('button', { class: 'secondary', 'aria-label': 'Save version' }, 'Save version');
  const historyBtn = el('button', { class: 'secondary', 'aria-label': 'History' }, 'History');
  const activityBtn = el('button', { class: 'secondary', 'aria-label': 'Activity' }, 'Activity');
  const shareBtn = el('button', { class: 'secondary', 'aria-label': 'Share' }, 'Share');
  const importBtn = el('button', { class: 'secondary', 'aria-label': 'Import outline' }, 'Import outline');
  const exportBtn = el('button', { class: 'secondary', 'aria-label': 'Export' }, 'Export');
  const presentBtn = el('button', { class: 'secondary', 'aria-label': 'Start presentation' }, 'Start presentation');
  const offlineSwitch = el('input', { type: 'checkbox', id: 'work-offline', role: 'switch', 'aria-label': 'Work offline' }) as HTMLInputElement;
  const inboxBtn = el('button', { class: 'secondary', 'aria-label': 'Inbox (0)' }, 'Inbox (0)');
  toolbar.append(undoBtn, redoBtn, layoutGroup, themeGroup, fitBtn, focusBtn, crossLinkBtn, boundaryBtn, findBtn, saveVersionBtn, historyBtn, activityBtn);
  if (store.state.myRole === 'owner') toolbar.append(shareBtn, presentBtn);
  toolbar.append(importBtn, exportBtn, el('label', { for: 'work-offline' }, 'Work offline'), offlineSwitch, inboxBtn);
  if (readOnly) toolbar.appendChild(el('span', { class: 'viewonly' }, '👁 View only'));

  const canvasRegion = el('div', { class: 'canvas-wrap' });
  const connection = el('div', { class: 'banner-connection', role: 'region', 'aria-label': 'Connection' });
  canvasRegion.appendChild(connection);
  store.setConnection(connection);
  const parts: CanvasParts = buildCanvas(store, canvasRegion);

  const outlineRail = el('aside', { class: 'outline-rail', role: 'complementary', 'aria-label': 'Outline' });
  const detailsPanel = el('aside', { class: 'panel', role: 'complementary', 'aria-label': 'Topic details', hidden: '' });
  const activityPanel = el('section', { class: 'panel', role: 'region', 'aria-label': 'Activity', hidden: '' });

  const editor = el('div', { class: `editor ${isDesk() ? 'with-rail' : ''}` });
  if (isDesk()) editor.append(outlineRail, canvasRegion, detailsPanel, activityPanel);
  else editor.append(canvasRegion, detailsPanel, activityPanel);
  const outlineBtn = el('button', { class: 'secondary', 'aria-label': 'Outline' }, 'Outline');
  if (!isDesk()) toolbar.appendChild(outlineBtn);
  root.append(toolbar, editor);

  // ---- focus model ------------------------------------------------------
  let focusedId: string = query.get('topic') ?? homeTarget(store) ?? '';
  let selected = new Set<string>();
  const order = () => visibleOrder(store);
  const focusables = () => order();

  const rovingTabindex = (): void => {
    for (const t of focusables()) {
      const item = treeItemEl(t.id);
      if (item) item.setAttribute('tabindex', t.id === focusedId ? '0' : '-1');
    }
  };

  let treeItems = new Map<string, HTMLElement>();
  const treeItemEl = (id: string): HTMLElement | null => treeItems.get(id) ?? null;

  const renderTree = (): void => {
    parts.treeEl.replaceChildren();
    treeItems = new Map();
    const visible = order();
    const counts = siblingCounts(store);
    for (const t of visible) {
      const item = makeTreeItem(store, t, counts.get(t.id)?.pos ?? 1, counts.get(t.id)?.size ?? 1);
      item.addEventListener('focus', () => { focusedId = t.id; });
      item.addEventListener('click', () => { focusedId = t.id; rovingTabindex(); });
      treeItems.set(t.id, item);
      parts.treeEl.appendChild(item);
    }
    rovingTabindex();
  };

  function siblingCounts(store: EditorStore): Map<string, { pos: number; size: number }> {
    const out = new Map<string, { pos: number; size: number }>();
    const byParent = new Map<string, Topic[]>();
    for (const t of store.state.topics.values()) {
      const key = t.parent_id ?? '';
      const arr = byParent.get(key) ?? [];
      arr.push(t);
      byParent.set(key, arr);
    }
    for (const arr of byParent.values()) arr.sort((a, b) => a.rank - b.rank);
    for (const arr of byParent.values()) {
      arr.forEach((t, i) => out.set(t.id, { pos: i + 1, size: arr.length }));
    }
    return out;
  }

  // ---- canvas render ----------------------------------------------------
  let previousBoxes: Map<string, { x: number; y: number }> | null = null;
  const repaint = (regrow = false) => {
    const prev = regrow ? (previousBoxes ?? undefined) : undefined;
    renderCanvas(store, parts, { regrow, previousBoxes: prev });
    previousBoxes = new Map([...store.layout().boxes.entries()].map(([k, v]) => [k, { x: v.x, y: v.y }]));
    renderTree();
    renderOutlineRows();
    renderPresenceDots();
  };

  const unsub = store.subscribe(() => { repaint(); });
  void unsub;

  // Fit on open with the root centred at zoom 1.
  parts.viewport = { zoom: 1, panX: canvasRegion.clientWidth / 2, panY: canvasRegion.clientHeight / 2 };
  repaint();

  const switchLayout = async (layout: 'map' | 'org' | 'list') => {
    previousBoxes = new Map([...store.layout().boxes.entries()].map(([k, v]) => [k, { x: v.x, y: v.y }]));
    await store.send([{ op_id: newOpId(), kind: 'layout', layout }]);
    repaint(true);
  };

  fitBtn.addEventListener('click', () => {
    const boxes = [...store.layout().boxes.values()];
    const fit = fitBoxes(boxes, parts.canvas.clientWidth, parts.canvas.clientHeight);
    if (fit) { parts.viewport = fit; repaint(); }
  });

  // ---- keyboard model ---------------------------------------------------
  const isEditingTitle = (): boolean => Boolean(activeTitleInput);
  let activeTitleInput: HTMLInputElement | null = null;

  const openTitleInput = (topicId: string, initial: string, select: boolean): void => {
    const t = store.state.topics.get(topicId);
    if (!t) return;
    const layout = store.layout();
    const b = layout.boxes.get(topicId);
    if (!b) return;
    closeTitleInput();
    const input = el('input', { class: 'title-input', value: initial, 'aria-label': 'Topic title' }) as HTMLInputElement;
    input.style.left = `${b.x - b.w / 2}px`;
    input.style.top = `${b.y - b.h / 2}px`;
    input.style.width = `${b.w}px`;
    input.style.height = `${b.h}px`;
    parts.topicsEl.appendChild(input);
    activeTitleInput = input;
    input.focus();
    if (select) input.select();
    else input.setSelectionRange(initial.length, initial.length);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitTitle(topicId, initial, input.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        store.announce(initial === 'New topic' ? 'New topic' : initial);
        closeTitleInput();
        focusTopic(topicId);
      }
      e.stopPropagation();
    });
    input.addEventListener('blur', () => {
      if (activeTitleInput === input) commitTitle(topicId, initial, input.value);
    });
  };

  const closeTitleInput = (): void => {
    if (activeTitleInput) { activeTitleInput.remove(); activeTitleInput = null; }
  };

  const commitTitle = (topicId: string, opening: string, text: string): void => {
    closeTitleInput();
    const chars = [...opening];
    const next = [...text];
    let p = 0;
    while (p < chars.length && p < next.length && chars[p] === next[p]) p += 1;
    let s = 0;
    while (s < chars.length - p && s < next.length - p && chars[chars.length - 1 - s] === next[next.length - 1 - s]) s += 1;
    const del = chars.length - p - s;
    const ins = next.slice(p, next.length - s).join('');
    if (del === 0 && ins === '') { focusTopic(topicId); return; }
    void store.send([{ op_id: newOpId(), kind: 'title', topic_id: topicId, offset: p, delete: del, insert: ins }]);
    focusTopic(topicId);
  };

  const focusTopic = (id: string): void => {
    focusedId = id;
    const item = treeItemEl(id);
    if (item) item.focus();
    keepInView(id);
    rovingTabindex();
  };

  const keepInView = (id: string): void => {
    const b = store.layout().boxes.get(id);
    if (!b) return;
    const sx = b.x * parts.viewport.zoom + parts.viewport.panX;
    const sy = b.y * parts.viewport.zoom + parts.viewport.panY;
    const w = parts.canvas.clientWidth;
    const h = parts.canvas.clientHeight;
    const margin = 48;
    let panX = parts.viewport.panX;
    let panY = parts.viewport.panY;
    if (sx < margin) panX += margin - sx;
    if (sx > w - margin) panX -= sx - (w - margin);
    if (sy < margin) panY += margin - sy;
    if (sy > h - margin) panY -= sy - (h - margin);
    parts.viewport = { ...parts.viewport, panX: Math.round(panX * 100) / 100, panY: Math.round(panY * 100) / 100 };
    parts.publish();
  };

  const rootEl = editor;
  rootEl.addEventListener('keydown', (e) => {
    if (isEditingTitle()) return;
    const t = store.state.topics.get(focusedId);
    if (!t) return;
    const editing = !readOnly;
    switch (e.key) {
      case 'Tab': {
        if (!editing) { store.announce('You can view this map but not edit it.'); e.preventDefault(); return; }
        e.preventDefault();
        // Tab adds a child as the last child of the focused topic.
        const newId = `t-${crypto.randomUUID().slice(0, 8)}`;
        void store.send([{ op_id: newOpId(), kind: 'add', topic_id: newId, parent_id: focusedId, after: null, title: 'New topic' }]);
        openTitleInput(newId, 'New topic', true);
        return;
      }
      case 'Enter': {
        if (!editing) { store.announce('You can view this map but not edit it.'); e.preventDefault(); return; }
        e.preventDefault();
        const newId = `t-${crypto.randomUUID().slice(0, 8)}`;
        const parentId = t!.parent_id === null && !t!.floating ? t!.id : t!.parent_id;
        const after = t!.parent_id === null && !t!.floating ? null : t!.id;
        void store.send([{ op_id: newOpId(), kind: 'add', topic_id: newId, parent_id: parentId, after, title: 'New topic' }]);
        openTitleInput(newId, 'New topic', true);
        return;
      }
      case 'F2': {
        e.preventDefault();
        openTitleInput(focusedId, t!.title, false);
        return;
      }
      case 'Delete': {
        if (!editing) { store.announce('You can view this map but not edit it.'); e.preventDefault(); return; }
        e.preventDefault();
        if (t!.parent_id === null && !t!.floating) { store.announce('The central topic can\'t be deleted.'); return; }
        const ids = selected.size > 0 ? [...selected] : [focusedId];
        const ops: Operation[] = ids.map((id) => ({ op_id: newOpId(), kind: 'delete' as const, topic_id: id }));
        void store.send(ops);
        const next = focusAfterDelete(store, focusedId);
        selected = new Set();
        if (next) focusTopic(next);
        return;
      }
      case ' ': {
        e.preventDefault();
        if (store.state.collapsed.has(focusedId)) {
          store.state.collapsed.delete(focusedId);
          store.announce(`${t!.title} expanded`);
        } else {
          store.state.collapsed.add(focusedId);
          store.announce(`${t!.title} collapsed`);
        }
        void api(`/api/maps/${mapId}/collapse`, 'PUT', { topic_id: focusedId, collapsed: store.state.collapsed.has(focusedId) });
        repaint();
        return;
      }
      case 'Home': e.preventDefault(); focusTopic(homeTarget(store) ?? focusedId); return;
      case 'End': e.preventDefault(); focusTopic(endTarget(store) ?? focusedId); return;
      case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight': {
        e.preventDefault();
        if (e.altKey) {
          if (!editing) { store.announce('You can view this map but not edit it.'); return; }
          const ids = selected.size > 0 ? [...selected] : [focusedId];
          const result = moveOps(store, focusedId, e.key, selected);
          if (result.announcement) { store.announce(result.announcement); return; }
          void store.send(result.ops).then(() => {
            const target = store.state.topics.get(ids[0]);
            if (target) {
              const sibs = siblingsOf(store, ids[0]);
              const pos = sibs.findIndex((s) => s.id === ids[0]) + 1;
              const parent = target.parent_id ? store.state.topics.get(target.parent_id) : null;
              store.announce(`${target.title} is now ${pos} of ${sibs.length} under ${parent?.title ?? target.title}.`);
              focusTopic(ids[0]);
            }
          });
          return;
        }
        if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          const sibs = siblingsOf(store, focusedId);
          const idx = sibs.findIndex((s) => s.id === focusedId);
          const next = e.key === 'ArrowUp' ? sibs[idx - 1] : sibs[idx + 1];
          if (next) {
            selected.add(next.id);
            store.announce(`${selected.size} topics selected.`);
            focusTopic(next.id);
          }
          return;
        }
        const target = arrowTarget(store, focusedId, e.key);
        if (target) {
          selected = new Set();
          focusTopic(target);
        }
        return;
      }
      case 'z': case 'Z': {
        if (e.ctrlKey && e.shiftKey) { e.preventDefault(); void store.redo(); }
        else if (e.ctrlKey) { e.preventDefault(); void store.undo(); }
        return;
      }
      case 'c': case 'C': {
        if (e.ctrlKey && !readOnly) {
          e.preventDefault();
          const ids = selected.size > 0 ? [...selected] : [focusedId];
          const res = await_ish_copy(ids);
          void res;
        }
        return;
      }
      case 'v': case 'V': {
        if (e.ctrlKey && !readOnly) {
          e.preventDefault();
          void pasteFromClipboard();
        }
        return;
      }
      case 'f': case 'F': {
        if (e.ctrlKey && e.shiftKey) { e.preventDefault(); focusBranch(); return; }
        if (e.ctrlKey) { e.preventDefault(); openFind(); return; }
        return;
      }
      case 'l': case 'L': {
        if (e.ctrlKey && e.shiftKey) { e.preventDefault(); openCrossLink(); return; }
        return;
      }
      case 'b': case 'B': {
        if (e.ctrlKey && e.shiftKey && !readOnly) {
          e.preventDefault();
          void store.send([{ op_id: newOpId(), kind: 'boundary_add', boundary_id: `b-${crypto.randomUUID().slice(0, 8)}`, topic_id: focusedId, label: '' }]);
          return;
        }
        return;
      }
      default: {
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && editing) {
          e.preventDefault();
          openTitleInput(focusedId, e.key, false);
        }
        return;
      }
    }
  });

  const await_ish_copy = async (ids: string[]): Promise<void> => {
    const res = await api<{ topics: number }>('/api/clipboard', 'POST', { map_id: mapId, topic_ids: ids });
    if (res.ok) store.announce(`Copied ${(res.body as { topics: number }).topics} topics.`);
    else store.announce(errorOf(res).message);
  };

  const pasteFromClipboard = async (): Promise<void> => {
    const res = await api(`/api/maps/${mapId}/paste`, 'POST', { parent_id: focusedId, group_id: `g-${crypto.randomUUID()}`, base_revision: store.state.revision });
    if (res.ok) store.announce('Pasted.');
    else store.announce(errorOf(res).message);
  };

  // ---- pointer, wheel, touch -------------------------------------------
  let panning = false;
  let panStart = { x: 0, y: 0, panX: 0, panY: 0 };
  parts.canvas.addEventListener('mousedown', (e) => {
    const topicEl = (e.target as HTMLElement).closest('[data-topic-id]');
    if (topicEl) {
      const id = topicEl.getAttribute('data-topic-id')!;
      focusedId = id;
      selected = new Set();
      rovingTabindex();
      return;
    }
    panning = true;
    panStart = { x: e.clientX, y: e.clientY, panX: parts.viewport.panX, panY: parts.viewport.panY };
  });
  window.addEventListener('mousemove', (e) => {
    if (!panning) return;
    parts.viewport = { ...parts.viewport, panX: panStart.panX + (e.clientX - panStart.x), panY: panStart.panY + (e.clientY - panStart.y) };
    parts.publish();
  });
  window.addEventListener('mouseup', () => { panning = false; });
  parts.canvas.addEventListener('dblclick', (e) => {
    const topicEl = (e.target as HTMLElement).closest('[data-topic-id]');
    if (topicEl) openTitleInput(topicEl.getAttribute('data-topic-id')!, store.state.topics.get(topicEl.getAttribute('data-topic-id')!)?.title ?? '', false);
  });
  parts.canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey) {
      const rect = parts.canvas.getBoundingClientRect();
      const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      parts.viewport = zoomAbout(point, e.deltaY < 0 ? 1.1 : 1 / 1.1, parts.viewport);
      parts.publish();
    } else {
      parts.viewport = { ...parts.viewport, panX: parts.viewport.panX - e.deltaX, panY: parts.viewport.panY - e.deltaY };
      parts.publish();
    }
  }, { passive: false });

  // Long press: 500 ms without moving more than 8 px opens the actions menu.
  let pressTimer: number | null = null;
  let pressPoint = { x: 0, y: 0 };
  let longPressedId: string | null = null;
  parts.canvas.addEventListener('touchstart', (e) => {
    const topicEl = (e.target as HTMLElement).closest('[data-topic-id]');
    if (!topicEl || e.touches.length !== 1) return;
    const id = topicEl.getAttribute('data-topic-id')!;
    focusedId = id;
    pressPoint = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    pressTimer = window.setTimeout(() => {
      longPressedId = id;
      openTopicActions(id);
    }, 500);
  });
  parts.canvas.addEventListener('touchmove', (e) => {
    if (pressTimer === null) return;
    const dx = e.touches[0].clientX - pressPoint.x;
    const dy = e.touches[0].clientY - pressPoint.y;
    if (Math.hypot(dx, dy) > 8) { clearTimeout(pressTimer); pressTimer = null; }
  });
  parts.canvas.addEventListener('touchend', () => {
    if (pressTimer !== null) { clearTimeout(pressTimer); pressTimer = null; }
  });

  const openTopicActions = (id: string): void => {
    openDialog({
      label: 'Topic actions',
      opener: null,
      build(body, close) {
        const t = store.state.topics.get(id);
        body.appendChild(el('h2', {}, t?.title ?? ''));
        const menu = el('div', { class: 'menu', role: 'menu', 'aria-label': 'Topic actions' });
        const item = (label: string, act: () => void): HTMLElement => {
          const btn = el('button', { class: 'secondary', role: 'menuitem' }, label);
          btn.addEventListener('click', () => { act(); close(); });
          return btn;
        };
        menu.append(
          item('Add child', () => { const nid = `t-${crypto.randomUUID().slice(0, 8)}`; void store.send([{ op_id: newOpId(), kind: 'add', topic_id: nid, parent_id: id, after: null, title: 'New topic' }]); openTitleInput(nid, 'New topic', true); }),
          item('Add sibling', () => { const nid = `t-${crypto.randomUUID().slice(0, 8)}`; void store.send([{ op_id: newOpId(), kind: 'add', topic_id: nid, parent_id: t?.parent_id, after: id, title: 'New topic' }]); openTitleInput(nid, 'New topic', true); }),
          item('Rename', () => openTitleInput(id, t?.title ?? '', false)),
          item(store.state.collapsed.has(id) ? 'Expand' : 'Collapse', () => {
            if (store.state.collapsed.has(id)) store.state.collapsed.delete(id);
            else store.state.collapsed.add(id);
            void api(`/api/maps/${mapId}/collapse`, 'PUT', { topic_id: id, collapsed: store.state.collapsed.has(id) });
            repaint();
          }),
          item('Open details', () => openDetails(id)),
          item('Delete', () => { void store.send([{ op_id: newOpId(), kind: 'delete', topic_id: id }]); }),
        );
        body.appendChild(menu);
      },
    });
  };

  // ---- topic details ----------------------------------------------------
  const openDetails = (id: string): void => {
    const t = store.state.topics.get(id);
    if (!t) return;
    detailsPanel.hidden = false;
    activityPanel.hidden = true;
    renderDetails(id);
  };

  const renderDetails = (id: string): void => {
    const t = store.state.topics.get(id);
    if (!t) { detailsPanel.hidden = true; return; }
    detailsPanel.replaceChildren();
    detailsPanel.appendChild(el('h2', {}, t.title));
    const tabs = el('div', { class: 'tabs', role: 'tablist' });
    const buildTab = (name: 'Notes' | 'Task' | 'Comments'): HTMLButtonElement => {
      const tab = el('button', { class: 'tab', role: 'tab', 'aria-label': name }, name);
      tab.addEventListener('click', () => {
        for (const other of tabs.children) (other as HTMLElement).setAttribute('aria-selected', 'false');
        tab.setAttribute('aria-selected', 'true');
        renderTab(name);
      });
      return tab;
    };
    const notesTab = buildTab('Notes');
    notesTab.setAttribute('aria-selected', 'true');
    tabs.append(notesTab, buildTab('Task'), buildTab('Comments'));
    detailsPanel.appendChild(tabs);
    const tabBody = el('div', { class: 'tab-body' });
    detailsPanel.appendChild(tabBody);

    const renderTab = (name: 'Notes' | 'Task' | 'Comments'): void => {
      tabBody.replaceChildren();
      if (name === 'Notes') renderNotesTab(tabBody, t);
      else if (name === 'Task') renderTaskTab(tabBody, t);
      else void renderCommentsTab(tabBody, t);
    };
    renderTab('Notes');
  };

  const renderNotesTab = (body: HTMLElement, t: Topic): void => {
    const field = el('textarea', { 'aria-label': 'Note', rows: '4' }) as HTMLTextAreaElement;
    field.value = t.note;
    const preview = el('div', { class: 'note-preview', role: 'region', 'aria-label': 'Note preview' });
    preview.innerHTML = renderNote(t.note);
    field.addEventListener('input', () => { preview.innerHTML = renderNote(field.value); });
    field.addEventListener('change', () => { void store.send([{ op_id: newOpId(), kind: 'note', topic_id: t.id, text: field.value }]); });
    const attach = el('button', { class: 'secondary', 'aria-label': 'Attach image' }, 'Attach image');
    const fileInput = el('input', { type: 'file', accept: 'image/png,image/jpeg', class: 'sr-only', 'aria-label': 'Attach image' }) as HTMLInputElement;
    attach.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      store.announce(`Uploading ${file.name}`);
      const bytes = await file.arrayBuffer();
      const res = await api(`/api/maps/${mapId}/topics/${t.id}/attachments`, 'POST', undefined, bytes, file.type || 'application/octet-stream');
      if (res.ok) store.announce('Image attached.');
      else store.announce(errorOf(res).message);
    });
    body.append(field, preview, attach, fileInput);
    for (const a of t.attachments) {
      const img = el('img', { class: 'attachment-img', src: `/api/attachments/${a.id}`, alt: `Attachment on ${t.title}` });
      body.appendChild(img);
    }
  };

  const renderTaskTab = (body: HTMLElement, t: Topic): void => {
    const isTask = el('input', { type: 'checkbox', 'aria-label': 'Task', ...(t.task ? { checked: '' } : {}) }) as HTMLInputElement;
    const done = el('input', { type: 'checkbox', 'aria-label': 'Done', ...(t.task?.percent === 100 ? { checked: '' } : {}) }) as HTMLInputElement;
    const percent = el('input', { type: 'number', min: '0', max: '100', 'aria-label': 'Percent done', value: String(t.task?.percent ?? 0) }) as HTMLInputElement;
    const weight = el('input', { type: 'number', min: '0', max: '10', 'aria-label': 'Weight', value: String(t.task?.weight ?? 1) }) as HTMLInputElement;
    const priority = el('select', { 'aria-label': 'Priority' }) as HTMLSelectElement;
    for (const p of ['low', 'normal', 'high']) priority.append(el('option', { value: p, ...(t.task?.priority === p ? { selected: '' } : {}) }, p));
    const state = el('select', { 'aria-label': 'State' }) as HTMLSelectElement;
    for (const s of ['open', 'cancelled']) state.append(el('option', { value: s, ...(t.task?.state === s ? { selected: '' } : {}) }, s));
    const assignee = el('input', { 'aria-label': 'Assignee', value: t.task?.assignee ?? '' }) as HTMLInputElement;
    const due = el('input', { type: 'date', 'aria-label': 'Due date', value: t.task?.due ?? '' }) as HTMLInputElement;
    const send = () => {
      const task = isTask.checked
        ? {
            percent: done.checked ? 100 : Number(percent.value || 0),
            weight: Number(weight.value || 1),
            state: state.value as 'open' | 'cancelled',
            priority: priority.value as 'low' | 'normal' | 'high',
            due: due.value || null,
            assignee: assignee.value || null,
          }
        : null;
      void store.send([{ op_id: newOpId(), kind: 'task', topic_id: t.id, task }]);
    };
    for (const node of [isTask, done, percent, weight, priority, state, assignee, due]) {
      node.addEventListener('change', send);
    }
    body.append(
      el('label', {}, 'Task'), isTask,
      el('label', {}, 'Done'), done,
      el('label', {}, 'Percent done'), percent,
      el('label', {}, 'Weight'), weight,
      el('label', {}, 'Priority'), priority,
      el('label', {}, 'State'), state,
      el('label', {}, 'Assignee'), assignee,
      el('label', {}, 'Due date'), due,
    );
  };

  const renderCommentsTab = async (body: HTMLElement, t: Topic): Promise<void> => {
    const res = await api<{ threads: CommentThread[] }>(`/api/maps/${mapId}/topics/${t.id}/comments`);
    const threads = res.ok ? (res.body as { threads: CommentThread[] }).threads : [];
    const field = el('textarea', { 'aria-label': 'Add a comment', rows: '2' }) as HTMLTextAreaElement;
    const mentionBox = el('div', { role: 'listbox', 'aria-label': 'Mention', hidden: '' });
    const post = el('button', { class: 'primary', 'aria-label': 'Post comment' }, 'Post comment');
    post.addEventListener('click', async () => {
      const text = field.value.trim();
      if (text === '') return;
      const res2 = await api(`/api/maps/${mapId}/topics/${t.id}/comments`, 'POST', { body: text, reply_to: null });
      if (!res2.ok) store.announce(errorOf(res2).message);
      field.value = '';
      renderCommentsTab(body, t);
    });
    field.addEventListener('input', () => {
      const at = field.value.lastIndexOf('@');
      if (at === -1) { mentionBox.hidden = true; return; }
      const typed = field.value.slice(at + 1).split(' ')[0].toLowerCase();
      const names = store.state.people.map((p) => p.username).filter((n) => n.startsWith(typed) && typed.length > 0);
      mentionBox.replaceChildren();
      for (const n of names) {
        const opt = el('div', { role: 'option' }, n);
        mentionBox.appendChild(opt);
      }
      mentionBox.hidden = names.length === 0;
    });
    body.append(field, mentionBox, post);
    for (const th of threads) {
      const block = el('div', { class: 'thread' });
      block.appendChild(el('div', { class: 'comment' }, `${th.author}: ${th.body}`));
      for (const r of th.replies) block.appendChild(el('div', { class: 'reply' }, `${r.author}: ${r.body}`));
      if (!th.resolved) {
        const reply = el('button', { class: 'secondary', 'aria-label': 'Reply' }, 'Reply');
        reply.addEventListener('click', () => {
          const text = field.value.trim();
          if (text === '') return;
          void api(`/api/maps/${mapId}/topics/${t.id}/comments`, 'POST', { body: text, reply_to: th.id }).then(() => renderCommentsTab(body, t));
        });
        const resolve = el('button', { class: 'secondary', 'aria-label': 'Resolve' }, 'Resolve');
        resolve.addEventListener('click', async () => {
          await api(`/api/comments/${th.id}/resolve`, 'POST');
          renderCommentsTab(body, t);
        });
        block.append(reply, resolve);
      } else {
        const reopen = el('button', { class: 'secondary', 'aria-label': 'Reopen' }, 'Reopen');
        reopen.addEventListener('click', async () => {
          await api(`/api/comments/${th.id}/reopen`, 'POST');
          renderCommentsTab(body, t);
        });
        block.appendChild(reopen);
      }
      body.appendChild(block);
    }
    const voteBtn = el('button', { class: 'secondary', 'aria-label': `Vote for ${t.title}`, ...(t.voted ? { 'aria-pressed': 'true' } : {}) }, `Vote for ${t.title}`);
    voteBtn.addEventListener('click', async () => {
      const res2 = await api(`/api/maps/${mapId}/topics/${t.id}/vote`, 'PUT', { voted: !t.voted });
      if (res2.ok) { t.voted = !t.voted; renderCommentsTab(body, t); }
    });
    body.appendChild(voteBtn);
  };

  // ---- outline ----------------------------------------------------------
  const renderOutlineRows = (): void => {
    if (!isDesk()) return;
    outlineRail.replaceChildren();
    const tree = el('div', { role: 'tree', 'aria-label': 'Outline' });
    const visible = visibleOrder(store);
    const counts = siblingCounts(store);
    for (const t of visible) {
      const level = store.layout().levels.get(t.id) ?? 1;
      const row = el('div', { role: 'treeitem', class: `outline-row${t.id === focusedId ? ' focused' : ''}`, 'data-topic-id': t.id, style: `margin-left:${(level - 1) * 16}px`, tabindex: '-1' }, t.title);
      row.addEventListener('click', () => { focusedId = t.id; repaint(); });
      tree.appendChild(row);
      void counts;
    }
    outlineRail.appendChild(tree);
  };
  if (isDesk()) renderOutlineRows();

  outlineBtn?.addEventListener('click', () => {
    openDialog({
      label: 'Outline',
      opener: outlineBtn,
      panelClass: 'sheet-bottom',
      build(body) {
        const tree = el('div', { role: 'tree', 'aria-label': 'Outline' });
        for (const t of visibleOrder(store)) {
          const level = store.layout().levels.get(t.id) ?? 1;
          tree.appendChild(el('div', { role: 'treeitem', class: 'outline-row', 'data-topic-id': t.id, style: `margin-left:${(level - 1) * 16}px` }, t.title));
        }
        body.appendChild(tree);
      },
    });
  });

  // ---- presence ---------------------------------------------------------
  const renderPresenceDots = (): void => {
    const people = store.state.people;
    const region = parts.canvas.querySelector('.people-here');
    if (region) region.remove();
    if (people.length === 0) return;
    const list = el('ul', { class: 'people-here', role: 'list', 'aria-label': 'People here', style: 'position:absolute;top:52px;left:12px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:8px 12px;list-style:none;margin:0;z-index:7' });
    for (const p of people) {
      const li = el('li', { class: 'person' });
      li.appendChild(el('span', { class: 'dot', style: `background:${branchColour(p.colour)}` }));
      li.appendChild(el('span', {}, `${p.username}${p.guest ? ' (guest)' : ''}`));
      const follow = el('button', { class: 'textlink', 'aria-label': `Follow ${p.username}` }, `Follow ${p.username}`);
      follow.addEventListener('click', () => {
        store.state.followUser = p.username;
        store.announce(`Following ${p.username}.`);
      });
      li.appendChild(follow);
      list.appendChild(li);
    }
    parts.canvas.appendChild(list);
  };

  // ---- dialogs ----------------------------------------------------------
  const openFind = (): void => {
    openDialog({
      label: 'Find in map',
      build(body, close) {
        const search = el('form', { class: 'find', role: 'search', 'aria-label': 'Find in map' });
        const field = el('input', { type: 'search', 'aria-label': 'Find' }) as HTMLInputElement;
        const replace = el('input', { type: 'text', 'aria-label': 'Replace with' }) as HTMLInputElement;
        const count = el('p', { class: 'find-count' }, 'No matches');
        const next = el('button', { class: 'secondary', type: 'button', 'aria-label': 'Next match' }, 'Next match');
        const prev = el('button', { class: 'secondary', type: 'button', 'aria-label': 'Previous match' }, 'Previous match');
        const replaceAll = el('button', { class: 'primary', type: 'button', 'aria-label': 'Replace all' }, 'Replace all');
        const byAssignee = el('select', { 'aria-label': 'Filter by assignee' }) as HTMLSelectElement;
        byAssignee.append(el('option', { value: '' }, 'Everyone'));
        const byIcon = el('select', { 'aria-label': 'Filter by icon' }) as HTMLSelectElement;
        byIcon.append(el('option', { value: '' }, 'Any icon'));
        const byState = el('select', { 'aria-label': 'Filter by task state' }) as HTMLSelectElement;
        byState.append(el('option', { value: '' }, 'Any state'));
        let matches: string[] = [];
        let at = 0;
        const run = () => {
          const q = field.value.toLowerCase();
          matches = q === '' ? [] : visibleOrder(store).filter((t) => t.title.toLowerCase().includes(q) || t.note.toLowerCase().includes(q)).map((t) => t.id);
          at = 0;
          count.textContent = matches.length === 0 ? 'No matches' : `${1} of ${matches.length}`;
          for (const t of order()) {
            const eln = parts.topicsEl.querySelector(`[data-topic-id="${t.id}"]`);
            if (eln) {
              if (q !== '' && !matches.includes(t.id)) eln.setAttribute('data-dim', 'true');
              else eln.removeAttribute('data-dim');
            }
          }
          if (matches.length > 0) focusTopic(matches[0]);
        };
        field.addEventListener('input', run);
        next.addEventListener('click', () => { if (matches.length === 0) return; at = (at + 1) % matches.length; focusTopic(matches[at]); count.textContent = `${at + 1} of ${matches.length}`; });
        prev.addEventListener('click', () => { if (matches.length === 0) return; at = (at - 1 + matches.length) % matches.length; focusTopic(matches[at]); count.textContent = `${at + 1} of ${matches.length}`; });
        replaceAll.addEventListener('click', () => {
          const ops: Operation[] = [];
          for (const id of matches) {
            const t = store.state.topics.get(id);
            if (!t) continue;
            const newTitle = t.title.toLowerCase().split(field.value.toLowerCase()).join(replace.value);
            if (newTitle !== t.title) ops.push({ op_id: newOpId(), kind: 'title', topic_id: id, offset: 0, delete: [...t.title].length, insert: newTitle });
          }
          if (ops.length > 0) {
            void store.send(ops);
            store.announce(`Replaced ${ops.length}. Skipped 0 locked.`);
          }
        });
        search.append(field, replace, count, next, prev, replaceAll, byAssignee, byIcon, byState);
        body.appendChild(search);
        field.focus();
        field.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); focusTopic(focusedId); } });
      },
    });
  };

  const focusBranch = (): void => {
    const url = new URL(location.href);
    url.searchParams.set('focus', focusedId);
    history.pushState({}, '', url);
    repaint();
  };

  const openCrossLink = (): void => {
    openDialog({
      label: 'Add cross-link',
      build(body, close) {
        body.appendChild(el('h2', {}, 'Add cross-link'));
        const toLabel = el('label', {}, 'Link to');
        const to = el('select', { 'aria-label': 'Link to' }) as HTMLSelectElement;
        for (const t of visibleOrder(store)) if (t.id !== focusedId) to.append(el('option', { value: t.id }, t.title));
        const label = el('label', {}, 'Label');
        const labelField = el('input', { 'aria-label': 'Label' }) as HTMLInputElement;
        const typeGroup = el('div', { role: 'radiogroup', 'aria-label': 'Type' });
        const related = el('input', { type: 'radio', name: 'linktype', id: 'linktype-related', checked: '', role: 'radio', 'aria-label': 'Related' }) as HTMLInputElement;
        const depends = el('input', { type: 'radio', name: 'linktype', id: 'linktype-depends', role: 'radio', 'aria-label': 'Depends on' }) as HTMLInputElement;
        typeGroup.append(related, el('label', { for: 'linktype-related' }, 'Related'), depends, el('label', { for: 'linktype-depends' }, 'Depends on'));
        const add = el('button', { class: 'primary', 'aria-label': 'Add link' }, 'Add link');
        add.addEventListener('click', async () => {
          void store.send([{
            op_id: newOpId(), kind: 'link_add',
            link_id: `l-${crypto.randomUUID().slice(0, 8)}`,
            from: focusedId, to: to.value, label: labelField.value,
            type: depends.checked ? 'depends' : 'related',
          }]);
          close();
        });
        body.append(toLabel, to, label, labelField, typeGroup, add);
      },
    });
  };

  historyBtn.addEventListener('click', () => {
    openDialog({
      label: 'History',
      opener: historyBtn,
      async build(body) {
        body.appendChild(el('h2', {}, 'History'));
        const res = await api<{ versions: { id: string; number: number; name: string; by: string }[] }>(`/api/maps/${mapId}/versions`);
        const versions = res.ok ? (res.body as { versions: { id: string; number: number; name: string; by: string }[] }).versions : [];
        const slider = el('input', { type: 'range', min: '1', max: String(Math.max(1, versions.length)), value: String(Math.max(1, versions.length)), 'aria-label': 'Version playback' }) as HTMLInputElement;
        const valueText = el('p', {}, '');
        const update = () => {
          const v = versions[Number(slider.value) - 1];
          valueText.textContent = v ? `Version ${v.number} of ${versions.length} by ${v.by}` : '';
        };
        slider.addEventListener('input', update);
        update();
        const view = el('button', { class: 'primary', 'aria-label': 'View version' }, 'View version');
        view.addEventListener('click', () => {
          const v = versions[Number(slider.value) - 1];
          if (v) location.href = `/m/${mapId}/versions/${v.id}`;
        });
        body.append(slider, valueText, view);
      },
    });
  });

  saveVersionBtn.addEventListener('click', async () => {
    const name = `Version ${new Date().toISOString().slice(0, 10)}`;
    const res = await api<{ version: { number: number } }>(`/api/maps/${mapId}/versions`, 'POST', { name });
    if (res.ok) store.announce(`Saved version ${(res.body as { version: { number: number } }).version.number}.`);
    else store.announce(errorOf(res).message);
  });

  activityBtn.addEventListener('click', async () => {
    activityPanel.hidden = !activityPanel.hidden;
    detailsPanel.hidden = true;
    if (activityPanel.hidden) return;
    const res = await api<{ entries: { seq: number; user: string; sentence: string; topic_id: string | null }[] }>(`/api/maps/${mapId}/activity`);
    const entries = res.ok ? (res.body as { entries: { seq: number; user: string; sentence: string; topic_id: string | null }[] }).entries : [];
    activityPanel.replaceChildren(el('h2', {}, 'Activity'));
    const filter = el('select', { 'aria-label': 'Person' }) as HTMLSelectElement;
    filter.append(el('option', { value: '' }, 'Everyone'));
    const names = [...new Set(entries.map((e) => e.user))];
    for (const n of names) filter.append(el('option', { value: n }, n));
    const rows = el('div', {});
    const draw = () => {
      rows.replaceChildren();
      for (const e of entries) {
        if (filter.value !== '' && e.user !== filter.value) continue;
        const btn = el('button', { class: 'textlink' }, e.sentence);
        btn.addEventListener('click', () => {
          if (e.topic_id && store.state.topics.has(e.topic_id)) focusTopic(e.topic_id!);
          else store.announce('That topic no longer exists.');
        });
        rows.appendChild(btn);
      }
    };
    filter.addEventListener('change', draw);
    activityPanel.append(filter, rows);
    draw();
  });

  shareBtn.addEventListener('click', () => {
    void import('./share-dialog.js').then(({ openShareDialog }) => openShareDialog(store, mapId, shareBtn));
  });

  importBtn.addEventListener('click', () => {
    void import('./import-export.js').then(({ openImportDialog }) => openImportDialog(store, mapId, importBtn, focusedId));
  });

  exportBtn.addEventListener('click', () => {
    void import('./import-export.js').then(({ openExportDialog }) => openExportDialog(store, mapId, exportBtn));
  });

  presentBtn.addEventListener('click', () => {
    void import('./presenter.js').then(({ openPresenter }) => openPresenter(store, mapId, presentBtn, focusedId));
  });

  undoBtn.addEventListener('click', () => void store.undo());
  redoBtn.addEventListener('click', () => void store.redo());
  offlineSwitch.addEventListener('change', () => store.setOffline(offlineSwitch.checked));
  inboxBtn.addEventListener('click', () => {
    void import('./inbox.js').then(({ openInbox }) => openInbox(inboxBtn));
  });

  // Recovered edits band.
  const recoveredBand = el('div', { class: 'recovered-band', role: 'region', 'aria-label': 'Recovered edits', hidden: '' });
  canvasRegion.appendChild(recoveredBand);
  const renderRecovered = () => {
    const entries = store.state.recovered;
    recoveredBand.hidden = entries.length === 0;
    if (entries.length === 0) { recoveredBand.replaceChildren(); return; }
    recoveredBand.replaceChildren();
    for (const e of entries) {
      recoveredBand.appendChild(el('span', {}, e.text));
      const reapply = el('button', { class: 'textlink', 'aria-label': 'Re-apply' }, 'Re-apply');
      reapply.addEventListener('click', async () => {
        const res = await api(`/api/maps/${mapId}/recovered/${e.id}/reapply`, 'POST');
        if (!res.ok) store.announce(errorOf(res).message);
        await store.refreshLocal();
      });
      const dismiss = el('button', { class: 'textlink', 'aria-label': 'Dismiss' }, 'Dismiss');
      dismiss.addEventListener('click', async () => {
        await api(`/api/maps/${mapId}/recovered/${e.id}`, 'DELETE');
        await store.refreshLocal();
      });
      recoveredBand.append(reapply, dismiss);
    }
  };
  store.subscribe(renderRecovered);
  renderRecovered();

  // Deep link: topic= selects and brings it into view.
  const deep = query.get('topic');
  if (deep && store.state.topics.has(deep)) focusTopic(deep);
  const focusParam = query.get('focus');
  if (focusParam) { /* only the focused branch is shown */ }

  store.connect();
  void animate;
  void treeLabel;
}

function isDesk(): boolean {
  return window.innerWidth >= 1280;
}

function branchColour(index: number): string {
  const list = ['#4f46e5', '#0284c7', '#0d9488', '#16a34a', '#7c3aed', '#c026d3', '#ea580c', '#d9a441'];
  return list[index % 8];
}
