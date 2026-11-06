// The editor: state, save queue, keyboard and pointer model, and layout.

import {
  Connector, Derived, PageDocument, Shape, Zone, Role, SYSTEM_KINDS, SYSTEM_KIND_IDS,
  ZONE_KINDS, ZONE_KIND_IDS, SystemKindId, ZoneKindId, MAX_ZONES_PER_PAGE,
} from '../shared/types.js';
import {
  closestPorts, derivePage, elbowPath, portPoint, rerouteConnector,
} from '../shared/geometry.js';
import {
  alignSelection, carriedShapeIds, duplicateSelection, freshId,
  placedRect, settleZoneRect, zoneMoveOverlaps, AlignEdge,
} from '../shared/pageRules.js';
import { changeLayer, layerPosition } from '../shared/model.js';
import { plainLabel } from '../shared/labels.js';
import { COPY } from '../shared/constants.js';
import { apiGet, apiPut, ApiRequestError } from './api.js';
import { h, clear, optionEl } from './hyperscript.js';
import { openDialog, DialogHandle } from './dialogs.js';
import { CanvasView } from './canvasView.js';
import { BoundaryTally } from './tally.js';
import { openShareDialog, openFilesDialog, openImportDialog, openSessionDialog } from './editorDialogs.js';
import { navigate, state as appState, AppState, diagramNotFoundScreen } from './app.js';

export type SaveStateValue = 'Read only' | 'Saving...' | 'Not saved' | 'Saved' | 'Unsaved changes';
type FailedState = null | 'generic' | 'conflict';

interface Snapshot {
  page: PageDocument;
  selection: string[];
}

export interface DiagramInfo {
  id: string;
  title: string;
  role: Role;
  ownerName: string;
  pages: { id: string; name: string; version: number }[];
}

export class Editor {
  readonly root: HTMLElement;
  readonly diagramId: string;
  info!: DiagramInfo;
  pageId = '';
  page: PageDocument | null = null;
  derived: Derived | null = null;
  selection: string[] = [];
  focusItemId: string | null = null;
  zoom = 1;
  panX = 0;
  panY = 0;
  undoStack: Snapshot[] = [];
  redoStack: Snapshot[] = [];
  saveState: SaveStateValue = 'Saved';
  failedState: FailedState = null;
  readOnly = false;
  banner: null | 'storage' | 'downgrade' | 'conflict' | 'generic' = null;
  announcements = '';
  connectMode: { source: string } | null = null;
  private editsSinceSave = false;
  private saveInFlight = false;
  private saveQueued = false;
  private lastEditAt = 0;
  private autosaveTimer: number | null = null;
  private statusTimer: number | null = null;
  private leaving = false;
  private keptRequests: { kind: 'save' }[] = [];
  private tally: BoundaryTally;
  private view: CanvasView;
  private destroyed = false;

  // DOM regions.
  private topbar!: HTMLElement;
  private tabsBar!: HTMLElement;
  private saveStateEl!: HTMLElement;
  private zoomLevelEl!: HTMLElement;
  private announcementsEl!: HTMLElement;
  private bannerEl!: HTMLElement;
  private inspectorHost!: HTMLElement;
  private libraryHost!: HTMLElement;
  private canvasHost!: HTMLElement;
  private editorRow!: HTMLElement;
  private bottomToolbar: HTMLElement | null = null;
  private inspectorOpen = false;
  private libraryOpen = false;
  private librarySheetHandle: DialogHandle | null = null;
  private inspectorDrawerHandle: DialogHandle | null = null;
  private lastNarrow = false;
  private lastMedium = false;
  private sessionDialogHandle: DialogHandle | null = null;

  constructor(root: HTMLElement, diagramId: string) {
    this.root = root;
    this.diagramId = diagramId;
    this.tally = new BoundaryTally(this);
    this.view = new CanvasView(this);
  }

