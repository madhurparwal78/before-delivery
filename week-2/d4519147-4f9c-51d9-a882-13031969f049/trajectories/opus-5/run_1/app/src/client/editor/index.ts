import { ApiFailure, api, sessionState } from '../api';
import { boundarySentences } from '../../shared/boundary';
import { COPY } from '../../shared/copy';
import { clonePage, expandSelection, readingOrder, translateSelection } from '../../shared/editing';
import { isSystemKindId, isZoneKindId } from '../../shared/kinds';
import { pagePath } from '../../shared/routes';
import type {
  Derived,
  DiagramDetail,
  ImportRecord,
  PageDocument,
  PlatformStatus,
} from '../../shared/types';
import { ICONS, announce, el, icon, openPanel, topPanel, type Panel } from '../dom';
import { navigate, setLeaveGuard, setScreenCleanup, showNotFound } from '../router';
import {
  addShapeOfKind,
  addZoneOfKind,
  alignSelected,
  changeLayerOf,
  connectFromPort,
  connectShapes,
  deleteSelected,
  duplicateSelected,
  groupSelected,
  moveSelection,
  setConnectorLabelOf,
  setGeometryOf,
  setShapeKindOf,
  setShapeLabelOf,
  setZoneFieldOf,
  ungroupSelected,
  type EditorContext,
} from './actions';
import {
  applyView,
  createCanvas,
  focusItem,
  renderCanvas,
  renderFocusRing,
  renderPorts,
  type CanvasRefs,
  type View,
} from './canvas';
import { openFilesDialog } from './files';
import { openImportDialog } from './importDialog';
import { createInspector, type InspectorView } from './inspector';
import { createLibrary, type LibraryView } from './library';
import { addGhostMarkers, playBoundaryTally, tallyQualifies } from './motion';
import { openShareDialog } from './share';
import { isGateOpen } from './sessionGate';
import { EditorState } from './state';

type LayoutMode = 'wide' | 'medium' | 'narrow';

function layoutMode(): LayoutMode {
  const width = window.innerWidth;
  if (width >= 1200) return 'wide';
  if (width >= 768) return 'medium';
  return 'narrow';
}

const MODIFIER = /Mac|iPhone|iPad/.test(navigator.platform) ? 'meta' : 'ctrl';

function hasModifier(event: KeyboardEvent): boolean {
  return MODIFIER === 'meta' ? event.metaKey : event.ctrlKey;
}

export async function renderEditor(root: HTMLElement, diagramId: string, pageId: string | null): Promise<void> {
  let diagram: DiagramDetail;
  try {
    const body = await api.get<{ diagram: DiagramDetail }>(`/api/diagrams/${diagramId}`);
    diagram = body.diagram;
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 404) showNotFound('diagram');
    return;
  }
  const firstPage = diagram.pages[0];
  const targetPageId = pageId ?? (firstPage ? firstPage.id : null);
  if (!targetPageId) {
    showNotFound('diagram');
    return;
  }
  if (!pageId) {
    window.history.replaceState({}, '', pagePath(diagramId, targetPageId));
  }
  let page: { page: PageDocument; derived: Derived };
  try {
    page = await api.get<{ page: PageDocument; derived: Derived }>(
      `/api/diagrams/${diagramId}/pages/${targetPageId}`,
    );
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 404) showNotFound('diagram');
    return;
  }
  const editor = new Editor(root, diagram, targetPageId, page.page, page.derived);
  editor.mount();
}

class Editor implements EditorContext {
  readonly state: EditorState;
  readonly view: View = { zoom: 1, panX: 0, panY: 0 };
  private readonly root: HTMLElement;
  private refs: CanvasRefs;
  private library: LibraryView | null = null;
  private inspector: InspectorView | null = null;
  private inspectorDrawer: Panel | null = null;
  private librarySheet: Panel | null = null;
  private mode: LayoutMode = layoutMode();
  private bannerHost = el('div');
  private saveStatus = el('div', { role: 'status', 'aria-label': 'Save state', class: 'save-state' });
  private zoomStatus = el('div', { role: 'status', 'aria-label': 'Zoom level', class: 'zoom-level' });
  private tabList = el('div', { role: 'tablist', 'aria-label': 'Pages', class: 'tablist' });
  private timers: number[] = [];
  private pointerState: Map<number, { x: number; y: number }> = new Map();
  private drag: {
    kind: 'shape' | 'zone' | 'pan' | 'port';
    startDoc: PageDocument;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
    shapeId?: string;
    port?: 'n' | 'e' | 's' | 'w';
    moved: boolean;
    outcome?: PageDocument;
    movedShapeIds?: Set<string>;
    movedZoneIds?: Set<string>;
  } | null = null;
  private pinch: { distance: number; canvasX: number; canvasY: number; zoom: number } | null = null;

