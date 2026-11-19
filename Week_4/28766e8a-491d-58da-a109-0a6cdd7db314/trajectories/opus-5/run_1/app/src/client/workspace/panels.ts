import { copy, versionListText } from '../../shared/copy.js';
import {
  LIMITS,
  type Layer,
  type Page,
  findShape,
  layersTopFirst,
  pagesInOrder,
  shapeLabel,
  visibleShapes,
} from '../../shared/document.js';
import { buildOutline, type OutlineItem } from '../../shared/outline.js';
import { routePage } from '../../shared/router.js';
import { announce } from '../announcer.js';
import { h, initialsOf, setExpanded, setPressed } from '../dom.js';
import { icon } from '../icons.js';
import type { Actions } from './actions.js';
import {
  type WorkspaceState,
  canEditNow,
  currentPage,
  selectedShapes,
  selectionBox,
  shownDocument,
} from './store.js';

export function topBar(state: WorkspaceState, actions: Actions): HTMLElement {
  const title = h('h1', { class: 'diagram-title' }, state.document.title);
  const avatars = state.presence.map((person) =>
    h(
      'button',
      {
        class: 'avatar',
        type: 'button',
        'aria-label': `${person.name}, ${person.role === 'viewer' ? 'viewing' : 'editing'}`,
        title: person.name,
      },
      initialsOf(person.name),
    ),
  );
  const ready = state.exports.filter((record) => record.status === 'ready');
  const latest = ready[0];
  const controls: HTMLElement[] = [];
  if (state.role === 'owner') {
    const share = h('button', { class: 'bar-button', type: 'button' }, icon('share'), 'Share');
    share.addEventListener('click', () => actions.openShare(share));
    controls.push(share);
  }
  if (canEditNow(state)) {
    const exportButton = h('button', { class: 'bar-button', type: 'button' }, icon('image'), 'Export');
    exportButton.addEventListener('click', () => actions.openExport(exportButton));
    controls.push(exportButton);
  }
  const outline = h('button', { class: 'bar-button', type: 'button' }, icon('list'), 'Outline');
  outline.addEventListener('click', () => actions.toggleOutline(undefined, outline));
  setExpanded(outline, state.outlineOpen);
  controls.push(outline);
  if (latest) {
    controls.push(
      h(
        'a',
        { class: 'bar-link', href: `/api/exports/${latest.id}/file`, download: '' },
        icon('download'),
        'Download latest export',
      ),
    );
  }
  return h(
    'header',
    { class: 'top-bar' },
    title,
    h('div', { class: 'presence' }, ...avatars),
    h('div', { class: 'bar-controls' }, ...controls),
  );
}

export function bannerRow(state: WorkspaceState): HTMLElement {
  const banners: HTMLElement[] = [];
  if (state.role === 'viewer') {
    banners.push(h('p', { class: 'banner view-only' }, copy.viewOnlyBanner(state.ownerName)));
  }
  if (state.preview) {
    banners.push(
      h('p', { class: 'banner preview' }, copy.previewBanner(state.preview.version.displayName)),
    );
  }
  if (state.exportPaused) {
    banners.push(h('p', { class: 'banner paused' }, copy.exportPausedBanner));
  }
  const connection = h('div', { class: 'banner-connection', role: 'status', 'aria-label': 'Connection' });
  if (state.connection === 'offline') {
    connection.appendChild(h('p', { class: 'banner offline' }, copy.offlineBanner(state.queue.length)));
  } else if (state.connection === 'ended') {
    connection.appendChild(
      h('p', { class: 'banner ended' }, copy.sessionEndedBanner(state.queue.length)),
    );
  } else if (state.savedBanner) {
    connection.appendChild(h('p', { class: 'banner saved' }, copy.savedBanner));
  }
  return h('div', { class: 'banner-row' }, ...banners, connection);
}

