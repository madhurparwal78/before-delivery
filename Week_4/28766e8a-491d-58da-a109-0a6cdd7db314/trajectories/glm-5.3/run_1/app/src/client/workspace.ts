import type { Document, Page, Shape, Connector, Layer, Role, UserRecord, DocumentOp, OperationRequest, OpAcknowledgement, CommentRecord, VersionRecord } from '../shared/model.js';
import { LIMITS } from '../shared/model.js';
import { el, svgEl, cloneDocument } from './dom.js';
import { Session } from './session.js';
import { shapeLabel } from '../shared/ids.js';
import {
  portPosition, defaultPortPair, snap, snapResize, insertionPosition,
  shapeBox, boundingBox, boxesOverlap, alignUnits, distributeUnits, type AlignSide,
} from '../shared/geometry.js';
import { routePage, labelAnchor, connectorShown, type RouteResult } from '../shared/router.js';
import { readingOrder, buildOutline, type OutlineItem } from '../shared/outline.js';
import * as copy from '../shared/copy.js';
import { rangeMessage, multiLabel } from '../shared/copy.js';
import { lockedNotice, lockedLayerDescription } from '../shared/copy.js';

export interface WorkspaceDeps {
  document: Document;
  role: Role;
  user: UserRecord;
  diagramId: string;
  versionId: string | null;
  ownerName: string;
}

export type ZoomStep = 25 | 50 | 75 | 100 | 150 | 200 | 300 | 400;
const ZOOM_STEPS: ZoomStep[] = [25, 50, 75, 100, 150, 200, 300, 400];

export class Workspace {
  private container: HTMLElement;
  private session: Session;
  private deps: WorkspaceDeps;
  private pageId: string;
  private selection: string[] = [];
  private focusedShape: string | null = null;
  private snapOn = true;
  private zoom = 100;
  private viewX = 0;
  private viewY = 0;
  private connectMode: { source: string; targetIndex: number; port: 'n' | 'e' | 's' | 'w' | null; targetHighlight: string } | null = null;
  private draftField: { field: string; value: string } | null = null;
  private reducedMotion = false;
  private dialogs: { element: HTMLElement; opener: HTMLElement | null; onClose?: () => void } | null = null;
  private comments: CommentRecord[] = [];
  private versions: VersionRecord[] = [];
  private latestExport: { id: string; format: string; status: string } | null = null;
  private queuedNoticePending = false;
  private savedTimer: number | null = null;
  private cursorSendLast = 0;
  private draftLabel: { shapeId: string; value: string } | null = null;

  // DOM references
  private svg!: SVGSVGElement;
  private shapesLayer!: SVGGElement;
  private connectorsLayer!: SVGGElement;
  private overlayLayer!: SVGGElement;
  private emptyPageText!: HTMLElement;
  private inspectorHeading!: HTMLElement;
  private fields: Record<'x' | 'y' | 'w' | 'h', HTMLInputElement> = {} as never;
  private labelField!: HTMLInputElement;
  private layerSelect!: HTMLSelectElement;
  private pageListEl!: HTMLElement;
  private layerListEl!: HTMLElement;
  private pageStripText!: HTMLElement;
  private zoomReadout!: HTMLElement;
  private connectionStatus!: HTMLElement;
  private bannerRow!: HTMLElement;
  private presenceRow!: HTMLElement;
  private announcer!: HTMLElement;
  private outlineTree!: HTMLElement;
  private commentsListEl!: HTMLElement;
  private historyListEl!: HTMLElement;
  private presencePeople = new Map<string, { name: string; role: string }>();

  constructor(container: HTMLElement, deps: WorkspaceDeps) {
    this.container = container;
    this.deps = deps;
    this.pageId = deps.document.pages[0]?.id ?? '';
    this.session = new Session(deps.document, deps.role, deps.user);
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = media.matches;
    media.addEventListener('change', (e) => { this.reducedMotion = e.matches; });
  }

  async start(): Promise<void> {
    this.buildLayout();
    this.renderAll();
    this.session.connect(this.deps.diagramId, {
      onServerEvent: (kind, payload) => this.onServerEvent(kind, payload),
      onReconnect: () => { this.connectionLostResolved(); this.updateConnection(); },
      onOffline: () => this.updateConnection(),
      onSessionEnded: () => { this.updateConnection(); this.openSignInDialog(); },
      onNotFound: () => this.showNotFound(),
      onQueued: () => this.updateConnection(),
      onQueueEmpty: () => this.showSavedBanner(),
      onAck: (opId, ack, label) => this.onAck(opId, ack, label),
      onReplayed: (opId, ack, label) => this.onAck(opId, ack, label, true),
      onRefused: (opId, code, message) => this.onRefused(opId, code, message),
    });
    await this.loadComments();
    await this.loadVersions();
    await this.loadLatestExport();
  }

  // ---- Layout construction ----