  constructor(root: HTMLElement, diagram: DiagramDetail, pageId: string, doc: PageDocument, derived: Derived) {
    this.root = root;
    this.state = new EditorState(diagram, pageId, doc, derived);
    this.refs = createCanvas();
  }

  paneSize(): { width: number; height: number } {
    const rect = this.refs.pane.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  mount(): void {
    this.buildShell();
    this.state.subscribe((change) => {
      if (change.doc) {
        const motion = change.motion;
        renderCanvas(this.state, this.refs);
        applyView(this.refs, this.view);
        if (motion) {
          const plan = {
            beforeDoc: motion.beforeDoc,
            beforeDerived: motion.beforeDerived,
            afterDoc: this.state.doc,
            afterDerived: this.state.derived,
            reverse: motion.reverse,
            announcement: null as string | null,
          };
          if (tallyQualifies(motion.beforeDerived, this.state.derived)) {
            const sentences = boundarySentences(
              motion.beforeDoc,
              motion.beforeDerived,
              this.state.doc,
              this.state.derived,
              { movedShapeIds: motion.meta.movedShapeIds, zoneAction: motion.meta.zoneAction },
            );
            plan.announcement = sentences.length > 0 ? sentences.join(' ') : null;
            addGhostMarkers(this.refs, plan);
            playBoundaryTally(this.refs, plan);
          }
        }
        if (this.state.focusedId) this.restoreFocus();
      } else if (change.selection) {
        renderCanvas(this.state, this.refs);
        applyView(this.refs, this.view);
        if (this.state.focusedId) this.restoreFocus();
      }
      if (change.selection) this.inspector?.render();
      this.syncChrome();
    });

    this.timers.push(
      window.setInterval(() => this.state.tick(), 200),
      window.setInterval(() => void this.pollStatus(), 10000),
    );
    void this.pollStatus();
    setLeaveGuard(() => this.state.settle());
    setScreenCleanup(() => this.destroy());
    window.addEventListener('beforeunload', this.onBeforeUnload);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('keydown', this.onKeyDown, true);
    this.refs.pane.focus();
  }

  private onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (this.state.hasPendingWork()) event.preventDefault();
  };

  private onResize = (): void => {
    const next = layoutMode();
    if (next === this.mode) return;
    const widened = next === 'wide';
    this.mode = next;
    const hadDrawer = this.inspectorDrawer !== null;
    this.inspectorDrawer?.close();
    this.inspectorDrawer = null;
    this.librarySheet?.close();
    this.librarySheet = null;
    this.buildShell();
    if (widened && hadDrawer) {
      this.inspector?.firstField()?.focus();
    } else if (!widened && document.activeElement === document.body) {
      const focused = this.state.focusedId;
      if (focused) this.focusItem(focused);
      else this.refs.pane.focus();
    }
  };

  private destroy(): void {
    for (const timer of this.timers) window.clearInterval(timer);
    this.timers = [];
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('keydown', this.onKeyDown, true);
  }