export function toolbar(state: WorkspaceState, actions: Actions): HTMLElement {
  const buttons: HTMLElement[] = [];
  for (const [kind, label, name] of [
    ['rectangle', 'Rectangle', 'square'],
    ['ellipse', 'Ellipse', 'circle'],
    ['diamond', 'Diamond', 'diamond'],
    ['text', 'Text', 'type'],
  ] as const) {
    const button = h('button', { class: 'tool', type: 'button' }, icon(name), label);
    button.addEventListener('click', () => actions.insertShape(kind));
    buttons.push(button);
  }
  const snap = h('button', { class: 'tool', type: 'button' }, icon('grid'), 'Snap to grid');
  setPressed(snap, state.snapToGrid);
  snap.addEventListener('click', () => actions.toggleSnap());

  const align = h('button', { class: 'tool', type: 'button', 'aria-haspopup': 'menu' }, icon('align-left'), 'Align');
  align.addEventListener('click', () => actions.openAlignMenu(align));

  const undo = h('button', { class: 'tool', type: 'button' }, icon('undo'), 'Undo');
  undo.addEventListener('click', () => actions.undo());
  const redo = h('button', { class: 'tool', type: 'button' }, icon('redo'), 'Redo');
  redo.addEventListener('click', () => actions.redo());

  return h(
    'div',
    { class: 'toolbar', role: 'toolbar', 'aria-label': 'Tools' },
    ...buttons,
    snap,
    align,
    undo,
    redo,
  );
}

export function viewControls(state: WorkspaceState, actions: Actions): HTMLElement {
  const out = h('button', { class: 'view-button', type: 'button', 'aria-label': 'Zoom out' }, icon('zoom-out'));
  out.addEventListener('click', () => actions.zoomStep(-1));
  const readout = h(
    'span',
    { id: 'zoom-readout', role: 'status', 'aria-label': 'Zoom', class: 'mono' },
    `${state.zoom}%`,
  );
  const into = h('button', { class: 'view-button', type: 'button', 'aria-label': 'Zoom in' }, icon('zoom-in'));
  into.addEventListener('click', () => actions.zoomStep(1));
  const reset = h('button', { class: 'view-button', type: 'button', 'aria-label': 'Reset zoom' }, icon('maximize'));
  reset.addEventListener('click', () => actions.resetZoom());

  const layers = h(
    'button',
    { class: 'view-button layers-toggle', type: 'button', 'aria-label': 'Layers' },
    icon('layers'),
  );
  setExpanded(layers, state.leftRailOpen);
  layers.addEventListener('click', () => actions.toggleLeftRail());

  const inspector = h(
    'button',
    { class: 'view-button inspector-toggle', type: 'button', 'aria-label': 'Toggle inspector' },
    icon('panel'),
  );
  setExpanded(inspector, state.inspectorOpen);
  inspector.addEventListener('click', () => actions.toggleInspector());

  return h(
    'div',
    { class: 'view-controls', role: 'group', 'aria-label': 'View' },
    out,
    readout,
    into,
    reset,
    layers,
    inspector,
  );
}

function renameOnF2(item: HTMLElement, current: string, commit: (name: string) => void): void {
  item.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key !== 'F2') return;
    event.preventDefault();
    const field = h('input', { class: 'rename', type: 'text', value: current, 'aria-label': 'Name' });
    item.replaceChildren(field);
    field.focus();
    field.select();
    const finish = (save: boolean): void => {
      const value = field.value;
      item.focus();
      if (save && value.trim().length > 0) commit(value);
      else commit(current);
    };
    field.addEventListener('keydown', (inner) => {
      if (inner.key === 'Enter') {
        inner.preventDefault();
        inner.stopPropagation();
        finish(true);
      } else if (inner.key === 'Escape') {
        inner.preventDefault();
        inner.stopPropagation();
        finish(false);
      }
    });
    field.addEventListener('blur', () => finish(true));
  });
}

export function pagesRegion(state: WorkspaceState, actions: Actions): HTMLElement {
  const doc = shownDocument(state);
  const pages = pagesInOrder(doc);
  const list = h('ul', { class: 'rail-list', role: 'list' });
  for (const page of pages) {
    const item = h(
      'button',
      {
        class: 'rail-item',
        type: 'button',
        'aria-current': page.id === state.pageId ? 'page' : null,
        'data-page': page.id,
        'data-focus-key': `page-item-${page.id}`,
      },
      page.name,
    );
    item.addEventListener('click', () => actions.openPage(page.id));
    item.addEventListener('keydown', (event) => {
      const key = (event as KeyboardEvent).key;
      if (event.altKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
        event.preventDefault();
        actions.reorderPage(page.id, key === 'ArrowUp' ? 'up' : 'down');
      } else if (key === 'Delete' && pages.length > 1) {
        event.preventDefault();
        actions.openDeletePage(page.id, item);
      }
    });
    renameOnF2(item, page.name, (name) => actions.renamePage(page.id, name));
    list.appendChild(h('li', {}, item));
  }
  const children: HTMLElement[] = [h('h2', { class: 'rail-heading' }, 'Pages'), list];
  if (canEditNow(state) && doc.pages.length < LIMITS.pagesPerDiagram) {
    const add = h('button', { class: 'rail-add', type: 'button' }, icon('plus'), 'Add page');
    add.addEventListener('click', () => actions.addPage());
    children.push(add);
  }
  return h('section', { class: 'rail-region', role: 'region', 'aria-label': 'Pages' }, ...children);
}