  private buildLayout(): void {
    const canEdit = this.deps.role === 'owner' || this.deps.role === 'editor';
    const isViewer = !canEdit;

    this.announcer = el('div', { id: 'announcer', 'aria-live': 'polite' });

    // Top bar
    const title = el('h1', { class: 'diagram-title', role: 'heading', 'aria-level': '1', text: this.deps.document.title });
    this.presenceRow = el('div', { class: 'presence-row' });
    const shareBtn: HTMLElement | null = this.deps.role === 'owner'
      ? el('button', { 'aria-label': 'Share', text: 'Share', onclick: () => this.openShareDialog(shareBtn as HTMLElement) })
      : null;
    const exportBtn: HTMLElement | null = canEdit
      ? el('button', { 'aria-label': 'Export', text: 'Export', onclick: () => this.openExportDialog(exportBtn as HTMLElement) })
      : null;
    const outlineBtn: HTMLElement = el('button', { 'aria-label': 'Outline', text: 'Outline', onclick: () => this.openOutlinePanel(outlineBtn) });
    this.latestExportLink = el('a', { href: '#', class: 'hidden', 'aria-label': 'Download latest export', text: 'Download latest export' });
    const topBar = el('header', { class: 'top-bar' }, title, this.presenceRow,
      shareBtn, exportBtn, outlineBtn, this.latestExportLink,
      el('button', { 'aria-label': 'Sign out', text: 'Sign out', onclick: () => { void this.signOut(); } }));

    // Banner row
    this.viewOnlyBanner = el('div', { class: 'banner hidden', text: copy.viewOnlyBanner(this.deps.ownerName) });
    this.previewBanner = el('div', { class: 'banner hidden' });
    this.pausedBanner = el('div', { class: 'banner hidden', text: copy.exportPausedBanner });
    this.connectionStatus = el('div', { role: 'status', 'aria-label': 'Connection', class: 'connection-status' });
    this.bannerRow = el('div', { class: 'banner-row' }, this.viewOnlyBanner, this.previewBanner, this.pausedBanner, this.connectionStatus);
    if (isViewer) this.viewOnlyBanner.classList.remove('hidden');
    if (this.deps.versionId) {
      this.showPreviewBanner(this.deps.versionId);
    }

    // Toolbar
    const alignMenu = el('div', { class: 'menu hidden', role: 'menu', 'aria-label': 'Align' });
    const alignItems: [string, () => void][] = [
      ['Align left', () => this.align('left')], ['Align centre', () => this.align('centre')],
      ['Align right', () => this.align('right')], ['Align top', () => this.align('top')],
      ['Align middle', () => this.align('middle')], ['Align bottom', () => this.align('bottom')],
      ['Distribute horizontally', () => this.distribute('h')],
      ['Distribute vertically', () => this.distribute('v')],
    ];
    const alignBtn: HTMLElement = el('button', { 'aria-label': 'Align', 'aria-haspopup': 'menu', text: 'Align', onclick: () => this.openMenu(alignBtn, alignMenu) });
    for (const [name, handler] of alignItems) {
      const item = el('div', { role: 'menuitem', tabindex: '-1', text: name, onclick: () => { handler(); this.closeMenu(); } });
      alignMenu.append(item);
    }
    const snapBtn = el('button', {
      'aria-label': 'Snap to grid', 'aria-pressed': 'true', text: 'Snap to grid',
      onclick: () => {
        this.snapOn = !this.snapOn;
        snapBtn.setAttribute('aria-pressed', String(this.snapOn));
      },
    });
    const undoBtn = el('button', { 'aria-label': 'Undo', text: 'Undo', onclick: () => this.session.undo() });
    const redoBtn = el('button', { 'aria-label': 'Redo', text: 'Redo', onclick: () => this.session.redo() });
    this.toolbar = el('div', { role: 'toolbar', 'aria-label': 'Tools', class: 'tools' },
      el('button', { 'aria-label': 'Rectangle', text: 'Rectangle', onclick: () => this.insertShape('rectangle') }),
      el('button', { 'aria-label': 'Ellipse', text: 'Ellipse', onclick: () => this.insertShape('ellipse') }),
      el('button', { 'aria-label': 'Diamond', text: 'Diamond', onclick: () => this.insertShape('diamond') }),
      el('button', { 'aria-label': 'Text', text: 'Text', onclick: () => this.insertShape('text') }),
      snapBtn, alignBtn, alignMenu, undoBtn, redoBtn,
    );
    if (!canEdit) this.toolbar.classList.add('hidden');

    // Left rail: pages and layers
    this.pageListEl = el('div', { role: 'list', class: 'page-list' });
    const pagesRegion = el('section', { role: 'region', 'aria-label': 'Pages' },
      el('div', { class: 'rail-heading', text: 'Pages' }),
      this.pageListEl,
      canEdit ? el('button', { 'aria-label': 'Add page', text: 'Add page', onclick: () => this.addPage() }) : null,
    );
    this.layerListEl = el('div', { role: 'list', class: 'layer-list' });
    const layersRegion = el('section', { role: 'region', 'aria-label': 'Layers' },
      el('div', { class: 'rail-heading', text: 'Layers' }),
      this.layerListEl,
      canEdit ? el('button', { 'aria-label': 'Add layer', text: 'Add layer', onclick: () => this.addLayer() }) : null,
    );
    this.leftRail = el('aside', { id: 'left-rail' }, pagesRegion, layersRegion);

    // Canvas
    this.svg = svgEl('svg', {
      id: 'canvas', role: 'graphics-document', 'aria-roledescription': 'diagram',
      tabindex: '0',
    });
    this.svg.classList.add('canvas-svg');
    this.connectorsLayer = svgEl('g', { class: 'connectors' });
    this.shapesLayer = svgEl('g', { class: 'shapes' });
    this.overlayLayer = svgEl('g', { class: 'overlay' });
    this.svg.append(this.connectorsLayer, this.shapesLayer, this.overlayLayer);
    this.canvasWrap = el('div', { class: 'canvas-wrap' }, this.svg, this.emptyPageText = el('div', { class: 'empty-page hidden', text: copy.emptyPageText }));

    // View controls
    this.zoomReadout = el('span', { id: 'zoom-readout', role: 'status', 'aria-label': 'Zoom', text: '100%' });
    const viewControls = el('div', { role: 'group', 'aria-label': 'View', class: 'view-controls' },
      el('button', { 'aria-label': 'Zoom out', text: '−', onclick: () => this.stepZoom(-1) }),
      this.zoomReadout,
      el('button', { 'aria-label': 'Zoom in', text: '+', onclick: () => this.stepZoom(1) }),
      el('button', { 'aria-label': 'Reset zoom', text: 'Reset', onclick: () => this.setZoom(100) }),
      this.layersBtn = el('button', { 'aria-label': 'Layers', 'aria-expanded': 'false', text: 'Layers', onclick: () => this.toggleLayersRail() }),
      this.inspectorBtn = el('button', { 'aria-label': 'Toggle inspector', 'aria-expanded': 'true', text: 'Inspector', onclick: () => this.toggleInspectorRail() }),
    );

    // Page strip
    this.pageStripText = el('span', { class: 'page-strip-text' });
    const pageStrip = el('div', { id: 'page-strip', class: 'page-strip' },
      el('button', { 'aria-label': 'Previous page', text: '‹', onclick: () => this.switchPageBy(-1) }),
      this.pageStripText,
      el('button', { 'aria-label': 'Next page', text: '›', onclick: () => this.switchPageBy(1) }),
    );

    // Inspector rail
    this.inspectorHeading = el('div', { id: 'inspector-heading', class: 'inspector-heading', text: 'Nothing selected' });
    const fieldsBox = el('div', { class: 'inspector-fields' },
      this.fields['x'] = el('input', { type: 'number', 'aria-label': 'X', role: 'spinbutton' }) as HTMLInputElement,
      this.fields['y'] = el('input', { type: 'number', 'aria-label': 'Y', role: 'spinbutton' }) as HTMLInputElement,
      this.fields['w'] = el('input', { type: 'number', 'aria-label': 'Width', role: 'spinbutton' }) as HTMLInputElement,
      this.fields['h'] = el('input', { type: 'number', 'aria-label': 'Height', role: 'spinbutton' }) as HTMLInputElement,
    );
    this.layerSelect = el('select', { 'aria-label': 'Layer', role: 'combobox' }) as HTMLSelectElement;
    this.labelField = el('input', { type: 'text', 'aria-label': 'Label' }) as HTMLInputElement;
    const inspectorTab = el('div', { class: 'tab-panel', role: 'tabpanel', 'aria-label': 'Inspector' },
      this.inspectorHeading, fieldsBox,
      el('label', { class: 'field-label', text: 'Label' }, this.labelField),
      el('label', { class: 'field-label', text: 'Layer' }, this.layerSelect),
    );
    this.commentsListEl = el('div', { class: 'tab-panel comments-panel' });
    this.historyListEl = el('div', { class: 'tab-panel history-panel' });
    const tablist = el('div', { role: 'tablist', class: 'tablist' },
      this.inspectorTab = el('button', { role: 'tab', 'aria-selected': 'true', text: 'Inspector', onclick: () => this.showTab('inspector') }),
      this.commentsTab = el('button', { role: 'tab', 'aria-selected': 'false', text: 'Comments', onclick: () => this.showTab('comments') }),
      this.historyTab = el('button', { role: 'tab', 'aria-selected': 'false', text: 'History', onclick: () => this.showTab('history') }),
    );
    this.inspectorRail = el('aside', { id: 'inspector-rail', 'data-motion': 'open', 'data-progress': '1.00' },
      tablist, inspectorTab, this.commentsListEl, this.historyListEl);
    this.showTab('inspector');

    // Bottom toolbar (<768px)
    this.bottomToolbar = el('div', { id: 'bottom-toolbar', class: 'bottom-toolbar' },
      el('button', { 'aria-label': 'Layers', text: 'Layers', onclick: (e: Event) => this.openBottomSheet('Layers', (e.target as HTMLElement)) }),
      el('button', { 'aria-label': 'Inspector', text: 'Inspector', onclick: (e: Event) => this.openBottomSheet('Inspector', (e.target as HTMLElement)) }),
      el('button', { 'aria-label': 'Comments', text: 'Comments', onclick: (e: Event) => this.openBottomSheet('Comments', (e.target as HTMLElement)) }),
      el('button', { 'aria-label': 'History', text: 'History', onclick: (e: Event) => this.openBottomSheet('History', (e.target as HTMLElement)) }),
      el('button', { 'aria-label': 'Shape actions', text: 'Actions', onclick: (e: Event) => this.openShapeActionsMenu(e.target as HTMLElement) }),
      canEdit ? el('button', { 'aria-label': 'Insert', text: 'Insert', onclick: (e: Event) => this.openInsertMenu(e.target as HTMLElement) }) : null,
    );

    // Wire field events
    for (const key of ['x', 'y', 'w', 'h'] as const) {
      const field = this.fields[key];
      field.addEventListener('keydown', (e) => this.fieldKeydown(key, e));
      field.addEventListener('input', () => { this.draftField = { field: key, value: field.value }; });
    }
    this.labelField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.commitLabelField();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.labelField.value = this.selectedShape()?.label ?? '';
      }
    });

    const main = el('div', { class: 'workspace' }, topBar, this.bannerRow, this.toolbar,
      el('div', { class: 'workspace-main' }, this.leftRail, this.canvasWrap, this.inspectorRail),
      pageStrip, viewControls, this.bottomToolbar, this.announcer);

    this.container.append(main);
    this.attachCanvasEvents();
    this.attachKeyboard();
    void viewControls;
  }

  private toolbar!: HTMLElement;
  private leftRail!: HTMLElement;
  private inspectorRail!: HTMLElement;
  private bottomToolbar!: HTMLElement;
  private canvasWrap!: HTMLElement;
  private layersBtn!: HTMLButtonElement;
  private inspectorBtn!: HTMLButtonElement;
  private inspectorTab!: HTMLButtonElement;
  private commentsTab!: HTMLButtonElement;
  private historyTab!: HTMLButtonElement;
  private latestExportLink!: HTMLAnchorElement;
  private viewOnlyBanner!: HTMLElement;
  private previewBanner!: HTMLElement;
  private pausedBanner!: HTMLElement;

  // ---- Rendering ----

  private page(): Page {
    return this.session.document.pages.find((p) => p.id === this.pageId)
      ?? this.session.document.pages[0]!;
  }

  private renderAll(): void {
    this.renderCanvas();
    this.renderInspector();
    this.renderRails();
    this.renderPageStrip();
    this.renderComments();
    this.renderHistory();
    this.updateCanvasLabel();
  }

  private updateCanvasLabel(): void {
    this.svg.setAttribute('aria-label', `${this.page().name} canvas`);
  }

  private blockedIds = new Set<string>();

  private renderCanvas(overrides?: Map<string, { x: number; y: number; w: number; h: number }>): void {
    const page = this.page();
    const visible = new Set(page.layers.filter((l) => l.visible).map((l) => l.id));
    const routed = routePage(page, overrides);
    this.blockedIds = new Set<string>();
    for (const [id, result] of routed.routes) if (result.blocked) this.blockedIds.add(id);

    this.shapesLayer.replaceChildren();
    this.connectorsLayer.replaceChildren();

    const layersByOrder = [...page.layers].sort((a, b) => a.order - b.order);
    for (const layer of layersByOrder) {
      if (!layer.visible) continue;
      const shapes = page.shapes.filter((s) => s.layer === layer.id).sort((a, b) => a.z - b.z);
      const groups = new Map<string, SVGGElement>();
      for (const group of page.groups) {
        if (!group.members.some((m) => shapes.some((s) => s.id === m))) continue;
        const g = svgEl('g', { id: `group-${group.id}`, role: 'group', 'aria-label': `Group of ${group.members.length} shapes` });
        groups.set(group.id, g);
      }
      for (const shape of shapes) {
        const box = overrides?.get(shape.id) ?? { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
        const g = svgEl('g', {
          id: `shape-${shape.id}`, role: 'graphics-symbol',
          'aria-roledescription': shape.kind, 'aria-label': shapeLabel(shape),
          'data-x': Math.round(box.x), 'data-y': Math.round(box.y),
          'data-w': Math.round(box.w), 'data-h': Math.round(box.h),
          'data-layer': shape.layer, tabindex: '-1',
        });
        if (layer.locked) g.setAttribute('aria-description', lockedLayerDescription(layer.name));
        if (this.selection.includes(shape.id)) g.setAttribute('data-selected', 'true');
        const body = this.shapeMarkup(shape, box);
        g.append(body);
        if (shape.label.length > 0) {
          const text = svgEl('text', { x: box.x + box.w / 2, y: box.y + box.h / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
          text.textContent = shape.label;
          g.append(text);
        }
        if (this.focusedShape === shape.id) g.classList.add('focused');
        const parent = shape.group ? groups.get(shape.group) : null;
        if (parent) parent.append(g);
        else this.shapesLayer.append(g);
        if (layer.locked) {
          const lock = svgEl('g', { 'aria-hidden': 'true', class: 'lock-icon' });
          const padlock = svgEl('path', { d: lockIconPath(box.x + 6, box.y + 6) });
          lock.append(padlock);
          this.overlayTarget(lock);
        }
      }
      for (const g of groups.values()) this.shapesLayer.append(g);
    }

    for (const connector of page.connectors) {
      if (!connectorShown(connector, page, visible)) continue;
      const result = routed.routes.get(connector.id) as RouteResult | undefined;
      const route = result?.route ?? connector.route;
      if (result?.blocked) this.blockedIds.add(connector.id);
      const from = page.shapes.find((s) => s.id === connector.from.shape);
      const to = page.shapes.find((s) => s.id === connector.to.shape);
      const name = (result?.blocked ? copy.blockedConnectorName : copy.connectorName)(
        from ? shapeLabel(from) : '', to ? shapeLabel(to) : '');
      const g = svgEl('g', {
        id: `connector-${connector.id}`, role: 'graphics-symbol', 'aria-roledescription': 'connector',
        'aria-label': name,
        'data-points': route.map((p) => `${p[0]},${p[1]}`).join(' '),
        'data-from': `${connector.from.shape}:${connector.from.port}`,
        'data-to': `${connector.to.shape}:${connector.to.port}`,
      });
      if (result?.blocked) g.setAttribute('data-blocked', 'true');
      const path = svgEl('path', { d: route.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' '), fill: 'none' });
      if (result?.blocked) path.classList.add('blocked');
      g.append(path);
      if (connector.label.length > 0) {
        const anchor = labelAnchor(route);
        const text = svgEl('text', { class: 'connector-label', x: anchor.x, y: anchor.y, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
        text.textContent = connector.label;
        g.append(text);
      }
      this.connectorsLayer.append(g);
    }

    // Comment pins
    for (const comment of this.comments) {
      if (comment.resolved || !comment.anchored) continue;
      const shape = page.shapes.find((s) => s.id === comment.shape);
      if (!shape || !visible.has(shape.layer)) continue;
      const pin = svgEl('g');
      const button = el('button', { id: `pin-${comment.id}`, 'aria-label': `Comment by ${comment.author.name} on ${shapeLabel(shape)}` });
      button.classList.add('comment-pin');
      const foreign = svgEl('foreignObject', { x: shape.x + shape.w - 8, y: shape.y - 8, width: 20, height: 20 });
      foreign.append(button);
      pin.append(foreign);
      this.overlayTarget(pin);
      button.addEventListener('click', () => { this.showTab('comments'); this.focusThread(comment.id); });
    }

    // Empty page text
    const hasVisibleShape = page.shapes.some((s) => visible.has(s.layer));
    this.emptyPageText.classList.toggle('hidden', hasVisibleShape);

    // Selection handles and port dots for connect mode
    this.renderHandles(overrides);
    this.renderPortDots(overrides);
    this.renderRemoteCursors();
  }

  private overlayStore: SVGElement[] = [];

  private overlayTarget(node: SVGElement): void {
    this.overlayStore.push(node);
    this.overlayLayer.append(node);
  }

  private shapeMarkup(shape: Shape, box: { x: number; y: number; w: number; h: number }): SVGElement {
    switch (shape.kind) {
      case 'rectangle':
        return svgEl('rect', { x: box.x, y: box.y, width: box.w, height: box.h });
      case 'ellipse':
        return svgEl('ellipse', { cx: box.x + box.w / 2, cy: box.y + box.h / 2, rx: box.w / 2, ry: box.h / 2 });
      case 'diamond': {
        const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
        return svgEl('polygon', { points: `${cx},${box.y} ${box.x + box.w},${cy} ${cx},${box.y + box.h} ${box.x},${cy}` });
      }
      case 'text':
        return svgEl('rect', { x: box.x, y: box.y, width: box.w, height: box.h, class: 'text-shape' });
    }
  }

  private renderHandles(overrides?: Map<string, { x: number; y: number; w: number; h: number }>): void {
    if (this.selection.length === 0) return;
    const page = this.page();
    const boxes = this.selection
      .map((id) => page.shapes.find((s) => s.id === id))
      .filter((s): s is Shape => s !== undefined)
      .map((s) => overrides?.get(s.id) ?? shapeBox(s));
    const box = boundingBox(boxes);
    const outline = svgEl('rect', { x: box.x, y: box.y, width: box.w, height: box.h, class: 'selection-outline' });
    this.overlayTarget(outline);
    for (const [cx, cy] of [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]]) {
      const handle = svgEl('rect', { x: cx - 5, y: cy - 5, width: 10, height: 10, class: 'selection-handle', 'data-handle-x': cx, 'data-handle-y': cy });
      this.overlayTarget(handle);
    }
  }

  private renderPortDots(overrides?: Map<string, { x: number; y: number; w: number; h: number }>): void {
    const page = this.page();
    const visible = new Set(page.layers.filter((l) => l.visible).map((l) => l.id));
    const dragSources = this.dragSources;
    const connectSource = this.connectMode?.source;
    const sources = new Set<string>([...dragSources]);
    if (connectSource) sources.add(connectSource);
    if (sources.size === 0) return;
    const candidates = connectSource
      ? readingOrder(page.shapes.filter((s) => s.id !== connectSource && visible.has(s.layer) && !this.isLayerLockedId(s.layer)))
      : readingOrder(page.shapes.filter((s) => sources.has(s.id)));
    for (const shape of candidates) {
      if (!connectSource && !sources.has(shape.id)) continue;
      if (!connectSource && !visible.has(shape.layer)) continue;
      const box = overrides?.get(shape.id) ?? shapeBox(shape);
      for (const port of ['n', 'e', 's', 'w'] as const) {
        const pos = portPosition(box, port);
        const dot = svgEl('circle', { class: 'port-dot', cx: pos.x, cy: pos.y, r: 5 });
        if (this.connectMode && this.connectMode.targetHighlight === shape.id && this.connectMode.port === port) {
          dot.classList.add('target-port');
        }
        this.overlayTarget(dot);
      }
      if (this.connectMode && this.connectMode.targetHighlight === shape.id) {
        const box2 = overrides?.get(shape.id) ?? shapeBox(shape);
        const outline = svgEl('rect', { x: box2.x, y: box2.y, width: box2.w, height: box2.h, class: 'connect-target' });
        this.overlayTarget(outline);
      }
    }
  }

  private dragSources = new Set<string>();

  private renderRemoteCursors(): void {
    for (const [userId, cursor] of this.remoteCursors) {
      const g = svgEl('g', { id: `cursor-${userId}`, 'data-cursor-of': userId, 'aria-hidden': 'true', class: 'remote-cursor' });
      const pointer = svgEl('path', { d: `M${cursor.x},${cursor.y} l0,14 l4,-4 l3,6 l3,-1 l-3,-6 l5,0 z` });
      const label = svgEl('text', { x: cursor.x + 12, y: cursor.y + 18 });
      label.textContent = cursor.name;
      g.append(pointer, label);
      this.overlayTarget(g);
    }
  }

  private remoteCursors = new Map<string, { x: number; y: number; name: string }>();

  private renderInspector(): void {
    const page = this.page();
    const shapes = this.selection
      .map((id) => page.shapes.find((s) => s.id === id))
      .filter((s): s is Shape => s !== undefined);
    if (shapes.length === 0) {
      this.inspectorHeading.textContent = 'Nothing selected';
      this.setFieldValue('x', '');
      this.setFieldValue('y', '');
      this.setFieldValue('w', '');
      this.setFieldValue('h', '');
      this.labelField.value = '';
      return;
    }
    if (shapes.length === 1) {
      const shape = shapes[0]!;
      this.inspectorHeading.textContent = shapeLabel(shape);
      this.setFieldValue('x', String(shape.x));
      this.setFieldValue('y', String(shape.y));
      this.setFieldValue('w', String(shape.w));
      this.setFieldValue('h', String(shape.h));
      if (document.activeElement !== this.labelField) this.labelField.value = shape.label;
    } else {
      const box = boundingBox(shapes.map(shapeBox));
      this.inspectorHeading.textContent = `${shapes.length} selected`;
      this.setFieldValue('x', String(box.x));
      this.setFieldValue('y', String(box.y));
      this.setFieldValue('w', String(box.w));
      this.setFieldValue('h', String(box.h));
      this.labelField.value = '';
    }
    const readonly = this.deps.role === 'viewer';
    for (const key of ['x', 'y', 'w', 'h'] as const) {
      this.fields[key].readOnly = readonly || (shapes.length > 1 && (key === 'w' || key === 'h'));
    }
    this.labelField.readOnly = readonly;
    this.layerSelect.replaceChildren();
    for (const layer of [...page.layers].sort((a, b) => b.order - a.order)) {
      const option = el('option', { value: layer.id, text: layer.name });
      this.layerSelect.append(option);
    }
    if (shapes.length === 1) this.layerSelect.value = shapes[0]!.layer;
    this.layerSelect.disabled = readonly;
  }

  private setFieldValue(key: 'x' | 'y' | 'w' | 'h', value: string): void {
    const field = this.fields[key];
    if (document.activeElement === field) return;
    if (this.draftField?.field === key) return;
    field.value = value;
  }

  private renderRails(): void {
    const canEdit = this.deps.role === 'owner' || this.deps.role === 'editor';
    const doc = this.session.document;
    this.pageListEl.replaceChildren();
    const pages = [...doc.pages].sort((a, b) => a.order - b.order);
    pages.forEach((page, index) => {
      const item = el('div', { role: 'listitem', class: 'rail-item' });
      const button = el('button', {
        role: 'button', 'aria-label': page.name, text: page.name,
        'aria-current': this.pageId === page.id ? 'page' : null,
        onclick: () => this.switchPage(page.id),
      });
      item.append(button);
      if (canEdit) {
        const rename = el('button', { 'aria-label': `Rename page ${page.name}`, text: 'Rename', onclick: () => this.renamePage(page) });
        const up = el('button', { 'aria-label': `Move page ${page.name} up`, text: '↑', onclick: () => this.reorderPage(page, -1) });
        const down = el('button', { 'aria-label': `Move page ${page.name} down`, text: '↓', onclick: () => this.reorderPage(page, 1) });
        const del = el('button', { 'aria-label': `Delete page ${page.name}`, text: 'Delete', onclick: () => this.openDeletePageDialog(page, del) });
        item.append(rename, up, down, del);
      }
      this.pageListEl.append(item);
      void index;
    });

    const page = this.page();
    this.layerListEl.replaceChildren();
    for (const layer of [...page.layers].sort((a, b) => b.order - a.order)) {
      const item = el('div', { role: 'listitem', class: 'rail-item' });
      const name = el('span', { text: layer.name });
      item.append(name);
      if (canEdit) {
        const hide = el('button', {
          'aria-label': layer.visible ? `Hide layer ${layer.name}` : `Show layer ${layer.name}`,
          'aria-pressed': String(!layer.visible),
          text: layer.visible ? 'Hide' : 'Show',
          onclick: () => this.toggleLayerVisible(layer),
        });
        const lock = el('button', {
          'aria-label': layer.locked ? `Unlock layer ${layer.name}` : `Lock layer ${layer.name}`,
          'aria-pressed': String(layer.locked),
          text: layer.locked ? 'Unlock' : 'Lock',
          onclick: () => this.toggleLayerLocked(layer),
        });
        item.append(hide, lock);
      }
      this.layerListEl.append(item);
    }
  }

  private renderPageStrip(): void {
    const pages = [...this.session.document.pages].sort((a, b) => a.order - b.order);
    const index = pages.findIndex((p) => p.id === this.pageId);
    const page = pages[index] ?? pages[0]!;
    this.pageStripText.textContent = copy.pageStripText(page.name, index + 1, pages.length);
  }

  private async renderComments(): Promise<void> {
    this.commentsListEl.replaceChildren();
    const composer = el('textarea', { 'aria-label': 'Comment', placeholder: 'Write a comment' });
    const post = el('button', { 'aria-label': 'Post comment', text: 'Post comment', onclick: () => {
      void this.postComment(composer.value, composer);
    } });
    this.commentsListEl.append(el('div', { class: 'comment-composer' }, composer, post));
    const threads = this.comments.filter((c) => c.parent === null);
    const open = threads.filter((c) => !c.resolved);
    const resolved = threads.filter((c) => c.resolved);
    for (const comment of open) {
      this.commentsListEl.append(this.renderThread(comment));
    }
    const heading = el('h3', { text: `Resolved (${resolved.length})`, role: 'heading', 'aria-level': '3' });
    this.commentsListEl.append(heading);
    for (const comment of resolved) {
      this.commentsListEl.append(this.renderThread(comment));
    }
  }

  private renderThread(comment: CommentRecord): HTMLElement {
    const thread = el('div', { class: 'comment-thread', 'data-comment': comment.id });
    const meta = el('div', { class: 'comment-meta', text: `${comment.author.name}` });
    const body = el('div', { class: 'comment-body', text: comment.text });
    const reply = el('button', { 'aria-label': 'Reply', text: 'Reply', onclick: () => {
      const box = el('textarea', { 'aria-label': 'Comment' });
      const send = el('button', { 'aria-label': 'Reply', text: 'Send', onclick: () => { void this.postComment(box.value, box, comment.id); } });
      thread.append(el('div', { class: 'comment-reply' }, box, send));
      box.focus();
    } });
    const resolve = el('button', { 'aria-label': 'Resolve', text: 'Resolve', onclick: () => void this.resolveComment(comment.id) });
    thread.append(meta, body, el('div', { class: 'comment-actions' }, reply, resolve));
    for (const child of this.comments.filter((c) => c.parent === comment.id)) {
      thread.append(el('div', { class: 'comment-child', text: `${child.author.name}: ${child.text}` }));
    }
    return thread;
  }

  private focusThread(commentId: string): void {
    const node = this.commentsListEl.querySelector(`[data-comment="${commentId}"]`) as HTMLElement | null;
    node?.scrollIntoView({ block: 'center' });
  }

  private async renderHistory(): Promise<void> {
    this.historyListEl.replaceChildren();
    if (this.deps.role === 'owner') {
      const save = el('button', { 'aria-label': 'Save version', text: 'Save version', onclick: () => this.openSaveVersionDialog(save) });
      this.historyListEl.append(save);
    }
    const list = el('div', { role: 'list', class: 'history-list' });
    for (const version of this.versions) {
      const item = el('div', { role: 'listitem' });
      const link = el('a', {
        href: `/d/${this.deps.diagramId}?page=${this.pageId}&version=${version.id}`,
        text: copy.historyListText(version.displayName, version.author.name, new Date(version.createdAt)),
        onclick: (e: Event) => { e.preventDefault(); this.previewVersion(version.id); },
      });
      item.append(link);
      if (this.deps.role === 'owner') {
        item.append(el('button', {
          'aria-label': 'Restore this version', text: 'Restore this version',
          onclick: () => void this.restoreVersion(version.id),
        }));
      }
      list.append(item);
    }
    this.historyListEl.append(list);
    if (this.deps.versionId) {
      this.historyListEl.append(el('button', {
        'aria-label': 'Back to latest', text: 'Back to latest',
        onclick: () => { history.pushState({}, '', `/d/${this.deps.diagramId}?page=${this.pageId}`); location.reload(); },
      }));
    }
  }

  // ---- Data loading ----

  private async loadComments(): Promise<void> {
    const res = await fetch(`/api/diagrams/${this.deps.diagramId}/comments`);
    if (!res.ok) return;
    const body = await res.json() as { comments: CommentRecord[] };
    this.comments = body.comments;
    this.renderComments();
    this.renderCanvas();
  }

  private async loadVersions(): Promise<void> {
    const res = await fetch(`/api/diagrams/${this.deps.diagramId}/versions`);
    if (!res.ok) return;
    const body = await res.json() as { versions: VersionRecord[] };
    this.versions = body.versions;
    this.renderHistory();
  }

  private async loadLatestExport(): Promise<void> {
    const res = await fetch(`/api/diagrams/${this.deps.diagramId}/exports`);
    if (!res.ok) return;
    const body = await res.json() as { exports: { id: string; status: string; format: string }[] };
    const ready = body.exports.filter((e) => e.status === 'ready');
    if (ready.length > 0) {
      this.latestExport = { id: ready[0]!.id, format: ready[0]!.format, status: 'ready' };
      this.latestExportLink.href = `/api/exports/${ready[0]!.id}/file`;
      this.latestExportLink.classList.remove('hidden');
    }
  }

  private async loadMembers(): Promise<void> {
    const res = await fetch(`/api/diagrams/${this.deps.diagramId}/members`);
    if (!res.ok) return;
    void res;
  }

  private async postComment(text: string, composer: HTMLTextAreaElement, parent?: string): Promise<void> {
    if (text.length === 0) return;
    const shapeId = this.selection[0] ?? this.focusedShape;
    if (!shapeId) return;
    const res = await fetch(`/api/diagrams/${this.deps.diagramId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shape: shapeId, text, parent: parent ?? null }),
    });
    if (!res.ok) return;
    composer.value = '';
    await this.loadComments();
  }

  private async resolveComment(commentId: string): Promise<void> {
    const res = await fetch(`/api/diagrams/${this.deps.diagramId}/comments/${commentId}/resolve`, { method: 'POST' });
    if (!res.ok) return;
    await this.loadComments();
  }

  private async previewVersion(versionId: string): Promise<void> {
    history.pushState({}, '', `/d/${this.deps.diagramId}?page=${this.pageId}&version=${versionId}`);
    const res = await fetch(`/api/diagrams/${this.deps.diagramId}/versions/${versionId}`);
    if (!res.ok) { this.showNotFound(); return; }
    const body = await res.json() as { version: VersionRecord; document: Document };
    this.session.document = body.document;
    this.deps.versionId = versionId;
    this.showPreviewBanner(versionId);
    this.renderAll();
  }

  private showPreviewBanner(versionId: string): void {
    const version = this.versions.find((v) => v.id === versionId);
    const name = version ? version.displayName : 'version';
    this.previewBanner.textContent = copy.previewBanner(name);
    this.previewBanner.classList.remove('hidden');
  }

  private async restoreVersion(versionId: string): Promise<void> {
    const res = await fetch(`/api/diagrams/${this.deps.diagramId}/versions/${versionId}/restore`, { method: 'POST' });
    if (!res.ok) return;
    const docRes = await fetch(`/api/diagrams/${this.deps.diagramId}/document`);
    this.session.document = (await docRes.json()) as Document;
    await this.loadComments();
    this.renderAll();
  }

  private async signOut(): Promise<void> {
    await fetch('/api/auth/signout', { method: 'POST' });
    location.href = '/';
  }

  // ---- Editing helpers ----

  private canEditNow(): boolean {
    return this.deps.role === 'owner' || this.deps.role === 'editor';
  }

  private layerLocked(shape: Shape): boolean {
    return this.isLayerLockedId(shape.layer);
  }

  private isLayerLockedId(layerId: string): boolean {
    const page = this.page();
    const layer = page.layers.find((l) => l.id === layerId);
    return layer?.locked ?? false;
  }

  private announce(text: string): void {
    this.announcer.textContent = '';
    window.setTimeout(() => { this.announcer.textContent = text; }, 10);
  }

  private selectedShape(): Shape | undefined {
    if (this.selection.length !== 1) return undefined;
    return this.page().shapes.find((s) => s.id === this.selection[0]);
  }

  private selectedShapes(): Shape[] {
    const page = this.page();
    const shapes: Shape[] = [];
    for (const id of this.selection) {
      const shape = page.shapes.find((s) => s.id === id);
      if (shape) shapes.push(shape);
    }
    return shapes;
  }

  /** All shape ids in the selection, group members included. */
  private selectionShapeIds(): string[] {
    const page = this.page();
    const ids = new Set<string>();
    for (const id of this.selection) {
      ids.add(id);
      const shape = page.shapes.find((s) => s.id === id);
      const group = shape?.group ? page.groups.find((g) => g.id === shape.group) : undefined;
      for (const member of group?.members ?? []) ids.add(member);
    }
    return [...ids];
  }

  private sendOperation(op: DocumentOp, label: string, undoable: boolean, optimistic: (doc: Document) => void): void {
    if (this.deps.versionId) return;
    if (!this.canEditNow()) {
      this.announce(copy.roleNotice);
      return;
    }
    const request: OperationRequest = { opId: this.session.nextId(), baseSeq: this.session.document.seq, op };
    this.session.commitOperation(request, optimistic, label);
    if (undoable) {
      this.session.pushUndo({ op, ack: { opId: request.opId, seq: this.session.document.seq + 1, ids: {}, rerouted: [] } });
    }
    this.renderCanvas();
    this.renderInspector();
    this.renderRails();
  }

  private insertShape(kind: Shape['kind']): void {
    if (!this.canEditNow()) return;
    const page = this.page();
    const layer = [...page.layers]
      .filter((l) => l.visible && !l.locked)
      .sort((a, b) => b.order - a.order)[0];
    if (!layer) return;
    const rect = this.svg.getBoundingClientRect();
    const cx = this.viewX + (rect.left + rect.width / 2 - rect.left) / (this.zoom / 100);
    const cy = this.viewY + (rect.top + rect.height / 2 - rect.top) / (this.zoom / 100);
    const occupied = page.shapes
      .filter((s) => page.layers.find((l) => l.id === s.layer)?.visible)
      .map(shapeBox);
    const pos = insertionPosition(cx, cy, occupied);
    const clientRef = `ref-${Math.random().toString(36).slice(2)}`;
    const op: DocumentOp = {
      kind: 'add_shape', page: page.id, layer: layer.id,
      shape: { kind, x: pos.x, y: pos.y, w: LIMITS.insertWidth, h: LIMITS.insertHeight, label: '' },
      clientRef,
    };
    const request: OperationRequest = { opId: this.session.nextId(), baseSeq: this.session.document.seq, op };
    this.session.commitOperation(request, (doc) => {
      const target = doc.pages.find((p) => p.id === page.id)!;
      const maxZ = target.shapes.reduce((m, s) => Math.max(m, s.z), 0);
      target.shapes.push({
        id: `pending-${clientRef}`, kind, layer: layer.id,
        x: pos.x, y: pos.y, w: LIMITS.insertWidth, h: LIMITS.insertHeight,
        label: '', z: maxZ + 1, group: null,
      });
    });
    this.renderAll();
  }

  // ---- Inspector field handling ----

  private fieldKeydown(key: 'x' | 'y' | 'w' | 'h', event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      this.commitField(key);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.draftField = null;
      this.clearFieldError(key);
      this.renderInspector();
    }
  }

  private commitField(key: 'x' | 'y' | 'w' | 'h'): void {
    const raw = this.fields[key].value.trim();
    const value = Number(raw);
    const min = key === 'w' || key === 'h' ? LIMITS.minSize : -LIMITS.coordinate;
    const max = key === 'w' || key === 'h' ? LIMITS.maxSize : LIMITS.coordinate;
    if (!Number.isInteger(value) || value < min || value > max) {
      const field = this.fields[key];
      field.setAttribute('aria-invalid', 'true');
      const message = rangeMessage(min, max);
      let errorEl = field.parentElement?.querySelector('.field-error') as HTMLElement | null;
      if (!errorEl) {
        errorEl = el('div', { class: 'field-error', role: 'alert' });
        field.parentElement?.append(errorEl);
      }
      errorEl.textContent = message;
      this.announce(message);
      return;
    }
    this.clearFieldError(key);
    const ids = this.selectionShapeIds();
    if (ids.length === 0) return;
    const set: Record<string, number> = {};
    if (key === 'x' || key === 'y') {
      const page = this.page();
      const boxes = ids.map((id) => page.shapes.find((s) => s.id === id)).filter((s): s is Shape => s !== undefined).map(shapeBox);
      const box = boundingBox(boxes);
      const delta = key === 'x' ? value - box.x : value - box.y;
      const shapes = [...new Set([...ids, ...this.selection])];
      const op: DocumentOp = {
        kind: 'update_shapes',
        shapes: shapes.map((id) => {
          const shape = page.shapes.find((s) => s.id === id);
          const shape2 = shape!;
          return {
            shape: id,
            set: key === 'x' ? { x: shape2.x + delta } : { y: shape2.y + delta },
          };
        }),
      };
      this.draftField = null;
      this.sendOperation(op, multiLabel(shapes.length), true, (doc) => {
        const target = doc.pages.find((p) => p.id === page.id)!;
        for (const id of shapes) {
          const shape = target.shapes.find((s) => s.id === id);
          if (!shape) continue;
          if (key === 'x') shape.x += delta; else shape.y += delta;
        }
      });
      return;
    }
    set[key] = value;
    const page = this.page();
    const op: DocumentOp = {
      kind: 'update_shapes',
      shapes: [...new Set(ids)].map((id) => ({ shape: id, set: { [key]: value } as Record<string, never> })),
    };
    void page;
    void set;
    this.draftField = null;
    this.sendOperation(op, multiLabel(ids.length), true, (doc) => {
      for (const p of doc.pages) {
        for (const id of ids) {
          const shape = p.shapes.find((s) => s.id === id);
          if (shape) {
            if (key === 'w') shape.w = value;
            if (key === 'h') shape.h = value;
          }
        }
      }
    });
  }

  private clearFieldError(key: 'x' | 'y' | 'w' | 'h'): void {
    this.fields[key].removeAttribute('aria-invalid');
    const errorEl = this.fields[key].parentElement?.querySelector('.field-error');
    errorEl?.remove();
  }

  private commitLabelField(): void {
    const shape = this.selectedShape();
    if (!shape) return;
    const value = this.labelField.value;
    this.sendOperation(
      { kind: 'update_shape', shape: shape.id, set: { label: value } },
      shapeLabel({ ...shape, label: value }), true,
      (doc) => {
        for (const p of doc.pages) {
          const s = p.shapes.find((x) => x.id === shape.id);
          if (s) s.label = value;
        }
      });
  }

  // ---- Pointer interactions ----

  private attachCanvasEvents(): void {
    this.svg.addEventListener('pointerdown', (e) => this.pointerDown(e));
    this.svg.addEventListener('pointermove', (e) => this.pointerMove(e));
    this.svg.addEventListener('pointerup', (e) => this.pointerUp(e));
    this.svg.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
  }

  private dragState: {
    kind: 'move' | 'resize' | 'marquee' | 'pan';
    startX: number; startY: number;
    origins: Map<string, { x: number; y: number; w: number; h: number }>;
    alt: boolean;
    fixedCorner?: { x: number; y: number };
    marqueeEl?: SVGElement;
    currentDx?: number;
    currentDy?: number;
    currentBox?: { x: number; y: number; w: number; h: number };
  } | null = null;

  private documentPoint(event: PointerEvent | WheelEvent | MouseEvent): { x: number; y: number } {
    const rect = this.svg.getBoundingClientRect();
    const factor = this.zoom / 100;
    return {
      x: this.viewX + (event.clientX - rect.left) / factor,
      y: this.viewY + (event.clientY - rect.top) / factor,
    };
  }

  private hitShape(point: { x: number; y: number }): Shape | undefined {
    const page = this.page();
    const visible = new Set(page.layers.filter((l) => l.visible).map((l) => l.id));
    const shapes = page.shapes.filter((s) => visible.has(s.layer)).sort((a, b) => b.z - a.z);
    for (const shape of shapes) {
      const box = shapeBox(shape);
      if (point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) {
        return shape;
      }
    }
    return undefined;
  }

  private pointerDown(event: PointerEvent): void {
    if (this.deps.versionId) return;
    const point = this.documentPoint(event);
    const page = this.page();

    // Port dot drag to connect
    const target = event.target as SVGElement;
    if (target.classList?.contains('port-dot')) {
      return;
    }

    const handle = (event.target as SVGElement).classList?.contains('selection-handle')
      ? (event.target as SVGElement)
      : null;
    const ids = this.selectionShapeIds();

    if (handle && ids.length === 1) {
      const shape = page.shapes.find((s) => s.id === ids[0]);
      if (!shape || this.layerLocked(shape)) { this.announceLocked(shape); return; }
      this.dragState = {
        kind: 'resize', startX: point.x, startY: point.y,
        origins: new Map([[shape.id, shapeBox(shape)]]),
        alt: event.altKey,
        fixedCorner: { x: Number(handle.getAttribute('data-handle-x')), y: Number(handle.getAttribute('data-handle-y')) },
      };
      return;
    }

    const shape = this.hitShape(point);
    if (shape) {
      if (this.layerLocked(shape)) { this.announceLocked(shape); return; }
      const group = shape.group;
      const groupMembers = group ? page.groups.find((g) => g.id === group)?.members ?? [] : [];
      const selectIds = groupMembers.length > 0 ? groupMembers : [shape.id];
      if (event.shiftKey) {
        const set = new Set(this.selection);
        for (const id of selectIds) {
          if (set.has(id)) set.delete(id); else set.add(id);
        }
        this.selection = [...set];
      } else {
        this.selection = selectIds;
      }
      this.focusedShape = shape.id;
      const moveIds = this.selectionShapeIds();
      const origins = new Map<string, { x: number; y: number; w: number; h: number }>();
      for (const id of moveIds) {
        const s = page.shapes.find((x) => x.id === id);
        if (s && !this.layerLocked(s)) origins.set(id, shapeBox(s));
      }
      this.dragSources = new Set(moveIds);
      this.dragState = {
        kind: 'move', startX: point.x, startY: point.y,
        origins, alt: event.altKey,
      };
      this.renderCanvas();
      this.renderInspector();
      return;
    }

    if (this.selection.length > 0 && !event.shiftKey) {
      this.selection = [];
      this.renderCanvas();
      this.renderInspector();
    }
    this.dragState = { kind: 'pan', startX: point.x, startY: point.y, origins: new Map(), alt: false };
  }

  private announceLocked(shape: Shape | undefined): void {
    if (!shape) return;
    const layer = this.page().layers.find((l) => l.id === shape.layer);
    this.announce(lockedNotice(layer?.name ?? ''));
  }

  private pointerMove(event: PointerEvent): void {
    const point = this.documentPoint(event);
    const now = Date.now();
    if (now - this.cursorSendLast > 50) {
      this.cursorSendLast = now;
      this.session.sendCursor(point.x, point.y);
    }
    const drag = this.dragState;
    if (!drag) return;
    if (drag.kind === 'move') {
      let dx = point.x - drag.startX;
      let dy = point.y - drag.startY;
      if (this.snapOn && !event.altKey && !drag.alt) {
        const boxes = [...drag.origins.values()];
        const box = boundingBox(boxes);
        const target = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
        const snapped = snapMoveBox(target);
        dx += snapped.dx;
        dy += snapped.dy;
      } else {
        dx = Math.round(dx);
        dy = Math.round(dy);
      }
      const overrides = new Map<string, { x: number; y: number; w: number; h: number }>();
      for (const [id, origin] of drag.origins) {
        overrides.set(id, { x: Math.round(origin.x + dx), y: Math.round(origin.y + dy), w: origin.w, h: origin.h });
      }
      drag.currentDx = dx;
      drag.currentDy = dy;
      this.renderCanvas(overrides);
      this.updateInspectorFromOverrides(overrides);
    } else if (drag.kind === 'resize' && drag.fixedCorner) {
      const [id] = [...drag.origins.keys()];
      const origin = drag.origins.get(id);
      if (!origin || !id) return;
      const fixed = drag.fixedCorner;
      let draggedX = Math.round(point.x);
      let draggedY = Math.round(point.y);
      let box: { x: number; y: number; w: number; h: number };
      if (this.snapOn && !event.altKey && !drag.alt) {
        box = snapResize(fixed.x, fixed.y, draggedX, draggedY);
      } else {
        const left = Math.min(fixed.x, draggedX), right = Math.max(fixed.x, draggedX);
        const top = Math.min(fixed.y, draggedY), bottom = Math.max(fixed.y, draggedY);
        let w = right - left, h = bottom - top;
        w = Math.min(LIMITS.maxSize, Math.max(LIMITS.minSize, w));
        h = Math.min(LIMITS.maxSize, Math.max(LIMITS.minSize, h));
        box = draggedX >= fixed.x ? { x: fixed.x, y: draggedY >= fixed.y ? fixed.y : fixed.y - h, w, h: draggedY >= fixed.y ? h : h }
          : { x: fixed.x - w, y: fixed.y, w, h };
        if (draggedY < fixed.y) box = { x: box.x, y: fixed.y - h, w, h };
        if (draggedX < fixed.x) box = { x: fixed.x - w, y: box.y, w, h };
      }
      const overrides = new Map([[id, box]]);
      drag.currentBox = box;
      this.renderCanvas(overrides);
      this.updateInspectorFromOverrides(overrides);
    }
  }

  private pointerUp(_event: PointerEvent): void {
    const drag = this.dragState;
    this.dragState = null;
    this.dragSources = new Set();
    if (!drag) return;
    if (drag.kind === 'move' && drag.currentDx !== undefined && drag.currentDy !== undefined) {
      const ids = [...drag.origins.keys()];
      const dx = drag.currentDx;
      const dy = drag.currentDy;
      if (dx === 0 && dy === 0) { this.renderCanvas(); return; }
      const page = this.page();
      const shapes = [...new Set([...ids, ...this.selection])].filter((id) => {
        const s = page.shapes.find((x) => x.id === id);
        return s !== undefined && !this.layerLocked(s);
      });
      const op: DocumentOp = {
        kind: 'update_shapes',
        shapes: shapes.map((id) => {
          const origin = drag.origins.get(id);
          const shape = page.shapes.find((s) => s.id === id)!;
          return { shape: id, set: { x: origin!.x + dx, y: origin!.y + dy } };
        }),
      };
      const label = shapes.length === 1
        ? shapeLabel(page.shapes.find((s) => s.id === shapes[0])!)
        : multiLabel(shapes.length);
      this.sendOperation(op, label, true, (doc) => {
        const target = doc.pages.find((p) => p.id === page.id)!;
        for (const id of shapes) {
          const origin = drag.origins.get(id);
          const shape = target.shapes.find((s) => s.id === id);
          if (shape && origin) {
            shape.x = origin.x + dx;
            shape.y = origin.y + dy;
          }
        }
      });
      this.settleConnectors();
    } else if (drag.kind === 'resize' && drag.currentBox) {
      const [id] = [...drag.origins.keys()];
      const box = drag.currentBox;
      if (!id) return;
      const page = this.page();
      const shape = page.shapes.find((s) => s.id === id);
      if (!shape) return;
      const op: DocumentOp = {
        kind: 'update_shape', shape: id, set: { x: box.x, y: box.y, w: box.w, h: box.h },
      };
      this.sendOperation(op, shapeLabel(shape), true, (doc) => {
        for (const p of doc.pages) {
          const s = p.shapes.find((x) => x.id === id);
          if (s) { s.x = box.x; s.y = box.y; s.w = box.w; s.h = box.h; }
        }
      });
      this.settleConnectors();
    } else {
      this.renderCanvas();
    }
  }

  /** The drop settle: hold data-points at the committed route for 200 ms. */
  private settleConnectors(): void {
    const connectors = [...this.connectorsLayer.querySelectorAll('g[id^="connector-"]')];
    if (this.reducedMotion) {
      for (const c of connectors) c.removeAttribute('data-settling');
      return;
    }
    for (const c of connectors) c.setAttribute('data-settling', 'true');
    window.setTimeout(() => {
      for (const c of connectors) c.removeAttribute('data-settling');
    }, 200);
  }

  private updateInspectorFromOverrides(overrides: Map<string, { x: number; y: number; w: number; h: number }>): void {
    const ids = this.selectionShapeIds();
    const boxes = ids.map((id) => overrides.get(id)).filter((b): b is { x: number; y: number; w: number; h: number } => b !== undefined);
    if (boxes.length === 0) return;
    const box = boundingBox(boxes);
    this.setFieldValue('x', String(box.x));
    this.setFieldValue('y', String(box.y));
    this.setFieldValue('w', String(box.w));
    this.setFieldValue('h', String(box.h));
  }

  private wheel(event: WheelEvent): void {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const factor = event.deltaY < 0 ? 1.1 : 0.9;
      const newZoom = Math.min(400, Math.max(25, Math.round(this.zoom * factor)));
      this.setZoom(newZoom, { x: event.clientX, y: event.clientY });
    } else {
      const factor = this.zoom / 100;
      this.viewX += event.deltaX / factor;
      this.viewY += event.deltaY / factor;
      this.applyView();
    }
  }

  private applyView(): void {
    this.svg.setAttribute('viewBox', `${this.viewX} ${this.viewY} ${this.svg.clientWidth / (this.zoom / 100)} ${this.svg.clientHeight / (this.zoom / 100)}`);
    this.zoomReadout.textContent = `${this.zoom}%`;
  }

  private stepZoom(direction: 1 | -1): void {
    const index = ZOOM_STEPS.findIndex((z) => z >= this.zoom);
    const next = index + direction;
    const target = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, next))] ?? 100;
    this.setZoom(target);
  }

  private setZoom(zoom: number, center?: { x: number; y: number }): void {
    const rect = this.svg.getBoundingClientRect();
    const focus = center ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const pointBefore = {
      x: this.viewX + (focus.x - rect.left) / (this.zoom / 100),
      y: this.viewY + (focus.y - rect.top) / (this.zoom / 100),
    };
    this.zoom = zoom;
    this.viewX = pointBefore.x - (focus.x - rect.left) / (zoom / 100);
    this.viewY = pointBefore.y - (focus.y - rect.top) / (zoom / 100);
    this.applyView();
  }

  // ---- Keyboard ----

  private attachKeyboard(): void {
    document.addEventListener('keydown', (event) => this.keydown(event));
  }

  /** The Sign in to continue dialog keeps the canvas live underneath. */
  private dialogsAllowCanvasShortcuts(): boolean {
    return this.dialogs?.element.getAttribute('aria-label') === 'Sign in to continue';
  }

  private isTyping(): boolean {
    const active = document.activeElement;
    return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement;
  }

  private onCanvasTarget(): boolean {
    const active = document.activeElement;
    if (!active) return false;
    return active === this.svg || this.svg.contains(active);
  }

  private keydown(event: KeyboardEvent): void {
    const inDialog = this.dialogs !== null;
    if (event.key === 'Escape' && inDialog) {
      this.closeDialog();
      return;
    }
    if (this.isTyping()) return;
    // Canvas shortcuts keep working while a non-input dialog is open, so an
    // open session dialog never blocks editing the canvas.
    if (inDialog && !this.dialogsAllowCanvasShortcuts()) return;

    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.session.redo(); else this.session.undo();
      return;
    }
    if (mod && event.altKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      this.addPage();
      return;
    }
    if (mod && event.key === 'PageDown') { event.preventDefault(); this.switchPageBy(1); return; }
    if (mod && event.key === 'PageUp') { event.preventDefault(); this.switchPageBy(-1); return; }
    if (mod && event.key.toLowerCase() === 'a' && this.onCanvasTarget()) {
      event.preventDefault();
      this.selectAll();
      return;
    }
    if (mod && event.altKey && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      this.openOutlinePanel();
      return;
    }
    if (mod && event.altKey && event.key.toLowerCase() === 'h') {
      event.preventDefault();
      this.showTab('history');
      return;
    }
    if (mod && event.altKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.openSaveVersionDialog(null);
      return;
    }
    if (mod && (event.key === '=' || event.key === '+')) { event.preventDefault(); this.stepZoom(1); return; }
    if (mod && event.key === '-') { event.preventDefault(); this.stepZoom(-1); return; }
    if (mod && event.key === '0') { event.preventDefault(); this.setZoom(100); return; }
    if (event.altKey && event.shiftKey) {
      const map: Record<string, [AlignSide | 'h' | 'v', 'align' | 'distribute']> = {
        l: ['left', 'align'], c: ['centre', 'align'], r: ['right', 'align'],
        t: ['top', 'align'], m: ['middle', 'align'], b: ['bottom', 'align'],
        h: ['h', 'distribute'], v: ['v', 'distribute'],
      };
      const entry = map[event.key.toLowerCase()];
      if (entry) {
        event.preventDefault();
        if (entry[1] === 'align') this.align(entry[0] as AlignSide);
        else this.distribute(entry[0] as 'h' | 'v');
        return;
      }
    }

    if (!this.onCanvasTarget()) return;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      if (event.altKey) {
        event.preventDefault();
        this.moveFocus(event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (this.connectMode) {
        event.preventDefault();
        this.connectModeStep(event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      event.preventDefault();
      const delta = event.shiftKey ? 1 : LIMITS.arrowNudge;
      this.nudge(delta, event.key);
      return;
    }

    switch (event.key) {
      case ' ':
      case 'Enter': {
        const focused = this.focusedShape;
        if (!focused) return;
        event.preventDefault();
        const page = this.page();
        const shape = page.shapes.find((s) => s.id === focused);
        if (!shape) return;
        if (event.shiftKey) {
          const set = new Set(this.selection);
          if (set.has(focused)) set.delete(focused); else set.add(focused);
          this.selection = [...set];
        } else if (this.selection.length === 1 && this.selection[0] === focused) {
          this.draftLabel = { shapeId: focused, value: shape.label };
          this.labelField.value = shape.label;
          this.labelField.focus();
        } else {
          this.selection = [focused];
        }
        this.renderCanvas();
        this.renderInspector();
        return;
      }
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        this.deleteSelection();
        return;
      case 'r':
      case 'R':
        if (this.canEditNow()) { event.preventDefault(); this.insertShape('rectangle'); }
        return;
      case 'c':
      case 'C':
        if (this.focusedShape) { event.preventDefault(); this.startConnectMode(this.focusedShape); }
        return;
      case 'm':
      case 'M': {
        const shape = this.selectedShape();
        if (shape) {
          event.preventDefault();
          this.showTab('comments');
          const composer = this.commentsListEl.querySelector('textarea');
          (composer as HTMLTextAreaElement | null)?.focus();
        }
        return;
      }
      case '1': case '2': case '3': case '4':
        if (this.connectMode) {
          event.preventDefault();
          const ports = ['n', 'e', 's', 'w'] as const;
          this.connectMode.port = ports[Number(event.key) - 1]!;
          this.renderCanvas();
        }
        return;
      case 'F10':
        if (event.shiftKey && this.selection.length > 0) {
          event.preventDefault();
          this.openShapeActionsMenu(this.selection[0]!);
        }
        return;
      case 'Escape':
        event.preventDefault();
        if (this.connectMode) {
          this.connectMode = null;
          this.renderCanvas();
          return;
        }
        this.selection = [];
        this.renderCanvas();
        this.renderInspector();
        return;
      default:
        return;
    }

    if (mod && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      this.duplicateSelection();
    }
    if (mod && (event.key === ']' || event.key === '[')) {
      event.preventDefault();
      this.zOrder(event.key === ']' ? 1 : -1);
    }
    if (mod && event.key.toLowerCase() === 'g') {
      event.preventDefault();
      if (event.shiftKey) this.ungroup(); else this.group();
    }
  }

  private moveFocus(direction: 1 | -1): void {
    const page = this.page();
    const visible = new Set(page.layers.filter((l) => l.visible).map((l) => l.id));
    const ordered = readingOrder(page.shapes.filter((s) => visible.has(s.layer)));
    if (ordered.length === 0) return;
    const index = ordered.findIndex((s) => s.id === this.focusedShape);
    const next = index === -1
      ? 0
      : (index + direction + ordered.length) % ordered.length;
    this.focusedShape = ordered[next]!.id;
    const node = document.getElementById(`shape-${this.focusedShape}`) as SVGElement | null;
    node?.focus();
    this.renderCanvas();
  }

  private selectAll(): void {
    if (!this.canEditNow()) return;
    const page = this.page();
    const visible = new Set(page.layers.filter((l) => l.visible && !l.locked).map((l) => l.id));
    this.selection = page.shapes.filter((s) => visible.has(s.layer)).map((s) => s.id);
    this.renderCanvas();
    this.renderInspector();
  }

  private nudge(delta: number, key: string): void {
    const page = this.page();
    const ids = this.selection.length > 0
      ? this.selectionShapeIds()
      : this.focusedShape ? [this.focusedShape] : [];
    if (ids.length === 0) return;
    const shapes = ids.map((id) => page.shapes.find((s) => s.id === id)).filter((s): s is Shape => s !== undefined);
    const locked = shapes.find((s) => this.layerLocked(s));
    if (locked) { this.announceLocked(locked); return; }
    if (!this.canEditNow()) { this.announce(copy.roleNotice); return; }
    const dx = key === 'ArrowRight' ? delta : key === 'ArrowLeft' ? -delta : 0;
    const dy = key === 'ArrowDown' ? delta : key === 'ArrowUp' ? -delta : 0;
    const op: DocumentOp = {
      kind: 'update_shapes',
      shapes: shapes.map((s) => ({ shape: s.id, set: { x: s.x + dx, y: s.y + dy } })),
    };
    const label = shapes.length === 1 ? shapeLabel(shapes[0]!) : multiLabel(shapes.length);
    this.sendOperation(op, label, true, (doc) => {
      const target = doc.pages.find((p) => p.id === page.id)!;
      for (const s of shapes) {
        const shape = target.shapes.find((x) => x.id === s.id);
        if (shape) { shape.x += dx; shape.y += dy; }
      }
    });
    this.settleConnectors();
  }

  private deleteSelection(): void {
    if (!this.canEditNow()) { this.announce(copy.roleNotice); return; }
    const ids = this.selectionShapeIds();
    if (ids.length === 0) return;
    const page = this.page();
    const locked = ids.map((id) => page.shapes.find((s) => s.id === id)).find((s) => s && this.layerLocked(s));
    if (locked) { this.announceLocked(locked); return; }
    const label = ids.length === 1 ? shapeLabel(page.shapes.find((s) => s.id === ids[0])!) : multiLabel(ids.length);
    const ops: DocumentOp[] = ids.map((id) => ({ kind: 'delete_shape' as const, shape: id }));
    for (const op of ops) {
      const target = (op as { shape: string }).shape;
      this.sendOperation(op, label, true, (doc) => {
        for (const p of doc.pages) {
          p.shapes = p.shapes.filter((s) => s.id !== target);
          p.connectors = p.connectors.filter((c) => c.from.shape !== target && c.to.shape !== target);
        }
      });
    }
    this.selection = [];
    this.renderAll();
  }

  private duplicateSelection(): void {
    if (!this.canEditNow()) return;
    const page = this.page();
    const ids = this.selectionShapeIds();
    for (const id of ids) {
      const shape = page.shapes.find((s) => s.id === id);
      if (!shape) continue;
      this.insertShapeAt(shape, shape.x + 24, shape.y + 24);
    }
  }

  private insertShapeAt(shape: Shape, x: number, y: number): void {
    const page = this.page();
    const clientRef = `ref-${Math.random().toString(36).slice(2)}`;
    const op: DocumentOp = {
      kind: 'add_shape', page: page.id, layer: shape.layer,
      shape: { kind: shape.kind, x, y, w: shape.w, h: shape.h, label: shape.label },
      clientRef,
    };
    this.sendOperation(op, shapeLabel(shape), false, (doc) => {
      const target = doc.pages.find((p) => p.id === page.id)!;
      const maxZ = target.shapes.reduce((m, s) => Math.max(m, s.z), 0);
      target.shapes.push({ ...shape, id: `pending-${clientRef}`, x, y, z: maxZ + 1, group: null });
    });
  }

  private zOrder(direction: 1 | -1): void {
    if (!this.canEditNow()) return;
    const page = this.page();
    for (const id of this.selectionShapeIds()) {
      const shape = page.shapes.find((s) => s.id === id);
      if (!shape) continue;
      this.sendOperation(
        { kind: 'update_shape', shape: id, set: { z: shape.z + direction } as never },
        shapeLabel(shape), false,
        (doc) => {
          for (const p of doc.pages) {
            const s = p.shapes.find((x) => x.id === id);
            if (s) s.z += direction;
          }
        });
    }
  }

  private group(): void {
    if (!this.canEditNow()) return;
    const page = this.page();
    const ids = this.selectionShapeIds();
    if (ids.length < 2) return;
    const layers = new Set(ids.map((id) => page.shapes.find((s) => s.id === id)?.layer));
    if (layers.size > 1) {
      this.announce(copy.crossLayerGroupRefusal);
      return;
    }
    const op: DocumentOp & { kind: 'group_shapes' } = {
      kind: 'update_shapes', shapes: [], ...({} as object),
    } as never;
    void op;
    // Grouping travels over the socket; the local mirror keeps the doc live.
    this.sendSocketOp({ kind: 'group_shapes', shapes: ids, page: page.id });
    this.announce(copy.groupedNotice(ids.length));
  }

  private ungroup(): void {
    if (!this.canEditNow()) return;
    const page = this.page();
    const ids = this.selectionShapeIds();
    const groups = new Set<string>();
    for (const id of ids) {
      const shape = page.shapes.find((s) => s.id === id);
      if (shape?.group) groups.add(shape.group);
    }
    if (groups.size === 0) return;
    const members = page.groups.filter((g) => groups.has(g.id)).flatMap((g) => g.members);
    this.sendSocketOp({ kind: 'ungroup', groups: [...groups], page: page.id });
    this.announce(copy.ungroupedNotice(members.length));
  }

  private async sendSocketOp(op: Record<string, unknown>): Promise<void> {
    await this.session.sendSocket(op);
  }

  private align(side: AlignSide): void {
    if (!this.canEditNow()) return;
    const page = this.page();
    const units = this.alignUnits();
    if (units.length < 2) return;
    const moves = alignUnits(units, side);
    if (moves.every((m) => m.dx === 0 && m.dy === 0)) return;
    this.applyUnitMoves(moves);
    const count = units.reduce((sum, u) => sum + u.members.length, 0);
    this.announce(copy.alignedNotice(count, side));
  }

  private distribute(axis: 'h' | 'v'): void {
    if (!this.canEditNow()) return;
    const units = this.alignUnits();
    if (units.length < 3) return;
    const moves = distributeUnits(units, axis);
    this.applyUnitMoves(moves);
    const count = units.reduce((sum, u) => sum + u.members.length, 0);
    this.announce(copy.distributedNotice(count));
  }

  private alignUnits(): { id: string; box: { x: number; y: number; w: number; h: number }; members: string[] }[] {
    const page = this.page();
    const ids = this.selectionShapeIds();
    const units: { id: string; box: { x: number; y: number; w: number; h: number }; members: string[] }[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      const shape = page.shapes.find((s) => s.id === id);
      if (!shape || seen.has(id)) continue;
      const group = shape.group ? page.groups.find((g) => g.id === shape.group) : undefined;
      if (group) {
        const members = group.members.filter((m) => ids.includes(m));
        const boxes = members.map((m) => page.shapes.find((s) => s.id === m)).filter((s): s is Shape => s !== undefined).map(shapeBox);
        units.push({ id: group.id, box: boundingBox(boxes), members });
        for (const m of members) seen.add(m);
      } else {
        units.push({ id, box: shapeBox(shape), members: [id] });
        seen.add(id);
      }
    }
    return units;
  }

  private applyUnitMoves(moves: { id: string; dx: number; dy: number }[]): void {
    const page = this.page();
    const allIds: string[] = [];
    const op: DocumentOp = {
      kind: 'update_shapes',
      shapes: [],
    };
    for (const move of moves) {
      const unit = this.alignUnits().find((u) => u.id === move.id);
      if (!unit) continue;
      for (const memberId of unit.members) {
        const shape = page.shapes.find((s) => s.id === memberId);
        if (!shape) continue;
        allIds.push(memberId);
        op.shapes.push({
          shape: memberId,
          set: { x: shape.x + move.dx, y: shape.y + move.dy },
        });
      }
    }
    const label = multiLabel(allIds.length);
    this.sendOperation(op, label, true, (doc) => {
      const target = doc.pages.find((p) => p.id === page.id)!;
      for (const entry of op.shapes) {
        const shape = target.shapes.find((s) => s.id === entry.shape);
        const set = entry.set as { x: number; y: number };
        if (shape) { shape.x = set.x; shape.y = set.y; }
      }
    });
  }

  // ---- Connect mode ----

  private startConnectMode(source: string): void {
    const page = this.page();
    const visible = new Set(page.layers.filter((l) => l.visible && !l.locked).map((l) => l.id));
    const candidates = readingOrder(page.shapes.filter((s) => s.id !== source && visible.has(s.layer)));
    if (candidates.length === 0) return;
    const sourceIndex = readingOrder(page.shapes.filter((s) => visible.has(s.layer))).findIndex((s) => s.id === source);
    let start = 0;
    const after = candidates.findIndex((s, i) => {
      void s;
      void i;
      return false;
    });
    void after;
    const ordered = readingOrder(page.shapes.filter((s) => visible.has(s.layer)));
    const nextIndex = ordered.findIndex((s, i) => i > sourceIndex && s.id !== source);
    start = nextIndex >= 0 ? nextIndex : 0;
    const firstCandidate = candidates.find((c) => c.id === ordered[start]?.id) ?? candidates[0]!;
    this.connectMode = { source, targetIndex: candidates.indexOf(firstCandidate), port: null, targetHighlight: firstCandidate.id };
    this.renderCanvas();
  }

  private connectModeStep(direction: 1 | -1): void {
    const mode = this.connectMode;
    if (!mode) return;
    const page = this.page();
    const visible = new Set(page.layers.filter((l) => l.visible && !l.locked).map((l) => l.id));
    const candidates = readingOrder(page.shapes.filter((s) => s.id !== mode.source && visible.has(s.layer)));
    if (candidates.length === 0) return;
    const current = candidates.findIndex((c) => c.id === mode.targetHighlight);
    const next = (current + direction + candidates.length) % candidates.length;
    mode.targetHighlight = candidates[next]!.id;
    this.renderCanvas();
  }

  // ---- Page and layer management ----

  private async addPage(): Promise<void> {
    if (!this.canEditNow()) return;
    const doc = this.session.document;
    const name = `Page ${doc.pages.length + 1}`;
    // The server assigns the page id; refresh the document and open the new page.
    const before = new Set(doc.pages.map((p) => p.id));
    await this.sendSocketOp({ kind: 'add_page', name });
    await this.reloadDocument();
    const added = this.session.document.pages.find((p) => !before.has(p.id));
    this.pageId = added?.id ?? this.pageId;
    this.renderAll();
    this.syncAddress();
  }

  private async renamePage(page: Page): Promise<void> {
    if (!this.canEditNow()) return;
    const current = page.name;
    const input = el('input', { type: 'text', value: current, 'aria-label': `Rename page ${current}` }) as HTMLInputElement;
    const commit = () => {
      const value = input.value.trim();
      if (value.length > 0 && value !== current) {
        page.name = value;
        this.sendSocketOp({ kind: 'rename_page', page: page.id, name: value });
        this.renderAll();
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); input.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); input.value = current; input.blur(); }
    });
    input.addEventListener('blur', commit);
    const node = this.pageListEl.querySelector(`[aria-label="${current}"]`)?.parentElement;
    node?.prepend(input);
    input.focus();
  }

  private async reorderPage(page: Page, direction: -1 | 1): Promise<void> {
    if (!this.canEditNow()) return;
    const doc = this.session.document;
    const pages = [...doc.pages].sort((a, b) => a.order - b.order);
    const index = pages.findIndex((p) => p.id === page.id);
    const target = index + direction;
    if (target < 0 || target >= pages.length) return;
    const reordered = [...pages];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved!);
    reordered.forEach((p, i) => { p.order = i; });
    this.sendSocketOp({ kind: 'reorder_pages', page: page.id, order: target });
    const total = pages.length;
    this.announce(copy.reorderNotice(page.name, target + 1, total));
    this.renderAll();
  }

  private async addLayer(): Promise<void> {
    if (!this.canEditNow()) return;
    const page = this.page();
    const name = `Layer ${page.layers.length + 1}`;
    page.layers.push({ id: `pending-layer-${Date.now()}`, name, order: page.layers.length, visible: true, locked: false });
    this.sendSocketOp({ kind: 'add_layer', page: page.id, name });
    this.renderAll();
  }

  private toggleLayerVisible(layer: Layer): void {
    if (!this.canEditNow()) return;
    layer.visible = !layer.visible;
    this.sendSocketOp({ kind: 'set_layer_visible', page: this.pageId, layer: layer.id, visible: layer.visible });
    this.renderAll();
  }

  private toggleLayerLocked(layer: Layer): void {
    if (!this.canEditNow()) return;
    layer.locked = !layer.locked;
    this.sendSocketOp({ kind: 'set_layer_locked', page: this.pageId, layer: layer.id, locked: layer.locked });
    this.renderAll();
  }

  private switchPageBy(direction: -1 | 1): void {
    const pages = [...this.session.document.pages].sort((a, b) => a.order - b.order);
    const index = pages.findIndex((p) => p.id === this.pageId);
    const target = index + direction;
    if (target < 0 || target >= pages.length) return;
    this.switchPage(pages[target]!.id);
  }

  private switchPage(pageId: string): void {
    this.pageId = pageId;
    this.selection = [];
    this.renderAll();
    this.syncAddress();
  }

  private syncAddress(): void {
    const url = `/d/${this.deps.diagramId}?page=${this.pageId}${this.deps.versionId ? `&version=${this.deps.versionId}` : ''}`;
    history.replaceState({}, '', url);
  }

  // ---- Menus and dialogs ----

  private openMenu(anchor: HTMLElement, menu: HTMLElement): void {
    menu.classList.remove('hidden');
    const rect = anchor.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.left = `${Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8)}px`;
    const below = rect.bottom + menu.offsetHeight;
    menu.style.top = below > window.innerHeight ? `${Math.max(8, rect.top - menu.offsetHeight)}px` : `${rect.bottom}px`;
    this.activeMenu = { menu, anchor };
    const first = menu.querySelector('[role="menuitem"]') as HTMLElement | null;
    first?.focus();
  }

  private activeMenu: { menu: HTMLElement; anchor: HTMLElement } | null = null;

  private closeMenu(): void {
    if (!this.activeMenu) return;
    this.activeMenu.menu.classList.add('hidden');
    this.activeMenu.anchor.focus();
    this.activeMenu = null;
  }

  private openShapeActionsMenu(anchor: string | HTMLElement): void {
    if (!this.selection || this.selection.length === 0) return;
    const canEdit = this.canEditNow();
    const menu = el('div', { role: 'menu', 'aria-label': 'Shape actions', class: 'popup-menu hidden' });
    const comment = el('div', { role: 'menuitem', tabindex: '-1', text: 'Comment', onclick: () => { this.showTab('comments'); this.closeMenu(); } });
    menu.append(comment);
    if (canEdit) {
      menu.append(
        el('div', { role: 'menuitem', tabindex: '-1', text: 'Duplicate', onclick: () => { this.duplicateSelection(); this.closeMenu(); } }),
        el('div', { role: 'menuitem', tabindex: '-1', text: 'Delete', onclick: () => { this.deleteSelection(); this.closeMenu(); } }),
        el('div', { role: 'menuitem', tabindex: '-1', text: 'Bring forward', onclick: () => { this.zOrder(1); this.closeMenu(); } }),
        el('div', { role: 'menuitem', tabindex: '-1', text: 'Send backward', onclick: () => { this.zOrder(-1); this.closeMenu(); } }),
      );
    }
    document.body.append(menu);
    const anchorEl = typeof anchor === 'string'
      ? document.getElementById(`shape-${anchor}`) as HTMLElement
      : anchor;
    this.openMenu(anchorEl, menu);
  }

  private openInsertMenu(anchor: HTMLElement): void {
    const menu = el('div', { role: 'menu', 'aria-label': 'Insert', class: 'popup-menu hidden' });
    for (const kind of ['Rectangle', 'Ellipse', 'Diamond', 'Text'] as const) {
      menu.append(el('div', {
        role: 'menuitem', tabindex: '-1', text: kind,
        onclick: () => { this.insertShape(kind.toLowerCase() as Shape['kind']); this.closeMenu(); },
      }));
    }
    document.body.append(menu);
    this.openMenu(anchor, menu);
  }

  private openDialog(dialog: HTMLElement, opener: HTMLElement | null, onClose?: () => void): void {
    document.body.append(dialog);
    dialog.classList.add('dialog-open');
    this.dialogs = { element: dialog, opener, onClose };
    const focusable = dialog.querySelector<HTMLElement>('input, button, select, textarea, [tabindex]');
    focusable?.focus();
    this.trapTab(dialog);
  }

  private closeDialog(): void {
    if (!this.dialogs) return;
    this.dialogs.element.remove();
    this.dialogs.opener?.focus();
    this.dialogs.onClose?.();
    this.dialogs = null;
  }

  private trapTab(dialog: HTMLElement): void {
    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const items = [...dialog.querySelectorAll<HTMLElement>('input, button, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')]
        .filter((el2) => !el2.hasAttribute('disabled'));
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  private openShareDialog(opener: HTMLElement): void {
    const dialog = el('div', { role: 'dialog', 'aria-label': 'Share', class: 'dialog' });
    const email = el('input', { type: 'email', 'aria-label': 'Email' }) as HTMLInputElement;
    const role = el('select', { 'aria-label': 'Role' }) as HTMLSelectElement;
    role.append(el('option', { value: 'editor', text: 'Editor' }), el('option', { value: 'viewer', text: 'Viewer' }));
    const mailBanner = el('div', { class: 'banner hidden', text: copy.mailOutageBanner });
    const status = el('div', { class: 'dialog-status', 'aria-live': 'polite' });
    const memberList = el('div', { role: 'list', 'aria-label': 'Members', class: 'member-list' });
    const send = el('button', { 'aria-label': 'Send invite', text: 'Send invite', onclick: () => {
      void this.sendInvite(email.value, role.value as 'editor' | 'viewer', status, mailBanner, memberList);
    } });
    const close = el('button', { text: 'Close', onclick: () => this.closeDialog() });
    dialog.append(mailBanner, email, role, send, status, memberList, close);
    this.openDialog(dialog, opener);
    void this.renderMemberList(memberList, mailBanner);
  }

  private async renderMemberList(memberList: HTMLElement, mailBanner: HTMLElement): Promise<void> {
    memberList.replaceChildren();
    const res = await fetch(`/api/diagrams/${this.deps.diagramId}/members`);
    if (!res.ok) return;
    const body = await res.json() as {
      members: { userId: string; email: string; name: string; role: string; status: string }[];
      invites: { id: string; email: string; role: string; status: string }[];
    };
    for (const member of body.members) {
      const row = el('div', { role: 'listitem', class: 'member-row' });
      const name = el('span', { text: member.name || member.email });
      const roleSelect = el('select', { 'aria-label': `Role for ${member.email}` }) as HTMLSelectElement;
      roleSelect.append(el('option', { value: 'editor', text: 'Editor' }), el('option', { value: 'viewer', text: 'Viewer' }));
      roleSelect.value = member.role;
      roleSelect.addEventListener('change', () => {
        void this.changeRole(member.userId, roleSelect.value);
      });
      const statusText = el('span', { text: 'Active' });
      row.append(name, roleSelect, statusText);
      if (this.deps.role === 'owner' && member.role !== 'owner') {
        row.append(el('button', { 'aria-label': `Remove ${member.email}`, text: 'Remove', onclick: () => void this.removeMember(member.userId) }));
      }
      memberList.append(row);
    }
    for (const invite of body.invites) {
      const row = el('div', { role: 'listitem', class: 'member-row' });
      row.append(el('span', { text: invite.email }));
      const statusText = el('span', {
        text: invite.status === 'emailed' ? copy.inviteStatusInvited
          : invite.status === 'email_not_sent' ? copy.inviteStatusEmailNotSent
            : copy.inviteStatusExpired,
      });
      row.append(statusText);
      if (invite.status === 'email_not_sent' || invite.status === 'expired') {
        row.append(el('button', {
          'aria-label': `Resend invite to ${invite.email}`, text: 'Resend',
          onclick: () => void this.resendInvite(invite.id),
        }));
      }
      memberList.append(row);
    }
    const hasOutage = body.invites.some((i) => i.status === 'email_not_sent');
    mailBanner.classList.toggle('hidden', !hasOutage);
  }

  private async sendInvite(email: string, role: 'editor' | 'viewer', status: HTMLElement, mailBanner: HTMLElement, memberList: HTMLElement): Promise<void> {
    if (email.length === 0) return;
    status.textContent = copy.invitePending;
    const res = await fetch(`/api/diagrams/${this.deps.diagramId}/invites`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, role }),
    });
    const body = await res.json() as { invite?: { status: string }; error?: { code: string } };
    if (!res.ok) {
      if (body.error?.code === 'already_member' || body.error?.code === 'already_invited') {
        status.textContent = body.error.code === 'already_member' ? 'Already a member.' : 'Already invited.';
      }
      return;
    }
    if (body.invite?.status === 'emailed') {
      status.textContent = copy.inviteEmailedNotice(email.toLowerCase());
    } else {
      status.textContent = '';
      mailBanner.classList.remove('hidden');
    }
    this.announce(copy.inviteEmailedNotice(email.toLowerCase()));
    await this.renderMemberList(memberList, mailBanner);
  }

  private async resendInvite(inviteId: string): Promise<void> {
    await fetch(`/api/diagrams/${this.deps.diagramId}/invites/${inviteId}/resend`, { method: 'POST' });
  }

  private async changeRole(userId: string, role: string): Promise<void> {
    await fetch(`/api/diagrams/${this.deps.diagramId}/members/${userId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role }),
    });
  }

  private async removeMember(userId: string): Promise<void> {
    await fetch(`/api/diagrams/${this.deps.diagramId}/members/${userId}`, { method: 'DELETE' });
  }

  private openExportDialog(opener: HTMLElement): void {
    const dialog = el('div', { role: 'dialog', 'aria-label': 'Export', class: 'dialog' });
    const format = el('select', { 'aria-label': 'Format' }) as HTMLSelectElement;
    format.append(el('option', { value: 'png', text: 'PNG' }), el('option', { value: 'svg', text: 'SVG' }));
    const scale = el('select', { 'aria-label': 'Scale' }) as HTMLSelectElement;
    scale.append(el('option', { value: '1', text: '1x' }), el('option', { value: '2', text: '2x' }));
    const pageSelect = el('select', { 'aria-label': 'Page' }) as HTMLSelectElement;
    for (const page of [...this.session.document.pages].sort((a, b) => a.order - b.order)) {
      pageSelect.append(el('option', { value: page.id, text: page.name }));
    }
    pageSelect.value = this.pageId;
    const background = el('select', { 'aria-label': 'Background' }) as HTMLSelectElement;
    background.append(el('option', { value: 'white', text: 'White' }), el('option', { value: 'transparent', text: 'Transparent' }));
    const exportStatus = el('div', { class: 'dialog-status', 'aria-live': 'polite' });
    const retry = el('button', { 'aria-label': 'Try again', text: 'Try again', class: 'hidden', onclick: () => {
      if (this.latestExport) {
        void fetch(`/api/exports/${this.latestExport.id}/retry`, { method: 'POST' });
        exportStatus.textContent = copy.exportPending(this.page().name);
      }
    } });
    const download = el('a', { href: '#', class: 'hidden', 'aria-label': 'Download PNG', text: 'Download PNG' });
    const exportBtn = el('button', { 'aria-label': 'Export', text: 'Export', onclick: () => {
      void this.requestExport(format.value as 'png' | 'svg', Number(scale.value), background.value as 'white' | 'transparent', pageSelect.value, exportStatus, download, retry);
    } });
    const close = el('button', { text: 'Close', onclick: () => this.closeDialog() });
    format.addEventListener('change', () => {
      scale.disabled = format.value === 'svg';
      download.textContent = format.value === 'svg' ? 'Download SVG' : 'Download PNG';
      download.setAttribute('aria-label', format.value === 'svg' ? 'Download SVG' : 'Download PNG');
    });
    dialog.append(format, scale, pageSelect, background, exportBtn, exportStatus, download, retry, close);
    this.openDialog(dialog, opener);
  }

  private async requestExport(format: 'png' | 'svg', scale: number, background: 'white' | 'transparent', pageId: string, status: HTMLElement, download: HTMLAnchorElement, retry: HTMLButtonElement): Promise<void> {
    if (this.pendingExport) return;
    this.pendingExport = true;
    const pageName = this.session.document.pages.find((p) => p.id === pageId)?.name ?? '';
    status.textContent = copy.exportPending(pageName);
    const res = await fetch(`/api/diagrams/${this.deps.diagramId}/exports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ page: pageId, format, scale: format === 'svg' ? 1 : scale, background }),
    });
    const body = await res.json() as { id: string; status: string };
    this.pendingExport = false;
    if (!res.ok) return;
    this.latestExport = { id: body.id, format, status: body.status };
    const poll = window.setInterval(async () => {
      const check = await fetch(`/api/exports/${body.id}`);
      const data = await check.json() as { status: string };
      if (data.status === 'ready') {
        clearInterval(poll);
        status.textContent = copy.exportReady;
        download.href = `/api/exports/${body.id}/file`;
        download.classList.remove('hidden');
        retry.classList.add('hidden');
        this.announce(copy.exportReady);
        this.latestExportLink.href = download.href;
        this.latestExportLink.classList.remove('hidden');
      } else if (data.status === 'storage_unavailable') {
        clearInterval(poll);
        status.textContent = copy.exportPausedBanner;
        retry.classList.remove('hidden');
        download.classList.add('hidden');
        this.pausedBanner.classList.remove('hidden');
      }
    }, 500);
  }

  private pendingExport = false;

  private openSaveVersionDialog(opener: HTMLElement | null): void {
    const dialog = el('div', { role: 'dialog', 'aria-label': 'Save version', class: 'dialog' });
    const name = el('input', { type: 'text', 'aria-label': 'Version name' }) as HTMLInputElement;
    const save = el('button', { 'aria-label': 'Save', text: 'Save', onclick: async () => {
      const res = await fetch(`/api/diagrams/${this.deps.diagramId}/versions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.value }),
      });
      if (res.ok) {
        const body = await res.json() as { version: VersionRecord };
        this.announce(copy.versionSavedNotice(body.version.displayName));
        await this.loadVersions();
        this.closeDialog();
      }
    } });
    dialog.append(name, save, el('button', { text: 'Close', onclick: () => this.closeDialog() }));
    this.openDialog(dialog, opener);
  }

  private openDeletePageDialog(page: Page, opener: HTMLElement): void {
    const dialog = el('div', { role: 'alertdialog', 'aria-label': 'Delete page', class: 'dialog' });
    dialog.append(
      el('p', { text: `Delete page ${page.name}?` }),
      el('button', { 'aria-label': 'Delete page', text: 'Delete page', onclick: () => {
        this.sendSocketOp({ kind: 'delete_page', page: page.id });
        const doc = this.session.document;
        doc.pages = doc.pages.filter((p) => p.id !== page.id);
        doc.pages.forEach((p, i) => { p.order = i; });
        if (this.pageId === page.id) this.pageId = doc.pages[0]?.id ?? '';
        this.renderAll();
        this.closeDialog();
      } }),
      el('button', { 'aria-label': 'Cancel', text: 'Cancel', onclick: () => this.closeDialog() }),
    );
    this.openDialog(dialog, opener);
  }

  private openSignInDialog(): void {
    if (this.dialogs) return;
    const dialog = el('div', { role: 'dialog', 'aria-label': 'Sign in to continue', class: 'dialog' });
    const email = el('input', { type: 'email', 'aria-label': 'Email', readonly: 'true', value: this.deps.user.email }) as HTMLInputElement;
    const password = el('input', { type: 'password', 'aria-label': 'Password' }) as HTMLInputElement;
    const error = el('div', { class: 'dialog-error', 'aria-live': 'polite' });
    const signIn = el('button', { 'aria-label': 'Sign in', text: 'Sign in', onclick: async () => {
      const res = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: this.deps.user.email, password: password.value }),
      });
      if (!res.ok) {
        error.textContent = copy.signInError;
        this.announce(copy.signInError);
        return;
      }
      this.closeDialog();
      this.session.reconnectAfterSignIn();
    } });
    dialog.append(email, password, signIn, error);
    this.openDialog(dialog, null);
  }

  private openOutlinePanel(opener?: HTMLElement): void {
    const dialog = el('div', { role: 'dialog', 'aria-label': 'Outline', class: 'dialog outline-panel' });
    this.outlineTree = el('div', { role: 'tree', 'aria-label': 'Diagram outline', class: 'outline-tree' });
    dialog.append(this.outlineTree, el('button', { text: 'Close', onclick: () => this.closeDialog() }));
    this.buildOutlineTree();
    this.openDialog(dialog, opener ?? null);
  }

  private buildOutlineTree(): void {
    const items = buildOutline(this.session.document, this.blockedIds);
    this.outlineTree.replaceChildren();
    const render = (item: OutlineItem, depth: number, parent?: HTMLElement): HTMLElement => {
      const node = el('div', {
        role: 'treeitem', 'aria-level': String(depth + 1), 'aria-expanded': depth < 2 ? 'true' : null,
        tabindex: '-1', text: item.text, class: 'outline-item',
      });
      node.addEventListener('click', () => {
        if (item.kind === 'page') this.switchPage(item.pageId ?? item.id);
        else if (item.shapeId) {
          if (item.pageId) this.switchPage(item.pageId);
          this.selection = [item.shapeId];
          this.focusedShape = item.shapeId;
          this.renderAll();
          document.getElementById(`shape-${item.shapeId}`)?.focus();
          this.closeDialog();
        }
      });
      (parent ?? this.outlineTree).append(node);
      for (const child of item.children) render(child, depth + 1, node);
      return node;
    };
    for (const item of items) render(item, 0);
    const first = this.outlineTree.querySelector('.outline-item') as HTMLElement | null;
    first?.focus();
  }

  private openBottomSheet(title: string, opener: HTMLElement): void {
    const dialog = el('div', { role: 'dialog', 'aria-label': title, class: 'dialog bottom-sheet' });
    if (title === 'Layers') {
      dialog.append(this.leftRail.cloneNode(true));
    } else if (title === 'Inspector') {
      dialog.append(this.inspectorRail.cloneNode(true));
    } else if (title === 'Comments') {
      dialog.append(this.commentsListEl.cloneNode(true));
    } else if (title === 'History') {
      dialog.append(this.historyListEl.cloneNode(true));
    }
    dialog.append(el('button', { text: 'Close', onclick: () => this.closeDialog() }));
    this.openDialog(dialog, opener);
  }

  private toggleLayersRail(): void {
    const open = this.layersBtn.getAttribute('aria-expanded') === 'true';
    this.layersBtn.setAttribute('aria-expanded', String(!open));
    this.leftRail.classList.toggle('open', !open);
    this.leftRail.classList.toggle('closed', open);
  }

  private toggleInspectorRail(): void {
    const open = this.inspectorBtn.getAttribute('aria-expanded') === 'true';
    this.inspectorBtn.setAttribute('aria-expanded', String(!open));
    const rail = this.inspectorRail;
    const progress = Number(rail.getAttribute('data-progress') ?? '1');
    if (this.reducedMotion) {
      rail.setAttribute('data-motion', open ? 'closed' : 'open');
      rail.setAttribute('data-progress', open ? '0.00' : '1.00');
      rail.classList.toggle('closed', open);
      return;
    }
    const duration = open ? progress * 200 : (1 - progress) * 200;
    rail.setAttribute('data-motion', open ? 'closing' : 'opening');
    const start = performance.now();
    const from = progress;
    const to = open ? 0 : 1;
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      const value = from + (to - from) * t;
      rail.setAttribute('data-progress', value.toFixed(2));
      if (t >= 1) {
        rail.setAttribute('data-motion', open ? 'closed' : 'open');
        rail.classList.toggle('closed', open);
      } else {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  }

  private showTab(tab: 'inspector' | 'comments' | 'history'): void {
    this.inspectorTab.setAttribute('aria-selected', String(tab === 'inspector'));
    this.commentsTab.setAttribute('aria-selected', String(tab === 'comments'));
    this.historyTab.setAttribute('aria-selected', String(tab === 'history'));
    const panels = this.inspectorRail.querySelectorAll('.tab-panel');
    (panels[0] as HTMLElement).style.display = tab === 'inspector' ? '' : 'none';
    (panels[1] as HTMLElement).style.display = tab === 'comments' ? '' : 'none';
    (panels[2] as HTMLElement).style.display = tab === 'history' ? '' : 'none';
    if (tab === 'comments') void this.loadComments();
  }

  // ---- Connection and server events ----

  private connectionLostResolved(): void {
    if (this.session.isSessionEnded()) return;
    if (this.session.queueLength() > 0) return;
    this.connectionStatus.textContent = '';
  }

  private updateConnection(): void {
    if (this.session.isSessionEnded()) {
      this.connectionStatus.textContent = copy.sessionEndedBanner(this.session.queueLength());
      return;
    }
    if (this.session.isOffline()) {
      this.connectionStatus.textContent = copy.offlineBanner(this.session.queueLength());
      return;
    }
    this.connectionStatus.textContent = '';
  }

  private showSavedBanner(): void {
    if (this.session.isSessionEnded() || this.session.isOffline()) return;
    this.connectionStatus.textContent = copy.savedBanner;
    if (this.savedTimer !== null) clearTimeout(this.savedTimer);
    this.savedTimer = window.setTimeout(() => {
      if (this.session.isSessionEnded() || this.session.isOffline()) return;
      this.connectionStatus.textContent = '';
    }, 3000);
  }

  private showNotFound(): void {
    this.container.replaceChildren();
    const nf = el('div', { class: 'not-found' },
      el('h1', { text: copy.notFoundHeading }),
      el('p', { text: copy.notFoundText }),
      el('a', { href: '/', text: 'Back to your diagrams' }));
    this.container.append(nf);
  }

  private onAck(opId: string, ack: OpAcknowledgement, label?: string, replayed = false): void {
    void opId;
    this.session.document.seq = Math.max(this.session.document.seq, ack.seq);
    // Optimistic pending ids become the server ids.
    for (const [clientRef, id] of Object.entries(ack.ids)) {
      for (const page of this.session.document.pages) {
        const pending = page.shapes.find((s) => s.id === `pending-${clientRef}`);
        if (pending) pending.id = id;
        const pendingConnector = page.connectors.find((c) => c.id === `pending-${clientRef}`);
        if (pendingConnector) pendingConnector.id = id;
      }
    }
    if (replayed) {
      // Replay is not announced; the saved banner covers it.
    } else if (label && this.queuedNoticePending === false) {
      this.announce(copy.movedNotice(label, ack.rerouted.length));
    }
    void this.reloadDocument();
  }

  private async reloadDocument(): Promise<void> {
    const res = await fetch(`/api/diagrams/${this.deps.diagramId}/document`);
    if (!res.ok) return;
    this.session.document = (await res.json()) as Document;
    this.renderAll();
  }

  private onRefused(opId: string, code: string, message: string): void {
    void opId;
    void message;
    if (code === 'shape_deleted' || code === 'connector_deleted') {
      const label = this.lastDeletedLabel ?? multiLabel(1);
      this.announce(copy.deletedNotice(label, this.lastDeletedBy ?? 'someone'));
      void this.reloadDocument();
      return;
    }
    if (code === 'forbidden_role') {
      this.announce(copy.roleNotice);
      void this.reloadDocument();
      return;
    }
    void this.reloadDocument();
  }

  private lastDeletedLabel = '';
  private lastDeletedBy = '';

  private onServerEvent(kind: string, payload: unknown): void {
    if (kind === 'server:operation') {
      const p = payload as { ack: OpAcknowledgement; op: DocumentOp; userId: string };
      this.session.document.seq = Math.max(this.session.document.seq, p.ack.seq);
      this.session.noteSocketOpAcked();
      void this.reloadDocument();
      return;
    }
    if (kind === 'server:cursor') {
      const p = payload as { userId: string; name: string; x: number; y: number };
      this.remoteCursors.set(p.userId, { x: p.x, y: p.y, name: p.name });
      this.renderCanvas();
      return;
    }
    if (kind === 'server:presence') {
      const p = payload as { userId: string; name: string }[];
      this.presencePeople = new Map(p.map((person) => [person.userId, { name: person.name, role: 'editor' }]));
      this.renderPresence();
      return;
    }
    if (kind === 'server:comment' || kind === 'server:version' || kind === 'server:export' || kind === 'server:members') {
      void this.loadComments();
      void this.loadVersions();
      void this.loadLatestExport();
      return;
    }
    if (kind === 'server:role') {
      void this.refreshRole();
      return;
    }
    if (kind === 'server:restore') {
      const p = payload as { by: string; versionName: string };
      this.announce(copy.restoredNotice(p.by, p.versionName));
      void this.reloadDocument().then(() => this.loadComments());
      return;
    }
  }

  private async refreshRole(): Promise<void> {
    const res = await fetch(`/api/diagrams/${this.deps.diagramId}/document`);
    if (res.status === 404) { this.showNotFound(); return; }
    const meRes = await fetch('/api/me');
    if (!meRes.ok) return;
    // The role comes from the members list.
    const membersRes = await fetch(`/api/diagrams/${this.deps.diagramId}/members`);
    if (!membersRes.ok) return;
    const body = await membersRes.json() as { members: { userId: string; role: Role }[] };
    const mine = body.members.find((m) => m.userId === this.deps.user.id);
    if (!mine) { this.showNotFound(); return; }
    if (mine.role !== this.deps.role) {
      this.deps.role = mine.role;
      const canEdit = mine.role === 'owner' || mine.role === 'editor';
      this.toolbar.classList.toggle('hidden', !canEdit);
      this.viewOnlyBanner.classList.toggle('hidden', canEdit);
      this.renderRails();
      this.renderCanvas();
    }
  }

  private renderPresence(): void {
    this.presenceRow.replaceChildren();
    for (const [userId, person] of this.presencePeople) {
      if (userId === this.deps.user.id) continue;
      const label = `${person.name}, ${person.role === 'viewer' ? 'viewing' : 'editing'}`;
      const avatar = el('button', { 'aria-label': label, text: initials(person.name), title: label });
      avatar.classList.add('presence-avatar');
      this.presenceRow.append(avatar);
    }
  }
}

function initials(name: string): string {
  return name.split(/\s+/).map((part) => part[0] ?? '').join('').slice(0, 2).toUpperCase();
}

function snapMoveBox(box: { x: number; y: number; w: number; h: number }): { dx: number; dy: number } {
  return { dx: snap(box.x) - box.x, dy: snap(box.y) - box.y };
}

function lockIconPath(x: number, y: number): string {
  return `M${x + 4},${y + 8} h6 v-4 a3,3 0 0 0 -6,0 z M${x + 3},${y + 7} h8 v7 h-8 z`;
}