  private buildShell(): void {
    const narrow = this.mode === 'narrow';
    const canEditDiagram = this.state.role === 'owner' || this.state.role === 'editor';

    const home = el('a', { href: '/', class: 'home' });
    if (narrow) {
      home.append(icon(ICONS.home));
      home.setAttribute('aria-label', 'All diagrams');
    } else {
      home.textContent = 'All diagrams';
    }
    home.addEventListener('click', (event) => {
      event.preventDefault();
      void navigate('/');
    });

    const title = el('h1', { text: this.state.diagram.title });
    this.renderTabs();

    const topbar = el('header', { class: 'topbar', role: 'banner' }, [home, title]);
    if (!narrow) topbar.append(this.tabList);
    topbar.append(this.saveStatus, el('div', { class: 'spacer' }));

    if (!narrow) {
      const zoomOut = this.iconButton('Zoom out', ICONS.zoomOut, () => this.zoomBy(-1));
      const zoomIn = this.iconButton('Zoom in', ICONS.zoomIn, () => this.zoomBy(1));
      const undo = this.iconButton('Undo', ICONS.undo, () => this.state.undo());
      const redo = this.iconButton('Redo', ICONS.redo, () => this.state.redo());
      const save = this.iconButton('Save', ICONS.save, () => void this.state.saveNow());
      topbar.append(zoomOut, zoomIn, this.zoomStatus, undo, redo, save);
      if (canEditDiagram) topbar.append(this.iconButton('Import', ICONS.importFile, () => this.openImport()));
    }
    topbar.append(this.iconButton('Files', ICONS.files, () => this.openFiles()));
    if (this.state.role === 'owner') {
      topbar.append(this.iconButton('Share', ICONS.share, () => this.openShare()));
    }
    if (this.mode === 'medium') {
      topbar.append(this.iconButton('Inspector', ICONS.inspector, () => this.openInspectorDrawer()));
    }
    if (narrow) topbar.append(this.tabList);

    const canvasColumn = el('div', { class: 'canvas-column' }, [this.bannerHost, this.refs.pane]);
    const workspace = el('div', { class: 'workspace' });
    if (!narrow) {
      this.library = createLibrary(this.libraryHandlers(), 'rail');
      workspace.append(this.library.element);
    } else {
      this.library = null;
    }
    workspace.append(canvasColumn);
    if (this.mode === 'wide') {
      this.inspector = createInspector(this.state, this.inspectorHandlers(), 'pane');
      workspace.append(this.inspector.element);
    } else {
      this.inspector = null;
    }

    const shell = el('div', { class: 'editor' }, [topbar, workspace]);
    if (narrow) {
      const toolbar = el('div', { class: 'bottom-toolbar', role: 'toolbar', 'aria-label': 'Editor tools' }, [
        this.iconButton('Shapes', ICONS.shapes, () => this.openLibrarySheet()),
        this.iconButton('Inspector', ICONS.inspector, () => this.openInspectorDrawer()),
        this.iconButton('Undo', ICONS.undo, () => this.state.undo()),
        this.iconButton('Redo', ICONS.redo, () => this.state.redo()),
        this.iconButton('Save', ICONS.save, () => void this.state.saveNow()),
      ]);
      shell.append(toolbar);
    }
    this.root.replaceChildren(shell);
    this.attachCanvasEvents();
    renderCanvas(this.state, this.refs);
    applyView(this.refs, this.view);
    this.syncChrome();
  }

  private iconButton(label: string, path: string, action: () => void): HTMLButtonElement {
    const compact = this.mode !== 'wide';
    const button = el('button', { type: 'button', class: 'icon', 'aria-label': label });
    if (compact) {
      button.append(icon(path));
    } else {
      button.textContent = label;
    }
    button.addEventListener('click', action);
    return button;
  }

  private renderTabs(): void {
    this.tabList.replaceChildren(
      ...this.state.diagram.pages.map((page) => {
        const selected = page.id === this.state.pageId;
        const tab = el('button', {
          type: 'button',
          role: 'tab',
          'aria-selected': selected ? 'true' : 'false',
          'data-page': page.id,
          text: page.name,
        });
        tab.addEventListener('click', () => {
          if (page.id === this.state.pageId) return;
          void navigate(pagePath(this.state.diagram.id, page.id));
        });
        return tab;
      }),
    );
  }