function layerRow(state: WorkspaceState, actions: Actions, page: Page, layer: Layer): HTMLElement {
  const count = page.shapes.filter((shape) => shape.layer === layer.id).length;
  const name = h('span', { class: 'rail-item-name' }, layer.name);
  const item = h(
    'div',
    {
      class: 'rail-item layer-item',
      tabindex: '0',
      'data-layer': layer.id,
      'data-focus-key': `layer-item-${layer.id}`,
    },
    name,
  );
  item.addEventListener('keydown', (event) => {
    const key = (event as KeyboardEvent).key;
    if (event.altKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
      event.preventDefault();
      actions.reorderLayer(layer.id, key === 'ArrowUp' ? 'up' : 'down');
    }
  });
  renameOnF2(item, layer.name, (next) => actions.renameLayer(layer.id, next));
  const row = h('li', { class: 'layer-row' }, item, h('span', { class: 'mono rail-count' }, String(count)));
  if (canEditNow(state)) {
    const hide = h('button', {
      class: 'rail-toggle',
      type: 'button',
      'aria-label': layer.visible ? `Hide layer ${layer.name}` : `Show layer ${layer.name}`,
    });
    hide.appendChild(icon(layer.visible ? 'eye' : 'eye-off'));
    setPressed(hide, !layer.visible);
    hide.addEventListener('click', () => actions.setLayerFlag(layer.id, 'visible', !layer.visible));
    const lock = h('button', {
      class: 'rail-toggle',
      type: 'button',
      'aria-label': layer.locked ? `Unlock layer ${layer.name}` : `Lock layer ${layer.name}`,
    });
    lock.appendChild(icon(layer.locked ? 'lock' : 'unlock'));
    setPressed(lock, layer.locked);
    lock.addEventListener('click', () => actions.setLayerFlag(layer.id, 'locked', !layer.locked));
    row.append(hide, lock);
  }
  return row;
}

export function layersRegion(state: WorkspaceState, actions: Actions): HTMLElement {
  const page = currentPage(state);
  const list = h('ul', { class: 'rail-list', role: 'list' });
  for (const layer of layersTopFirst(page)) list.appendChild(layerRow(state, actions, page, layer));
  const children: HTMLElement[] = [h('h2', { class: 'rail-heading' }, 'Layers'), list];
  if (canEditNow(state) && page.layers.length < LIMITS.layersPerPage) {
    const add = h('button', { class: 'rail-add', type: 'button' }, icon('plus'), 'Add layer');
    add.addEventListener('click', () => actions.addLayer());
    children.push(add);
  }
  return h('section', { class: 'rail-region', role: 'region', 'aria-label': 'Layers' }, ...children);
}

export function pageStrip(state: WorkspaceState, actions: Actions): HTMLElement {
  const doc = shownDocument(state);
  const pages = pagesInOrder(doc);
  const index = pages.findIndex((page) => page.id === state.pageId);
  const page = pages[index] ?? pages[0];
  const previous = h(
    'button',
    { class: 'strip-button', type: 'button', 'aria-label': 'Previous page' },
    icon('chevronLeft'),
  );
  previous.addEventListener('click', () => actions.nextPage(-1));
  const next = h(
    'button',
    { class: 'strip-button', type: 'button', 'aria-label': 'Next page' },
    icon('chevronRight'),
  );
  next.addEventListener('click', () => actions.nextPage(1));
  const strip = h(
    'div',
    { id: 'page-strip' },
    previous,
    h(
      'span',
      { class: 'strip-label' },
      `${page?.name ?? ''} · `,
      h('span', { class: 'mono' }, `${index + 1} of ${pages.length}`),
    ),
    next,
  );
  attachSwipe(strip, actions);
  return strip;
}

const SWIPE_DISTANCE = 40;

/** A horizontal swipe on the page strip switches page: left opens the next, right the previous. */
function attachSwipe(strip: HTMLElement, actions: Actions): void {
  let start: { x: number; y: number } | null = null;
  strip.addEventListener('pointerdown', (event) => {
    start = { x: event.clientX, y: event.clientY };
  });
  strip.addEventListener('pointerup', (event) => {
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    start = null;
    if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) <= Math.abs(dy)) return;
    actions.nextPage(dx < 0 ? 1 : -1);
  });
  strip.addEventListener('pointercancel', () => {
    start = null;
  });
}