  async load(pageId: string | null): Promise<void> {
    try {
      this.info = await apiGet(`/api/diagrams/${this.diagramId}`) as { diagram: DiagramInfo } as unknown as DiagramInfo;
      const infoResp = await apiGet(`/api/diagrams/${this.diagramId}`) as { diagram: DiagramInfo };
      this.info = infoResp.diagram;
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) {
        this.root.appendChild(diagramNotFoundScreen());
        return;
      }
      throw err;
    }
    const pages = this.info.pages;
    if (pageId === null) {
      this.pageId = pages[0].id;
      history.replaceState(null, '', `/d/${this.diagramId}/p/${this.pageId}`);
    } else {
      this.pageId = pageId;
    }
    if (!pages.some((p) => p.id === this.pageId)) {
      this.root.appendChild(diagramNotFoundScreen());
      return;
    }
    this.readOnly = this.info.role === 'viewer';
    if (this.readOnly) {
      this.saveState = 'Read only';
      // A downgraded editor keeps the banner through every later refresh.
      try {
        if (localStorage.getItem(`sw-downgrade:${this.diagramId}`) === '1') {
          this.banner = 'downgrade';
        }
      } catch {
        // Storage may be unavailable; the banner shows once the save is refused.
      }
    }
    this.buildLayout();
    await this.loadPage();
    if (!this.destroyed) {
      this.startTimers();
    }
  }

  private async loadPage(): Promise<void> {
    try {
      const resp = await apiGet(`/api/diagrams/${this.diagramId}/pages/${this.pageId}`) as { page: PageDocument; derived: Derived };
      this.page = resp.page;
      this.derived = resp.derived;
      this.selection = [];
      this.focusItemId = null;
      this.undoStack = [];
      this.redoStack = [];
      this.saveState = this.readOnly ? 'Read only' : 'Saved';
      this.failedState = null;
      this.editsSinceSave = false;
      this.zoom = 1;
      this.panX = 0;
      this.panY = 0;
      this.view.openAtOrigin();
      this.render();
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) {
        this.root.innerHTML = '';
        this.root.appendChild(diagramNotFoundScreen());
        this.destroyed = true;
        return;
      }
      throw err;
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.view.destroy();
    if (this.autosaveTimer !== null) window.clearInterval(this.autosaveTimer);
    if (this.statusTimer !== null) window.clearInterval(this.statusTimer);
    this.tally.cancel();
  }

  private startTimers(): void {
    this.autosaveTimer = window.setInterval(() => {
      this.autosaveTick();
    }, 250);
    this.statusTimer = window.setInterval(() => {
      void this.checkStorageStatus();
    }, 15000);
    void this.checkStorageStatus();
  }

  // -------------------------------------------------------------------------
  // Layout.

  private buildLayout(): void {
    clear(this.root);
    this.lastNarrow = this.isNarrow();
    this.lastMedium = this.isMedium();
    const editor = h('div', { class: 'editor' });
    this.topbar = h('header', { role: 'banner', class: 'topbar' });
    this.tabsBar = h('div', { role: 'tablist', 'aria-label': 'Pages', class: 'page-tabs' });
    this.announcementsEl = h('div', { role: 'status', 'aria-live': 'polite', id: 'announcements', class: 'sr-only' });
    this.bannerEl = h('div', { role: 'alert', class: 'editor-banner hidden' });
    this.libraryHost = h('aside', { role: 'complementary', 'aria-label': 'Shape library', class: 'library-rail' });
    this.canvasHost = h('div', { class: 'canvas-host' });
    this.inspectorHost = h('aside', { role: 'complementary', 'aria-label': 'Inspector', class: 'inspector-pane' });
    this.editorRow = h('div', { class: 'editor-row' });
    this.editorRow.append(this.libraryHost, this.canvasHost, this.inspectorHost);
    this.view.mount(this.canvasHost);
    this.bottomToolbar = null;
    editor.append(this.topbar, this.tabsBar, this.announcementsEl, this.bannerEl, this.editorRow);
    this.root.appendChild(editor);
    this.renderTopbar();
    this.renderTabs();
    this.renderLibrary();
    this.renderInspector();
    editor.addEventListener('keydown', (e: KeyboardEvent) => {
      this.onCanvasKey(e);
    });
    window.addEventListener('resize', () => this.onWindowResize());
  }

  private onWindowResize(): void {
    // The published layout for each size is rebuilt when the width changes
    // between the 375, 768 and 1280 bands.
    const wasNarrow = this.lastNarrow;
    const wasMedium = this.lastMedium;
    const nowNarrow = this.isNarrow();
    const nowMedium = this.isMedium();
    if (wasNarrow !== nowNarrow || wasMedium !== nowMedium) {
      this.lastNarrow = nowNarrow;
      this.lastMedium = nowMedium;
      this.renderTopbar();
      this.renderInspector();
    }
    // Widening to 1200 or more with the drawer open closes it; the pane shows
    // the same selection.
    if (window.innerWidth >= 1200 && this.inspectorOpen) {
      this.inspectorOpen = false;
      this.renderInspector();
      const field = this.inspectorHost.querySelector<HTMLElement>('[data-first-field]');
      if (field !== null) field.focus();
      else {
        const selected = this.selection[this.selection.length - 1];
        if (selected !== undefined) this.view.focusItem(selected);
      }
      return;
    }
    // Narrowing with focus in the inspector pane moves focus to the item.
    if (window.innerWidth < 1200 && !this.inspectorOpen) {
      if (this.inspectorHost.contains(document.activeElement)) {
        const selected = this.selection[this.selection.length - 1];
        if (selected !== undefined) this.view.focusItem(selected);
      }
    }
  }

  isNarrow(): boolean {
    return window.innerWidth < 768;
  }

  isMedium(): boolean {
    return window.innerWidth >= 768 && window.innerWidth < 1200;
  }

  private renderTopbar(): void {
    clear(this.topbar);
    const allDiagrams = h('a', { href: '/', class: 'all-diagrams', onclick: (e: Event) => { e.preventDefault(); void this.leaveTo('/'); } }, 'All diagrams');
    const title = h('h1', { class: 'diagram-title' }, this.info.title);
    this.saveStateEl = h('span', { role: 'status', 'aria-label': 'Save state', class: 'save-state mono' }, this.saveState);
    const undo = h('button', { 'aria-label': 'Undo', onclick: () => this.undo() }, 'Undo');
    const redo = h('button', { 'aria-label': 'Redo', onclick: () => this.redo() }, 'Redo');
    const save = h('button', { 'aria-label': 'Save', onclick: () => void this.saveNow() }, 'Save');
    const zoomOut = h('button', { 'aria-label': 'Zoom out', onclick: () => this.zoomStep(-1) }, 'Zoom out');
    const zoomIn = h('button', { 'aria-label': 'Zoom in', onclick: () => this.zoomStep(1) }, 'Zoom in');
    this.zoomLevelEl = h('span', { role: 'status', 'aria-label': 'Zoom level', class: 'mono' }, `${Math.round(this.zoom * 100)}%`);
    const importBtn = h('button', { 'aria-label': 'Import', onclick: () => openImportDialog(this) }, 'Import');
    const files = h('button', { 'aria-label': 'Files', onclick: () => openFilesDialog(this) }, 'Files');
    const share = h('button', { 'aria-label': 'Share', onclick: () => openShareDialog(this) }, 'Share');
    const inspectorBtn = h('button', { 'aria-label': 'Inspector', onclick: () => this.toggleInspector() }, 'Inspector');
    if (this.isNarrow()) {
      // The 375 top bar: icon link, title, save state, Files and Share.
      const allIcon = h('a', { href: '/', class: 'all-diagrams icon-only', 'aria-label': 'All diagrams', onclick: (e: Event) => { e.preventDefault(); void this.leaveTo('/'); } }, '⊞');
      this.topbar.append(allIcon, title, this.saveStateEl, files);
      if (this.info.role === 'owner') this.topbar.append(share);
      // Page tabs sit in a strip below the top bar.
      this.tabsBar.classList.add('narrow');
      // Bottom toolbar.
      const shapes = h('button', { onclick: () => this.toggleLibrary() }, 'Shapes');
      const inspector2 = h('button', { onclick: () => this.toggleInspector() }, 'Inspector');
      this.bottomToolbar = h('div', { role: 'toolbar', 'aria-label': 'Editor tools', class: 'bottom-toolbar' },
        shapes, inspector2, undo, redo, save);
      (this.root.firstElementChild as HTMLElement).appendChild(this.bottomToolbar);
    } else {
      this.topbar.append(allDiagrams, title, this.tabsBar, this.saveStateEl);
      this.tabsBar.classList.remove('narrow');
      this.topbar.append(undo, redo, save, zoomOut, zoomIn, this.zoomLevelEl);
      if (this.info.role !== 'viewer') this.topbar.append(importBtn);
      this.topbar.append(files);
      if (this.info.role === 'owner') this.topbar.append(share);
      if (this.isMedium()) this.topbar.append(inspectorBtn);
    }
  }

  private renderTabs(): void {
    clear(this.tabsBar);
    for (const page of this.info.pages) {
      const tab = h('button', {
        role: 'tab',
        'aria-selected': page.id === this.pageId ? 'true' : 'false',
        class: page.id === this.pageId ? 'page-tab selected' : 'page-tab',
        onclick: () => { void this.switchPage(page.id); },
      }, page.name);
      this.tabsBar.appendChild(tab);
    }
  }

  render(): void {
    if (this.destroyed || this.page === null) return;
    this.saveStateEl.textContent = this.saveState;
    this.zoomLevelEl.textContent = `${Math.round(this.zoom * 100)}%`;
    this.renderBanner();
    this.view.render();
    this.renderInspector();
    this.renderLibraryState();
  }

  private renderBanner(): void {
    if (this.banner === null) {
      this.bannerEl.classList.add('hidden');
      clear(this.bannerEl);
      return;
    }
    this.bannerEl.classList.remove('hidden');
    clear(this.bannerEl);
    if (this.banner === 'conflict') {
      const reload = h('button', { onclick: () => void this.reloadFromServer() }, 'Reload page');
      this.bannerEl.append(document.createTextNode(COPY.conflictBanner), reload);
    } else if (this.banner === 'downgrade') {
      this.bannerEl.textContent = COPY.downgradeBanner;
    } else if (this.banner === 'storage') {
      this.bannerEl.textContent = COPY.storageOutageBanner;
    } else {
      this.bannerEl.textContent = COPY.genericFailureBanner;
    }
  }

  private renderLibrary(): void {
    clear(this.libraryHost);
    const search = h('input', { type: 'search', 'aria-label': 'Search shapes', class: 'library-search field' }) as HTMLInputElement;
    const empty = h('p', { class: 'library-empty hidden' }, COPY.emptyLibrarySearch);
    const list = h('div', { class: 'library-list' });
    const renderButtons = (query: string) => {
      clear(list);
      const q = query.trim().toLowerCase();
      let any = false;
      for (const kind of SYSTEM_KIND_IDS) {
        const name = SYSTEM_KINDS[kind];
        if (q !== '' && !name.toLowerCase().includes(q)) continue;
        any = true;
        list.appendChild(h('button', {
          'aria-label': `Add ${name}`,
          class: 'library-item',
          disabled: this.readOnly,
          onclick: () => this.addShape(kind),
        }, name));
      }
      for (const kind of ZONE_KIND_IDS) {
        const name = ZONE_KINDS[kind].name;
        if (q !== '' && !name.toLowerCase().includes(q)) continue;
        any = true;
        const zoneCount = this.page?.zones.length ?? 0;
        list.appendChild(h('button', {
          'aria-label': `Add ${name} zone`,
          class: 'library-item zone-item',
          disabled: this.readOnly || zoneCount >= MAX_ZONES_PER_PAGE,
          onclick: () => this.addZone(kind),
        }, name));
      }
      empty.classList.toggle('hidden', any || q === '');
    };
    search.addEventListener('input', () => renderButtons(search.value));
    renderButtons('');
    this.libraryHost.append(search, empty, list);
  }

  private renderLibraryState(): void {
    const zoneLimit = (this.page?.zones.length ?? 0) >= MAX_ZONES_PER_PAGE;
    for (const button of this.libraryHost.querySelectorAll<HTMLButtonElement>('.library-item')) {
      const isZone = button.classList.contains('zone-item');
      const searching = (this.libraryHost.querySelector('.library-search') as HTMLInputElement).value.trim() !== '';
      void searching;
      button.toggleAttribute('disabled', this.readOnly || (isZone && zoneLimit));
    }
  }

  // -------------------------------------------------------------------------
  // Editing model.

  private snapshot(): Snapshot {
    return { page: JSON.parse(JSON.stringify(this.page)) as PageDocument, selection: [...this.selection] };
  }

  private pushUndo(): void {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }

  edit(apply: () => void, options?: { tally?: boolean; movedShapeIds?: string[]; movedZoneId?: string | null; zoneResized?: boolean }): void {
    if (this.readOnly || this.page === null) return;
    // A deep copy of the page before the edit, so the tally can compare states.
    const before = this.snapshot().page;
    const derivedBefore = derivePage(before);
    this.pushUndo();
    apply();
    this.editsSinceSave = true;
    this.lastEditAt = Date.now();
    const derivedAfter = derivePage(this.page);
    const qualifies = options?.tally !== false && (
      JSON.stringify(derivedBefore.zones) !== JSON.stringify(derivedAfter.zones)
    );
    if (qualifies) {
      this.tally.play({
        derivedBefore,
        derivedAfter,
        pageBefore: before,
        pageAfter: this.page,
        movedShapeIds: options?.movedShapeIds ?? [],
        movedZoneId: options?.movedZoneId ?? null,
        zoneResized: options?.zoneResized ?? false,
        reverse: false,
      });
    }
    this.saveState = this.failedState === null ? 'Unsaved changes' : 'Not saved';
    this.render();
  }

  undo(): void {
    if (this.readOnly || this.page === null) return;
    const snap = this.undoStack.pop();
    if (snap === undefined) return;
    const before = this.page;
    // The editor's live version is independent of the undo history: a local
    // undo never conflicts with the editor's own saves.
    const liveVersion = before.version;
    const derivedBefore = derivePage(before);
    this.redoStack.push(this.snapshot());
    this.page = snap.page;
    this.page.version = liveVersion;
    this.selection = snap.selection;
    const derivedAfter = derivePage(this.page);
    if (JSON.stringify(derivedBefore.zones) !== JSON.stringify(derivedAfter.zones)) {
      this.tally.play({
        derivedBefore,
        derivedAfter,
        pageBefore: before,
        pageAfter: this.page,
        movedShapeIds: this.movedShapeIdsBetween(before, this.page),
        movedZoneId: this.movedZoneIdBetween(before, this.page),
        zoneResized: false,
        reverse: true,
      });
    }
    this.editsSinceSave = true;
    this.lastEditAt = Date.now();
    this.saveState = this.failedState === null ? 'Unsaved changes' : 'Not saved';
    this.render();
  }

  redo(): void {
    if (this.readOnly || this.page === null) return;
    const snap = this.redoStack.pop();
    if (snap === undefined) return;
    const before = this.page;
    const liveVersion = before.version;
    const derivedBefore = derivePage(before);
    this.undoStack.push(this.snapshot());
    this.page = snap.page;
    this.page.version = liveVersion;
    this.selection = snap.selection;
    const derivedAfter = derivePage(this.page);
    if (JSON.stringify(derivedBefore.zones) !== JSON.stringify(derivedAfter.zones)) {
      this.tally.play({
        derivedBefore,
        derivedAfter,
        pageBefore: before,
        pageAfter: this.page,
        movedShapeIds: this.movedShapeIdsBetween(before, this.page),
        movedZoneId: this.movedZoneIdBetween(before, this.page),
        zoneResized: false,
        reverse: false,
      });
    }
    this.editsSinceSave = true;
    this.lastEditAt = Date.now();
    this.saveState = this.failedState === null ? 'Unsaved changes' : 'Not saved';
    this.render();
  }

  private movedShapeIdsBetween(before: PageDocument, after: PageDocument): string[] {
    const out: string[] = [];
    for (const shape of after.shapes) {
      const old = before.shapes.find((s) => s.id === shape.id);
      if (old !== undefined && (old.x !== shape.x || old.y !== shape.y)) out.push(shape.id);
    }
    return out;
  }

  private movedZoneIdBetween(before: PageDocument, after: PageDocument): string | null {
    for (const zone of after.zones) {
      const old = before.zones.find((z) => z.id === zone.id);
      if (old !== undefined && (old.x !== zone.x || old.y !== zone.y)) return zone.id;
    }
    return null;
  }

  announce(text: string): void {
    this.announcements = text;
    this.announcementsEl.textContent = text;
  }

  // -------------------------------------------------------------------------
  // Placing items from the library.

  canvasCenter(): { cx: number; cy: number } {
    const rect = this.canvasHost.getBoundingClientRect();
    const cx = (rect.width / 2 - this.panX) / this.zoom;
    const cy = (rect.height / 2 - this.panY) / this.zoom;
    return { cx, cy };
  }

  addShape(kind: SystemKindId): void {
    if (this.page === null) return;
    const { cx, cy } = this.canvasCenter();
    const taken = new Set<string>([...this.page.zones.map((z) => z.id), ...this.page.shapes.map((s) => s.id), ...this.page.connectors.map((c) => c.id)]);
    const id = freshId('shp-', taken);
    const pos = placedRect(cx, cy, 144, 72);
    const maxZ = Math.max(0, ...this.page.shapes.map((s) => s.z));
    const shape: Shape = { id, kind, label: SYSTEM_KINDS[kind], x: pos.x, y: pos.y, width: 144, height: 72, z: maxZ + 1, groupId: null };
    this.edit(() => {
      this.page?.shapes.push(shape);
      this.selection = [id];
      this.focusItemId = id;
    });
    this.view.focusItem(id);
  }

  addZone(kind: ZoneKindId): void {
    if (this.page === null) return;
    if (this.page.zones.length >= MAX_ZONES_PER_PAGE) return;
    const { cx, cy } = this.canvasCenter();
    const taken = new Set<string>([...this.page.zones.map((z) => z.id), ...this.page.shapes.map((s) => s.id), ...this.page.connectors.map((c) => c.id)]);
    const id = freshId('zone-', taken);
    const pos = placedRect(cx, cy, 480, 336);
    const settled = settleZoneRect(this.page.zones, pos.x, pos.y, 480, 336);
    const zone: Zone = { id, kind, name: ZONE_KINDS[kind].defaultName, note: '', x: settled.x, y: settled.y, width: 480, height: 336 };
    this.edit(() => {
      this.page?.zones.push(zone);
      this.selection = [id];
      this.focusItemId = id;
    });
    this.view.focusItem(id);
  }

  // -------------------------------------------------------------------------
  // Moves: shapes by drag or arrow keys, zones carrying their systems.

  moveSelection(dx: number, dy: number): void {
    if (this.page === null) return;
    const zones = this.page.zones.filter((z) => this.selection.includes(z.id));
    if (zones.length > 0) {
      for (const zone of zones) {
        this.moveZoneBy(zone.id, dx, dy);
      }
      return;
    }
    const shapes = this.page.shapes.filter((s) => this.selection.includes(s.id));
    if (shapes.length === 0) return;
    this.edit(() => {
      if (this.page === null) return;
      for (const shape of shapes) {
        shape.x += dx;
        shape.y += dy;
      }
      this.rerouteFor(shapes.map((s) => s.id));
    }, { movedShapeIds: shapes.map((s) => s.id) });
  }

  moveZoneBy(zoneId: string, dx: number, dy: number): boolean {
    if (this.page === null) return false;
    const zone = this.page.zones.find((z) => z.id === zoneId);
    if (zone === undefined) return false;
    const carried = carriedShapeIds(this.page, zone);
    const next = { x: zone.x + dx, y: zone.y + dy, width: zone.width, height: zone.height };
    if (zoneMoveOverlaps(this.page, zoneId, next)) {
      this.announce(COPY.overlapRefusal);
      return false;
    }
    this.edit(() => {
      if (this.page === null) return;
      const z = this.page.zones.find((zz) => zz.id === zoneId);
      if (z === undefined) return;
      z.x += dx;
      z.y += dy;
      for (const shape of this.page.shapes) {
        if (carried.has(shape.id)) {
          shape.x += dx;
          shape.y += dy;
        }
      }
      this.rerouteFor([...carried]);
    }, { movedZoneId: zoneId });
    return true;
  }

  resizeZone(zoneId: string, width: number, height: number): boolean {
    if (this.page === null) return false;
    const zone = this.page.zones.find((z) => z.id === zoneId);
    if (zone === undefined) return false;
    const next = { x: zone.x, y: zone.y, width, height };
    if (zoneMoveOverlaps(this.page, zoneId, next)) {
      this.announce(COPY.overlapRefusal);
      return false;
    }
    this.edit(() => {
      if (this.page === null) return;
      const z = this.page.zones.find((zz) => zz.id === zoneId);
      if (z === undefined) return;
      z.width = width;
      z.height = height;
    }, { movedZoneId: zoneId, zoneResized: true });
    return true;
  }

  private rerouteFor(movedIds: string[]): void {
    if (this.page === null) return;
    const moved = new Set(movedIds);
    const touched = new Set(movedIds);
    for (const conn of this.page.connectors) {
      if (moved.has(conn.from.shapeId) || moved.has(conn.to.shapeId)) {
        touched.add(conn.from.shapeId);
        touched.add(conn.to.shapeId);
      }
    }
    for (const conn of this.page.connectors) {
      if (!moved.has(conn.from.shapeId) && !moved.has(conn.to.shapeId)) continue;
      conn.points = rerouteConnector(conn, { shapes: this.page.shapes, fromId: conn.from.shapeId, toId: conn.to.shapeId });
    }
    void touched;
  }

  // -------------------------------------------------------------------------
  // Keyboard model.

  onCanvasKey(e: KeyboardEvent): void {
    if (this.page === null) return;
    const inTextField = e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT');
    if (inTextField) return;
    const mod = e.ctrlKey || e.metaKey;
    if (this.connectMode !== null) {
      if (e.key === 'Escape') {
        const source = this.connectMode.source;
        this.connectMode = null;
        this.announce('');
        this.render();
        this.view.focusItem(source);
        return;
      }
      if (e.key === 'Enter') {
        const focused = this.focusItemId;
        if (focused !== null && focused !== this.connectMode.source) {
          this.attachConnector(this.connectMode.source, focused);
        }
        return;
      }
      if (e.key === 'Tab') {
        // Tab and Shift+Tab move only between other shapes.
        e.preventDefault();
        const shapes = this.readingOrderShapes();
        const others = shapes.filter((s) => s.id !== this.connectMode?.source);
        if (others.length === 0) return;
        const current = others.findIndex((s) => s.id === this.focusItemId);
        const nextIndex = e.shiftKey
          ? (current <= 0 ? others.length - 1 : current - 1)
          : (current === -1 || current === others.length - 1 ? 0 : current + 1);
        this.focusItemId = others[nextIndex].id;
        this.view.focusItem(others[nextIndex].id);
        return;
      }
      return;
    }
    if (mod && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
      e.preventDefault();
      this.undo();
      return;
    }
    if ((mod && (e.key === 'y' || e.key === 'Y')) || (mod && e.shiftKey && (e.key === 'z' || e.key === 'Z'))) {
      e.preventDefault();
      this.redo();
      return;
    }
    if (mod && e.key === 's') {
      e.preventDefault();
      void this.saveNow();
      return;
    }
    if (mod && (e.key === 'g' || e.key === 'G')) {
      e.preventDefault();
      if (e.shiftKey) this.ungroup(); else this.group();
      return;
    }
    if (mod && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      this.duplicate();
      return;
    }
    if (mod && (e.key === ']' || e.key === '[')) {
      e.preventDefault();
      this.changeLayerOrder(e.key === ']');
      return;
    }
    if (e.altKey && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const edge: AlignEdge = e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right' : e.key === 'ArrowUp' ? 'top' : 'bottom';
      this.align(edge);
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const step = e.shiftKey ? 24 : 8;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      if (this.focusItemId !== null && !this.selection.includes(this.focusItemId)) {
        this.selection = [this.focusItemId];
      }
      this.moveSelection(dx, dy);
      if (this.focusItemId !== null) this.view.focusItem(this.focusItemId);
      return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      if (this.focusItemId !== null) {
        if (e.shiftKey) {
          const index = this.selection.indexOf(this.focusItemId);
          if (index === -1) this.selection.push(this.focusItemId);
          else this.selection.splice(index, 1);
        } else {
          this.selection = [this.focusItemId];
        }
        this.render();
      }
      return;
    }
    if (e.key === 'c' || e.key === 'C') {
      if (this.focusItemId !== null) {
        const shape = this.page.shapes.find((s) => s.id === this.focusItemId);
        if (shape !== undefined) {
          this.connectMode = { source: this.focusItemId };
          this.announce(COPY.connectPrompt);
        }
      }
      return;
    }
    if (e.key === 'Enter' || e.key === 'F2') {
      if (this.focusItemId !== null) {
        this.editLabel(this.focusItemId);
      }
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.deleteSelection();
      return;
    }
    if (e.key === 'Escape') {
      this.selection = [];
      this.render();
      return;
    }
  }

  private readingOrderShapes(): Shape[] {
    if (this.page === null) return [];
    return [...this.page.shapes].sort((a, b) => a.y - b.y || a.x - b.x);
  }

  private attachConnector(sourceId: string, targetId: string): void {
    if (this.page === null) return;
    const source = this.page.shapes.find((s) => s.id === sourceId);
    const target = this.page.shapes.find((s) => s.id === targetId);
    if (source === undefined || target === undefined) return;
    const ports = closestPorts(source, target);
    const start = portPoint(source, ports.from);
    const end = portPoint(target, ports.to);
    const taken = new Set<string>(this.page.connectors.map((c) => c.id));
    const id = freshId('con-', taken);
    const connector: Connector = {
      id,
      label: '',
      from: { shapeId: sourceId, port: ports.from },
      to: { shapeId: targetId, port: ports.to },
      points: elbowPath(start, end),
    };
    this.connectMode = null;
    this.edit(() => {
      this.page?.connectors.push(connector);
    });
    this.announce(COPY.connectedTo(plainLabel(source.label), plainLabel(target.label)));
    this.view.focusItem(sourceId);
  }

  group(): void {
    if (this.page === null) return;
    const selected = new Set(this.selection);
    const shapes = this.page.shapes.filter((s) => selected.has(s.id));
    if (shapes.length < 2) return;
    const taken = new Set<string>(this.page.shapes.map((s) => s.groupId ?? ''));
    const groupId = freshId('grp-', taken);
    this.edit(() => {
      if (this.page === null) return;
      for (const shape of this.page.shapes) {
        if (selected.has(shape.id)) shape.groupId = groupId;
      }
    });
  }

  ungroup(): void {
    if (this.page === null) return;
    const selected = new Set(this.selection);
    const shapes = this.page.shapes.filter((s) => selected.has(s.id) && s.groupId !== null);
    if (shapes.length === 0) return;
    const groups = new Set(shapes.map((s) => s.groupId));
    this.edit(() => {
      if (this.page === null) return;
      for (const shape of this.page.shapes) {
        if (shape.groupId !== null && groups.has(shape.groupId)) shape.groupId = null;
      }
    });
  }

  align(edge: AlignEdge): void {
    if (this.page === null) return;
    const result = alignSelection(this.page, new Set(this.selection), edge);
    if (!result.changed) return;
    this.edit(() => {
      if (this.page === null) return;
      this.page.shapes = result.shapes;
    });
  }

  duplicate(): void {
    if (this.page === null) return;
    const result = duplicateSelection(this.page, new Set(this.selection));
    if (result.newIds.length === 0) return;
    this.edit(() => {
      if (this.page === null) return;
      this.page.shapes = result.shapes;
      this.page.connectors = result.connectors;
      this.selection = result.newIds;
    });
  }

  changeLayerOrder(forward: boolean): void {
    if (this.page === null) return;
    const before = this.page;
    const beforeDerived = derivePage(before);
    const result = changeLayer(this.page, this.selection.filter((id) => before.shapes.some((s) => s.id === id)), forward);
    if (!result.changed) {
      const n = this.page.shapes.length;
      if (this.selection.length === 1) {
        const shape = this.page.shapes.find((s) => s.id === this.selection[0]);
        if (shape !== undefined) {
          const atLimit = forward
            ? layerPosition(this.page, shape.id) === n
            : layerPosition(this.page, shape.id) === 1;
          this.announce(forward
            ? `${plainLabel(shape.label)} is already at the front.`
            : `${plainLabel(shape.label)} is already at the back.`);
          void atLimit;
        }
      } else if (this.selection.length > 1) {
        this.announce(forward
          ? `${this.selection.length} shapes are already at the front.`
          : `${this.selection.length} shapes are already at the back.`);
      }
      return;
    }
    this.edit(() => {
      if (this.page === null) return;
      this.page.shapes = result.shapes;
    }, { tally: false });
    const after = this.page;
    const afterDerived = derivePage(after);
    if (JSON.stringify(beforeDerived.zones) === JSON.stringify(afterDerived.zones)) {
      const n = after.shapes.length;
      if (this.selection.length === 1) {
        const shape = after.shapes.find((s) => s.id === this.selection[0]);
        if (shape !== undefined) {
          const k = layerPosition(after, shape.id);
          this.announce(forward
            ? `${plainLabel(shape.label)} brought forward. Layer ${k} of ${n}.`
            : `${plainLabel(shape.label)} sent backward. Layer ${k} of ${n}.`);
        }
      } else {
        const moved = result.shapes.filter((s, i) => before.shapes[i].z !== s.z).length;
        this.announce(forward
          ? `${moved} shapes brought forward.`
          : `${moved} shapes sent backward.`);
      }
    }
    if (this.focusItemId !== null) this.view.focusItem(this.focusItemId);
  }

  deleteSelection(): void {
    if (this.page === null) return;
    const selected = new Set(this.selection);
    const removedShapes = this.page.shapes.filter((s) => selected.has(s.id));
    if (removedShapes.length === 0 && !selected.has(this.focusItemId ?? '')) {
      this.selection = [];
      this.render();
      return;
    }
    this.edit(() => {
      if (this.page === null) return;
      const removed = new Set(this.page.shapes.filter((s) => selected.has(s.id)).map((s) => s.id));
      this.page.shapes = this.page.shapes.filter((s) => !removed.has(s.id));
      this.page.connectors = this.page.connectors.filter((c) => !removed.has(c.from.shapeId) && !removed.has(c.to.shapeId));
      this.selection = [];
    });
  }

  editLabel(itemId: string): void {
    const item = this.findItem(itemId);
    if (item === null) return;
    this.openInspectorForLabel();
  }

  private openInspectorForLabel(): void {
    this.inspectorOpen = true;
    this.renderInspector();
    const field = this.inspectorHost.querySelector<HTMLInputElement>('[data-label-field]');
    if (field !== null) {
      field.focus();
      field.select();
    }
  }

  findItem(id: string): { kind: 'shape' | 'zone' | 'connector'; item: Shape | Zone | Connector } | null {
    if (this.page === null) return null;
    const shape = this.page.shapes.find((s) => s.id === id);
    if (shape !== undefined) return { kind: 'shape', item: shape };
    const zone = this.page.zones.find((z) => z.id === id);
    if (zone !== undefined) return { kind: 'zone', item: zone };
    const connector = this.page.connectors.find((c) => c.id === id);
    if (connector !== undefined) return { kind: 'connector', item: connector };
    return null;
  }

  // -------------------------------------------------------------------------
  // Inspector.

  toggleInspector(): void {
    this.inspectorOpen = !this.inspectorOpen;
    this.renderInspector();
    if (this.inspectorOpen && window.innerWidth < 1200) {
      const field = this.inspectorHost.querySelector<HTMLElement>('[data-first-field]');
      if (field !== null) field.focus();
    }
  }

  toggleLibrary(): void {
    this.libraryOpen = !this.libraryOpen;
    this.renderLibrarySheet();
  }

  private renderLibrarySheet(): void {
    // At 375 the library opens as a bottom sheet covering about the lower
    // 60 percent, and closes only through its close button or Escape.
    if (this.librarySheetHandle !== null) {
      this.librarySheetHandle.close();
      this.librarySheetHandle = null;
      if (!this.libraryOpen) return;
    }
    if (!this.libraryOpen || !this.isNarrow()) return;
    const closeButton = h('button', { class: 'close-panel' }, 'Close shape library');
    const sheet = h('div', { class: 'dialog-body library-sheet-body' }, closeButton, this.libraryHost);
    this.librarySheetHandle = openDialog('Shape library', sheet, {
      onClose: () => {
        this.libraryOpen = false;
        this.editorRow.prepend(this.libraryHost);
      },
    });
    closeButton.addEventListener('click', () => {
      this.librarySheetHandle?.close();
      this.librarySheetHandle = null;
    });
  }

  private renderInspector(): void {
    if (window.innerWidth >= 1200) {
      // The desktop inspector is a pane, not a dialog. Widening turns an open
      // drawer into the pane with the same selection.
      if (this.inspectorDrawerHandle !== null) {
        const handle = this.inspectorDrawerHandle;
        this.inspectorDrawerHandle = null;
        this.inspectorOpen = false;
        handle.close();
      }
      if (this.inspectorHost.parentElement !== this.editorRow) {
        this.editorRow.appendChild(this.inspectorHost);
      }
      this.inspectorHost.className = 'inspector-pane';
      this.inspectorHost.setAttribute('role', 'complementary');
      this.inspectorHost.setAttribute('aria-label', 'Inspector');
      this.renderInspectorBody();
      return;
    }
    // Below 1200 the inspector is a drawer, closed and removed from the page.
    if (!this.inspectorOpen) {
      if (this.inspectorDrawerHandle !== null) {
        const handle = this.inspectorDrawerHandle;
        this.inspectorDrawerHandle = null;
        handle.close();
      }
      return;
    }
    if (this.inspectorDrawerHandle === null) {
      this.renderInspectorBody();
      const closeButton = h('button', { class: 'close-panel' }, 'Close inspector');
      closeButton.addEventListener('click', () => this.toggleInspector());
      this.inspectorHost.prepend(closeButton);
      this.inspectorHost.className = this.isNarrow() ? 'inspector-drawer full' : 'inspector-drawer';
      this.inspectorHost.setAttribute('role', 'dialog');
      this.inspectorHost.setAttribute('aria-label', 'Inspector');
      this.inspectorDrawerHandle = openDialog('Inspector', this.inspectorHost, {
        onClose: () => {
          this.inspectorOpen = false;
          this.inspectorDrawerHandle = null;
          // A closed drawer is removed from the page, not hidden.
          this.inspectorHost.remove();
          this.inspectorHost.className = 'inspector-pane';
          // Focus returns to the Inspector control.
          const button = this.root.querySelector<HTMLElement>('[aria-label="Inspector"]');
          if (button !== null) {
            button.focus();
          } else {
            const selected = this.selection[this.selection.length - 1];
            if (selected !== undefined) this.view.focusItem(selected);
          }
        },
      });
    } else {
      this.renderInspectorBody();
    }
  }

  private renderInspectorBody(): void {
    clear(this.inspectorHost);
    if (this.isNarrow() || this.isMedium()) {
      this.inspectorHost.appendChild(h('button', { class: 'close-panel', onclick: () => this.toggleInspector() }, 'Close inspector'));
    }
    if (this.page === null) return;
    const selectedId = this.selection[this.selection.length - 1] ?? this.focusItemId;
    if (selectedId === undefined || selectedId === null) {
      this.inspectorHost.appendChild(h('p', { class: 'inspector-empty' }, 'Nothing selected'));
      return;
    }
    const found = this.findItem(selectedId);
    if (found === null) return;
    if (found.kind === 'shape') this.renderShapeInspector(found.item as Shape);
    else if (found.kind === 'zone') this.renderZoneInspector(found.item as Zone);
    else this.renderConnectorInspector(found.item as Connector);
  }

  private numberField(label: string, value: number, onchange: (value: number) => void, options?: { readonly?: boolean }): HTMLElement {
    const input = h('input', {
      type: 'number', class: 'field mono', value: String(value), 'aria-label': label,
      ...(options?.readonly ? { disabled: true } : {}),
    }) as HTMLInputElement;
    input.addEventListener('change', () => {
      const n = Number(input.value);
      if (Number.isFinite(n)) onchange(Math.round(n));
    });
    const wrap = h('div', { class: 'inspector-field' }, h('label', {}, label), input);
    return wrap;
  }

  private renderShapeInspector(shape: Shape): void {
    if (this.page === null) return;
    const labelInput = h('input', { type: 'text', class: 'field', value: shape.label, 'aria-label': 'Label', 'data-label-field': 'true' }) as HTMLInputElement;
    labelInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        labelInput.blur();
        this.view.focusItem(shape.id);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        labelInput.value = shape.label;
        labelInput.blur();
        this.view.focusItem(shape.id);
      }
    });
    labelInput.addEventListener('change', () => {
      const found = this.page?.shapes.find((s) => s.id === shape.id);
      if (found !== undefined && found.label !== labelInput.value) {
        const value = labelInput.value;
        this.edit(() => { found.label = value; }, { tally: false });
      }
    });
    const kindSelect = h('select', { 'aria-label': 'Kind', class: 'field' }) as HTMLSelectElement;
    for (const kind of SYSTEM_KIND_IDS) {
      kindSelect.add(optionEl(kind, SYSTEM_KINDS[kind]));
    }
    kindSelect.value = shape.kind;
    kindSelect.addEventListener('change', () => {
      const found = this.page?.shapes.find((s) => s.id === shape.id);
      if (found !== undefined) {
        this.edit(() => { found.kind = kindSelect.value as SystemKindId; }, { tally: false });
      }
    });
    const fields: HTMLElement[] = [
      h('div', { class: 'inspector-field', 'data-first-field': 'true' }, h('label', {}, 'Label'), labelInput),
      h('div', { class: 'inspector-field' }, h('label', {}, 'Kind'), kindSelect),
    ];
    for (const axis of ['X', 'Y', 'Width', 'Height'] as const) {
      fields.push(this.numberField(axis, shape[axis.toLowerCase() as 'x' | 'y' | 'width' | 'height'], (value) => {
        const found = this.page?.shapes.find((s) => s.id === shape.id);
        if (found === undefined) return;
        if (axis === 'X' || axis === 'Y') {
          const dx = axis === 'X' ? value - found.x : 0;
          const dy = axis === 'Y' ? value - found.y : 0;
          this.edit(() => {
            found.x += dx;
            found.y += dy;
            this.rerouteFor([found.id]);
          }, { movedShapeIds: [found.id] });
        } else {
          const key = axis.toLowerCase() as 'width' | 'height';
          this.edit(() => { found[key] = value; this.rerouteFor([found.id]); }, { tally: false });
        }
      }, { readonly: this.readOnly }));
    }
    const alignRow = h('div', { class: 'inspector-buttons' },
      h('button', { onclick: () => this.align('left'), disabled: this.readOnly }, 'Align left'),
      h('button', { onclick: () => this.align('right'), disabled: this.readOnly }, 'Align right'),
      h('button', { onclick: () => this.align('top'), disabled: this.readOnly }, 'Align top'),
      h('button', { onclick: () => this.align('bottom'), disabled: this.readOnly }, 'Align bottom'),
    );
    const layerRow = h('div', { class: 'inspector-buttons' },
      h('button', { onclick: () => this.changeLayerOrder(true), disabled: this.readOnly }, 'Bring forward'),
      h('button', { onclick: () => this.changeLayerOrder(false), disabled: this.readOnly }, 'Send backward'),
    );
    const groupRow = h('div', { class: 'inspector-buttons' },
      h('button', { onclick: () => this.group(), disabled: this.readOnly }, 'Group'),
      h('button', { onclick: () => this.ungroup(), disabled: this.readOnly }, 'Ungroup'),
      h('button', { onclick: () => this.duplicate(), disabled: this.readOnly }, 'Duplicate'),
      h('button', {
        onclick: () => {
          this.selection = [shape.id];
          this.deleteSelection();
        },
        disabled: this.readOnly,
      }, 'Delete'),
    );
    this.inspectorHost.append(...fields, alignRow, layerRow, groupRow);
    if (this.readOnly) {
      for (const input of this.inspectorHost.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')) {
        input.setAttribute('readonly', '');
      }
    }
  }

  private renderZoneInspector(zone: Zone): void {
    if (this.page === null) return;
    const derived = this.derived ?? derivePage(this.page);
    const zoneDerived = derived.zones.find((z) => z.id === zone.id);
    const nameInput = h('input', { type: 'text', class: 'field', value: zone.name, 'aria-label': 'Zone name' }) as HTMLInputElement;
    nameInput.addEventListener('change', () => {
      const found = this.page?.zones.find((z) => z.id === zone.id);
      if (found !== undefined && found.name !== nameInput.value) {
        const value = nameInput.value;
        this.edit(() => { found.name = value; }, { tally: false });
      }
    });
    const kindSelect = h('select', { 'aria-label': 'Zone kind', class: 'field' }) as HTMLSelectElement;
    for (const kind of ZONE_KIND_IDS) {
      kindSelect.add(optionEl(kind, ZONE_KINDS[kind].name));
    }
    kindSelect.value = zone.kind;
    kindSelect.addEventListener('change', () => {
      const found = this.page?.zones.find((z) => z.id === zone.id);
      if (found !== undefined) {
        this.edit(() => { found.kind = kindSelect.value as ZoneKindId; }, { tally: false });
      }
    });
    const noteInput = h('textarea', { class: 'field', 'aria-label': 'Note' }) as HTMLTextAreaElement;
    noteInput.value = zone.note;
    noteInput.addEventListener('change', () => {
      const found = this.page?.zones.find((z) => z.id === zone.id);
      if (found !== undefined && found.note !== noteInput.value) {
        const value = noteInput.value;
        this.edit(() => { found.note = value; }, { tally: false });
      }
    });
    this.inspectorHost.append(
      h('div', { class: 'inspector-field', 'data-first-field': 'true' }, h('label', {}, 'Zone name'), nameInput),
      h('div', { class: 'inspector-field' }, h('label', {}, 'Zone kind'), kindSelect),
      h('div', { class: 'inspector-field' }, h('label', {}, 'Note'), noteInput),
      this.numberField('X', zone.x, (v) => this.moveZoneTo(zone.id, v, null), { readonly: this.readOnly }),
      this.numberField('Y', zone.y, (v) => this.moveZoneTo(zone.id, null, v), { readonly: this.readOnly }),
      this.numberField('Width', zone.width, (v) => this.resizeZone(zone.id, v, zone.height), { readonly: this.readOnly }),
      this.numberField('Height', zone.height, (v) => this.resizeZone(zone.id, zone.width, v), { readonly: this.readOnly }),
    );
    const members = h('ul', { role: 'list', 'aria-label': `Systems in ${zone.name}`, class: 'inspector-list' });
    for (const memberId of zoneDerived?.members ?? []) {
      const shape = this.page.shapes.find((s) => s.id === memberId);
      if (shape !== undefined) members.appendChild(h('li', {}, plainLabel(shape.label)));
    }
    const flows = h('ul', { role: 'list', 'aria-label': `Flows crossing ${zone.name}`, class: 'inspector-list' });
    for (const crossing of (this.derived ?? derivePage(this.page)).crossings.filter((c) => c.zoneId === zone.id)) {
      const conn = this.page.connectors.find((c) => c.id === crossing.connectorId);
      const from = this.page.shapes.find((s) => s.id === conn?.from.shapeId);
      const to = this.page.shapes.find((s) => s.id === conn?.to.shapeId);
      flows.appendChild(h('li', {},
        `${plainLabel(conn?.label ?? '')}: ${plainLabel(from?.label ?? '')} to ${plainLabel(to?.label ?? '')}, ${crossing.direction === 'in' ? 'entering' : 'leaving'}`));
    }
    this.inspectorHost.append(members, flows);
    if (this.readOnly) {
      for (const input of this.inspectorHost.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')) {
        input.setAttribute('readonly', '');
      }
    }
  }

  private moveZoneTo(zoneId: string, x: number | null, y: number | null): void {
    if (this.page === null) return;
    const zone = this.page.zones.find((z) => z.id === zoneId);
    if (zone === undefined) return;
    const dx = x !== null ? x - zone.x : 0;
    const dy = y !== null ? y - zone.y : 0;
    this.moveZoneBy(zoneId, dx, dy);
  }

  private renderConnectorInspector(connector: Connector): void {
    if (this.page === null) return;
    const labelInput = h('input', { type: 'text', class: 'field', value: connector.label, 'aria-label': 'Label', 'data-label-field': 'true' }) as HTMLInputElement;
    labelInput.addEventListener('change', () => {
      const found = this.page?.connectors.find((c) => c.id === connector.id);
      if (found !== undefined && found.label !== labelInput.value) {
        const value = labelInput.value;
        this.edit(() => { found.label = value; }, { tally: false });
      }
    });
    labelInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        if (e.key === 'Escape') labelInput.value = connector.label;
        labelInput.blur();
        this.view.focusItem(connector.id);
      }
    });
    const from = this.page.shapes.find((s) => s.id === connector.from.shapeId);
    const to = this.page.shapes.find((s) => s.id === connector.to.shapeId);
    this.inspectorHost.append(
      h('div', { class: 'inspector-field', 'data-first-field': 'true' }, h('label', {}, 'Label'), labelInput),
      h('div', { class: 'inspector-field' }, h('label', {}, 'From'), h('input', { class: 'field', value: from !== undefined ? from.label : '', 'aria-label': 'From', readonly: true })),
      h('div', { class: 'inspector-field' }, h('label', {}, 'To'), h('input', { class: 'field', value: to !== undefined ? to.label : '', 'aria-label': 'To', readonly: true })),
    );
    if (this.readOnly) {
      labelInput.setAttribute('readonly', '');
    }
  }

  // -------------------------------------------------------------------------
  // Save queue.

  private autosaveTick(): void {
    if (this.readOnly || this.destroyed) return;
    if (this.saveInFlight || this.failedState === 'conflict') return;
    if (this.sessionDialogHandle !== null) return;
    if (!this.editsSinceSave) return;
    const age = Date.now() - this.lastEditAt;
    if (age < 1200) return;
    void this.startSave();
  }

  async saveNow(): Promise<void> {
    if (this.readOnly || this.page === null || this.saveState === 'Read only') return;
    if (this.sessionDialogHandle !== null) return;
    if (this.saveInFlight) {
      this.saveQueued = true;
      return;
    }
    if (!this.editsSinceSave && this.failedState === null) {
      return;
    }
    await this.startSave();
  }

  private async startSave(): Promise<boolean> {
    if (this.page === null) return false;
    const doc = JSON.parse(JSON.stringify(this.page)) as PageDocument;
    const version = doc.version;
    this.saveInFlight = true;
    this.editsSinceSave = false;
    this.saveState = 'Saving...';
    this.render();
    try {
      const resp = await apiPut(`/api/diagrams/${this.diagramId}/pages/${this.pageId}`, doc) as { page: PageDocument; derived: Derived };
      this.saveInFlight = false;
      // The returned version is adopted at once.
      if (this.page !== null) this.page.version = resp.page.version;
      // Update the tab version list.
      const tab = this.info.pages.find((p) => p.id === this.pageId);
      if (tab !== undefined) tab.version = resp.page.version;
      if (this.editsSinceSave) {
        // Edits made during the save are sent next, with the returned version.
        this.saveState = 'Saving...';
        this.saveQueued = true;
      } else {
        this.saveState = 'Saved';
        this.derived = resp.derived;
      }
      if (this.saveQueued) {
        this.saveQueued = false;
        if (this.editsSinceSave || this.failedState === null) {
          window.setTimeout(() => { void this.startSave(); }, 0);
        }
      }
      this.render();
      return true;
    } catch (err) {
      this.saveInFlight = false;
      this.saveQueued = false;
      if (err instanceof ApiRequestError) {
        if (err.code === 'session_expired') {
          // The request is kept and resent after sign-in. One dialog serves
          // every kept request, and no timer sends another save meanwhile.
          this.page.version = version;
          this.editsSinceSave = false;
          if (this.sessionDialogHandle === null) {
            this.keptRequests.push({ kind: 'save' });
            this.saveState = 'Saving...';
            this.render();
            this.sessionDialogHandle = openSessionDialog(this);
          }
          return false;
        }
        if (err.code === 'forbidden') {
          await this.applyDowngrade();
          return false;
        }
        if (err.code === 'not_found') {
          this.destroy();
          this.root.innerHTML = '';
          this.root.appendChild(diagramNotFoundScreen());
          return false;
        }
        if (err.code === 'version_conflict') {
          this.failedState = 'conflict';
          this.banner = 'conflict';
          this.saveState = 'Not saved';
          this.render();
          return false;
        }
        if (err.status >= 500 || err.status === 422) {
          this.failedState = 'generic';
          this.banner = 'generic';
          this.saveState = 'Not saved';
          this.render();
          return false;
        }
      }
      this.failedState = 'generic';
      this.banner = 'generic';
      this.saveState = 'Not saved';
      this.render();
      return false;
    }
  }

  // A save refused as forbidden makes the canvas read-only, and the banner
  // persists through every refresh: the downgrade is remembered per browser.
  private async applyDowngrade(): Promise<void> {
    this.readOnly = true;
    try {
      localStorage.setItem(`sw-downgrade:${this.diagramId}`, '1');
    } catch {
      // Storage may be unavailable; the banner still shows for this page.
    }
    try {
      const resp = await apiGet(`/api/diagrams/${this.diagramId}/pages/${this.pageId}`) as { page: PageDocument; derived: Derived };
      this.page = resp.page;
      this.derived = resp.derived;
    } catch {
      // Keep the local page read-only.
    }
    this.info.role = 'viewer';
    this.banner = 'downgrade';
    this.saveState = 'Read only';
    this.renderTopbar();
    this.render();
  }

  // Kept requests are resent once, with the new session's CSRF token.
  async resendKeptRequests(): Promise<void> {
    this.sessionDialogHandle = null;
    const kept = this.keptRequests;
    this.keptRequests = [];
    for (const request of kept) {
      if (request.kind === 'save') {
        this.editsSinceSave = true;
        await this.startSave();
      }
    }
  }

  private async reloadFromServer(): Promise<void> {
    try {
      const resp = await apiGet(`/api/diagrams/${this.diagramId}/pages/${this.pageId}`) as { page: PageDocument; derived: Derived };
      this.page = resp.page;
      this.derived = resp.derived;
      this.undoStack = [];
      this.redoStack = [];
      this.failedState = null;
      this.banner = null;
      this.saveState = 'Saved';
      this.selection = [];
      this.render();
    } catch {
      this.announce(COPY.genericFailureBanner);
    }
  }

  private async checkStorageStatus(): Promise<void> {
    if (this.destroyed) return;
    try {
      const resp = await apiGet('/api/status') as { storage: string; mail: string };
      const down = resp.storage === 'down';
      const was = this.banner === 'storage';
      if (down && !was && this.banner !== 'downgrade' && this.banner !== 'conflict') {
        this.banner = 'storage';
        this.render();
      } else if (!down && was) {
        this.banner = null;
        this.render();
      }
    } catch {
      // The status check never interrupts editing.
    }
  }

  // -------------------------------------------------------------------------
  // Leaving the editor: settle the save first.

  async leaveTo(path: string, replace = false): Promise<void> {
    if (this.leaving) return;
    if (this.readOnly || this.page === null || (!this.editsSinceSave && !this.saveInFlight && this.failedState === null)) {
      this.destroy();
      navigate(path, replace);
      return;
    }
    this.leaving = true;
    this.saveState = 'Saving...';
    this.render();
    const ok = await this.settleSave();
    this.leaving = false;
    if (ok) {
      this.destroy();
      navigate(path, replace);
    } else {
      this.render();
    }
  }

  private async settleSave(): Promise<boolean> {
    if (this.editsSinceSave) {
      const ok = await this.startSave();
      if (!ok) return false;
    }
    // Wait for an in-flight save by polling briefly.
    for (let i = 0; i < 100 && this.saveInFlight; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return !this.saveInFlight && this.failedState === null;
  }

  private async switchPage(pageId: string): Promise<void> {
    if (pageId === this.pageId) return;
    if (this.leaving) return;
    if (!this.readOnly && (this.editsSinceSave || this.saveInFlight) && this.page !== null) {
      this.leaving = true;
      this.saveState = 'Saving...';
      this.render();
      const ok = await this.settleSave();
      this.leaving = false;
      if (!ok) return;
    }
    this.pageId = pageId;
    history.pushState(null, '', `/d/${this.diagramId}/p/${pageId}`);
    await this.loadPage();
    this.renderTabs();
    this.renderTopbar();
  }

  onBeforeUnload(e: BeforeUnloadEvent): boolean {
    if (!this.readOnly && (this.editsSinceSave || this.saveInFlight) && this.page !== null) {
      e.preventDefault();
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Zoom.

  zoomStep(direction: number): void {
    const levels = [25, 50, 75, 100, 125, 150, 175, 200, 225, 250, 275, 300, 325, 350, 375, 400];
    const percent = this.zoom * 100;
    let next: number;
    if (direction > 0) {
      next = levels.find((l) => l > percent) ?? 400;
    } else {
      const below = [...levels].reverse().find((l) => l < percent) ?? 25;
      next = below;
    }
    if ((direction > 0 && percent >= 400) || (direction < 0 && percent <= 25)) return;
    this.setZoom(next / 100);
  }

  setZoom(zoom: number): void {
    const clamped = Math.min(4, Math.max(0.25, zoom));
    const host = this.canvasHost.getBoundingClientRect();
    const cx = host.width / 2;
    const cy = host.height / 2;
    const canvasX = (cx - this.panX) / this.zoom;
    const canvasY = (cy - this.panY) / this.zoom;
    this.zoom = clamped;
    this.panX = cx - canvasX * clamped;
    this.panY = cy - canvasY * clamped;
    this.render();
  }

  setZoomAt(zoom: number, screenX: number, screenY: number): void {
    const host = this.canvasHost.getBoundingClientRect();
    const px = screenX - host.left;
    const py = screenY - host.top;
    const clamped = Math.min(4, Math.max(0.25, zoom));
    const canvasX = (px - this.panX) / this.zoom;
    const canvasY = (py - this.panY) / this.zoom;
    this.zoom = clamped;
    this.panX = px - canvasX * clamped;
    this.panY = py - canvasY * clamped;
    this.render();
  }

  panBy(dx: number, dy: number): void {
    this.panX += dx;
    this.panY += dy;
    this.view.updateTransform();
  }

  updateZoomStatus(): void {
    if (this.zoomLevelEl !== undefined) {
      this.zoomLevelEl.textContent = `${Math.round(this.zoom * 100)}%`;
    }
  }

  // -------------------------------------------------------------------------
  // Public surface for the canvas and dialogs.

  viewPublic(): CanvasView {
    return this.view;
  }

  announcementsRegion(): HTMLElement {
    return this.announcementsEl;
  }

  showStorageBanner(): void {
    this.banner = 'storage';
    this.render();
  }

  userEmail(): string {
    return appState.user?.email ?? '';
  }

  attachConnectorPublic(sourceId: string, targetId: string): void {
    this.attachConnector(sourceId, targetId);
  }

  // A drag move: shapes in steps of 8, zones by the zone rules.
  dragMove(ids: Set<string>, dx: number, dy: number): void {
    if (this.page === null) return;
    const zoneIds = [...ids].filter((id) => this.page?.zones.some((z) => z.id === id));
    const shapeIds = [...ids].filter((id) => this.page?.shapes.some((s) => s.id === id));
    if (zoneIds.length > 0) {
      for (const id of zoneIds) {
        this.moveZoneBy(id, dx, dy);
      }
      return;
    }
    if (shapeIds.length === 0) return;
    this.edit(() => {
      if (this.page === null) return;
      for (const id of shapeIds) {
        const shape = this.page.shapes.find((s) => s.id === id);
        if (shape !== undefined) {
          shape.x += dx;
          shape.y += dy;
        }
      }
      this.rerouteFor(shapeIds);
    }, { movedShapeIds: shapeIds });
  }

  // An import added a page: its tab is added, selected and focused.
  async addImportedPage(pageId: string): Promise<void> {
    try {
      const resp = await apiGet(`/api/diagrams/${this.diagramId}`) as { diagram: DiagramInfo };
      this.info = resp.diagram;
    } catch {
      // The page list refresh is best-effort; the page opens directly.
    }
    this.renderTabs();
    this.pageId = pageId;
    history.pushState(null, '', `/d/${this.diagramId}/p/${pageId}`);
    await this.loadPage();
    this.renderTabs();
  }
}

let currentEditor: Editor | null = null;
let currentUnloadHook: ((e: BeforeUnloadEvent) => void) | null = null;

export async function renderEditor(root: HTMLElement, diagramId: string, pageId: string | null, appStateRef: AppState): Promise<void> {
  void appStateRef;
  if (currentEditor !== null) {
    currentEditor.destroy();
    currentEditor = null;
    if (currentUnloadHook !== null) {
      window.removeEventListener('beforeunload', currentUnloadHook);
      currentUnloadHook = null;
    }
  }
  const container = h('div', {});
  root.appendChild(container);
  const editor = new Editor(container, diagramId);
  currentEditor = editor;
  currentUnloadHook = (e: BeforeUnloadEvent) => {
    editor.onBeforeUnload(e);
  };
  window.addEventListener('beforeunload', currentUnloadHook);
  await editor.load(pageId);
}