  private syncChrome(): void {
    this.saveStatus.textContent = this.state.saveStateText();
    this.zoomStatus.textContent = `${Math.floor(this.view.zoom * 100 + 0.5)}%`;
    this.library?.sync();
    const banners: HTMLElement[] = [];
    if (this.state.storageDown) {
      banners.push(el('div', { class: 'alert', role: 'alert', text: COPY.storageOutage }));
    }
    if (this.state.banner === 'downgrade') {
      banners.push(el('div', { class: 'alert', role: 'alert', text: COPY.downgradeBanner }));
    }
    if (this.state.banner === 'conflict') {
      const reload = el('button', { type: 'button', text: 'Reload page' });
      reload.addEventListener('click', () => void this.state.reloadFromServer());
      banners.push(
        el('div', { class: 'alert', role: 'alert' }, [el('span', { text: COPY.versionConflict }), reload]),
      );
    }
    if (this.state.banner === 'generic') {
      banners.push(el('div', { class: 'alert', role: 'alert', text: COPY.genericFailure }));
    }
    this.bannerHost.replaceChildren(...banners);
  }

  private async pollStatus(): Promise<void> {
    try {
      const status = await api.get<PlatformStatus>('/api/status');
      const down = status.storage === 'down';
      if (down !== this.state.storageDown) {
        this.state.storageDown = down;
        this.syncChrome();
      }
    } catch {
      // A failed status check leaves the banner as it is.
    }
  }

  markStorageDown(): void {
    this.state.storageDown = true;
    this.syncChrome();
  }

  focusItem(id: string): void {
    focusItem(this.refs, id);
    this.state.focusedId = id;
    renderFocusRing(this.refs, id);
  }

  private restoreFocus(): void {
    const id = this.state.focusedId;
    if (!id) return;
    const active = document.activeElement;
    const insideCanvas = active instanceof Element && this.refs.pane.contains(active);
    if (insideCanvas || active === document.body) this.focusItem(id);
  }

  openInspectorFor(id: string): void {
    this.state.select([id], id);
    if (this.mode !== 'wide' && !this.inspectorDrawer) this.openInspectorDrawer();
  }

  focusLabelField(): void {
    const field = this.inspector?.labelField();
    field?.focus();
    field?.select();
  }

  private libraryHandlers(): Parameters<typeof createLibrary>[0] {
    return {
      addShape: (kind) => {
        this.librarySheet?.close();
        this.librarySheet = null;
        addShapeOfKind(this, kind);
      },
      addZone: (kind) => {
        this.librarySheet?.close();
        this.librarySheet = null;
        addZoneOfKind(this, kind);
      },
      canAddZone: () => this.state.doc.zones.length < 20,
      readOnly: () => this.state.readOnly,
    };
  }

  private inspectorHandlers(): Parameters<typeof createInspector>[1] {
    return {
      setShapeLabel: (id, label) => setShapeLabelOf(this, id, label),
      setShapeKind: (id, kind) => setShapeKindOf(this, id, kind),
      setGeometry: (id, values) => setGeometryOf(this, id, values),
      setZoneName: (id, name) => setZoneFieldOf(this, id, { name }),
      setZoneKind: (id, kind) => setZoneFieldOf(this, id, { kind }),
      setZoneNote: (id, note) => setZoneFieldOf(this, id, { note }),
      setConnectorLabel: (id, label) => setConnectorLabelOf(this, id, label),
      align: (edge) => alignSelected(this, edge),
      layer: (direction) => changeLayerOf(this, direction),
      group: () => groupSelected(this),
      ungroup: () => ungroupSelected(this),
      duplicate: () => duplicateSelected(this),
      remove: () => deleteSelected(this),
      commitLabel: () => {
        const id = this.state.focusedId;
        this.inspectorDrawer?.close();
        this.inspectorDrawer = null;
        if (id) this.focusItem(id);
      },
      cancelLabel: () => {
        const id = this.state.focusedId;
        this.inspectorDrawer?.close();
        this.inspectorDrawer = null;
        if (id) this.focusItem(id);
      },
    };
  }

  private openInspectorDrawer(): void {
    if (this.inspectorDrawer) return;
    const view = createInspector(this.state, this.inspectorHandlers(), 'drawer');
    const close = el('button', { type: 'button', 'aria-label': 'Close inspector' }, [icon(ICONS.close)]);
    const content = el('div', {}, [close, view.element]);
    this.inspector = view;
    this.inspectorDrawer = openPanel(content, {
      labelledBy: 'Inspector',
      className: 'drawer',
      hostClassName: 'drawer-host',
      initialFocus: () => view.firstField() ?? close,
      onClose: () => {
        this.inspectorDrawer = null;
        this.inspector = null;
      },
    });
    close.addEventListener('click', () => {
      this.inspectorDrawer?.close();
      this.inspectorDrawer = null;
    });
  }