/**
 * An inspector number field. An out-of-range or non-whole value is refused in place with
 * the range message and nothing is sent; the draft stays until Escape clears it.
 */
function numberField(
  label: string,
  value: number | '',
  readOnly: boolean,
  min: number,
  max: number,
  commit: (value: number) => void,
): HTMLElement {
  const message = copy.rangeMessage(min, max);
  const input = h('input', {
    class: 'mono field-input',
    type: 'number',
    role: 'spinbutton',
    'aria-label': label,
    value: value === '' ? '' : String(value),
    readonly: readOnly,
    'data-field': label,
    step: '1',
  });
  const error = h('p', { class: 'field-error', hidden: true }, message);
  const refuse = (): void => {
    input.setAttribute('aria-invalid', 'true');
    error.hidden = false;
    announce(message);
  };
  const accept = (): void => {
    input.removeAttribute('aria-invalid');
    error.hidden = true;
  };
  const tryCommit = (): void => {
    const raw = input.value.trim();
    const next = Number(raw);
    if (raw.length === 0 || !Number.isInteger(next) || next < min || next > max) {
      refuse();
      return;
    }
    accept();
    delete input.dataset['draft'];
    commit(next);
  };
  input.addEventListener('input', () => {
    input.dataset['draft'] = 'true';
  });
  input.addEventListener('keydown', (event) => {
    const key = (event as KeyboardEvent).key;
    if (key === 'Enter') {
      event.preventDefault();
      tryCommit();
    } else if (key === 'Escape') {
      event.preventDefault();
      accept();
      delete input.dataset['draft'];
      input.value = value === '' ? '' : String(value);
    }
  });
  input.addEventListener('blur', () => {
    if (input.dataset['draft'] === 'true') tryCommit();
  });
  return h('div', { class: 'field' }, h('label', { class: 'field-label' }, label, input), error);
}

export function inspectorPanel(state: WorkspaceState, actions: Actions): HTMLElement {
  const page = currentPage(state);
  const shapes = selectedShapes(state);
  const box = selectionBox(state);
  const readOnly = !canEditNow(state);
  const multi = shapes.length > 1;
  const single = shapes.length === 1 ? shapes[0] : undefined;
  const heading = h(
    'h2',
    { id: 'inspector-heading' },
    shapes.length === 0
      ? 'Nothing selected'
      : single
        ? shapeLabel(single)
        : `${shapes.length} selected`,
  );
  const fields = h(
    'div',
    { class: 'fields' },
    numberField('X', box?.x ?? '', readOnly, LIMITS.coordMin, LIMITS.coordMax, (value) =>
      actions.commitInspector('x', value),
    ),
    numberField('Y', box?.y ?? '', readOnly, LIMITS.coordMin, LIMITS.coordMax, (value) =>
      actions.commitInspector('y', value),
    ),
    numberField('Width', box?.w ?? '', readOnly || multi, LIMITS.sizeMin, LIMITS.sizeMax, (value) =>
      actions.commitInspector('w', value),
    ),
    numberField('Height', box?.h ?? '', readOnly || multi, LIMITS.sizeMin, LIMITS.sizeMax, (value) =>
      actions.commitInspector('h', value),
    ),
  );
  const labelField = h('input', {
    class: 'field-input',
    type: 'text',
    role: 'textbox',
    'aria-label': 'Label',
    value: single?.label ?? '',
    readonly: readOnly || multi,
  });
  labelField.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key !== 'Enter' || !single) return;
    event.preventDefault();
    actions.commitLabel(single.id, labelField.value);
  });
  const layerSelect = h('select', { class: 'field-input', 'aria-label': 'Layer', disabled: readOnly || shapes.length === 0 });
  for (const layer of layersTopFirst(page)) {
    layerSelect.appendChild(
      h('option', { value: layer.id, selected: single?.layer === layer.id }, layer.name),
    );
  }
  layerSelect.addEventListener('change', () => actions.moveSelectionToLayer(layerSelect.value));
  return h(
    'div',
    { class: 'inspector-panel' },
    heading,
    fields,
    h('div', { class: 'field' }, h('label', { class: 'field-label' }, 'Label', labelField)),
    h('div', { class: 'field' }, h('label', { class: 'field-label' }, 'Layer', layerSelect)),
  );
}

