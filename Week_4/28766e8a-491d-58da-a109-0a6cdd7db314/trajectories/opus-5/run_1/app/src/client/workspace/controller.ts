import { copy } from '../../shared/copy.js';
import {
  DUPLICATE_OFFSET,
  LIMITS,
  type DiagramDocument,
  type Page,
  type Port,
  type Role,
  type Shape,
  type ShapeKind,
  findPage,
  findShape,
  isLayerLocked,
  layersTopFirst,
  pagesInOrder,
  shapeLabel,
  visibleShapes,
} from '../../shared/document.js';
import {
  type AlignSide,
  type Box,
  type DistributeAxis,
  alignOffsets,
  boxOf,
  defaultPortPair,
  distributeOffsets,
  insertionPosition,
  selectionUnits,
} from '../../shared/geometry.js';
import type { Operation, ShapeEntry } from '../../shared/operation.js';
import { api, type ExportRecord, type InviteRecord, type MemberRecord } from '../api.js';
import { announce, announcer } from '../announcer.js';
import { clear, h, mount } from '../dom.js';
import {
  GLIDE_MS,
  PORT_FADE_MS,
  RAIL_MS,
  ReversibleSlide,
  SETTLE_MS,
  animate,
  easeOut,
  formatProgress,
  onEveryFrame,
  reducedMotion,
} from '../motion.js';
import type { Actions, InspectorField } from './actions.js';
import {
  type CanvasElements,
  canvasCentre,
  documentPoint,
  easeRoute,
  pathFor,
  renderCanvas,
  updateDrawnGeometry,
} from './canvas.js';
import {
  closeOpenPanel,
  closeSignInDialog,
  hasOpenPanel,
  openDeletePageDialog,
  openExportDialog,
  openMenu,
  openSaveVersionDialog,
  onPanelClosed,
  openShareDialog,
  openSheetPanel,
  openSignInDialog,
} from './dialogs.js';
import { LiveConnection } from './live.js';
import {
  type DragSession,
  buildDragPreview,
  movedLabel,
  plannedBoxes,
} from './interactions.js';
import {
  bannerRow,
  bottomToolbar,
  commentsPanel,
  emptyPageMessage,
  historyPanel,
  inspectorPanel,
  layersRegion,
  outlinePanel,
  pageStrip,
  pagesRegion,
  toolbar,
  topBar,
  viewControls,
} from './panels.js';
import {
  type WorkspaceState,
  ZOOM_STEPS,
  canEditNow,
  currentPage,
  exportMemory,
  expandGroups,
  focusOrder,
  insertLayer,
  recomputeRoutes,
  rememberExport,
  selectableShapes,
  selectedShapes,
  selectionBox,
  shownDocument,
} from './store.js';

export type Layout = 'wide' | 'medium' | 'narrow';

type Route = readonly (readonly [number, number])[];

interface Glide {
  shapes: Map<string, Box>;
  routes: Map<string, Route>;
  progress: number;
}

interface HelloMessage {
  role: Role;
  ownerName: string;
  document: DiagramDocument;
  presence: { userId: string; name: string; role: Role }[];
  exports: ExportRecord[];
}

/** The workspace screen: one state, one render pass and the commands that change it. */
export class Workspace implements Actions {
  readonly state: WorkspaceState;
  readonly live: LiveConnection;
  canvas: CanvasElements;
  drag: DragSession | null = null;
  /** Pointer and keyboard wiring, attached by the workspace entry point. */
  wireInput: ((workspace: Workspace) => void) | null = null;

  private glide: Glide | null = null;
  private readonly host: HTMLElement;
  private readonly hosts = new Map<string, HTMLElement>();
  private readonly railSlide: ReversibleSlide;
  private readonly outlineExpanded = new Set<string>();
  private readonly settleHandles = new Map<string, { cancel(): void }>();
  private members: { members: MemberRecord[]; invites: InviteRecord[] } = { members: [], invites: [] };
  private mailOutage = false;
  private stopDragLoop: (() => void) | null = null;
  private glideHandle: { cancel(): void } | null = null;
  private cursorHandle: { cancel(): void } | null = null;
  private lastInspectorKey = '';
  /** Keeps an open Export dialog showing the export's current state. */
  private refreshOpenExportDialog: (() => void) | null = null;
  private sessionEndedOpener: HTMLElement | null = null;

  constructor(host: HTMLElement, state: WorkspaceState, private readonly onNotFound: () => void) {
    this.host = host;
    this.state = state;
    this.canvas = renderCanvas(state);
    this.buildShell();
    this.railSlide = new ReversibleSlide(
      RAIL_MS,
      (motion, progress) => this.applyRailMotion(motion, progress),
      state.inspectorOpen,
    );
    onPanelClosed(() => {
      this.refreshOpenExportDialog = null;
    });
    this.live = new LiveConnection(state, {
      onChange: () => this.render(),
      onRemoteChange: (pages) => this.applyRemoteChange(pages),
      onHello: (message) => this.applyHello(message as unknown as HelloMessage),
      onRoleChange: (role) => this.applyRoleChange(role),
      onCommentsChanged: () => void this.refreshComments(),
      onVersionsChanged: () => void this.refreshVersions(),
      onMembersChanged: () => void this.refreshMembers(),
      onExportsChanged: () => void this.refreshExports(),
      onNotFound: () => this.onNotFound(),
      onSessionEnded: () => this.handleSessionEnded(),
      onRestored: (name, version) => announce(copy.restoredNotice(name, version)),
    });
  }

  layout(): Layout {
    if (window.matchMedia('(min-width: 1280px)').matches) return 'wide';
    if (window.matchMedia('(min-width: 768px)').matches) return 'medium';
    return 'narrow';
  }

  start(): void {
    this.live.start();
    this.render();
    void this.refreshComments();
    void this.refreshVersions();
    window.addEventListener('resize', () => this.render());
    window.addEventListener('popstate', () => this.applyAddress());
  }

  private slot(name: string): HTMLElement {
    const existing = this.hosts.get(name);
    if (existing) return existing;
    const created = h('div', { class: `slot-${name}` });
    this.hosts.set(name, created);
    return created;
  }

  private buildShell(): void {
    const rail = h('aside', { id: 'inspector-rail' }, this.slot('tabs'), this.slot('inspectorBody'));
    this.hosts.set('inspectorRail', rail);
    const canvasPane = h(
      'div',
      { class: 'canvas-pane' },
      this.slot('toolbar'),
      h(
        'div',
        { class: 'canvas-wrap' },
        this.slot('canvasHost'),
        this.slot('labelLayer'),
        this.slot('viewControls'),
      ),
      this.slot('pageStrip'),
    );
    const leftRail = h('div', { id: 'left-rail' }, this.slot('leftRail'));
    this.hosts.set('leftRailOuter', leftRail);
    mount(
      this.host,
      h(
        'div',
        { class: 'workspace' },
        this.slot('topBar'),
        this.slot('banners'),
        h('div', { class: 'panes' }, leftRail, canvasPane, rail),
        this.slot('bottomToolbar'),
        this.slot('outline'),
        announcer(),
      ),
    );
  }