  private openLibrarySheet(): void {
    if (this.librarySheet) return;
    const view = createLibrary(this.libraryHandlers(), 'sheet');
    const close = el('button', { type: 'button', 'aria-label': 'Close shape library' }, [icon(ICONS.close)]);
    const content = el('div', {}, [close, view.element]);
    this.library = view;
    this.librarySheet = openPanel(content, {
      labelledBy: 'Shape library',
      className: 'sheet',
      hostClassName: 'sheet-host',
      initialFocus: () => content.querySelector<HTMLElement>('input') ?? close,
      onClose: () => {
        this.librarySheet = null;
        this.library = null;
      },
    });
    close.addEventListener('click', () => {
      this.librarySheet?.close();
      this.librarySheet = null;
    });
  }

  private openShare(): void {
    openShareDialog({
      diagramId: this.state.diagram.id,
      ownerEmail: sessionState.user?.email ?? '',
      ownerName: this.state.diagram.ownerName,
    });
  }

  private openFiles(): void {
    openFilesDialog({
      diagramId: this.state.diagram.id,
      role: this.state.role,
      onStorageError: () => this.markStorageDown(),
    });
  }

  private openImport(): void {
    openImportDialog({
      diagramId: this.state.diagram.id,
      onImported: (record: ImportRecord) => void this.afterImport(record),
      onStorageError: () => this.markStorageDown(),
    });
  }

  private async afterImport(record: ImportRecord): Promise<void> {
    const body = await api.get<{ diagram: DiagramDetail }>(`/api/diagrams/${this.state.diagram.id}`);
    this.state.diagram.pages = body.diagram.pages;
    this.renderTabs();
    await navigate(pagePath(this.state.diagram.id, record.pageId), { settle: false });
    const tab = document.querySelector<HTMLElement>(`[data-page="${CSS.escape(record.pageId)}"]`);
    tab?.focus();
  }

  private zoomBy(steps: number): void {
    const percent = Math.floor(this.view.zoom * 100 + 0.5);
    const next =
      steps > 0 ? Math.min(400, (Math.floor(percent / 25) + 1) * 25) : Math.max(25, (Math.ceil(percent / 25) - 1) * 25);
    const size = this.paneSize();
    this.zoomTo(next / 100, size.width / 2, size.height / 2);
  }

  private zoomTo(zoom: number, originX: number, originY: number): void {
    const clamped = Math.min(4, Math.max(0.25, zoom));
    const ratio = clamped / this.view.zoom;
    this.view.panX = originX - (originX - this.view.panX) * ratio;
    this.view.panY = originY - (originY - this.view.panY) * ratio;
    this.view.zoom = clamped;
    applyView(this.refs, this.view);
    this.syncChrome();
  }