export function commentsPanel(state: WorkspaceState, actions: Actions): HTMLElement {
  const page = currentPage(state);
  const target = state.commentTarget ?? state.selection[0] ?? null;
  const open = state.comments.filter((comment) => comment.parent === null && !comment.resolved);
  const resolved = state.comments.filter((comment) => comment.parent === null && comment.resolved);
  const threads = h('ul', { class: 'thread-list', role: 'list' });
  for (const thread of open) {
    const shape = findShape(page, thread.shape);
    const replies = state.comments.filter((comment) => comment.parent === thread.id);
    const resolve = h('button', { class: 'thread-button', type: 'button' }, 'Resolve');
    resolve.addEventListener('click', () => actions.resolveThread(thread.id));
    const reply = h('button', { class: 'thread-button', type: 'button' }, 'Reply');
    reply.addEventListener('click', () => actions.postComment(thread.shape, '', thread.id));
    threads.appendChild(
      h(
        'li',
        { class: 'thread', 'data-comment': thread.id },
        h('p', { class: 'thread-shape' }, shape ? shapeLabel(shape) : ''),
        h('p', { class: 'thread-author' }, thread.author.name),
        h('p', { class: 'thread-text' }, thread.text),
        ...replies.map((item) => h('p', { class: 'thread-reply' }, `${item.author.name}: ${item.text}`)),
        h('div', { class: 'thread-actions' }, reply, resolve),
      ),
    );
  }
  const composer = h('textarea', {
    class: 'field-input composer',
    role: 'textbox',
    'aria-label': 'Comment',
    rows: '3',
  });
  const post = h('button', { class: 'thread-button', type: 'button' }, 'Post comment');
  post.addEventListener('click', () => {
    const text = composer.value.trim();
    if (text.length === 0 || target === null) return;
    actions.postComment(target, text, null);
    composer.value = '';
  });
  return h(
    'div',
    { class: 'comments-panel' },
    threads,
    h('div', { class: 'composer-row' }, composer, post),
    h('h3', {}, `Resolved (${resolved.length})`),
    h(
      'ul',
      { class: 'thread-list resolved', role: 'list' },
      ...resolved.map((thread) => h('li', { class: 'thread' }, h('p', { class: 'thread-text' }, thread.text))),
    ),
  );
}

export function historyPanel(state: WorkspaceState, actions: Actions): HTMLElement {
  const save = h('button', { class: 'thread-button', type: 'button' }, 'Save version');
  save.addEventListener('click', () => actions.openSaveVersion(save));
  const list = h('ul', { class: 'version-list', role: 'list' });
  for (const version of state.versions) {
    const link = h(
      'a',
      {
        class: 'version-link',
        href: `/d/${state.diagramId}?page=${state.pageId}&version=${version.id}`,
        'data-version': version.id,
      },
      versionListText(version.displayName, version.author.name, version.createdAt),
    );
    link.addEventListener('click', (event) => {
      event.preventDefault();
      actions.previewVersion(version.id);
    });
    list.appendChild(h('li', {}, link));
  }
  const children: HTMLElement[] = [save, list];
  if (state.preview) {
    if (state.role === 'owner') {
      const restore = h('button', { class: 'thread-button', type: 'button' }, 'Restore this version');
      restore.addEventListener('click', () => {
        if (state.preview) actions.restoreVersion(state.preview.version.id);
      });
      children.push(restore);
    }
    const back = h('button', { class: 'thread-button', type: 'button' }, 'Back to latest');
    back.addEventListener('click', () => actions.backToLatest());
    children.push(back);
  }
  return h('div', { class: 'history-panel' }, ...children);
}

export function inspectorRail(state: WorkspaceState, actions: Actions): HTMLElement {
  const tabs = h('div', { role: 'tablist', class: 'tablist', 'aria-label': 'Inspector tabs' });
  for (const [id, label] of [
    ['inspector', 'Inspector'],
    ['comments', 'Comments'],
    ['history', 'History'],
  ] as const) {
    const tab = h(
      'button',
      {
        class: 'tab',
        type: 'button',
        role: 'tab',
        'aria-selected': state.inspectorTab === id ? 'true' : 'false',
        tabindex: state.inspectorTab === id ? '0' : '-1',
      },
      label,
    );
    tab.addEventListener('click', () => actions.setInspectorTab(id));
    tabs.appendChild(tab);
  }
  const body =
    state.inspectorTab === 'comments'
      ? commentsPanel(state, actions)
      : state.inspectorTab === 'history'
        ? historyPanel(state, actions)
        : inspectorPanel(state, actions);
  return h('aside', { id: 'inspector-rail' }, tabs, h('div', { class: 'rail-body', role: 'tabpanel' }, body));
}