  private applyRailMotion(motion: string, progress: number): void {
    const rail = this.hosts.get('inspectorRail');
    if (!rail) return;
    rail.setAttribute('data-motion', motion);
    rail.setAttribute('data-progress', formatProgress(progress));
    rail.style.setProperty('--rail-progress', String(progress));
  }

  private captureFocus(): string | null {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) && !(active instanceof SVGElement)) return null;
    if (active.id.length > 0) return `#${CSS.escape(active.id)}`;
    const key = active.getAttribute('data-focus-key');
    if (key !== null) return `[data-focus-key="${CSS.escape(key)}"]`;
    const label = active.getAttribute('aria-label');
    return label === null ? null : `[aria-label="${CSS.escape(label)}"]`;
  }

  private restoreFocus(selector: string | null): void {
    if (selector === null) return;
    if (document.activeElement !== document.body) return;
    this.host.querySelector<HTMLElement>(selector)?.focus();
  }

  render(): void {
    const layout = this.layout();
    const state = this.state;
    if (layout === 'wide') state.leftRailOpen = true;
    const focus = this.captureFocus();
    this.host.firstElementChild?.setAttribute('data-layout', layout);

    mount(this.slot('topBar'), topBar(state, this));
    mount(this.slot('banners'), bannerRow(state));
    if (state.connection === 'ended') {
      const again = h('button', { class: 'bar-button', type: 'button' }, 'Sign in again');
      again.addEventListener('click', () => this.openSessionDialog(again));
      this.slot('banners').querySelector('.banner-connection')?.appendChild(again);
    }

    const leftOuter = this.hosts.get('leftRailOuter');
    if (leftOuter) {
      const show = layout !== 'narrow' && state.leftRailOpen;
      leftOuter.hidden = !show;
      if (show) mount(this.slot('leftRail'), pagesRegion(state, this), layersRegion(state, this));
      else clear(this.slot('leftRail'));
    }

    if (canEditNow(state) && layout !== 'narrow') mount(this.slot('toolbar'), toolbar(state, this));
    else clear(this.slot('toolbar'));

    mount(this.slot('viewControls'), viewControls(state, this));
    mount(this.slot('pageStrip'), pageStrip(state, this));

    const rail = this.hosts.get('inspectorRail');
    if (rail) rail.hidden = layout === 'narrow' || !state.inspectorOpen;
    this.renderInspector();

    if (layout === 'narrow') mount(this.slot('bottomToolbar'), bottomToolbar(state, this));
    else clear(this.slot('bottomToolbar'));

    if (state.outlineOpen) mount(this.slot('outline'), outlinePanel(state, this, this.outlineExpanded));
    else clear(this.slot('outline'));

    this.renderCanvasRegion();
    this.restoreFocus(focus);
  }

  private renderInspector(): void {
    const state = this.state;
    const tabs = this.slot('tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Inspector tabs');
    tabs.className = 'tablist';
    clear(tabs);
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
          'aria-label': label,
          'aria-selected': state.inspectorTab === id ? 'true' : 'false',
          tabindex: state.inspectorTab === id ? '0' : '-1',
        },
        label,
      );
      tab.addEventListener('click', () => this.setInspectorTab(id));
      tabs.appendChild(tab);
    }
    const key = [
      state.inspectorTab,
      state.selection.join(','),
      state.role,
      state.preview === null ? 'live' : 'preview',
      state.comments.length,
      state.versions.length,
      state.commentTarget ?? '',
    ].join('|');
    const draftFocused =
      document.activeElement instanceof HTMLElement &&
      document.activeElement.dataset['draft'] === 'true';
    if (key === this.lastInspectorKey && draftFocused) {
      this.updateInspectorValues();
      return;
    }
    this.lastInspectorKey = key;
    const body =
      state.inspectorTab === 'comments'
        ? commentsPanel(state, this)
        : state.inspectorTab === 'history'
          ? historyPanel(state, this)
          : inspectorPanel(state, this);
    mount(this.slot('inspectorBody'), body);
  }

  /** X, Y, Width and Height follow every frame, keeping a focused field's draft. */
  updateInspectorValues(): void {
    const box = this.dragBox() ?? selectionBox(this.state);
    const values: Record<string, number | null> = {
      X: box ? Math.round(box.x) : null,
      Y: box ? Math.round(box.y) : null,
      Width: box ? Math.round(box.w) : null,
      Height: box ? Math.round(box.h) : null,
    };
    for (const [label, value] of Object.entries(values)) {
      const field = this.host.querySelector<HTMLInputElement>(`input[data-field="${label}"]`);
      if (!field) continue;
      if (document.activeElement === field && field.dataset['draft'] === 'true') continue;
      field.value = value === null ? '' : String(value);
    }
  }

  private dragBox(): Box | null {
    if (!this.drag) return null;
    const list = [...plannedBoxes(this.state, this.drag).values()];
    if (list.length === 0) return null;
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    for (const box of list) {
      x1 = Math.min(x1, box.x);
      y1 = Math.min(y1, box.y);
      x2 = Math.max(x2, box.x + box.w);
      y2 = Math.max(y2, box.y + box.h);
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  renderCanvasRegion(): void {
    const held = document.activeElement;
    const hadCanvasFocus = held instanceof Element && this.canvas.svg.contains(held);
    this.canvas = renderCanvas(this.state);
    mount(this.slot('canvasHost'), this.canvas.svg, this.canvas.pins, emptyPageMessage(this.state));
    this.applyGlide();
    this.wireInput?.(this);
    if (this.state.focusedShape !== null) {
      this.canvas.shapes.get(this.state.focusedShape)?.setAttribute('tabindex', '0');
    }
    if (hadCanvasFocus) this.restoreShapeFocus();
    for (const pin of this.canvas.pins.querySelectorAll<HTMLButtonElement>('.comment-pin')) {
      pin.addEventListener('click', () => this.openPin(pin.dataset['comment'] ?? ''));
    }
  }

  // --------------------------------------------------------------- live updates

  private applyHello(message: HelloMessage): void {
    const state = this.state;
    state.role = message.role;
    state.ownerName = message.ownerName;
    state.document = message.document;
    state.presence = message.presence.filter((person) => person.userId !== state.me.id);
    state.exports = message.exports;
    if (findPage(state.document, state.pageId) === undefined) {
      state.pageId = pagesInOrder(state.document)[0]?.id ?? state.pageId;
    }
    this.noteExportStates();
    recomputeRoutes(state);
    this.render();
  }

  private applyRoleChange(role: Role): void {
    this.state.role = role;
    if (role === 'viewer') {
      this.state.selection = [];
      announce(copy.roleNotice);
    }
    this.render();
    this.canvas.svg.focus();
  }

  /** Another person's accepted change: the shape glides while the data holds the new values. */
  private applyRemoteChange(pages: readonly string[]): void {
    const page = currentPage(this.state);
    const shapesBefore = new Map<string, Box>();
    for (const [id, node] of this.canvas.shapes) {
      shapesBefore.set(id, {
        x: Number(node.getAttribute('data-x')),
        y: Number(node.getAttribute('data-y')),
        w: Number(node.getAttribute('data-w')),
        h: Number(node.getAttribute('data-h')),
      });
    }
    const routesBefore = new Map<string, Route>();
    for (const [id, parts] of this.canvas.connectors) {
      routesBefore.set(id, parseRoute(parts.group.getAttribute('data-points') ?? ''));
    }
    if (!pages.includes(page.id) || reducedMotion()) {
      this.glide = null;
      this.render();
      return;
    }
    this.glide = { shapes: shapesBefore, routes: routesBefore, progress: 0 };
    this.render();
    this.glideHandle?.cancel();
    this.glideHandle = animate(
      GLIDE_MS,
      (progress) => {
        if (this.glide) this.glide.progress = easeOut(progress);
        this.applyGlide();
      },
      () => {
        this.glide = null;
        this.applyGlide();
      },
    );
  }

  /** During a glide the drawn line catches up while the data already holds the new values. */
  private applyGlide(): void {
    const glide = this.glide;
    if (!glide) {
      updateDrawnGeometry(this.state, this.canvas);
      return;
    }
    const page = currentPage(this.state);
    for (const [id, node] of this.canvas.shapes) {
      const shape = findShape(page, id);
      const from = glide.shapes.get(id);
      if (!shape || !from) continue;
      const to = boxOf(shape);
      this.drawShapeBody(node, shape, {
        x: from.x + (to.x - from.x) * glide.progress,
        y: from.y + (to.y - from.y) * glide.progress,
        w: from.w + (to.w - from.w) * glide.progress,
        h: from.h + (to.h - from.h) * glide.progress,
      });
    }
    for (const [id, parts] of this.canvas.connectors) {
      const connector = page.connectors.find((candidate) => candidate.id === id);
      if (!connector) continue;
      const from = glide.routes.get(id);
      parts.path.setAttribute(
        'd',
        from && from.length === connector.route.length
          ? easeRoute(from, connector.route, glide.progress)
          : pathFor(connector.route),
      );
    }
  }

  private drawShapeBody(node: SVGGElement, shape: Shape, box: Box): void {
    const body = node.querySelector('.shape-body');
    if (body) {
      if (shape.kind === 'ellipse') {
        body.setAttribute('cx', String(box.x + box.w / 2));
        body.setAttribute('cy', String(box.y + box.h / 2));
        body.setAttribute('rx', String(box.w / 2));
        body.setAttribute('ry', String(box.h / 2));
      } else if (shape.kind === 'diamond') {
        body.setAttribute(
          'points',
          `${box.x + box.w / 2},${box.y} ${box.x + box.w},${box.y + box.h / 2} ` +
            `${box.x + box.w / 2},${box.y + box.h} ${box.x},${box.y + box.h / 2}`,
        );
      } else {
        body.setAttribute('x', String(box.x));
        body.setAttribute('y', String(box.y));
        body.setAttribute('width', String(box.w));
        body.setAttribute('height', String(box.h));
      }
    }
    const label = node.querySelector('.shape-label');
    if (label) {
      label.setAttribute('x', String(box.x + box.w / 2));
      label.setAttribute('y', String(box.y + box.h / 2));
    }
  }

  /** Remote cursors glide to each new position over 240 milliseconds. */
  glideCursors(): void {
    if (reducedMotion()) {
      for (const cursor of this.state.cursors.values()) {
        cursor.drawnX = cursor.x;
        cursor.drawnY = cursor.y;
      }
      this.paintCursors();
      return;
    }
    const starts = new Map(
      [...this.state.cursors.values()].map((cursor) => [
        cursor.userId,
        { x: cursor.drawnX, y: cursor.drawnY },
      ]),
    );
    this.cursorHandle?.cancel();
    this.cursorHandle = animate(GLIDE_MS, (progress) => {
      for (const cursor of this.state.cursors.values()) {
        const start = starts.get(cursor.userId) ?? { x: cursor.x, y: cursor.y };
        cursor.drawnX = start.x + (cursor.x - start.x) * easeOut(progress);
        cursor.drawnY = start.y + (cursor.y - start.y) * easeOut(progress);
      }
      this.paintCursors();
    });
  }

  private paintCursors(): void {
    for (const [userId, node] of this.canvas.cursors) {
      const cursor = this.state.cursors.get(userId);
      if (cursor) node.setAttribute('transform', `translate(${cursor.drawnX} ${cursor.drawnY})`);
    }
  }

  private handleSessionEnded(): void {
    this.sessionEndedOpener =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.openSessionDialog(this.sessionEndedOpener ?? undefined);
  }

  private openSessionDialog(opener?: HTMLElement): void {
    openSignInDialog(this.state.me.email, this, opener);
  }

  // ------------------------------------------------------------------- drags

  /** Port dots fade in over 120 milliseconds, or show at full strength under reduced motion. */
  beginDrag(session: DragSession): void {
    this.drag = session;
    this.state.drag = buildDragPreview(this.state, session);
    this.renderCanvasRegion();
    if (!reducedMotion()) {
      const dots = [...this.canvas.overlay.querySelectorAll<SVGElement>('.port-dot')];
      animate(PORT_FADE_MS, (progress) => {
        for (const dot of dots) dot.style.opacity = String(progress);
      });
    }
    this.stopDragLoop?.();
    this.stopDragLoop = onEveryFrame(() => {
      if (!this.drag) return;
      this.state.drag = buildDragPreview(this.state, this.drag);
      updateDrawnGeometry(this.state, this.canvas);
      this.updateInspectorValues();
    });
  }

  /** Ends a gesture without committing anything. */
  cancelDrag(): void {
    this.stopDragLoop?.();
    this.stopDragLoop = null;
    this.drag = null;
    this.state.drag = null;
  }

  get canvasHostElement(): HTMLElement {
    return this.slot('canvasHost');
  }

  updateDrag(point: { x: number; y: number }, altHeld: boolean): void {
    if (!this.drag) return;
    this.drag.latest = point;
    this.drag.altHeld = altHeld;
    this.drag.moved = true;
  }

  /** On drop the connectors settle onto the route the drop commits, which is the last preview. */
  endDrag(): void {
    const session = this.drag;
    this.stopDragLoop?.();
    this.stopDragLoop = null;
    this.drag = null;
    if (!session) return;
    const preview = this.state.drag;
    this.state.drag = null;
    if (session.kind === 'move' || session.kind === 'resize') {
      const boxes = plannedBoxes(this.state, session);
      const entries: ShapeEntry[] = [];
      for (const [id, box] of boxes) {
        const start = session.startBoxes.get(id);
        if (!start) continue;
        if (session.kind === 'resize') {
          entries.push({ shape: id, set: { x: box.x, y: box.y, w: box.w, h: box.h } });
        } else if (box.x !== start.x || box.y !== start.y) {
          entries.push({ shape: id, set: { x: box.x, y: box.y } });
        }
      }
      if (entries.length > 0) {
        this.sendShapeUpdates(entries, movedLabel(this.state, [...boxes.keys()]));
        this.render();
        this.settleConnectors(preview?.routes ?? new Map());
        return;
      }
    }
    this.render();
  }

  /**
   * The drawn line eases from the preview into the committed route over 200 milliseconds
   * while `data-points` already hold the committed route.
   */
  private settleConnectors(previewRoutes: Map<string, { route: Route }>): void {
    if (reducedMotion() || previewRoutes.size === 0) return;
    const page = currentPage(this.state);
    for (const [id, preview] of previewRoutes) {
      const connector = page.connectors.find((candidate) => candidate.id === id);
      const parts = this.canvas.connectors.get(id);
      if (!connector || !parts) continue;
      const from = preview.route;
      const to = connector.route;
      parts.group.setAttribute('data-settling', 'true');
      this.settleHandles.get(id)?.cancel();
      this.settleHandles.set(
        id,
        animate(
          SETTLE_MS,
          (progress) => parts.path.setAttribute('d', easeRoute(from, to, easeOut(progress))),
          () => {
            parts.path.setAttribute('d', pathFor(to));
            parts.group.removeAttribute('data-settling');
            this.settleHandles.delete(id);
          },
        ),
      );
    }
  }

  private sendShapeUpdates(entries: readonly ShapeEntry[], label: string): void {
    const first = entries[0];
    if (!first) return;
    const op: Operation =
      entries.length === 1
        ? { kind: 'update_shape', shape: first.shape, set: first.set }
        : { kind: 'update_shapes', shapes: [...entries] };
    this.live.send(op, { kind: 'moved', label });
  }

  // ----------------------------------------------------------------- actions

  say(message: string): void {
    announce(message);
  }

  openPage(pageId: string): void {
    if (this.state.pageId === pageId) return;
    this.state.pageId = pageId;
    this.state.selection = [];
    this.state.focusedShape = null;
    this.state.connect = null;
    recomputeRoutes(this.state);
    this.syncAddress('push');
    this.render();
  }

  nextPage(step: 1 | -1): void {
    const pages = pagesInOrder(shownDocument(this.state));
    const index = pages.findIndex((page) => page.id === this.state.pageId);
    const next = pages[index + step];
    if (next) this.openPage(next.id);
  }

  addPage(): void {
    const count = shownDocument(this.state).pages.length + 1;
    this.live.send({ kind: 'add_page', name: `Page ${count}` });
    const open = (): void => {
      const pages = pagesInOrder(this.state.document);
      const added = pages[pages.length - 1];
      if (added) this.openPage(added.id);
    };
    window.setTimeout(open, 0);
  }

  renamePage(pageId: string, name: string): void {
    const page = findPage(shownDocument(this.state), pageId);
    if (!page || page.name === name) {
      this.render();
      return;
    }
    this.live.send({ kind: 'rename_page', page: pageId, name });
  }

  reorderPage(pageId: string, direction: 'up' | 'down'): void {
    const pages = pagesInOrder(shownDocument(this.state));
    const index = pages.findIndex((page) => page.id === pageId);
    const target = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= pages.length) return;
    this.live.send({ kind: 'reorder_page', page: pageId, direction });
    const page = pages[index];
    if (page) announce(copy.reorderNotice(page.name, target + 1, pages.length));
  }

  deletePage(pageId: string): void {
    if (shownDocument(this.state).pages.length <= 1) return;
    this.live.send({ kind: 'delete_page', page: pageId });
    if (this.state.pageId === pageId) {
      const remaining = pagesInOrder(this.state.document)[0];
      if (remaining) this.openPage(remaining.id);
    }
  }

  addLayer(): void {
    const page = currentPage(this.state);
    this.live.send({ kind: 'add_layer', page: page.id, name: `Layer ${page.layers.length + 1}` });
  }

  renameLayer(layerId: string, name: string): void {
    const layer = currentPage(this.state).layers.find((candidate) => candidate.id === layerId);
    if (!layer || layer.name === name) {
      this.render();
      return;
    }
    this.live.send({ kind: 'rename_layer', layer: layerId, name });
  }

  reorderLayer(layerId: string, direction: 'up' | 'down'): void {
    const ordered = layersTopFirst(currentPage(this.state));
    const index = ordered.findIndex((layer) => layer.id === layerId);
    const target = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    this.live.send({ kind: 'reorder_layer', layer: layerId, direction });
    const layer = ordered[index];
    if (layer) announce(copy.reorderNotice(layer.name, target + 1, ordered.length));
  }

  setLayerFlag(layerId: string, flag: 'visible' | 'locked', value: boolean): void {
    this.live.send({ kind: 'set_layer_flag', layer: layerId, flag, value });
    if (value) {
      // Shapes on a hidden or locked layer cannot stay selected.
      const page = currentPage(this.state);
      this.state.selection = this.state.selection.filter(
        (id) => findShape(page, id)?.layer !== layerId,
      );
    }
    this.render();
  }

  moveSelectionToLayer(layerId: string): void {
    const ids = expandGroups(currentPage(this.state), this.state.selection);
    if (ids.length === 0) return;
    this.sendShapeUpdates(
      ids.map((id) => ({ shape: id, set: { layer: layerId } })),
      movedLabel(this.state, ids),
    );
  }

  insertShape(kind: ShapeKind): void {
    const page = currentPage(this.state);
    const layer = insertLayer(page);
    if (layer === null || !canEditNow(this.state)) return;
    const at = insertionPosition(page, canvasCentre(this.state, this.canvas.svg));
    const before = new Set(page.shapes.map((shape) => shape.id));
    this.live.send(
      {
        kind: 'add_shape',
        page: page.id,
        layer,
        shape: { kind, x: at.x, y: at.y, w: 160, h: 80, label: '' },
        clientRef: 'insert',
      },
      { kind: 'none' },
      (ids) => this.focusInsertedShape(ids['insert']),
    );
    if (!this.live.connected) {
      const added = currentPage(this.state).shapes.find((shape) => !before.has(shape.id));
      if (added) this.focusInsertedShape(added.id);
    }
  }

  /** Inserting focuses the new shape's label editor, using the id the server gave it. */
  private focusInsertedShape(shapeId: string | undefined): void {
    if (shapeId === undefined) return;
    this.state.selection = [shapeId];
    this.state.focusedShape = shapeId;
    this.render();
    this.openLabelEditor(shapeId);
  }

  /** Enter opens the label editor over the shape; Enter commits and Escape cancels. */
  openLabelEditor(shapeId: string): void {
    const shape = findShape(currentPage(this.state), shapeId);
    if (!shape || !canEditNow(this.state)) return;
    const factor = this.state.zoom / 100;
    const field = h('input', {
      class: 'label-editor',
      type: 'text',
      role: 'textbox',
      'aria-label': 'Label',
      value: shape.label,
      style:
        `left:${(shape.x - this.state.view.x) * factor}px;` +
        `top:${(shape.y - this.state.view.y) * factor}px;` +
        `width:${shape.w * factor}px;height:${shape.h * factor}px`,
    });
    this.slot('labelLayer').appendChild(field);
    field.focus();
    field.select();
    let settled = false;
    const finish = (save: boolean): void => {
      if (settled) return;
      settled = true;
      const value = field.value;
      field.remove();
      this.canvas.shapes.get(shapeId)?.focus();
      if (save && value !== shape.label) this.commitLabel(shapeId, value);
    };
    field.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });
    field.addEventListener('blur', () => finish(true));
  }

  commitLabel(shapeId: string, label: string): void {
    this.live.send({ kind: 'update_shape', shape: shapeId, set: { label } });
  }

  deleteSelection(): void {
    const page = currentPage(this.state);
    const ids = expandGroups(page, this.state.selection);
    if (ids.length === 0 || !canEditNow(this.state)) return;
    const label = movedLabel(this.state, ids);
    const order = focusOrder(page);
    const index = order.findIndex((shape) => shape.id === ids[0]);
    const first = ids[0];
    this.live.send(
      ids.length === 1 && first !== undefined
        ? { kind: 'delete_shape', shape: first }
        : { kind: 'delete_shapes', shapes: ids },
      { kind: 'moved', label },
    );
    this.state.selection = [];
    const next = order.slice(index + 1).find((shape) => !ids.includes(shape.id));
    this.state.focusedShape = next?.id ?? null;
    this.render();
    if (next) this.canvas.shapes.get(next.id)?.focus();
    else this.canvas.svg.focus();
  }

  duplicateSelection(): void {
    const ids = expandGroups(currentPage(this.state), this.state.selection);
    if (ids.length === 0) return;
    this.live.send({
      kind: 'duplicate_shapes',
      shapes: ids,
      dx: DUPLICATE_OFFSET,
      dy: DUPLICATE_OFFSET,
    });
  }

  reorderSelection(direction: 'forward' | 'backward'): void {
    const ids = expandGroups(currentPage(this.state), this.state.selection);
    if (ids.length === 0) return;
    this.live.send({ kind: 'reorder_shape', shapes: ids, direction });
  }

  groupSelection(): void {
    const page = currentPage(this.state);
    const ids = expandGroups(page, this.state.selection);
    if (ids.length < 2) return;
    if (new Set(ids.map((id) => findShape(page, id)?.layer)).size > 1) {
      announce(copy.crossLayerGroupRefusal);
      return;
    }
    this.live.send({ kind: 'group_shapes', shapes: ids });
    announce(copy.groupedNotice(ids.length));
  }

  ungroupSelection(): void {
    const page = currentPage(this.state);
    const groups = [
      ...new Set(
        this.state.selection
          .map((id) => findShape(page, id)?.group)
          .filter((group): group is string => group !== null && group !== undefined),
      ),
    ];
    if (groups.length === 0) return;
    const count = expandGroups(page, this.state.selection).length;
    this.live.send({ kind: 'ungroup_shapes', groups });
    announce(copy.ungroupedNotice(count));
  }

  align(side: AlignSide): void {
    const units = selectionUnits(currentPage(this.state), selectedShapes(this.state));
    if (units.length < 2 || !canEditNow(this.state)) return;
    const offsets = alignOffsets(units, side);
    const entries: ShapeEntry[] = [];
    for (const unit of units) {
      const offset = offsets.get(unit) ?? { dx: 0, dy: 0 };
      for (const shape of unit.shapes) {
        entries.push({ shape: shape.id, set: { x: shape.x + offset.dx, y: shape.y + offset.dy } });
      }
    }
    this.live.send({ kind: 'update_shapes', shapes: entries });
    announce(copy.alignedNotice(entries.length, side));
  }

  distribute(axis: DistributeAxis): void {
    const units = selectionUnits(currentPage(this.state), selectedShapes(this.state));
    if (units.length < 3 || !canEditNow(this.state)) return;
    const offsets = distributeOffsets(units, axis);
    const entries: ShapeEntry[] = [];
    for (const unit of units) {
      const offset = offsets.get(unit) ?? { dx: 0, dy: 0 };
      for (const shape of unit.shapes) {
        entries.push({ shape: shape.id, set: { x: shape.x + offset.dx, y: shape.y + offset.dy } });
      }
    }
    this.live.send({ kind: 'update_shapes', shapes: entries });
    announce(copy.distributedNotice(entries.length));
  }

  /** Arrow nudges by 8 and Shift+Arrow by 1, never snapped, as one operation. */
  nudge(dx: number, dy: number): void {
    const page = currentPage(this.state);
    const focused = this.state.focusedShape;
    const ids = expandGroups(
      page,
      this.state.selection.length > 0 ? this.state.selection : focused === null ? [] : [focused],
    );
    if (ids.length === 0 || !canEditNow(this.state)) return;
    const entries: ShapeEntry[] = [];
    for (const id of ids) {
      const shape = findShape(page, id);
      if (!shape || isLayerLocked(page, shape.layer)) continue;
      entries.push({ shape: id, set: { x: shape.x + dx, y: shape.y + dy } });
    }
    if (entries.length === 0) return;
    this.sendShapeUpdates(entries, movedLabel(this.state, ids));
    this.render();
  }

  commitInspector(field: InspectorField, value: number): void {
    const page = currentPage(this.state);
    const shapes = selectedShapes(this.state);
    if (shapes.length === 0 || !canEditNow(this.state)) return;
    if (field === 'w' || field === 'h') {
      const only = shapes[0];
      if (shapes.length !== 1 || !only) return;
      this.sendShapeUpdates(
        [{ shape: only.id, set: field === 'w' ? { w: value } : { h: value } }],
        shapeLabel(only),
      );
      return;
    }
    const box = selectionBox(this.state);
    if (!box) return;
    const delta = value - (field === 'x' ? box.x : box.y);
    const ids = expandGroups(page, this.state.selection);
    const entries: ShapeEntry[] = [];
    for (const id of ids) {
      const shape = findShape(page, id);
      if (!shape) continue;
      entries.push({
        shape: id,
        set: field === 'x' ? { x: shape.x + delta } : { y: shape.y + delta },
      });
    }
    this.sendShapeUpdates(entries, movedLabel(this.state, ids));
  }

  select(ids: readonly string[]): void {
    this.state.selection = expandGroups(currentPage(this.state), ids);
    this.render();
  }

  toggleSelected(id: string): void {
    const members = expandGroups(currentPage(this.state), [id]);
    const present = members.every((member) => this.state.selection.includes(member));
    this.state.selection = present
      ? this.state.selection.filter((candidate) => !members.includes(candidate))
      : [...new Set([...this.state.selection, ...members])];
    this.render();
  }

  clearSelection(): void {
    this.state.selection = [];
    this.render();
  }

  selectAll(): void {
    this.select(selectableShapes(currentPage(this.state)).map((shape) => shape.id));
  }

  focusShape(id: string | null): void {
    this.state.focusedShape = id;
    this.render();
    this.restoreShapeFocus();
  }

  /** Puts focus back on the roving shape after the canvas has been rebuilt. */
  restoreShapeFocus(): void {
    const id = this.state.focusedShape;
    const node = id === null ? null : this.canvas.shapes.get(id);
    (node ?? this.canvas.svg).focus();
  }

  // ------------------------------------------------------------ connect mode

  startConnect(): void {
    const page = currentPage(this.state);
    const source = this.state.focusedShape ?? this.state.selection[0] ?? null;
    if (source === null || !canEditNow(this.state)) return;
    const order = focusOrder(page);
    const candidates = order.filter(
      (shape) => !isLayerLocked(page, shape.layer) && shape.id !== source,
    );
    if (candidates.length === 0) return;
    const sourceIndex = order.findIndex((shape) => shape.id === source);
    const after = candidates.findIndex(
      (shape) => order.findIndex((other) => other.id === shape.id) > sourceIndex,
    );
    this.state.connect = {
      source,
      candidates: candidates.map((shape) => shape.id),
      highlight: after >= 0 ? after : 0,
      port: null,
    };
    this.render();
  }

  moveConnectHighlight(step: 1 | -1): void {
    const connect = this.state.connect;
    if (!connect || connect.candidates.length === 0) return;
    const count = connect.candidates.length;
    connect.highlight = (connect.highlight + step + count) % count;
    this.render();
  }

  setConnectPort(port: Port): void {
    if (this.state.connect) this.state.connect.port = port;
  }

  commitConnect(): void {
    const connect = this.state.connect;
    if (!connect) return;
    const page = currentPage(this.state);
    const source = findShape(page, connect.source);
    const targetId = connect.candidates[connect.highlight];
    const target = targetId === undefined ? undefined : findShape(page, targetId);
    this.state.connect = null;
    if (!source || !target) {
      this.render();
      return;
    }
    const pair = defaultPortPair(boxOf(source), boxOf(target));
    this.live.send({
      kind: 'add_connector',
      page: page.id,
      from: { shape: source.id, port: pair.from },
      to: { shape: target.id, port: connect.port ?? pair.to },
      label: '',
      clientRef: 'connect',
    });
    announce(copy.connectedNotice(shapeLabel(source), shapeLabel(target)));
    this.focusShape(source.id);
  }

  cancelConnect(): void {
    this.state.connect = null;
    this.render();
  }

  undo(): void {
    this.live.send({ kind: 'undo' });
  }

  redo(): void {
    this.live.send({ kind: 'redo' });
  }

  // -------------------------------------------------------------------- view

  toggleSnap(): void {
    this.state.snapToGrid = !this.state.snapToGrid;
    this.render();
  }

  zoomStep(step: 1 | -1): void {
    this.zoomBy(step, null);
  }

  /** Steps through the published zoom percentages, keeping a zoom centre put. */
  zoomBy(step: 1 | -1, centre: { x: number; y: number } | null): void {
    const index = ZOOM_STEPS.indexOf(this.state.zoom as (typeof ZOOM_STEPS)[number]);
    const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, index + step))];
    if (next !== undefined) this.setZoom(next, centre);
  }

  resetZoom(): void {
    this.setZoom(100, null);
  }

  /** Zooming keeps the zoom centre put by moving the view origin. */
  setZoom(percent: number, centre: { x: number; y: number } | null): void {
    const before = this.state.zoom / 100;
    const after = percent / 100;
    if (centre) {
      this.state.view = {
        x: centre.x - (centre.x - this.state.view.x) * (before / after),
        y: centre.y - (centre.y - this.state.view.y) * (before / after),
      };
    }
    this.state.zoom = percent;
    this.render();
  }

  panBy(dx: number, dy: number): void {
    const factor = this.state.zoom / 100;
    this.state.view = { x: this.state.view.x + dx / factor, y: this.state.view.y + dy / factor };
    this.render();
  }

  toggleInspector(): void {
    this.state.inspectorOpen = !this.state.inspectorOpen;
    this.railSlide.set(this.state.inspectorOpen);
    this.render();
  }

  toggleLeftRail(force?: boolean): void {
    this.state.leftRailOpen = force ?? !this.state.leftRailOpen;
    this.render();
  }

  openSheet(sheet: 'layers' | 'inspector' | 'comments' | 'history' | null, opener?: HTMLElement): void {
    this.state.openSheet = sheet;
    if (sheet === null) {
      closeOpenPanel();
      return;
    }
    if (sheet === 'layers') {
      openSheetPanel(
        'Layers',
        h('div', { class: 'sheet-body' }, pagesRegion(this.state, this), layersRegion(this.state, this)),
        opener,
      );
      return;
    }
    if (sheet === 'comments') {
      openSheetPanel('Comments', commentsPanel(this.state, this), opener);
      return;
    }
    if (sheet === 'history') {
      openSheetPanel('History', historyPanel(this.state, this), opener);
      return;
    }
    openSheetPanel('Inspector', inspectorPanel(this.state, this), opener);
  }

  setInspectorTab(tab: 'inspector' | 'comments' | 'history'): void {
    this.state.inspectorTab = tab;
    if (!this.state.inspectorOpen) {
      this.state.inspectorOpen = true;
      this.railSlide.set(true);
    }
    this.render();
  }

  toggleOutline(force?: boolean, opener?: HTMLElement): void {
    this.state.outlineOpen = force ?? !this.state.outlineOpen;
    if (this.state.outlineOpen) this.seedOutlineExpansion();
    this.render();
    if (this.state.outlineOpen) {
      const items = [...this.host.querySelectorAll<HTMLElement>('[role="treeitem"]')];
      for (const item of items) item.setAttribute('tabindex', '-1');
      const first = items[0];
      first?.setAttribute('tabindex', '0');
      first?.focus();
    } else {
      opener?.focus();
    }
  }

  /**
   * The open page starts expanded and the others start collapsed; layer and group items
   * start expanded.
   */
  private seedOutlineExpansion(): void {
    const doc = shownDocument(this.state);
    this.outlineExpanded.add(`page-${this.state.pageId}`);
    for (const page of doc.pages) {
      if (page.id !== this.state.pageId) continue;
      for (const layer of page.layers) this.outlineExpanded.add(`layer-${layer.id}`);
      for (const group of page.groups) this.outlineExpanded.add(`group-${group.id}`);
    }
  }

  // ---------------------------------------------------------- dialogs and menus

  openShare(opener?: HTMLElement): void {
    void this.refreshMembers().then(() => {
      openShareDialog(this, { ...this.members, mailOutage: this.mailOutage }, opener);
    });
  }

  openExport(opener?: HTMLElement): void {
    openExportDialog(
      this.state,
      this,
      (page) => this.newestExportFor(page),
      (refresh) => {
        this.refreshOpenExportDialog = refresh;
      },
      opener,
    );
  }

  openSaveVersion(opener?: HTMLElement): void {
    openSaveVersionDialog(this, opener);
  }

  openDeletePage(pageId: string, opener?: HTMLElement): void {
    openDeletePageDialog(pageId, this, opener);
  }

  openShapeActions(anchor: { x: number; y: number }, opener?: HTMLElement): void {
    const selected = this.state.selection[0] ?? '';
    const items = canEditNow(this.state)
      ? [
          { label: 'Comment', run: () => this.commentOnShape(selected) },
          { label: 'Duplicate', run: () => this.duplicateSelection() },
          { label: 'Delete', run: () => this.deleteSelection() },
          { label: 'Bring forward', run: () => this.reorderSelection('forward') },
          { label: 'Send backward', run: () => this.reorderSelection('backward') },
        ]
      : [{ label: 'Comment', run: () => this.commentOnShape(selected) }];
    openMenu('Shape actions', items, anchor, opener);
  }

  openAlignMenu(opener: HTMLElement): void {
    const box = opener.getBoundingClientRect();
    const units = selectionUnits(currentPage(this.state), selectedShapes(this.state));
    const needsTwo = units.length < 2;
    const needsThree = units.length < 3;
    openMenu(
      'Align',
      [
        { label: 'Align left', run: () => this.align('left'), disabled: needsTwo },
        { label: 'Align centre', run: () => this.align('centre'), disabled: needsTwo },
        { label: 'Align right', run: () => this.align('right'), disabled: needsTwo },
        { label: 'Align top', run: () => this.align('top'), disabled: needsTwo },
        { label: 'Align middle', run: () => this.align('middle'), disabled: needsTwo },
        { label: 'Align bottom', run: () => this.align('bottom'), disabled: needsTwo },
        { label: 'Distribute horizontally', run: () => this.distribute('horizontal'), disabled: needsThree },
        { label: 'Distribute vertically', run: () => this.distribute('vertical'), disabled: needsThree },
      ],
      { x: box.left, y: box.bottom + 4 },
      opener,
    );
  }

  openInsertMenu(opener: HTMLElement): void {
    const box = opener.getBoundingClientRect();
    openMenu(
      'Insert',
      (['rectangle', 'ellipse', 'diamond', 'text'] as const).map((kind) => ({
        label: `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`,
        run: () => this.insertShape(kind),
      })),
      { x: box.left, y: box.top - 4 },
      opener,
    );
  }

  // --------------------------------------------------------------- comments

  commentOnShape(shapeId: string): void {
    if (shapeId.length === 0) return;
    this.state.commentTarget = shapeId;
    if (this.layout() === 'narrow') this.openSheet('comments');
    else this.setInspectorTab('comments');
    document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Comment"]')?.focus();
  }

  postComment(shapeId: string, text: string, parent: string | null): void {
    if (text.trim().length === 0) return;
    void api
      .addComment(this.state.diagramId, shapeId, text, parent)
      .then(() => this.refreshComments())
      .catch(() => undefined);
  }

  resolveThread(commentId: string): void {
    void api
      .resolveComment(this.state.diagramId, commentId)
      .then(() => this.refreshComments())
      .catch(() => undefined);
  }

  openPin(commentId: string): void {
    const comment = this.state.comments.find((candidate) => candidate.id === commentId);
    if (comment) this.state.commentTarget = comment.shape;
    if (this.layout() === 'narrow') this.openSheet('comments');
    else this.setInspectorTab('comments');
  }

  private async refreshComments(): Promise<void> {
    try {
      this.state.comments = (await api.comments(this.state.diagramId)).comments;
      this.render();
    } catch {
      // The list refreshes again on the next change.
    }
  }

  // --------------------------------------------------------------- versions

  private async refreshVersions(): Promise<void> {
    try {
      this.state.versions = (await api.versions(this.state.diagramId)).versions;
      this.render();
    } catch {
      // The list refreshes again on the next change.
    }
  }

  saveVersion(name: string | null): void {
    void api
      .saveVersion(this.state.diagramId, name)
      .then(async (result) => {
        announce(copy.versionSavedNotice(result.version.displayName));
        await this.refreshVersions();
      })
      .catch(() => undefined);
  }

  previewVersion(versionId: string): void {
    void api
      .version(this.state.diagramId, versionId)
      .then((result) => {
        this.state.preview = { version: result.version, document: result.document };
        this.state.selection = [];
        const known = findPage(result.document, this.state.pageId) !== undefined;
        if (!known) {
          this.state.pageId = pagesInOrder(result.document)[0]?.id ?? this.state.pageId;
        }
        recomputeRoutes(this.state);
        this.syncAddress(known ? 'push' : 'replace');
        this.render();
      })
      .catch(() => this.onNotFound());
  }

  backToLatest(): void {
    this.state.preview = null;
    if (findPage(this.state.document, this.state.pageId) === undefined) {
      this.state.pageId = pagesInOrder(this.state.document)[0]?.id ?? this.state.pageId;
    }
    recomputeRoutes(this.state);
    this.syncAddress('push');
    this.render();
  }

  restoreVersion(versionId: string): void {
    const version =
      this.state.versions.find((candidate) => candidate.id === versionId) ??
      this.state.preview?.version;
    const restoredName = version?.displayName ?? '';
    if (version) announce(copy.restorePending(restoredName));
    void api
      .restoreVersion(this.state.diagramId, versionId)
      .then(async () => {
        this.state.preview = null;
        recomputeRoutes(this.state);
        announce(copy.restoredNotice(this.state.me.name, restoredName));
        this.syncAddress('replace');
        await this.refreshVersions();
        await this.refreshComments();
      })
      .catch(() => undefined);
  }

  // ---------------------------------------------------------------- exports

  private newestExportFor(page: string): ExportRecord | null {
    const memory = exportMemory(this.state.diagramId, this.state.me.id);
    return (
      this.state.exports.find(
        (record) => record.page === page && memory.requested.includes(record.id),
      ) ?? null
    );
  }

  requestExport(settings: {
    page: string;
    format: 'png' | 'svg';
    scale: 1 | 2;
    background: 'white' | 'transparent';
  }): void {
    void api
      .createExport(this.state.diagramId, settings)
      .then(async (record) => {
        rememberExport(this.state.diagramId, this.state.me.id, { requested: [record.id] });
        await this.refreshExports();
      })
      .catch(() => undefined);
  }

  retryExport(exportId: string): void {
    void api
      .retryExport(exportId)
      .then(() => this.refreshExports())
      .catch(() => this.refreshExports());
  }

  private async refreshExports(): Promise<void> {
    try {
      this.state.exports = (await api.exports(this.state.diagramId)).exports;
      this.noteExportStates();
      this.render();
      this.refreshOpenExportDialog?.();
    } catch {
      // The list refreshes again on the next change.
    }
  }

  /** `Export ready.` is announced exactly once per export, in the tab that requested it. */
  private noteExportStates(): void {
    const memory = exportMemory(this.state.diagramId, this.state.me.id);
    let paused = false;
    for (const record of this.state.exports) {
      if (!memory.requested.includes(record.id)) continue;
      if (record.status === 'storage_unavailable') paused = true;
      if (record.status === 'ready' && !memory.announced.includes(record.id)) {
        rememberExport(this.state.diagramId, this.state.me.id, { announced: [record.id] });
        announce(copy.exportReady);
      }
    }
    this.state.exportPaused = paused;
  }

  // ---------------------------------------------------------------- members

  private async refreshMembers(): Promise<void> {
    try {
      this.members = await api.members(this.state.diagramId);
      this.mailOutage = this.members.invites.some((invite) => invite.status === 'email_not_sent');
      this.render();
    } catch {
      // The list refreshes again on the next change.
    }
  }

  private async afterMemberChange(emailed: string | null): Promise<void> {
    if (emailed !== null) announce(copy.inviteEmailedNotice(emailed));
    await this.refreshMembers();
    if (hasOpenPanel()) openShareDialog(this, { ...this.members, mailOutage: this.mailOutage });
  }

  invite(email: string, role: 'editor' | 'viewer'): void {
    void api
      .invite(this.state.diagramId, email, role)
      .then((result) =>
        this.afterMemberChange(result.invite.status === 'emailed' ? result.invite.email : null),
      )
      .catch(() => this.afterMemberChange(null));
  }

  resendInvite(inviteId: string): void {
    void api
      .resendInvite(this.state.diagramId, inviteId)
      .then((result) =>
        this.afterMemberChange(result.invite.status === 'emailed' ? result.invite.email : null),
      )
      .catch(() => this.afterMemberChange(null));
  }

  removeInvite(inviteId: string): void {
    void api
      .revokeInvite(this.state.diagramId, inviteId)
      .then(() => this.afterMemberChange(null))
      .catch(() => undefined);
  }

  setMemberRole(userId: string, role: 'editor' | 'viewer'): void {
    void api
      .setMemberRole(this.state.diagramId, userId, role)
      .then(() => this.afterMemberChange(null))
      .catch(() => undefined);
  }

  removeMember(userId: string): void {
    void api
      .removeMember(this.state.diagramId, userId)
      .then(() => this.afterMemberChange(null))
      .catch(() => undefined);
  }

  // ---------------------------------------------------------------- session

  signInAgain(password: string, onError: (message: string) => void): void {
    void api
      .signIn(this.state.me.email, password)
      .then(() => {
        closeSignInDialog();
        this.sessionEndedOpener?.focus();
        this.live.resume();
        this.render();
      })
      .catch(() => onError(copy.signInError));
  }

  // ---------------------------------------------------------------- address

  /** The URL tracks the open page and any version being previewed. */
  syncAddress(mode: 'push' | 'replace'): void {
    const url = new URL(window.location.href);
    url.pathname = `/d/${this.state.diagramId}`;
    url.search = '';
    url.searchParams.set('page', this.state.pageId);
    if (this.state.preview) url.searchParams.set('version', this.state.preview.version.id);
    const next = `${url.pathname}${url.search}`;
    if (mode === 'push') window.history.pushState({}, '', next);
    else window.history.replaceState({}, '', next);
  }

  /** Reads the address again after Back or Forward. */
  applyAddress(): void {
    const url = new URL(window.location.href);
    const page = url.searchParams.get('page');
    const version = url.searchParams.get('version');
    if (version === null) {
      if (this.state.preview !== null) {
        this.state.preview = null;
        recomputeRoutes(this.state);
      }
    } else if (this.state.preview?.version.id !== version) {
      void api
        .version(this.state.diagramId, version)
        .then((result) => {
          this.state.preview = { version: result.version, document: result.document };
          recomputeRoutes(this.state);
          this.render();
        })
        .catch(() => this.onNotFound());
    }
    if (page !== null && page !== this.state.pageId) {
      this.state.pageId = page;
      this.state.selection = [];
    }
    recomputeRoutes(this.state);
    this.render();
  }

  /** The locked notice, announced when a press lands on a shape that cannot be selected. */
  announceLocked(shape: Shape): void {
    const page = currentPage(this.state);
    const layer = page.layers.find((candidate) => candidate.id === shape.layer);
    if (layer?.locked === true) announce(copy.lockedNotice(layer.name));
  }

  documentPointOf(clientX: number, clientY: number): { x: number; y: number } {
    return documentPoint(this.state, this.canvas.svg, clientX, clientY);
  }

  pageOf(pageId: string): Page | undefined {
    return findPage(shownDocument(this.state), pageId);
  }

  get editable(): boolean {
    return canEditNow(this.state);
  }

  get shapeLimit(): number {
    return LIMITS.shapesPerPage;
  }

  get visibleShapeCount(): number {
    return visibleShapes(currentPage(this.state)).length;
  }
}

function parseRoute(points: string): Route {
  if (points.length === 0) return [];
  return points.split(' ').map((pair) => {
    const [x, y] = pair.split(',');
    return [Number(x), Number(y)] as const;
  });
}