  private attachCanvasEvents(): void {
    const pane = this.refs.pane;
    pane.addEventListener('focusin', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const holder = target.closest('[data-id]');
      const id = holder?.getAttribute('data-id');
      if (id) {
        this.state.focusedId = id;
        renderFocusRing(this.refs, id);
        if (holder?.getAttribute('data-kind') === 'shape') renderPorts(this.state, this.refs, id);
      }
    });
    pane.addEventListener('focusout', (event) => {
      const next = event.relatedTarget;
      if (next instanceof Element && pane.contains(next)) return;
      renderFocusRing(this.refs, null);
      renderPorts(this.state, this.refs, null);
    });
    pane.addEventListener('pointerover', (event) => {
      const target = event.target;
      const holder = target instanceof Element ? target.closest('[data-kind="shape"]') : null;
      const id = holder?.getAttribute('data-id');
      if (id) renderPorts(this.state, this.refs, id);
    });
    pane.addEventListener('dragover', (event) => {
      if (!this.state.canEdit) return;
      event.preventDefault();
    });
    pane.addEventListener('drop', (event) => {
      if (!this.state.canEdit) return;
      event.preventDefault();
      const payload = event.dataTransfer?.getData('text/x-scopewright-kind');
      if (!payload) return;
      const rect = pane.getBoundingClientRect();
      const at = {
        x: (event.clientX - rect.left - this.view.panX) / this.view.zoom,
        y: (event.clientY - rect.top - this.view.panY) / this.view.zoom,
      };
      const [kind, id] = payload.split(':');
      if (kind === 'shape' && isSystemKindId(id)) addShapeOfKind(this, id, at);
      else if (kind === 'zone' && isZoneKindId(id)) addZoneOfKind(this, id, at);
    });
    pane.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    pane.addEventListener('pointermove', (event) => this.onPointerMove(event));
    pane.addEventListener('pointerup', (event) => this.onPointerUp(event));
    pane.addEventListener('pointercancel', (event) => this.onPointerUp(event));
    pane.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        if (event.ctrlKey) {
          const rect = pane.getBoundingClientRect();
          const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
          this.zoomTo(this.view.zoom * factor, event.clientX - rect.left, event.clientY - rect.top);
          return;
        }
        this.view.panX -= event.deltaX;
        this.view.panY -= event.deltaY;
        applyView(this.refs, this.view);
      },
      { passive: false },
    );
  }

  private canvasPoint(event: PointerEvent): { x: number; y: number } {
    const rect = this.refs.pane.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private onPointerDown(event: PointerEvent): void {
    if (isGateOpen() || topPanel()) return;
    // The default mouse behaviour would move focus off the canvas item.
    event.preventDefault();
    this.pointerState.set(event.pointerId, this.canvasPoint(event));
    if (this.pointerState.size >= 2) {
      this.cancelDrag();
      const points = [...this.pointerState.values()];
      const a = points[0];
      const b = points[1];
      if (!a || !b) return;
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      this.pinch = {
        distance: Math.hypot(b.x - a.x, b.y - a.y),
        zoom: this.view.zoom,
        canvasX: (midX - this.view.panX) / this.view.zoom,
        canvasY: (midY - this.view.panY) / this.view.zoom,
      };
      return;
    }
    const target = event.target;
    const holder = target instanceof Element ? target.closest('[data-id]') : null;
    const portNode = target instanceof Element ? target.closest('[data-port]') : null;
    const point = this.canvasPoint(event);
    const base = {
      startDoc: clonePage(this.state.doc),
      startX: point.x,
      startY: point.y,
      panX: this.view.panX,
      panY: this.view.panY,
      moved: false,
    };

    if (portNode && !this.state.readOnly) {
      const shapeId = portNode.getAttribute('data-port-shape');
      const port = portNode.getAttribute('data-port');
      if (shapeId && (port === 'n' || port === 'e' || port === 's' || port === 'w')) {
        this.drag = { kind: 'port', ...base, shapeId, port };
        this.refs.pane.setPointerCapture(event.pointerId);
        return;
      }
    }

    if (holder) {
      const id = holder.getAttribute('data-id') ?? '';
      const kind = holder.getAttribute('data-kind');
      const inHeader = target instanceof Element && target.closest('[data-zone-header]') !== null;
      if (event.shiftKey) {
        const selection = new Set(this.state.selection);
        if (selection.has(id)) selection.delete(id);
        else selection.add(id);
        this.state.select(expandSelection(this.state.doc, selection), id);
      } else if (!this.state.selection.has(id)) {
        this.state.select(expandSelection(this.state.doc, [id]), id);
      }
      this.focusItem(id);
      if (this.state.readOnly || this.state.conflicted) {
        this.drag = { kind: 'pan', ...base };
      } else if (kind === 'shape') {
        this.drag = { kind: 'shape', ...base };
      } else if (kind === 'zone' && inHeader) {
        this.drag = { kind: 'zone', ...base };
      } else {
        this.drag = { kind: 'pan', ...base };
      }
      this.refs.pane.setPointerCapture(event.pointerId);
      return;
    }

    this.drag = { kind: 'pan', ...base };
    this.refs.pane.setPointerCapture(event.pointerId);
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.pointerState.has(event.pointerId)) this.pointerState.set(event.pointerId, this.canvasPoint(event));
    if (this.pinch && this.pointerState.size >= 2) {
      const points = [...this.pointerState.values()];
      const a = points[0];
      const b = points[1];
      if (!a || !b) return;
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      if (distance <= 0) return;
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const zoom = Math.min(4, Math.max(0.25, (this.pinch.zoom * distance) / this.pinch.distance));
      this.view.zoom = zoom;
      this.view.panX = midX - this.pinch.canvasX * zoom;
      this.view.panY = midY - this.pinch.canvasY * zoom;
      applyView(this.refs, this.view);
      this.syncChrome();
      return;
    }
    const drag = this.drag;
    if (!drag) return;
    const point = this.canvasPoint(event);
    const dxScreen = point.x - drag.startX;
    const dyScreen = point.y - drag.startY;
    if (Math.abs(dxScreen) > 2 || Math.abs(dyScreen) > 2) drag.moved = true;
    if (drag.kind === 'pan') {
      this.view.panX = drag.panX + dxScreen;
      this.view.panY = drag.panY + dyScreen;
      applyView(this.refs, this.view);
      return;
    }
    if (drag.kind === 'port') return;
    const step = 8;
    const dx = Math.round(dxScreen / this.view.zoom / step) * step;
    const dy = Math.round(dyScreen / this.view.zoom / step) * step;
    if (dx === 0 && dy === 0) return;
    const selection = expandSelection(drag.startDoc, this.state.selection);
    const outcome = translateSelection(drag.startDoc, selection, dx, dy);
    if (!outcome.ok) return;
    drag.outcome = outcome.doc;
    drag.movedShapeIds = outcome.movedShapeIds;
    drag.movedZoneIds = outcome.movedZoneIds;
    this.state.preview(outcome.doc);
    renderCanvas(this.state, this.refs);
    applyView(this.refs, this.view);
  }

  private onPointerUp(event: PointerEvent): void {
    this.pointerState.delete(event.pointerId);
    if (this.pointerState.size < 2) this.pinch = null;
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    if (drag.kind === 'port') {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      const holder = target instanceof Element ? target.closest('[data-kind="shape"]') : null;
      const targetId = holder?.getAttribute('data-id');
      if (targetId && drag.shapeId && drag.port) connectFromPort(this, drag.shapeId, drag.port, targetId);
      return;
    }
    if (drag.kind === 'pan' || !drag.moved) return;
    const outcome = drag.outcome;
    this.state.preview(drag.startDoc);
    if (!outcome) {
      if (drag.kind === 'zone') announce(COPY.overlapRefusal);
      renderCanvas(this.state, this.refs);
      applyView(this.refs, this.view);
      return;
    }
    const meta: {
      movedShapeIds?: string[];
      zoneAction?: { zoneId: string; kind: 'moved' | 'resized' };
    } = { movedShapeIds: [...(drag.movedShapeIds ?? [])] };
    const movedZone = [...(drag.movedZoneIds ?? [])][0];
    if (movedZone) meta.zoneAction = { zoneId: movedZone, kind: 'moved' };
    this.state.applyEdit(outcome, meta);
  }

  private cancelDrag(): void {
    const drag = this.drag;
    this.drag = null;
    if (!drag || drag.kind === 'pan' || drag.kind === 'port') return;
    this.state.preview(drag.startDoc);
    renderCanvas(this.state, this.refs);
    applyView(this.refs, this.view);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (isGateOpen()) return;
    const target = event.target;
    const inField =
      target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
    const inPanel = topPanel() !== null;
    if (inField) return;
    if (inPanel && !this.inspectorDrawer) return;

    if (hasModifier(event) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void this.state.saveNow();
      return;
    }
    if (hasModifier(event) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.state.redo();
      else this.state.undo();
      return;
    }
    if (hasModifier(event) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.state.redo();
      return;
    }
    if (hasModifier(event) && event.key.toLowerCase() === 'g') {
      event.preventDefault();
      if (event.shiftKey) ungroupSelected(this);
      else groupSelected(this);
      return;
    }
    if (hasModifier(event) && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      duplicateSelected(this);
      return;
    }
    if (hasModifier(event) && (event.key === ']' || event.key === '[')) {
      event.preventDefault();
      changeLayerOf(this, event.key === ']' ? 'forward' : 'backward');
      return;
    }
    if (event.key.startsWith('Arrow')) {
      const edge =
        event.key === 'ArrowLeft'
          ? 'left'
          : event.key === 'ArrowRight'
            ? 'right'
            : event.key === 'ArrowUp'
              ? 'top'
              : 'bottom';
      if (event.altKey && event.shiftKey) {
        event.preventDefault();
        alignSelected(this, edge);
        return;
      }
      const inside = document.activeElement instanceof Element && this.refs.pane.contains(document.activeElement);
      if (!inside) return;
      event.preventDefault();
      const focused = this.state.focusedId;
      if (focused && !this.state.selection.has(focused)) this.state.select([focused], focused);
      const step = event.shiftKey ? 24 : 8;
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      moveSelection(this, dx, dy);
      return;
    }
    if (event.key === 'Tab') {
      this.handleTab(event);
      return;
    }
    if (event.key === ' ' || event.key === 'Spacebar') {
      const focused = this.state.focusedId;
      const inside = document.activeElement instanceof Element && this.refs.pane.contains(document.activeElement);
      if (!focused || !inside) return;
      event.preventDefault();
      if (event.shiftKey) {
        const selection = new Set(this.state.selection);
        if (selection.has(focused)) selection.delete(focused);
        else selection.add(focused);
        this.state.select(expandSelection(this.state.doc, selection), focused);
      } else {
        this.state.select(expandSelection(this.state.doc, [focused]), focused);
      }
      this.focusItem(focused);
      return;
    }
    if (event.key === 'Escape') {
      if (this.state.connectFrom) {
        const source = this.state.connectFrom;
        this.state.connectFrom = null;
        this.focusItem(source);
        return;
      }
      this.state.select([], this.state.focusedId);
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (this.state.selection.size === 0) return;
      event.preventDefault();
      deleteSelected(this);
      return;
    }
    if (event.key === 'c' || event.key === 'C') {
      const focused = this.state.focusedId;
      if (!focused || !this.state.doc.shapes.some((shape) => shape.id === focused)) return;
      if (!this.state.canEdit) return;
      this.state.connectFrom = focused;
      announce(COPY.connectPrompt);
      return;
    }
    if (event.key === 'Enter' || event.key === 'F2') {
      const focused = this.state.focusedId;
      if (!focused) return;
      if (this.state.connectFrom) {
        const source = this.state.connectFrom;
        this.state.connectFrom = null;
        connectShapes(this, source, focused);
        return;
      }
      const isShape = this.state.doc.shapes.some((shape) => shape.id === focused);
      const isConnector = this.state.doc.connectors.some((connector) => connector.id === focused);
      if (!isShape && !isConnector) return;
      event.preventDefault();
      this.openInspectorFor(focused);
      window.setTimeout(() => this.focusLabelField(), 0);
    }
  };

  private handleTab(event: KeyboardEvent): void {
    const active = document.activeElement;
    if (!(active instanceof Element) || !this.refs.pane.contains(active)) return;
    const order = readingOrder(this.state.doc).map((entry) => entry.id);
    if (this.state.connectFrom) {
      const shapes = readingOrder(this.state.doc)
        .filter((entry) => entry.kind === 'shape' && entry.id !== this.state.connectFrom)
        .map((entry) => entry.id);
      if (shapes.length === 0) return;
      event.preventDefault();
      const current = shapes.indexOf(this.state.focusedId ?? '');
      const next = event.shiftKey
        ? (current - 1 + shapes.length) % shapes.length
        : (current + 1) % shapes.length;
      const id = shapes[next];
      if (id) this.focusItem(id);
      return;
    }
    const holder = active.closest('[data-id]');
    const currentId = holder?.getAttribute('data-id');
    if (!currentId) {
      if (event.shiftKey || order.length === 0) return;
      event.preventDefault();
      const first = order[0];
      if (first) this.focusItem(first);
      return;
    }
    const index = order.indexOf(currentId);
    const nextIndex = event.shiftKey ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= order.length) return;
    event.preventDefault();
    const id = order[nextIndex];
    if (id) this.focusItem(id);
  }
}