function outlineRow(
  state: WorkspaceState,
  actions: Actions,
  item: OutlineItem,
  level: number,
  expanded: Set<string>,
  rows: HTMLElement[],
): void {
  const open = expanded.has(item.id);
  const row = h(
    'div',
    {
      class: 'tree-item',
      role: 'treeitem',
      'aria-level': String(level),
      'aria-expanded': item.expandable ? (open ? 'true' : 'false') : null,
      'aria-label': item.text,
      tabindex: '-1',
      'data-outline': item.id,
    },
    item.text,
  );
  row.addEventListener('keydown', (event) => {
    const key = (event as KeyboardEvent).key;
    if (key === 'Enter' && item.shape !== undefined) {
      event.preventDefault();
      actions.openPage(item.page);
      actions.select([item.shape]);
      actions.focusShape(item.shape);
      actions.toggleOutline(false);
    } else if (key === 'ArrowRight' && item.expandable && !open) {
      event.preventDefault();
      expanded.add(item.id);
      actions.render();
    } else if (key === 'ArrowLeft' && item.expandable && open) {
      event.preventDefault();
      expanded.delete(item.id);
      actions.render();
    }
  });
  rows.push(row);
  if (open) {
    for (const child of item.children) outlineRow(state, actions, child, level + 1, expanded, rows);
  }
}

export function outlinePanel(
  state: WorkspaceState,
  actions: Actions,
  expanded: Set<string>,
): HTMLElement {
  const doc = shownDocument(state);
  const routed = new Map(doc.pages.map((page) => [page.id, routePage(page)]));
  const items = buildOutline(doc, routed);
  const rows: HTMLElement[] = [];
  for (const item of items) outlineRow(state, actions, item, 1, expanded, rows);
  const tree = h('div', { role: 'tree', 'aria-label': 'Diagram outline', class: 'tree' }, ...rows);
  tree.addEventListener('keydown', (event) => {
    const key = (event as KeyboardEvent).key;
    const visible = [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    const index = visible.findIndex((row) => row === document.activeElement);
    let next = -1;
    if (key === 'ArrowDown') next = Math.min(visible.length - 1, index + 1);
    else if (key === 'ArrowUp') next = Math.max(0, index - 1);
    else if (key === 'Home') next = 0;
    else if (key === 'End') next = visible.length - 1;
    if (next < 0) return;
    event.preventDefault();
    visible[next]?.focus();
  });
  return h('div', { class: 'outline-panel' }, h('h2', {}, 'Outline'), tree);
}

export function emptyPageMessage(state: WorkspaceState): HTMLElement | null {
  const page = currentPage(state);
  if (visibleShapes(page).length > 0) return null;
  return h('p', { class: 'empty-page' }, copy.emptyPageText);
}

export function bottomToolbar(state: WorkspaceState, actions: Actions): HTMLElement {
  const buttons: HTMLElement[] = [];
  for (const [sheet, label, name] of [
    ['layers', 'Layers', 'layers'],
    ['inspector', 'Inspector', 'panel'],
    ['comments', 'Comments', 'message'],
    ['history', 'History', 'history'],
  ] as const) {
    const button = h('button', { class: 'bottom-button', type: 'button', 'aria-label': label }, icon(name));
    button.addEventListener('click', () => actions.openSheet(sheet, button));
    buttons.push(button);
  }
  const shapeActions = h(
    'button',
    { class: 'bottom-button', type: 'button', 'aria-label': 'Shape actions' },
    icon('more-horizontal'),
  );
  shapeActions.addEventListener('click', () => {
    const rect = shapeActions.getBoundingClientRect();
    actions.openShapeActions({ x: rect.left, y: rect.top }, shapeActions);
  });
  buttons.push(shapeActions);
  if (canEditNow(state)) {
    const insert = h(
      'button',
      { class: 'bottom-button', type: 'button', 'aria-label': 'Insert', 'aria-haspopup': 'menu' },
      icon('plus'),
    );
    insert.addEventListener('click', () => actions.openInsertMenu(insert));
    buttons.push(insert);
  }
  return h('nav', { id: 'bottom-toolbar' }, ...buttons);
}
