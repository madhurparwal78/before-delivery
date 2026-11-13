import { el, svgEl, entityLabel, toScreen, toWorld } from './ui.js';
import type { DrawingState, ViewState, AidsState, PendingOperation } from './store.js';
import { drawingFromApi, entityAtPoint, entityHandlesForDom, visibleEntities, zoomAll, applyOpToState } from './store.js';
import { REFUSALS, READY_PROMPT, CANCELLED_PROMPT, parsePoint, parseNumber, resolveCommand, stageTakesSpace, unknownCommandText, type CommandSpec } from './commands.js';
import { entityMarkup, gripPoints, gripResult, fieldChanges, snapCandidates, perpendicularFoot, tangentPoint, lengthOf, areaOf } from './canvas.js';
import type { Pt, ResolvedEntity } from '../shared/geometry.js';
import { entityBounds } from '../shared/geometry.js';
import { round6 } from '../shared/num.js';
import { numberKey, trimZeros } from '../shared/num.js';
import { PRESENCE_COLOURS, reducedMotion, clamp, nearestMultipleOf45, handleOrder, normaliseAngle, cssEscape } from './constants.js';

// ---------------------------------------------------------------------------
// The drawing screen: state, canvas, pointer, command line, live channel.
// Panels and dialogs live in screen_panels.ts.
// ---------------------------------------------------------------------------

export interface ClientApi {
  <T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }>;
}

export interface ScreenSettings {
  toastMs: number;
  domMarginPx: number;
  domCeiling: number;
}

export const PANEL_ORDER = ['Entities', 'Layers', 'Properties', 'Parameters', 'Xrefs', 'Versions', 'Issues', 'Markups'] as const;
export type PanelName = (typeof PANEL_ORDER)[number];

export class DrawingScreenCore {
  readonly root: HTMLElement;
  protected readonly api: ClientApi;
  protected readonly drawingId: string;
  protected readonly me: string | null;
  protected readonly readOnly: boolean;
  protected readonly settings: ScreenSettings;
  protected state: DrawingState | null = null;
  protected view: ViewState = { zoom: 1, panX: 0, panY: 0 };
  protected selection = new Set<string>();
  protected aids: AidsState = { snap: true, ortho: false, grid: false, polar: false };
  protected lastPoint: Pt = { x: 0, y: 0 };
  protected snapPoint: { kind: string; point: Pt } | null = null;
  protected command: CommandSpec | null = null;
  protected stageIndex = 0;
  protected stageInputs: Array<Pt | number | string> = [];
  protected points: Pt[] = [];
  protected pendingGroups: Array<{ group_id: string; command: string; base_revision: number; ops: PendingOperation[] }> = [];
  protected offline = false;
  protected socket: WebSocket | null = null;
  protected socketSeq = 0;
  protected presence = new Map<string, { colour: number; x: number; y: number }>();
  protected following: string | null = null;
  protected paneWidth = 800;
  protected paneHeight = 600;
  protected lastCommand: CommandSpec | null = null;
  protected optimisticCounter = 0;
  protected issues: Array<Record<string, unknown>> = [];
  protected versions: Array<Record<string, unknown>> = [];
  protected rfis: Record<string, Record<string, unknown>> = {};
  protected commandInput: HTMLInputElement | null = null;
  protected promptStatus: HTMLElement | null = null;
  protected announcementsStatus: HTMLElement | null = null;
  protected toastStack: HTMLElement | null = null;
  protected connectionStatus: HTMLElement | null = null;
  protected drawingStage: HTMLElement | null = null;
  protected entityLayer: SVGGElement | null = null;
  protected overlayLayer: SVGGElement | null = null;
  protected cursorLayer: SVGGElement | null = null;
  protected zoomText: HTMLElement | null = null;
  protected peopleList: HTMLElement | null = null;
  protected panelBodies = new Map<PanelName, HTMLElement>();
  protected isPhone: boolean;
  protected isTablet: boolean;
  protected panelStripBody: HTMLElement | null = null;
  protected commandCancelled = false;
  protected topRightChip: HTMLElement | null = null;
  protected spaceHeld = false;


  constructor(drawingId: string, api: ClientApi, me: string | null, settings: ScreenSettings, readOnly: boolean) {
    this.drawingId = drawingId;
    this.api = api;
    this.me = me;
    this.settings = settings;
    this.readOnly = readOnly;
    this.isPhone = window.innerWidth < 768;
    this.isTablet = window.innerWidth >= 768 && window.innerWidth < 1280;
    this.root = this.build();
  }

  async load(): Promise<void> {
    const { status, data } = await this.api<Record<string, unknown>>('GET', `/api/drawings/${this.drawingId}`);
    if (status === 401) {
      window.location.href = '/signin';
      return;
    }
    if (status !== 200) {
      this.root.replaceChildren(el('div', { class: 'surface note' }, el('p', { text: 'We couldn\u2019t find that drawing.' })));
      return;
    }
    this.state = drawingFromApi(data);
    this.view = zoomAll(this.state, this.paneWidth, this.paneHeight);
    this.renderAll();
    await Promise.all([this.loadVersions(), this.loadIssues()]);
    this.openSocket();
  }

  private build(): HTMLElement {
    const screen = el('div', { class: 'drawing-screen' });
    const left = el('div', { class: 'left-column' });
    const centre = el('div', { class: 'centre-column' });
    const right = el('div', { class: 'right-column' });
    screen.append(left, centre, right);
    for (const name of PANEL_ORDER) {
      const { node, body } = this.panel(name);
      this.panelBodies.set(name, body);
      if (name === 'Entities' || name === 'Layers') left.append(node);
      else right.append(node);
    }
    const stage = el('div', { class: 'drawing-stage', role: 'region', 'aria-label': 'Drawing', tabindex: '0' });
    this.drawingStage = stage;
    const svg = svgEl('svg', { 'aria-hidden': 'true' });
    this.entityLayer = svgEl('g') as unknown as SVGGElement;
    this.overlayLayer = svgEl('g') as unknown as SVGGElement;
    this.cursorLayer = svgEl('g') as unknown as SVGGElement;
    svg.append(this.entityLayer, this.overlayLayer, this.cursorLayer);
    stage.append(svg);
    stage.append(this.buildTopLeftChip());
    this.topRightChip = this.buildTopRightChip();
    stage.append(this.topRightChip);
    stage.append(this.buildBottomLeftChip());
    stage.append(this.buildBottomRightChip());
    const commandInput = el('input', { type: 'text', 'aria-label': 'Command', autocomplete: 'off' });
    this.commandInput = commandInput as HTMLInputElement;
    this.promptStatus = el('span', { role: 'status', 'aria-live': 'polite', text: READY_PROMPT });
    const aids = el('div', { role: 'group', 'aria-label': 'Drafting aids' });
    for (const [key, label] of [['snap', 'Snap'], ['ortho', 'Ortho'], ['grid', 'Grid'], ['polar', 'Polar']] as Array<[keyof AidsState, string]>) {
      const button = el('button', { text: label, 'aria-pressed': this.aids[key] ? 'true' : 'false', class: 'aid-button', 'data-aid': key });
      button.addEventListener('click', () => this.toggleAid(key));
      aids.append(button);
    }
    const commandBar = el('div', { class: 'command-bar' }, commandInput, this.promptStatus, aids);
    centre.append(stage, commandBar);
    if (this.isTablet) {
      const strip = el('div', { class: 'panel-strip' });
      const tabs = el('div', { role: 'tablist', 'aria-label': 'Panels', class: 'panel-tabs' });
      const body = el('div', { class: 'panel-strip-body' });
      this.panelStripBody = body;
      for (const name of PANEL_ORDER) {
        const tab = el('button', { role: 'tab', text: name, 'aria-selected': name === 'Entities' ? 'true' : 'false', 'data-panel-tab': name });
        tab.addEventListener('click', () => this.selectStripPanel(name));
        tabs.append(tab);
      }
      strip.append(tabs, body);
      screen.append(strip);
    }
    if (this.isPhone) {
      const panelsButton = el('button', { text: 'Panels', 'aria-label': 'Panels' });
      const sheet = el('div', { class: 'panel-sheet', role: 'dialog', 'aria-label': 'Panel', hidden: true });
      const tabs = el('div', { role: 'tablist', class: 'panel-tabs' });
      const body = el('div', { class: 'panel-sheet-body' });
      for (const name of ['Issues', 'Markups', 'Versions'] as const) {
        const tab = el('button', { role: 'tab', text: name, 'aria-selected': name === 'Issues' ? 'true' : 'false', 'data-panel-tab': name });
        tab.addEventListener('click', () => this.selectPhonePanel(body, name));
        tabs.append(tab);
      }
      sheet.append(tabs, body);
      panelsButton.addEventListener('click', () => {
        (sheet as HTMLElement).hidden = false;
        this.selectPhonePanel(body, 'Issues');
      });
      this.topRightChip.append(panelsButton);
      screen.append(sheet);
    }
    this.announcementsStatus = el('span', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });
    this.toastStack = el('div', { class: 'toast-stack', role: 'status', 'aria-live': 'polite' });
    screen.append(this.announcementsStatus, this.toastStack);
    this.bindStage(stage);
    this.bindKeyboard();
    new ResizeObserver(() => {
      const rect = stage.getBoundingClientRect();
      this.paneWidth = rect.width || 1;
      this.paneHeight = rect.height || 1;
      this.renderEntities();
    }).observe(stage);
    const rect = stage.getBoundingClientRect();
    this.paneWidth = rect.width || 1;
    this.paneHeight = rect.height || 1;
    return screen;
  }

  protected panel(name: PanelName): { node: HTMLElement; body: HTMLElement } {
    const body = el('div', { class: 'panel-body' });
    const header = el('button', { class: 'panel-header', text: name, 'aria-expanded': 'true' });
    const node = el('section', { class: 'panel', 'data-open': 'true', 'data-panel': name }, header, body);
    header.addEventListener('click', () => {
      const open = node.dataset.open === 'true';
      node.dataset.open = open ? 'false' : 'true';
      header.setAttribute('aria-expanded', open ? 'false' : 'true');
    });
    return { node, body };
  }

  private selectStripPanel(name: PanelName): void {
    for (const tab of this.root.querySelectorAll('[data-panel-tab]')) {
      tab.setAttribute('aria-selected', tab.getAttribute('data-panel-tab') === name ? 'true' : 'false');
    }
    if (this.panelStripBody) this.panelStripBody.replaceChildren(this.panelBody(name));
  }

  private selectPhonePanel(body: HTMLElement, name: 'Issues' | 'Markups' | 'Versions'): void {
    for (const tab of this.root.querySelectorAll('[data-panel-tab]')) {
      tab.setAttribute('aria-selected', tab.getAttribute('data-panel-tab') === name ? 'true' : 'false');
    }
    body.replaceChildren(this.panelBody(name));
  }

  protected panelBody(name: PanelName): HTMLElement {
    return this.panelBodies.get(name) ?? el('div');
  }

  private buildTopLeftChip(): HTMLElement {
    const chip = el('div', { class: 'chip tl' });
    chip.append(el('span', { class: 'chip-label', 'data-drawing-name': 'true', text: '' }));
    const layouts = el('div', { role: 'tablist', 'aria-label': 'Layouts' });
    layouts.append(el('button', { role: 'tab', text: 'Model', 'aria-selected': 'true' }));
    chip.append(layouts);
    if (!this.readOnly) {
      const newSheet = el('button', { text: 'New sheet' });
      newSheet.addEventListener('click', () => void this.newSheet());
      chip.append(newSheet);
    }
    return chip;
  }

  private buildTopRightChip(): HTMLElement {
    const chip = el('div', { class: 'chip tr' });
    this.peopleList = el('ul', { role: 'list', 'aria-label': 'People here' });
    chip.append(this.peopleList);
    if (!this.readOnly) {
      const publish = el('button', { text: 'Publish sheet' });
      publish.addEventListener('click', () => void this.publishSheet());
      const compare = el('button', { text: 'Compare' });
      compare.addEventListener('click', () => void this.openCompare());
      const exportButton = el('button', { text: 'Export' });
      exportButton.addEventListener('click', () => void this.openExportDialog());
      const importButton = el('button', { text: 'Import' });
      importButton.addEventListener('click', () => this.openImportDialog());
      const underlayButton = el('button', { text: 'Add underlay' });
      underlayButton.addEventListener('click', () => this.openUnderlayDialog());
      chip.append(publish, compare, exportButton, importButton, underlayButton);
    }
    return chip;
  }

  private buildBottomLeftChip(): HTMLElement {
    const chip = el('div', { class: 'chip bl' });
    const offlineSwitch = el('input', { type: 'checkbox', role: 'switch', 'aria-label': 'Work offline' });
    offlineSwitch.addEventListener('change', () => this.setOffline((offlineSwitch as HTMLInputElement).checked));
    this.connectionStatus = el('span', { role: 'status', 'aria-live': 'polite', text: 'Live' });
    chip.append(offlineSwitch, this.connectionStatus);
    return chip;
  }

  private buildBottomRightChip(): HTMLElement {
    this.zoomText = el('span', { class: 'chip-label', text: 'Zoom 1' });
    return el('div', { class: 'chip br' }, this.zoomText);
  }

  protected renderAll(): void {
    this.renderEntities();
    this.renderPanels();
    this.updateDrawingRoot();
    const nameNode = this.root.querySelector('[data-drawing-name]');
    if (nameNode && this.state) nameNode.textContent = this.state.name;
  }

  protected updateDrawingRoot(): void {
    const stage = this.drawingStage;
    if (!stage || !this.state) return;
    stage.dataset.revision = String(this.state.revision);
    stage.dataset.pendingOps = String(this.pendingGroups.length);
    stage.dataset.totalEntities = String(this.state.order.length);
    stage.dataset.zoom = String(this.view.zoom);
    stage.dataset.panX = String(this.view.panX);
    stage.dataset.panY = String(this.view.panY);
    stage.dataset.snapKind = this.snapPoint ? this.snapPoint.kind : 'none';
    stage.dataset.snapX = this.snapPoint ? numberKey(this.snapPoint.point.x) : '0';
    stage.dataset.snapY = this.snapPoint ? numberKey(this.snapPoint.point.y) : '0';
    if (this.zoomText) this.zoomText.textContent = `Zoom ${trimZeros(this.view.zoom.toFixed(2))}`;
  }

  protected renderEntities(): void {
    if (!this.state || !this.entityLayer) return;
    const visible = new Set(visibleEntities(this.state));
    const domHandles = entityHandlesForDom(this.state, this.view, this.paneWidth, this.paneHeight, this.settings.domMarginPx, this.settings.domCeiling, this.selection);
    const keep = new Set(domHandles);
    for (const child of [...this.entityLayer.children]) {
      const handle = (child as SVGElement).getAttribute?.('data-entity-id') ?? '';
      if (handle && !keep.has(handle)) child.remove();
    }
    for (const handle of domHandles) {
      if (!visible.has(handle)) continue;
      const entity = this.state.entities[handle];
      if (!entity) continue;
      const node = entityMarkup(entity, this.state, this.view, this.selection.has(handle));
      const existing = this.entityLayer.querySelector(`[data-entity-id="${cssEscape(handle)}"]`);
      if (existing) (existing as SVGElement).replaceWith(node);
      else this.entityLayer.append(node);
    }
    this.renderGrips();
    this.updateDrawingRoot();
  }

  private renderGrips(): void {
    if (!this.overlayLayer || !this.state) return;
    for (const child of [...this.overlayLayer.querySelectorAll('[data-grip]')]) child.remove();
    if (this.isPhone || this.readOnly) return;
    for (const handle of this.selection) {
      const entity = this.state.entities[handle];
      if (!entity) continue;
      for (const grip of gripPoints(entity)) {
        const screen = toScreen(this.view, grip.point);
        const node = svgEl('rect', {
          'data-grip': grip.kind,
          'data-handle': handle,
          'data-index': String(grip.index),
          x: String(screen.x - 3),
          y: String(screen.y - 3),
          width: '6',
          height: '6',
          fill: '#ece7db',
        });
        node.addEventListener('pointerdown', (event) => this.beginGripDrag(event as PointerEvent, handle, grip.kind, grip.index));
        this.overlayLayer.append(node);
      }
    }
  }

  private beginGripDrag(event: PointerEvent, handle: string, kind: string, index: number): void {
    if (!this.state || this.readOnly) return;
    event.preventDefault();
    event.stopPropagation();
    const stage = this.drawingStage;
    if (!stage) return;
    const start = structuredClone(this.state.entities[handle]);
    if (!start) return;
    const move = (moveEvent: PointerEvent) => {
      const world = this.pointerWorld(moveEvent);
      if (this.state) this.state.entities[handle] = gripResult(start, kind, index, world);
      this.renderEntities();
    };
    const up = (upEvent: PointerEvent) => {
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerup', up);
      const world = this.pointerWorld(upEvent);
      const next = gripResult(start, kind, index, world);
      if (this.state) this.state.entities[handle] = start;
      const set = fieldChanges(start, next);
      if (set) void this.sendGroup('GRIP', [{ op_id: this.newOpId(), type: 'modify', handle, set }]);
      else this.renderEntities();
    };
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
  }

  protected pointerWorld(event: PointerEvent): Pt {
    const rect = this.drawingStage?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return toWorld(this.view, { x: event.clientX - rect.left, y: event.clientY - rect.top });
  }

  protected pointerScreen(event: { clientX: number; clientY: number }): Pt {
    const rect = this.drawingStage?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  // -----------------------------------------------------------------
  // Pointer, wheel and touch
  // -----------------------------------------------------------------

  private bindStage(stage: HTMLElement): void {
    stage.addEventListener('pointermove', (event) => {
      const world = this.pointerWorld(event);
      this.resolveSnap(world);
      this.sendPresence(world);
    });
    stage.addEventListener('pointerdown', (event) => {
      if (this.isPhone) {
        this.handleTouch(event);
        return;
      }
      if (event.button === 1 || (event.button === 0 && this.spaceHeld)) {
        this.beginPan(event);
        return;
      }
      if (event.button === 0) {
        const world = this.pointerWorld(event);
        const resolved = this.resolveSnap(world);
        this.handleClick(resolved, event.shiftKey);
      }
    });
    stage.addEventListener('wheel', (event) => {
      event.preventDefault();
      const screen = this.pointerScreen(event);
      const factor = event.deltaY < 0 ? 1.2 : 1 / 1.2;
      const before = toWorld(this.view, screen);
      this.view.zoom = clamp(Number((this.view.zoom * factor).toFixed(4)), 0.05, 50);
      const after = toScreen(this.view, before);
      this.view.panX = Number((this.view.panX + screen.x - after.x).toFixed(4));
      this.view.panY = Number((this.view.panY + screen.y - after.y).toFixed(4));
      this.stopFollowing();
      this.renderEntities();
    });
    stage.addEventListener('keydown', (event) => {
      if ((event.target as HTMLElement).tagName === 'INPUT') return;
      if (this.selection.size && event.key.startsWith('Arrow')) {
        event.preventDefault();
        const distance = event.shiftKey ? 10 : 1;
        const dx = event.key === 'ArrowLeft' ? -distance : event.key === 'ArrowRight' ? distance : 0;
        const dy = event.key === 'ArrowUp' ? distance : event.key === 'ArrowDown' ? -distance : 0;
        void this.sendGroup('NUDGE', [{ op_id: this.newOpId(), type: 'move', handles: [...this.selection], dx, dy }]);
        return;
      }
      if (this.selection.size && event.key === 'Delete') {
        event.preventDefault();
        const handles = [...this.selection];
        this.selection.clear();
        void this.sendGroup('ERASE', [{ op_id: this.newOpId(), type: 'delete', handles }]);
      }
    });
  }

  private beginPan(event: PointerEvent): void {
    const stage = this.drawingStage;
    if (!stage) return;
    let last = { x: event.clientX, y: event.clientY };
    const move = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - last.x;
      const dy = moveEvent.clientY - last.y;
      last = { x: moveEvent.clientX, y: moveEvent.clientY };
      this.view.panX = Number((this.view.panX + dx).toFixed(4));
      this.view.panY = Number((this.view.panY + dy).toFixed(4));
      this.stopFollowing();
      this.renderEntities();
    };
    const up = () => {
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerup', up);
    };
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
  }

  protected handleTouch(event: PointerEvent): void {
    const stage = this.drawingStage;
    if (!stage) return;
    const start = this.pointerScreen(event);
    const startTime = Date.now();
    let moved = 0;
    let timer = window.setTimeout(() => {
      timer = 0;
      this.openSheetMenu(start);
    }, 500);
    const move = (moveEvent: PointerEvent) => {
      const screen = this.pointerScreen(moveEvent);
      moved = Math.max(moved, Math.hypot(screen.x - start.x, screen.y - start.y));
      if (moved >= 8 && timer) {
        window.clearTimeout(timer);
        timer = 0;
      }
    };
    const up = () => {
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerup', up);
      if (timer) {
        window.clearTimeout(timer);
        timer = 0;
      }
      if (moved < 8 && Date.now() - startTime < 500) {
        this.openNewIssueDialog(start);
      }
    };
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
  }

  protected openSheetMenu(screen: Pt): void {
    const menu = el('div', { role: 'menu', 'aria-label': 'Sheet actions', class: 'surface', style: `position:absolute;left:${screen.x}px;top:${screen.y}px;z-index:20` });
    const pin = el('button', { role: 'menuitem', text: 'Pin issue here' });
    pin.addEventListener('click', () => { menu.remove(); this.openNewIssueDialog(screen); });
    const measure = el('button', { role: 'menuitem', text: 'Measure from here' });
    measure.addEventListener('click', () => { menu.remove(); this.startMeasure(screen); });
    const versions = el('button', { role: 'menuitem', text: 'Show versions' });
    versions.addEventListener('click', () => {
      menu.remove();
      const sheet = this.root.querySelector('.panel-sheet');
      if (sheet) (sheet as HTMLElement).hidden = false;
    });
    menu.append(pin, measure, versions);
    this.root.append(menu);
    const dismiss = (event: Event) => {
      if (!menu.contains(event.target as Node)) {
        menu.remove();
        document.removeEventListener('pointerdown', dismiss);
      }
    };
    document.addEventListener('pointerdown', dismiss);
  }

  protected startMeasure(screen: Pt): void {
    const from = toWorld(this.view, screen);
    const stage = this.drawingStage;
    if (!stage) return;
    const click = (event: PointerEvent) => {
      const to = toWorld(this.view, this.pointerScreen(event));
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      const angle = normaliseAngle((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI);
      this.setPrompt(`DIST: ${trimZeros(distance.toFixed(3))} units, angle ${trimZeros(angle.toFixed(2))} degrees`);
      stage.removeEventListener('pointerdown', click);
    };
    stage.addEventListener('pointerdown', click);
  }

  protected openNewIssueDialog(screen: Pt): void {
    const world = toWorld(this.view, screen);
    const title = el('input', { type: 'text', 'aria-label': 'Issue title' });
    const dialog = el('dialog', { 'aria-label': 'New issue' });
    const form = el('form', {}, el('label', { text: 'Issue title' }, title));
    form.append(el('button', { type: 'submit', text: 'Pin issue', class: 'primary' }));
    dialog.append(form);
    this.root.append(dialog);
    (dialog as HTMLDialogElement).showModal();
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const version = this.versions[this.versions.length - 1];
      if (!version) {
        this.toast('Publish a version first.');
        return;
      }
      const { status, data } = await this.api<{ id?: string }>('POST', `/api/versions/${String(version.id)}/issues`, {
        title: (title as HTMLInputElement).value,
        x: round6(world.x),
        y: round6(world.y),
      });
      if (status === 201) {
        const pin = el('div', {
          'data-issue-pin': String((data as { id?: string }).id ?? ''),
          'data-x': String(round6(world.x)),
          'data-y': String(round6(world.y)),
          style: `position:absolute;left:${screen.x}px;top:${screen.y}px;width:10px;height:10px;background:#9fb98a;border:1px solid #ece7db;z-index:6`,
        });
        this.drawingStage?.append(pin);
        this.animatePin(pin);
        (dialog as HTMLDialogElement).close();
        dialog.remove();
        void this.loadIssues();
      }
    });
  }

  protected animatePin(node: HTMLElement): void {
    if (reducedMotion()) return;
    node.animate([{ transform: 'scale(0.8)' }, { transform: 'scale(1)' }], { id: 'sheet-pin', duration: 200, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' });
  }

  // -----------------------------------------------------------------
  // Snaps and drafting aids
  // -----------------------------------------------------------------

  protected resolveSnap(world: Pt): Pt {
    if (!this.state) return world;
    const snapped = this.aids.snap ? this.findSnap(world) : null;
    this.snapPoint = snapped ? { kind: snapped.kind, point: snapped.point } : null;
    let point = snapped ? snapped.point : world;
    if (!snapped) point = this.applyAids(point);
    this.updateDrawingRoot();
    return point;
  }

  private applyAids(world: Pt): Pt {
    let point = world;
    const dx = point.x - this.lastPoint.x;
    const dy = point.y - this.lastPoint.y;
    if (this.aids.ortho) {
      point = Math.abs(dx) >= Math.abs(dy) ? { x: point.x, y: this.lastPoint.y } : { x: this.lastPoint.x, y: point.y };
    } else if (this.aids.polar) {
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      const distance = Math.hypot(dx, dy);
      const snapped = nearestMultipleOf45(angle);
      if (snapped !== null) {
        const radians = (snapped * Math.PI) / 180;
        point = { x: round6(this.lastPoint.x + distance * Math.cos(radians)), y: round6(this.lastPoint.y + distance * Math.sin(radians)) };
      }
    }
    if (this.aids.grid) point = this.applyGrid(point);
    return point;
  }

  private applyGrid(point: Pt): Pt {
    const dx = point.x - this.lastPoint.x;
    const dy = point.y - this.lastPoint.y;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const polarAngle = this.aids.polar ? nearestMultipleOf45(angle) : null;
    if (this.aids.ortho || (polarAngle !== null && polarAngle % 90 === 0)) {
      return Math.abs(dx) >= Math.abs(dy)
        ? { x: round6(Math.round(point.x)), y: this.lastPoint.y }
        : { x: this.lastPoint.x, y: round6(Math.round(point.y)) };
    }
    if (this.aids.polar && polarAngle !== null && polarAngle % 90 !== 0) {
      const distance = Math.round(Math.hypot(dx, dy));
      const radians = (polarAngle * Math.PI) / 180;
      return { x: round6(this.lastPoint.x + distance * Math.cos(radians)), y: round6(this.lastPoint.y + distance * Math.sin(radians)) };
    }
    return { x: round6(Math.round(point.x)), y: round6(Math.round(point.y)) };
  }

  private findSnap(world: Pt): { kind: string; point: Pt } | null {
    if (!this.state) return null;
    const aperture = 10 / this.view.zoom;
    const priority = ['endpoint', 'midpoint', 'centre', 'intersection', 'perpendicular', 'tangent', 'nearest'];
    const candidates: Array<{ kind: string; point: Pt; screenDistance: number; handle: string }> = [];
    for (const handle of this.state.order) {
      const entity = this.state.entities[handle];
      if (!entity) continue;
      const layer = this.state.layers[entity.layer];
      if (!layer || !layer.on || layer.frozen) continue;
      for (const candidate of snapCandidates(entity, handle)) {
        const screenDistance = Math.hypot(candidate.point.x - world.x, candidate.point.y - world.y) * this.view.zoom;
        if (screenDistance <= 10) candidates.push({ ...candidate, screenDistance, handle });
      }
    }
    const perpendicular = perpendicularFoot(this.state, world, this.lastPoint, aperture);
    if (perpendicular) candidates.push({ kind: 'perpendicular', point: perpendicular, screenDistance: Math.hypot(perpendicular.x - world.x, perpendicular.y - world.y) * this.view.zoom, handle: '' });
    const tangent = tangentPoint(this.state, world, this.lastPoint, aperture);
    if (tangent) candidates.push({ kind: 'tangent', point: tangent, screenDistance: Math.hypot(tangent.x - world.x, tangent.y - world.y) * this.view.zoom, handle: '' });
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      const kindA = priority.indexOf(a.kind);
      const kindB = priority.indexOf(b.kind);
      if (kindA !== kindB) return kindA - kindB;
      if (Math.abs(a.screenDistance - b.screenDistance) > 1e-9) return a.screenDistance - b.screenDistance;
      return handleOrder(a.handle) - handleOrder(b.handle);
    });
    return { kind: candidates[0].kind, point: candidates[0].point };
  }

  protected toggleAid(key: keyof AidsState): void {
    if (key === 'ortho' && !this.aids.ortho) this.aids.polar = false;
    if (key === 'polar' && !this.aids.polar) this.aids.ortho = false;
    this.aids[key] = !this.aids[key];
    const names: Record<keyof AidsState, string> = { snap: 'Snap', ortho: 'Ortho', grid: 'Grid', polar: 'Polar' };
    this.announce(`${names[key]} ${this.aids[key] ? 'on' : 'off'}`);
    for (const button of this.root.querySelectorAll('[data-aid]')) {
      const aid = (button as HTMLElement).dataset.aid as keyof AidsState;
      button.setAttribute('aria-pressed', this.aids[aid] ? 'true' : 'false');
    }
  }

  // -----------------------------------------------------------------
  // Clicks, selection and windows
  // -----------------------------------------------------------------

  protected handleClick(world: Pt, shift: boolean): void {
    if (!this.state || this.readOnly) return;
    if (this.command) {
      this.advanceCommand(world);
      return;
    }
    const handle = entityAtPoint(this.state, world, 10, this.view);
    if (handle) {
      if (shift) this.selection.delete(handle);
      else this.selection.add(handle);
      this.renderEntities();
      this.renderPanels();
      return;
    }
    if (shift) return;
    this.beginWindow(world);
  }

  private beginWindow(startWorld: Pt): void {
    const stage = this.drawingStage;
    if (!stage) return;
    let current = startWorld;
    let active = false;
    const overlay = svgEl('rect', { fill: 'none', stroke: '#ece7db', 'stroke-dasharray': '4 4' });
    this.overlayLayer?.append(overlay);
    const move = (event: PointerEvent) => {
      current = this.pointerWorld(event);
      active = true;
      const a = toScreen(this.view, { x: Math.min(startWorld.x, current.x), y: Math.min(startWorld.y, current.y) });
      const b = toScreen(this.view, { x: Math.max(startWorld.x, current.x), y: Math.max(startWorld.y, current.y) });
      overlay.setAttribute('x', String(a.x));
      overlay.setAttribute('y', String(a.y));
      overlay.setAttribute('width', String(Math.max(0, b.x - a.x)));
      overlay.setAttribute('height', String(Math.max(0, b.y - a.y)));
      overlay.setAttribute('data-window', startWorld.x <= current.x ? 'window' : 'crossing');
    };
    const up = () => {
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerup', up);
      overlay.remove();
      if (!active || !this.state) return;
      const crossing = startWorld.x > current.x;
      const minX = Math.min(startWorld.x, current.x);
      const maxX = Math.max(startWorld.x, current.x);
      const minY = Math.min(startWorld.y, current.y);
      const maxY = Math.max(startWorld.y, current.y);
      for (const handle of this.state.order) {
        const entity = this.state.entities[handle];
        if (!entity) continue;
        const layer = this.state.layers[entity.layer];
        if (!layer || layer.locked || layer.frozen || !layer.on) continue;
        const box = entityBounds(entity);
        const inside = crossing
          ? box.minX <= maxX && box.maxX >= minX && box.minY <= maxY && box.maxY >= minY
          : box.minX >= minX && box.maxX <= maxX && box.minY >= minY && box.maxY <= maxY;
        if (inside) this.selection.add(handle);
      }
      this.renderEntities();
      this.renderPanels();
    };
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
  }

  // -----------------------------------------------------------------
  // Keyboard map and command line
  // -----------------------------------------------------------------

  private bindKeyboard(): void {
    const input = this.commandInput;
    if (!input) return;
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const text = input.value;
        input.value = '';
        this.submitCommand(text);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.cancelCommand();
        return;
      }
      const stage = this.currentStage();
      if (event.key === ' ' && stage && !stageTakesSpace(stage)) {
        event.preventDefault();
        const text = input.value;
        input.value = '';
        this.submitCommand(text);
      }
    });
    document.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement;
      const inField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
      if (event.key === ' ') this.spaceHeld = true;
      if (event.key === 'F3') { event.preventDefault(); this.toggleAid('snap'); return; }
      if (event.key === 'F8') { event.preventDefault(); this.toggleAid('ortho'); return; }
      if (event.key === 'F9') { event.preventDefault(); this.toggleAid('grid'); return; }
      if (event.key === 'F10') { event.preventDefault(); this.toggleAid('polar'); return; }
      if (event.key === 'F6') { event.preventDefault(); this.cycleFocus(event.shiftKey); return; }
      if (inField) {
        if (event.key === 'Escape' && target !== input) {
          event.preventDefault();
          input.focus();
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        void this.undo(event.shiftKey);
        return;
      }
      if (event.key === 'Delete' && this.selection.size) {
        event.preventDefault();
        const handles = [...this.selection];
        this.selection.clear();
        void this.sendGroup('ERASE', [{ op_id: this.newOpId(), type: 'delete', handles }]);
        return;
      }
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (this.isPhone) {
          this.setPrompt('Drawing commands aren\u2019t available on a phone. Open this drawing on a desktop to edit.');
          return;
        }
        input.focus();
      }
    });
    document.addEventListener('keyup', (event) => {
      if (event.key === ' ') this.spaceHeld = false;
    });
  }

  protected currentStage(): string | null {
    if (!this.command) return null;
    const stages = this.command.stages;
    const base = stages[Math.min(this.stageIndex, stages.length - 1)] ?? null;
    if (!base) return null;
    if (this.command.name === 'ARRAY' && this.stageIndex >= 2) {
      if (String(this.stageInputs[1] ?? '').toUpperCase() === 'R') {
        return ['ARRAY: rows', 'ARRAY: columns', 'ARRAY: row gap', 'ARRAY: column gap'][this.stageIndex - 2] ?? base;
      }
      return ['ARRAY: centre', 'ARRAY: count', 'ARRAY: total angle'][this.stageIndex - 2] ?? base;
    }
    return base;
  }

  protected setPrompt(text: string): void {
    if (this.promptStatus) this.promptStatus.textContent = text;
  }

  protected announce(text: string): void {
    if (this.announcementsStatus) this.announcementsStatus.textContent = text;
  }

  protected toast(text: string): void {
    if (!this.toastStack) return;
    const node = el('div', { class: 'toast', text });
    this.toastStack.append(node);
    if (!reducedMotion()) {
      node.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'translateY(0)' }], { id: 'toast-enter', duration: 120, easing: 'ease-out', fill: 'forwards' });
    }
    window.setTimeout(() => node.remove(), this.settings.toastMs);
  }

  private cycleFocus(backwards: boolean): void {
    const stops: HTMLElement[] = [];
    if (this.commandInput) stops.push(this.commandInput);
    if (this.drawingStage) stops.push(this.drawingStage);
    if (!this.isPhone) {
      for (const name of PANEL_ORDER) {
        const body = this.panelBodies.get(name);
        const panelNode = body?.parentElement;
        if (panelNode && panelNode.dataset.open === 'true') stops.push(panelNode);
      }
    } else {
      const sheet = this.root.querySelector('.panel-sheet');
      if (sheet && !(sheet as HTMLElement).hidden) stops.push(sheet as HTMLElement);
    }
    if (!stops.length) return;
    const active = document.activeElement as HTMLElement | null;
    const index = active ? stops.indexOf(active) : -1;
    const next = backwards ? (index - 1 + stops.length) % stops.length : (index + 1) % stops.length;
    stops[next].focus();
  }

  protected submitCommand(text: string): void {
    if (this.readOnly) {
      this.setPrompt('You can view this drawing but not edit it.');
      return;
    }
    if (this.commandCancelled) {
      this.commandCancelled = false;
      if (text.trim() === '') {
        this.setPrompt(READY_PROMPT);
        return;
      }
    }
    if (!this.command) {
      if (text.trim() === '') {
        if (this.lastCommand) {
          this.command = this.lastCommand;
          this.stageIndex = 0;
          this.stageInputs = [];
          this.points = [];
          this.setPrompt(this.currentStage() ?? READY_PROMPT);
        }
        return;
      }
      if (text.trim().toUpperCase() === 'U') {
        void this.undo(false);
        return;
      }
      const spec = resolveCommand(text);
      if (!spec) {
        this.setPrompt(unknownCommandText(text));
        return;
      }
      this.lastCommand = spec;
      this.command = spec;
      this.stageIndex = 0;
      this.stageInputs = [];
      this.points = [];
      if (spec.name === 'ZOOMALL') {
        this.runZoomAll();
        this.command = null;
        this.setPrompt(READY_PROMPT);
        return;
      }
      if (spec.name === 'PURGE') {
        void this.sendGroup('PURGE', [{ op_id: this.newOpId(), type: 'purge' }]);
        this.command = null;
        this.setPrompt('Purged 0 blocks, 0 layers.');
        return;
      }
      if (spec.name === 'LAYER') {
        this.command = null;
        this.focusPanel('Layers');
        return;
      }
      if (spec.name === 'FIND') {
        this.command = null;
        this.openFind();
        return;
      }
      this.setPrompt(this.currentStage() ?? READY_PROMPT);
      return;
    }
    this.enterStage(text);
  }

  protected focusPanel(name: PanelName): void {
    const body = this.panelBodies.get(name);
    const header = body?.parentElement?.querySelector('.panel-header');
    if (header instanceof HTMLElement) header.focus();
  }

  private cancelCommand(): void {
    this.command = null;
    this.stageIndex = 0;
    this.stageInputs = [];
    this.points = [];
    this.commandCancelled = true;
    this.setPrompt(CANCELLED_PROMPT);
    this.commandInput?.focus();
  }

  protected advanceCommand(world: Pt): void {
    const stage = this.currentStage();
    if (!stage) return;
    if (this.command?.name === 'LINE' && this.stageIndex >= 1) {
      this.points.push(world);
      this.lastPoint = world;
      if (this.points.length >= 2) {
        const from = this.points[this.points.length - 2];
        void this.sendGroup('LINE', [{ op_id: this.newOpId(), type: 'add', entity: { type: 'line', layer: this.currentLayerName(), x1: from.x, y1: from.y, x2: world.x, y2: world.y } }]);
      }
      this.setPrompt(this.currentStage() ?? READY_PROMPT);
      return;
    }
    this.enterStagePoint(world);
  }

  private enterStagePoint(world: Pt): void {
    if (!this.command) return;
    this.stageInputs.push(world);
    this.lastPoint = world;
    this.stageIndex += 1;
    this.setPrompt(this.currentStage() ?? READY_PROMPT);
    if (this.stageIndex >= this.command.stages.length) this.finishCommand();
  }

  protected enterStage(text: string): void {
    if (!this.command) return;
    const stage = this.currentStage();
    if (!stage) return;
    if (text.trim() === '') {
      if (this.pickEndsStage()) return;
      this.stageIndex += 1;
      this.setPrompt(this.currentStage() ?? READY_PROMPT);
      if (this.stageIndex >= this.command.stages.length) this.finishCommand();
      return;
    }
    if (text.trim().toUpperCase() === 'U' && this.stageIndex > 0) {
      this.stepBack();
      return;
    }
    if (this.command.name === 'LINE' && this.stageIndex >= 1) {
      const point = parsePoint(text, this.lastPoint);
      if (!point) {
        this.setPrompt(REFUSALS.notPoint);
        return;
      }
      this.points.push(point);
      this.lastPoint = point;
      if (this.points.length >= 2) {
        const from = this.points[this.points.length - 2];
        void this.sendGroup('LINE', [{ op_id: this.newOpId(), type: 'add', entity: { type: 'line', layer: this.currentLayerName(), x1: from.x, y1: from.y, x2: point.x, y2: point.y } }]);
      }
      this.setPrompt(this.currentStage() ?? READY_PROMPT);
      return;
    }
    if (stage.includes('point') || stage.includes('corner') || stage.includes('centre') || stage.includes('position') || stage.includes('side') || stage.includes('inside') || stage.includes('line')) {
      const point = parsePoint(text, this.lastPoint);
      if (!point) {
        this.setPrompt(REFUSALS.notPoint);
        return;
      }
      this.stageInputs.push(point);
      this.lastPoint = point;
      this.stageIndex += 1;
      this.setPrompt(this.currentStage() ?? READY_PROMPT);
      if (this.stageIndex >= this.command.stages.length) this.finishCommand();
      return;
    }
    const value = parseNumber(text);
    if (value === null) {
      this.setPrompt(REFUSALS.notNumber);
      return;
    }
    if (value <= 0 && stageRequiresPositive(stage)) {
      this.setPrompt(REFUSALS.notPositive);
      return;
    }
    this.stageInputs.push(value);
    this.stageIndex += 1;
    this.setPrompt(this.currentStage() ?? READY_PROMPT);
    if (this.stageIndex >= this.command.stages.length) this.finishCommand();
  }

  private pickEndsStage(): boolean {
    const stage = this.currentStage();
    if (!stage) return false;
    if (stage.includes('pick entities') || stage.includes('pick block inserts') || stage.includes('picking')) {
      this.stageIndex += 1;
      this.setPrompt(this.currentStage() ?? READY_PROMPT);
      return true;
    }
    return false;
  }

  private stepBack(): void {
    if (this.points.length) {
      this.points.pop();
      const previous = this.points[this.points.length - 1];
      if (previous) this.lastPoint = previous;
      this.setPrompt(this.currentStage() ?? READY_PROMPT);
      return;
    }
    if (this.stageIndex > 0) {
      this.stageIndex -= 1;
      this.stageInputs.pop();
      this.setPrompt(this.currentStage() ?? READY_PROMPT);
    }
  }

  private finishCommand(): void {
    this.setPrompt(READY_PROMPT);
    this.command = null;
    this.stageIndex = 0;
    this.stageInputs = [];
    this.points = [];
    this.commandInput?.focus();
  }

  protected currentLayerName(): string {
    return this.state?.currentLayer ?? '0';
  }

  private runZoomAll(): void {
    if (!this.state) return;
    const before = { ...this.view };
    this.view = zoomAll(this.state, this.paneWidth, this.paneHeight);
    this.updateDrawingRoot();
    if (!reducedMotion() && this.entityLayer?.parentElement) {
      this.entityLayer.parentElement.animate(
        [
          { transform: `translate(${before.panX}px, ${before.panY}px) scale(${before.zoom})` },
          { transform: `translate(${this.view.panX}px, ${this.view.panY}px) scale(${this.view.zoom})` },
        ],
        { id: 'zoom-all', duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' },
      );
    }
    this.renderEntities();
  }

  // -----------------------------------------------------------------
  // Operations, offline queue, undo
  // -----------------------------------------------------------------

  protected newOpId(): string {
    this.optimisticCounter += 1;
    return `op_${Date.now().toString(36)}_${this.optimisticCounter}_${Math.random().toString(36).slice(2, 8)}`;
  }

  protected async sendGroup(command: string, ops: PendingOperation[]): Promise<void> {
    if (!this.state) return;
    const group = {
      group_id: `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      command,
      base_revision: this.state.revision,
      ops,
    };
    if (this.offline) {
      this.pendingGroups.push(group);
      for (const op of ops) applyOpToState(this.state, op as Record<string, unknown>);
      this.updateConnection();
      this.renderEntities();
      this.renderPanels();
      return;
    }
    const { status, data } = await this.api<{ revision?: number; results?: Array<{ status: string; message: string | null }> }>('POST', `/api/drawings/${this.drawingId}/ops`, group);
    if (status === 200) {
      for (const result of (data as { results?: Array<{ message: string | null }> }).results ?? []) {
        if (result.message) this.toast(result.message);
      }
      const revision = (data as { revision?: number }).revision;
      if (typeof revision === 'number') this.state.revision = revision;
    } else {
      const message = (data as { message?: string }).message;
      if (message) this.toast(message);
    }
    await this.refresh();
  }

  protected async refresh(): Promise<void> {
    const { status, data } = await this.api<Record<string, unknown>>('GET', `/api/drawings/${this.drawingId}`);
    if (status === 200 && this.state) {
      this.state = drawingFromApi(data);
      this.renderEntities();
      this.renderPanels();
    }
  }

  private async undo(redo: boolean): Promise<void> {
    const { status, data } = await this.api<{ command?: string; message?: string }>('POST', `/api/drawings/${this.drawingId}/${redo ? 'redo' : 'undo'}`, {});
    if (status === 409) {
      const message = (data as { message?: string }).message;
      if (message) {
        this.setPrompt(message);
        this.toast(message);
      }
      this.commandInput?.focus();
      return;
    }
    if (status === 200) {
      const command = (data as { command?: string }).command ?? '';
      this.setPrompt(`${redo ? 'Redo' : 'Undo'}: ${command}`);
      this.announce(`${redo ? 'Redo' : 'Undo'}: ${command}`);
      await this.refresh();
    }
    this.commandInput?.focus();
  }

  private setOffline(off: boolean): void {
    this.offline = off;
    if (off) {
      this.socket?.close();
      this.socket = null;
    } else {
      void this.sendQueue();
      this.openSocket();
    }
    this.updateConnection();
  }

  private updateConnection(): void {
    if (!this.connectionStatus) return;
    if (this.offline) {
      const count = this.pendingGroups.length;
      this.connectionStatus.textContent = count
        ? `You're working offline. ${count} ${count === 1 ? 'change' : 'changes'} waiting.`
        : "You're working offline. 0 changes waiting.";
      return;
    }
    this.connectionStatus.textContent = this.socket && this.socket.readyState === 1 ? 'Live' : 'Reconnecting\u2026';
  }

  private async sendQueue(): Promise<void> {
    if (!this.pendingGroups.length) return;
    const groups = [...this.pendingGroups];
    let conflicts = 0;
    let sent = 0;
    for (const group of groups) {
      const { status, data } = await this.api<{ results?: Array<{ status: string }> }>('POST', `/api/drawings/${this.drawingId}/ops`, group);
      if (status === 200) {
        sent += 1;
        const results = (data as { results?: Array<{ status: string }> }).results ?? [];
        if (results.some((result) => result.status !== 'applied')) conflicts += 1;
        this.pendingGroups = this.pendingGroups.filter((pending) => pending.group_id !== group.group_id);
      }
    }
    await this.refresh();
    if (this.connectionStatus) {
      this.connectionStatus.textContent = `Back online: ${sent} ${sent === 1 ? 'change' : 'changes'} sent, ${conflicts} ${conflicts === 1 ? 'conflict' : 'conflicts'}.`;
    }
    window.setTimeout(() => this.updateConnection(), this.settings.toastMs);
  }

  // -----------------------------------------------------------------
  // Live channel and presence
  // -----------------------------------------------------------------

  protected openSocket(): void {
    if (this.offline) return;
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${window.location.host}/api/drawings/${this.drawingId}/live`);
    this.socket = socket;
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'hello', since: this.socketSeq }));
      this.updateConnection();
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data) as { seq?: number; type: string; data: Record<string, unknown> };
      if (typeof message.seq === 'number' && message.seq > this.socketSeq) this.socketSeq = message.seq;
      this.applyLiveMessage(message.type, message.data);
    });
    socket.addEventListener('close', () => {
      this.updateConnection();
      if (!this.offline && this.socket === socket) window.setTimeout(() => this.openSocket(), 500);
    });
  }

  protected sendPresence(world: Pt): void {
    if (!this.socket || this.socket.readyState !== 1) return;
    this.socket.send(JSON.stringify({ type: 'view', x: world.x, y: world.y, zoom: this.view.zoom, pan_x: this.view.panX, pan_y: this.view.panY }));
  }

  private applyLiveMessage(type: string, data: Record<string, unknown>): void {
    switch (type) {
      case 'ops':
        void this.refreshAfterOps(data);
        break;
      case 'presence':
        this.applyPresence(data);
        break;
      case 'notice':
        this.toast(String(data.message ?? ''));
        break;
      case 'version':
      case 'xref_version':
      case 'review':
        void this.loadVersions();
        break;
      case 'markup':
      case 'issue':
      case 'rfi':
        void this.loadIssues();
        void this.loadVersions();
        break;
      case 'role':
        this.applyRoleChange(data);
        break;
      case 'link':
      case 'export':
        break;
    }
  }

  private async refreshAfterOps(data: Record<string, unknown>): Promise<void> {
    const author = String(data.author ?? '');
    const command = String(data.command ?? '');
    const results = (data.results ?? []) as Array<{ status: string; handles: string[] }>;
    const handles = results.flatMap((result) => result.handles ?? []);
    if (author && author !== this.me) {
      if (handles.length === 1 && (command.startsWith('Undo') || command.startsWith('Redo'))) {
        this.announce(`${author} changed 1 entity`);
      } else if (handles.length === 1) {
        this.announce(`${author} moved ${handles[0]}`);
      } else if (handles.length > 1) {
        this.announce(`${author} changed ${handles.length} entities`);
      }
    }
    await this.refresh();
  }

  private applyPresence(data: Record<string, unknown>): void {
    const usernames = (data.usernames ?? []) as string[];
    const cursor = data.cursor as { username: string; x: number; y: number } | undefined;
    const view = data.view as { username: string; zoom: number; pan_x: number; pan_y: number } | undefined;
    const ordered = [...new Set(usernames)].sort();
    const taken = new Set<number>();
    for (const name of ordered) {
      let index = 1;
      while (taken.has(index)) index += 1;
      taken.add(index);
      const existing = this.presence.get(name);
      this.presence.set(name, { colour: index, x: existing?.x ?? 0, y: existing?.y ?? 0 });
    }
    for (const name of [...this.presence.keys()]) {
      if (!ordered.includes(name)) this.presence.delete(name);
    }
    if (cursor) {
      const entry = this.presence.get(cursor.username);
      if (entry) {
        entry.x = cursor.x;
        entry.y = cursor.y;
      }
    }
    if (view && this.following === view.username) {
      this.view.zoom = view.zoom;
      this.view.panX = view.pan_x;
      this.view.panY = view.pan_y;
    }
    this.renderPeople();
    this.renderCursors();
  }

  private renderPeople(): void {
    if (!this.peopleList) return;
    this.peopleList.replaceChildren();
    for (const [name, entry] of this.presence) {
      const item = el('li', {}, el('span', { text: name, style: `color:${PRESENCE_COLOURS[entry.colour]}` }));
      const follow = el('button', { text: `Follow ${name}` });
      follow.addEventListener('click', () => {
        this.following = name;
      });
      item.append(follow);
      this.peopleList.append(item);
    }
  }

  private renderCursors(): void {
    if (!this.cursorLayer) return;
    this.cursorLayer.replaceChildren();
    for (const [name, entry] of this.presence) {
      const screen = toScreen(this.view, { x: entry.x, y: entry.y });
      const colour = PRESENCE_COLOURS[entry.colour];
      const cross = svgEl('path', { d: `M ${screen.x - 8} ${screen.y} L ${screen.x + 8} ${screen.y} M ${screen.x} ${screen.y - 8} L ${screen.x} ${screen.y + 8}`, stroke: colour, 'stroke-width': '1', fill: 'none', class: 'remote-crosshair', 'data-username': name, 'data-colour': String(entry.colour), 'data-x': String(entry.x), 'data-y': String(entry.y) });
      const label = svgEl('text', { x: String(screen.x + 10), y: String(screen.y + 4), class: 'remote-cursor-label', 'data-username': name });
      label.textContent = name;
      this.cursorLayer.append(cross, label);
    }
  }

  private applyRoleChange(data: Record<string, unknown>): void {
    const username = String(data.username ?? '');
    if (username === this.me) {
      const role = data.role as string | null;
      if (role === null) {
        this.root.replaceChildren(el('div', { class: 'surface note' }, el('p', { text: 'You no longer have access to this drawing.' })));
        this.socket?.close();
        return;
      }
      this.toast(`Your role is now ${role}.`);
      this.drawingStage?.focus();
    }
    void this.loadVersions();
    void this.loadIssues();
  }

  protected stopFollowing(): void {
    if (this.following) this.following = null;
  }

  // -----------------------------------------------------------------
  // Data loading
  // -----------------------------------------------------------------

  protected async loadVersions(): Promise<void> {
    if (!this.state) return;
    const all: Array<Record<string, unknown>> = [];
    for (const sheet of this.state.sheets) {
      const { status, data } = await this.api<{ versions: Array<Record<string, unknown>> }>('GET', `/api/sheets/${sheet.id}/versions`);
      if (status === 200) {
        for (const version of data.versions) all.push({ ...version, sheet_id: sheet.id, sheet_name: sheet.name });
      }
    }
    this.versions = all;
    this.renderVersions();
  }

  protected async loadIssues(): Promise<void> {
    const { status, data } = await this.api<{ issues: Array<Record<string, unknown>> }>('GET', `/api/drawings/${this.drawingId}/issues`);
    if (status !== 200) return;
    this.issues = data.issues;
    for (const issue of this.issues) {
      for (const rfiId of (issue.rfi_ids ?? []) as string[]) {
        if (!this.rfis[rfiId]) {
          const rfi = await this.api<Record<string, unknown>>('GET', `/api/rfis/${rfiId}`);
          if (rfi.status === 200) this.rfis[rfiId] = rfi.data;
        }
      }
    }
    this.renderIssues();
  }

  // -----------------------------------------------------------------
  // Panels
  // -----------------------------------------------------------------

  protected renderPanels(): void {
    this.renderEntitiesPanel();
    this.renderLayersPanel();
    this.renderProperties();
    this.renderParameters();
    this.renderXrefs();
  }

  protected renderEntitiesPanel(): void {
    const body = this.panelBodies.get('Entities');
    if (!body || !this.state) return;
    const grid = el('div', { role: 'grid', 'aria-label': 'Entities', 'aria-rowcount': String(this.state.order.length) });
    const table = el('table', { class: 'panel-table' });
    for (const row of this.entityRows()) table.append(row);
    grid.append(table);
    body.replaceChildren(grid);
  }

  private entityRows(): HTMLElement[] {
    if (!this.state) return [];
    const ordered = [...this.state.order];
    const rows: HTMLElement[] = [];
    ordered.forEach((handle, index) => {
      const entity = this.state?.entities[handle];
      if (!entity) return;
      const label = entityLabel(entity, { dim_styles: this.state?.dimStyles ?? {}, entities: (this.state?.entities ?? {}) as never });
      const row = el('tr', { role: 'row', 'aria-rowindex': String(index + 1), 'aria-selected': this.selection.has(handle) ? 'true' : 'false', tabindex: '0', 'data-handle': handle });
      row.append(el('td', { class: 'row-label', role: 'gridcell', title: label, text: label }));
      row.addEventListener('click', () => {
        this.selection = new Set([handle]);
        this.renderEntities();
        this.renderPanels();
      });
      row.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const nextIndex = event.key === 'ArrowDown' ? Math.min(index + 1, ordered.length - 1) : Math.max(index - 1, 0);
          const rowsList = row.parentElement ? [...row.parentElement.children] : [];
          (rowsList[nextIndex] as HTMLElement | undefined)?.focus();
          const nextHandle = ordered[nextIndex];
          if (nextHandle) {
            this.selection = new Set([nextHandle]);
            this.renderEntities();
          }
        } else if (event.key === ' ') {
          event.preventDefault();
          if (this.selection.has(handle)) this.selection.delete(handle);
          else this.selection.add(handle);
          row.setAttribute('aria-selected', this.selection.has(handle) ? 'true' : 'false');
          this.renderEntities();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          this.panToEntity(handle);
        }
      });
      rows.push(row);
    });
    return rows;
  }

  private panToEntity(handle: string): void {
    const entity = this.state?.entities[handle];
    if (!entity) return;
    const box = entityBounds(entity);
    const margin = 48 / this.view.zoom;
    const width = Math.max(box.maxX - box.minX, 1e-6) + margin * 2;
    const height = Math.max(box.maxY - box.minY, 1e-6) + margin * 2;
    const zoom = clamp(Number(Math.min(this.view.zoom, Math.min(this.paneWidth / width, this.paneHeight / height)).toFixed(4)), 0.05, 50);
    this.view.zoom = zoom;
    const centreX = (box.minX + box.maxX) / 2;
    const centreY = (box.minY + box.maxY) / 2;
    this.view.panX = Number((this.paneWidth / 2 - centreX * zoom).toFixed(4));
    this.view.panY = Number((this.paneHeight / 2 + centreY * zoom).toFixed(4));
    this.renderEntities();
  }

  protected renderLayersPanel(): void {
    const body = this.panelBodies.get('Layers');
    if (!body || !this.state) return;
    const grid = el('div', { role: 'grid', 'aria-label': 'Layer list' });
    const rows = el('div', { class: 'layer-rows' });
    const names = Object.keys(this.state.layers).filter((name) => !name.includes('|')).sort();
    for (const name of names) rows.append(this.layerRow(name));
    grid.append(rows);
    const current = el('select', { 'aria-label': 'Current layer' });
    for (const name of names) {
      const option = el('option', { value: name, text: name });
      if (name === this.state.currentLayer) option.setAttribute('selected', 'true');
      current.append(option);
    }
    current.addEventListener('change', () => {
      const value = (current as HTMLSelectElement).value;
      if (this.state?.layers[value]?.frozen) {
        this.toast('Frozen layers can\u2019t be current.');
        return;
      }
      if (this.state) this.state.currentLayer = value;
    });
    const newLayer = el('button', { text: 'New layer' });
    newLayer.addEventListener('click', () => {
      const name = window.prompt('Layer name');
      if (name) void this.sendGroup('LAYER', [{ op_id: this.newOpId(), type: 'layer_add', name, colour: 'white', linetype: 'Continuous', lineweight: 0.25, on: true, frozen: false, locked: false }]);
    });
    const saveState = el('button', { text: 'Save layer state' });
    saveState.addEventListener('click', () => {
      const name = window.prompt('Layer state name');
      if (name) void this.sendGroup('LAYERSTATE', [{ op_id: this.newOpId(), type: 'layer_state_save', name }]);
    });
    const statesList = el('ul', { role: 'list', 'aria-label': 'Layer states' });
    for (const state of this.state.layerStates) {
      const restore = el('button', { text: 'Restore' });
      restore.addEventListener('click', () => void this.sendGroup('LAYERSTATE', [{ op_id: this.newOpId(), type: 'layer_state_restore', name: state.name }]));
      statesList.append(el('li', {}, el('span', { text: state.name }), restore));
    }
    body.replaceChildren(grid, el('div', { class: 'property-row' }, el('span', { class: 'property-name', text: 'Current layer' }), current), el('div', { class: 'review-buttons' }, newLayer, saveState), statesList);
  }

  private layerRow(name: string): HTMLElement {
    if (!this.state) return el('div');
    const layer = this.state.layers[name];
    const row = el('div', { class: 'layer-row', 'data-layer': name });
    const on = el('button', { text: 'On', 'aria-pressed': layer.on ? 'true' : 'false' });
    on.addEventListener('click', () => void this.sendGroup('LAYER', [{ op_id: this.newOpId(), type: 'layer_set', name, set: { on: !layer.on } }]));
    const frozen = el('button', { text: 'Frozen', 'aria-pressed': layer.frozen ? 'true' : 'false' });
    frozen.addEventListener('click', () => void this.sendGroup('LAYER', [{ op_id: this.newOpId(), type: 'layer_set', name, set: { frozen: !layer.frozen } }]));
    const locked = el('button', { text: 'Locked', 'aria-pressed': layer.locked ? 'true' : 'false' });
    locked.addEventListener('click', () => void this.sendGroup('LAYER', [{ op_id: this.newOpId(), type: 'layer_set', name, set: { locked: !layer.locked } }]));
    const colour = el('select', { 'aria-label': 'Colour' });
    for (const value of ['white', 'red', 'yellow', 'green', 'cyan', 'blue', 'magenta', 'grey']) {
      const option = el('option', { value, text: value });
      if (value === layer.colour) option.setAttribute('selected', 'true');
      colour.append(option);
    }
    colour.addEventListener('change', () => void this.sendGroup('LAYER', [{ op_id: this.newOpId(), type: 'layer_set', name, set: { colour: (colour as HTMLSelectElement).value } }]));
    const linetype = el('select', { 'aria-label': 'Linetype' });
    for (const value of ['Continuous', 'Dashed', 'Dotted', 'Centre']) {
      const option = el('option', { value, text: value });
      if (value === layer.linetype) option.setAttribute('selected', 'true');
      linetype.append(option);
    }
    linetype.addEventListener('change', () => void this.sendGroup('LAYER', [{ op_id: this.newOpId(), type: 'layer_set', name, set: { linetype: (linetype as HTMLSelectElement).value } }]));
    const lineweight = el('select', { 'aria-label': 'Lineweight' });
    for (const value of [0.13, 0.18, 0.25, 0.35, 0.5, 0.7]) {
      const option = el('option', { value: String(value), text: `${value} mm` });
      if (value === layer.lineweight) option.setAttribute('selected', 'true');
      lineweight.append(option);
    }
    lineweight.addEventListener('change', () => void this.sendGroup('LAYER', [{ op_id: this.newOpId(), type: 'layer_set', name, set: { lineweight: Number((lineweight as HTMLSelectElement).value) } }]));
    row.append(el('span', { class: 'layer-name', text: name }), on, frozen, locked, colour, linetype, lineweight);
    if (name !== '0') {
      const remove = el('button', { text: 'Delete' });
      remove.addEventListener('click', () => void this.sendGroup('LAYER', [{ op_id: this.newOpId(), type: 'layer_delete', name }]));
      row.append(remove);
    }
    return row;
  }

  protected renderProperties(): void {
    const body = this.panelBodies.get('Properties');
    if (!body || !this.state) return;
    const selected = [...this.selection].map((handle) => this.state?.entities[handle]).filter((entity): entity is ResolvedEntity => Boolean(entity));
    const rows: HTMLElement[] = [];
    const lengths = selected.map((entity) => lengthOf(entity)).filter((value): value is number => value !== null);
    const areas = selected.map((entity) => areaOf(entity)).filter((value): value is number => value !== null);
    const propertyRow = (name: string, values: number[]): HTMLElement => {
      const varies = values.length > 1 && values.some((value) => Math.abs(value - values[0]) > 0.001);
      return el('div', { class: 'property-row' },
        el('span', { class: 'property-name', text: name }),
        el('span', { class: 'property-value', text: varies ? '*VARIES*' : values.length ? trimZeros(values[0].toFixed(3)) : '' }));
    };
    if (lengths.length) rows.push(propertyRow('Length', lengths));
    if (areas.length) rows.push(propertyRow('Area', areas));
    for (const entity of selected) {
      if (entity.type === 'insert') {
        for (const [tag, value] of Object.entries(entity.attributes)) {
          const input = el('input', { type: 'text', value, 'aria-label': tag });
          input.addEventListener('change', () => void this.sendGroup('PROPERTIES', [{ op_id: this.newOpId(), type: 'modify', handle: entity.handle, set: { attributes: { ...entity.attributes, [tag]: (input as HTMLInputElement).value } } }]));
          rows.push(el('div', { class: 'property-row' }, el('span', { class: 'property-name', text: tag }), input));
        }
      }
    }
    body.replaceChildren(...rows);
  }

  protected renderParameters(): void {
    const body = this.panelBodies.get('Parameters');
    if (!body || !this.state) return;
    const grid = el('div', { role: 'grid', 'aria-label': 'Parameter list' });
    const table = el('table', { class: 'panel-table' });
    table.append(el('tr', { role: 'row' }, el('th', { text: 'Name' }), el('th', { text: 'Expression' }), el('th', { text: 'Value' })));
    for (const parameter of this.state.parameters) {
      table.append(el('tr', { role: 'row' },
        el('td', { role: 'gridcell', text: parameter.name }),
        el('td', { role: 'gridcell', text: parameter.expression }),
        el('td', { role: 'gridcell', text: '' })));
    }
    grid.append(table);
    body.replaceChildren(grid);
  }

  protected renderXrefs(): void {
    const body = this.panelBodies.get('Xrefs');
    if (!body || !this.state) return;
    body.replaceChildren();
    for (const xref of this.state.xrefs) {
      const row = el('div', { class: 'xref-row' });
      row.append(el('span', { text: xref.name }));
      const reload = el('button', { text: 'Reload' });
      reload.addEventListener('click', () => void this.sendGroup('XRELOAD', [{ op_id: this.newOpId(), type: 'xref_reload', name: xref.name }]));
      const clip = el('button', { text: 'Clip' });
      clip.addEventListener('click', () => void this.sendGroup('XCLIP', [{ op_id: this.newOpId(), type: 'xref_clip', name: xref.name, rect: null }]));
      const removeClip = el('button', { text: 'Remove clip' });
      removeClip.addEventListener('click', () => void this.sendGroup('XCLIP', [{ op_id: this.newOpId(), type: 'xref_clip', name: xref.name, rect: null }]));
      row.append(reload, clip, removeClip);
      body.append(row);
    }
    if (!this.state.xrefs.length) body.append(el('p', { class: 'meta', text: 'No xrefs.' }));
  }

  protected async newSheet(): Promise<void> {
    const name = window.prompt('Sheet name');
    if (!name || !this.state) return;
    const size = window.prompt('Sheet size: A3 or A4', 'A3') ?? 'A3';
    const { status, data } = await this.api<Record<string, unknown>>('POST', `/api/drawings/${this.drawingId}/sheets`, { name, size });
    if (status === 201) {
      this.state.sheets.push(data as never);
      this.toast(`Sheet ${name} added.`);
    }
  }

  protected async publishSheet(): Promise<void> {
    if (!this.state) return;
    const sheet = this.state.sheets[0];
    if (!sheet) {
      this.toast('Add a sheet first.');
      return;
    }
    this.setStorageNotice('Publishing\u2026');
    const { status, data } = await this.api<{ number?: number; message?: string }>('POST', `/api/sheets/${sheet.id}/versions`, {});
    if (status === 201) {
      this.setStorageNotice(`Published version ${(data as { number?: number }).number}.`);
      this.announce(`Published version ${(data as { number?: number }).number}.`);
      await this.loadVersions();
    } else {
      this.setStorageNotice(String((data as { message?: string }).message ?? 'Nothing was published.'));
    }
  }

  protected setStorageNotice(text: string | null): void {
    const node = this.root.querySelector('.storage-notice') as HTMLElement | null;
    if (!node) return;
    if (text === null) {
      node.hidden = true;
      node.textContent = '';
      return;
    }
    node.hidden = false;
    node.textContent = text;
    this.announce(text);
  }

  protected async openCompare(): Promise<void> {
    this.compareOpen = true;
    this.renderCompare();
  }

  protected async openExportDialog(): Promise<void> {
    this.openExport();
  }

  protected openImportDialog(): void {
    this.openImport();
  }

  protected openUnderlayDialog(): void {
    this.openUnderlay();
  }

  protected openFind(): void {
    this.openFindBar();
  }

  protected renderVersions(): void {
    const body = this.panelBodies.get('Versions');
    if (!body) return;
    body.replaceChildren();
    for (const version of this.versions) {
      const item = el('div', { class: 'version-item' });
      item.append(el('span', { text: `v${version.number}` }), el('span', { class: 'version-state', text: String(version.state ?? '') }));
      const startReview = el('button', { text: 'Start review' });
      startReview.addEventListener('click', () => void this.reviewAct(String(version.id), 'markup', 'start'));
      const approve = el('button', { text: 'Approve' });
      approve.addEventListener('click', () => void this.reviewAct(String(version.id), 'markup', 'approve'));
      const reject = el('button', { text: 'Reject' });
      reject.addEventListener('click', () => void this.reviewAct(String(version.id), 'markup', 'reject'));
      const restore = el('button', { text: 'Restore this version' });
      restore.addEventListener('click', () => void this.restoreVersion(String(version.id)));
      const createLink = el('button', { text: 'Create view link' });
      createLink.addEventListener('click', () => void this.createLink(String(version.id)));
      item.append(startReview, approve, reject, restore, createLink);
      const steps = (version.steps ?? []) as Array<Record<string, unknown>>;
      for (const step of steps) {
        item.append(el('span', { class: 'stamp', text: `${String(step.step)} ${String(step.state)}` }));
      }
      const stamps = (version.stamps ?? []) as Array<Record<string, unknown>>;
      for (const stamp of stamps) {
        item.append(el('span', { class: 'stamp', text: String(stamp.kind ?? '') }));
      }
      body.append(item);
    }
    if (!this.versions.length) body.append(el('p', { class: 'meta', text: 'No versions.' }));
  }

  protected renderIssues(): void {
    const body = this.panelBodies.get('Issues');
    if (!body) return;
    const list = el('ul', { role: 'list', 'aria-label': 'Issue list' });
    for (const issue of this.issues) {
      const item = el('li', { class: 'issue-item', role: 'listitem' });
      const head = el('div', { class: 'row-head' }, el('span', { text: String(issue.title) }), el('span', { class: 'meta', text: String(issue.state) }));
      const createRfi = el('button', { text: 'Create RFI' });
      createRfi.addEventListener('click', () => this.openNewRfi(String(issue.id)));
      const answer = el('button', { text: 'Answer issue' });
      answer.addEventListener('click', () => void this.issueTransition(String(issue.id), 'answered'));
      const close = el('button', { text: 'Close issue' });
      close.addEventListener('click', () => void this.issueTransition(String(issue.id), 'closed'));
      const reopen = el('button', { text: 'Reopen issue' });
      reopen.addEventListener('click', () => void this.issueTransition(String(issue.id), 'open'));
      item.append(head, el('div', { class: 'review-buttons' }, createRfi, answer, close, reopen));
      for (const rfiId of (issue.rfi_ids ?? []) as string[]) {
        const rfi = this.rfis[rfiId];
        if (!rfi) continue;
        const article = el('article', { 'aria-label': `RFI: ${String(rfi.question)}` });
        article.append(el('span', { text: String(rfi.question) }), el('span', { class: 'rfi-state', text: ` ${String(rfi.state)} with ${String(rfi.ball_in_court)}` }));
        const answerInput = el('input', { type: 'text', 'aria-label': 'RFI answer' });
        const send = el('button', { text: 'Send RFI' });
        send.addEventListener('click', () => void this.rfiTransition(rfiId, 'sent'));
        const answerRfi = el('button', { text: 'Answer RFI' });
        answerRfi.addEventListener('click', () => void this.rfiTransition(rfiId, 'answered', (answerInput as HTMLInputElement).value));
        const closeRfi = el('button', { text: 'Close RFI' });
        closeRfi.addEventListener('click', () => void this.rfiTransition(rfiId, 'closed'));
        const reopenRfi = el('button', { text: 'Reopen RFI' });
        reopenRfi.addEventListener('click', () => void this.rfiTransition(rfiId, 'sent'));
        article.append(el('div', { class: 'rfi-form' }, answerInput), el('div', { class: 'review-buttons' }, send, answerRfi, closeRfi, reopenRfi));
        item.append(article);
      }
      list.append(item);
    }
    body.replaceChildren(list);
  }

  protected async issueTransition(issueId: string, to: string): Promise<void> {
    const { status, data } = await this.api<{ message?: string }>('POST', `/api/issues/${issueId}/transitions`, { to });
    if (status !== 200) {
      this.toast(String((data as { message?: string }).message ?? 'That transition is not allowed.'));
      return;
    }
    await this.loadIssues();
  }

  protected async rfiTransition(rfiId: string, to: string, answer?: string): Promise<void> {
    const { status, data } = await this.api<{ message?: string }>('POST', `/api/rfis/${rfiId}/transitions`, answer === undefined ? { to } : { to, answer });
    if (status !== 200) {
      this.toast(String((data as { message?: string }).message ?? 'That transition is not allowed.'));
      return;
    }
    await this.loadIssues();
  }

  protected openNewRfi(issueId: string): void {
    const question = el('input', { type: 'text', 'aria-label': 'Question' });
    const addressee = el('select', { 'aria-label': 'Addressee' });
    for (const name of [...this.presence.keys()].sort()) {
      addressee.append(el('option', { value: name, text: name }));
    }
    const dialog = el('dialog', { 'aria-label': 'New RFI' });
    const form = el('form', {}, el('label', { text: 'Question' }, question), el('label', { text: 'Addressee' }, addressee));
    form.append(el('button', { type: 'submit', text: 'Save RFI', class: 'primary' }));
    dialog.append(form);
    this.root.append(dialog);
    (dialog as HTMLDialogElement).showModal();
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const { status, data } = await this.api<{ message?: string }>('POST', `/api/issues/${issueId}/rfis`, {
        question: (question as HTMLInputElement).value,
        addressee: (addressee as HTMLSelectElement).value,
      });
      if (status === 201) {
        (dialog as HTMLDialogElement).close();
        dialog.remove();
        await this.loadIssues();
      } else {
        this.toast(String((data as { message?: string }).message ?? 'That RFI was not saved.'));
      }
    });
  }

  protected async reviewAct(versionId: string, step: string, action: 'start' | 'approve' | 'reject'): Promise<void> {
    if (action === 'start') {
      const { status, data } = await this.api<{ message?: string }>('POST', `/api/versions/${versionId}/review`, {});
      if (status !== 201) {
        this.toast(String((data as { message?: string }).message ?? 'That review was not started.'));
        return;
      }
      await this.loadVersions();
      return;
    }
    const { status, data } = await this.api<{ message?: string }>('POST', `/api/versions/${versionId}/review/${step}/${action}`, {});
    if (status !== 200) {
      this.toast(String((data as { message?: string }).message ?? 'That review action was refused.'));
      return;
    }
    await this.loadVersions();
  }

  protected async restoreVersion(versionId: string): Promise<void> {
    const { status, data } = await this.api<{ message?: string }>('POST', `/api/drawings/${this.drawingId}/ops`, {
      base_revision: this.state?.revision ?? 0,
      group_id: `g_restore_${Date.now().toString(36)}`,
      command: 'RESTORE',
      ops: [{ op_id: this.newOpId(), type: 'version_restore', version: versionId }],
    });
    if (status === 200) {
      await this.refresh();
    } else {
      this.toast(String((data as { message?: string }).message ?? 'That version was not restored.'));
    }
  }

  protected async createLink(versionId: string): Promise<void> {
    const { status, data } = await this.api<{ url?: string }>('POST', `/api/versions/${versionId}/links`, {});
    if (status === 201) {
      this.toast(`Link created: ${String((data as { url?: string }).url ?? '')}`);
    }
  }

  protected compareOpen = false;

  protected renderCompare(): void {
    if (!this.compareOpen || !this.state) return;
    let controls = this.root.querySelector('.compare-controls') as HTMLElement | null;
    if (!controls) {
      controls = el('div', { class: 'compare-controls' });
      const from = el('select', { 'aria-label': 'Earlier version' });
      const to = el('select', { 'aria-label': 'Later version' });
      const slider = el('input', { type: 'range', min: '0', max: '100', value: '50', 'aria-label': 'Compare swipe' });
      const overlay = el('input', { type: 'checkbox', role: 'switch', 'aria-label': 'Overlay' });
      const counts = el('span', { class: 'compare-counts', role: 'status', 'aria-live': 'polite', text: 'Added 0, removed 0, changed 0' });
      slider.addEventListener('input', () => this.setCompareSwipe(Number((slider as HTMLInputElement).value)));
      slider.addEventListener('keydown', (event) => {
        const current = Number((slider as HTMLInputElement).value);
        if (event.key === 'ArrowLeft') { event.preventDefault(); this.setCompareSwipe(Math.max(0, current - 1)); }
        if (event.key === 'ArrowRight') { event.preventDefault(); this.setCompareSwipe(Math.min(100, current + 1)); }
        if (event.key === 'PageUp') { event.preventDefault(); this.setCompareSwipe(Math.min(100, current + 10)); }
        if (event.key === 'PageDown') { event.preventDefault(); this.setCompareSwipe(Math.max(0, current - 10)); }
        if (event.key === 'Home') { event.preventDefault(); this.setCompareSwipe(0); }
        if (event.key === 'End') { event.preventDefault(); this.setCompareSwipe(100); }
      });
      overlay.addEventListener('change', () => this.setCompareOverlay((overlay as HTMLInputElement).checked));
      from.addEventListener('change', () => void this.refreshCompare(from, to, counts));
      to.addEventListener('change', () => void this.refreshCompare(from, to, counts));
      controls.append(from, to, slider, overlay, counts);
      this.drawingStage?.append(controls);
      void this.refreshCompare(from, to, counts);
    }
  }

  protected compareSwipeValue = 50;

  protected setCompareSwipe(value: number): void {
    this.compareSwipeValue = value;
    const slider = this.root.querySelector('[aria-label="Compare swipe"]') as HTMLInputElement | null;
    if (slider) {
      slider.value = String(value);
      slider.setAttribute('aria-valuetext', `${value}% newer version`);
    }
    const divider = this.root.querySelector('[data-swipe-divider]') as HTMLElement | null;
    if (divider) {
      const previous = Number(divider.dataset.percent ?? '50');
      divider.dataset.percent = String(value);
      divider.style.left = `${value}%`;
      if (!reducedMotion() && previous !== value) {
        divider.animate([{ left: `${previous}%` }, { left: `${value}%` }], { id: 'compare-swipe', duration: 120, easing: 'ease-out', fill: 'forwards' });
      }
    }
  }

  protected setCompareOverlay(value: boolean): void {
    const divider = this.root.querySelector('[data-swipe-divider]') as HTMLElement | null;
    if (divider) divider.hidden = value;
  }

  protected async refreshCompare(from: HTMLSelectElement, to: HTMLSelectElement, counts: HTMLElement): Promise<void> {
    if (!this.state) return;
    const sheetId = this.state.sheets[0]?.id;
    if (!sheetId) return;
    const versions = await this.api<{ versions: Array<Record<string, unknown>> }>('GET', `/api/sheets/${sheetId}/versions`);
    if (versions.status !== 200) return;
    const numbers = versions.data.versions.map((version) => Number(version.number));
    from.replaceChildren();
    to.replaceChildren();
    for (const number of numbers) {
      from.append(el('option', { value: String(number), text: `v${number}` }));
      to.append(el('option', { value: String(number), text: `v${number}` }));
    }
    const latest = numbers[numbers.length - 1] ?? 1;
    const previous = numbers[numbers.length - 2] ?? latest;
    from.value = String(previous);
    to.value = String(latest);
    const compare = await this.api<{ added: number; removed: number; changed: number; entities: Array<{ id: string; diff: string }> }>('GET', `/api/sheets/${sheetId}/compare?from=${previous}&to=${latest}`);
    if (compare.status === 200) {
      counts.textContent = `Added ${compare.data.added}, removed ${compare.data.removed}, changed ${compare.data.changed}`;
    }
  }

  protected openExport(): void {
    const dialog = el('dialog', { 'aria-label': 'Export' });
    const form = el('form', {},
      el('label', { text: 'Plotfold text' }, el('input', { type: 'radio', name: 'format', value: 'plot.txt', checked: true })),
      el('label', { text: 'SVG' }, el('input', { type: 'radio', name: 'format', value: 'svg' })));
    const start = el('button', { type: 'submit', text: 'Start export', class: 'primary' });
    form.append(start);
    dialog.append(form);
    const progressArea = el('div', { class: 'export-progress' });
    dialog.append(progressArea);
    this.root.append(dialog);
    (dialog as HTMLDialogElement).showModal();
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const chosen = dialog.querySelector<HTMLInputElement>('input[name="format"]:checked')?.value ?? 'plot.txt';
      const { status, data } = await this.api<{ id?: string; state?: string; progress?: number; message?: string }>('POST', `/api/drawings/${this.drawingId}/exports`, { format: chosen });
      if (status !== 202) {
        this.setStorageNotice('Export failed: file storage is unavailable.');
        return;
      }
      this.setStorageNotice('Export started.');
      this.pollExport(String((data as { id?: string }).id), progressArea, dialog);
    });
  }

  protected pollExport(exportId: string, area: HTMLElement, dialog: HTMLElement): void {
    const progress = el('div', { role: 'progressbar', 'aria-label': 'Export', 'aria-valuemin': '0', 'aria-valuemax': '100' });
    const bar = el('div', { class: 'bar' }, el('div', { class: 'fill', style: 'width:0%' }));
    progress.append(bar);
    area.replaceChildren(progress);
    const tick = async () => {
      const { status, data } = await this.api<{ state?: string; progress?: number; download_url?: string | null; message?: string }>('GET', `/api/exports/${exportId}`);
      if (status !== 200) {
        this.setStorageNotice('Export failed: file storage is unavailable.');
        const retry = el('button', { text: 'Retry export' });
        retry.addEventListener('click', () => {
          void this.api('POST', `/api/exports/${exportId}/retry`, {}).then(() => this.pollExport(exportId, area, dialog));
        });
        area.replaceChildren(retry);
        return;
      }
      const value = Number((data as { progress?: number }).progress ?? 0);
      bar.firstElementChild?.setAttribute('style', `width:${value}%`);
      progress.setAttribute('aria-valuenow', String(value));
      if ((data as { state?: string }).state === 'ready') {
        const link = el('a', { text: 'Download export', href: `/api/exports/${exportId}/download` });
        area.replaceChildren(progress, el('div', {}, link));
        this.setStorageNotice('Export ready.');
        return;
      }
      if ((data as { state?: string }).state === 'failed') {
        this.setStorageNotice('Export failed: file storage is unavailable.');
        const retry = el('button', { text: 'Retry export' });
        retry.addEventListener('click', () => {
          void this.api('POST', `/api/exports/${exportId}/retry`, {}).then(() => this.pollExport(exportId, area, dialog));
        });
        area.replaceChildren(progress, retry);
        return;
      }
      window.setTimeout(() => void tick(), 200);
    };
    void tick();
    void dialog;
  }

  protected openImport(): void {
    const dialog = el('dialog', { 'aria-label': 'Import preview' });
    const file = el('input', { type: 'file', 'aria-label': 'Drawing text file' });
    const body = el('div', {});
    dialog.append(el('label', { text: 'File' }, file), body);
    this.root.append(dialog);
    (dialog as HTMLDialogElement).showModal();
    file.addEventListener('change', async () => {
      const input = file as HTMLInputElement;
      const selected = input.files?.[0];
      if (!selected) return;
      const bytes = new Uint8Array(await selected.arrayBuffer());
      this.setStorageNotice('Reading file\u2026');
      const { status, data } = await this.api<{ import_id?: string; adds?: { entities: number; layers: number; blocks: number }; renames?: Array<{ from: string; to: string }>; lines?: string[]; message?: string }>('POST', `/api/drawings/${this.drawingId}/imports`, bytes);
      if (status === 201) {
        const adds = (data as { adds?: { entities: number; layers: number; blocks: number } }).adds;
        const renames = (data as { renames?: Array<{ from: string; to: string }> }).renames ?? [];
        const preview = el('p', { text: `Adds ${adds?.entities ?? 0} entities, ${adds?.layers ?? 0} layers, ${adds?.blocks ?? 0} blocks.` });
        body.replaceChildren(preview);
        for (const rename of renames) {
          body.append(el('p', { text: `${rename.from} renamed ${rename.to}` }));
        }
        const merge = el('button', { text: 'Merge', class: 'primary' });
        const cancel = el('button', { text: 'Cancel' });
        merge.addEventListener('click', async () => {
          const result = await this.api<{ message?: string }>('POST', `/api/drawings/${this.drawingId}/merge`, { import_id: (data as { import_id?: string }).import_id });
          if (result.status === 200) {
            this.setStorageNotice(`Imported ${adds?.entities ?? 0} entities.`);
            (dialog as HTMLDialogElement).close();
            dialog.remove();
            await this.refresh();
          }
        });
        cancel.addEventListener('click', () => {
          (dialog as HTMLDialogElement).close();
          dialog.remove();
        });
        body.append(el('div', { class: 'dialog-actions' }, merge, cancel));
        return;
      }
      if (status === 422) {
        const lines = (data as { lines?: string[] }).lines ?? [];
        const list = el('ul', { class: 'import-errors', role: 'list', 'aria-label': 'Import errors' });
        for (const line of lines) list.append(el('li', { text: line }));
        body.replaceChildren(list);
        return;
      }
      this.setStorageNotice(String((data as { message?: string }).message ?? 'Nothing was imported.'));
    });
  }

  protected openUnderlay(): void {
    const dialog = el('dialog', { 'aria-label': 'Add underlay' });
    const file = el('input', { type: 'file', 'aria-label': 'Image file', accept: 'image/png,image/jpeg' });
    const first = el('input', { type: 'text', 'aria-label': 'First corner', placeholder: '0,0' });
    const opposite = el('input', { type: 'text', 'aria-label': 'Opposite corner', placeholder: '100,100' });
    const form = el('form', {},
      el('label', { text: 'Image file' }, file),
      el('label', { text: 'First corner' }, first),
      el('label', { text: 'Opposite corner' }, opposite));
    form.append(el('button', { type: 'submit', text: 'Attach', class: 'primary' }));
    dialog.append(form);
    this.root.append(dialog);
    (dialog as HTMLDialogElement).showModal();
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const selected = (file as HTMLInputElement).files?.[0];
      if (!selected) return;
      const bytes = new Uint8Array(await selected.arrayBuffer());
      this.setStorageNotice('Uploading\u2026');
      const one = parsePoint((first as HTMLInputElement).value, { x: 0, y: 0 });
      const two = parsePoint((opposite as HTMLInputElement).value, { x: 0, y: 0 });
      const { status, data } = await this.api<{ message?: string }>('POST', `/api/drawings/${this.drawingId}/underlays?x1=${one?.x ?? 0}&y1=${one?.y ?? 0}&x2=${two?.x ?? 0}&y2=${two?.y ?? 0}`, bytes);
      if (status === 201 || status === 200) {
        this.setStorageNotice('Underlay attached.');
        (dialog as HTMLDialogElement).close();
        dialog.remove();
        await this.refresh();
      } else {
        this.setStorageNotice(String((data as { message?: string }).message ?? 'Nothing was added.'));
      }
    });
  }

  protected openFindBar(): void {
    let bar = this.root.querySelector('.find-bar') as HTMLElement | null;
    if (bar) {
      bar.querySelector('input')?.focus();
      return;
    }
    bar = el('div', { class: 'find-bar', role: 'search', 'aria-label': 'Find' });
    const input = el('input', { type: 'search', 'aria-label': 'Find text', placeholder: 'Find' });
    const count = el('span', { role: 'status', 'aria-live': 'polite', text: 'No matches.' });
    const next = el('button', { text: 'Next match' });
    next.addEventListener('click', () => this.findNext());
    bar.append(input, count, next);
    this.drawingStage?.append(bar);
    (input as HTMLInputElement).focus();
    input.addEventListener('input', () => {
      const text = (input as HTMLInputElement).value;
      this.updateFindMatches(text, count);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.findNext();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        bar?.remove();
        this.commandInput?.focus();
      }
    });
  }

  protected findMatches: string[] = [];
  protected findIndex = -1;

  protected updateFindMatches(text: string, count: HTMLElement): void {
    if (!this.state) return;
    const needle = text.trim().toLowerCase();
    if (!needle) {
      this.findMatches = [];
      this.findIndex = -1;
      count.textContent = 'No matches.';
      return;
    }
    this.findMatches = this.state.order.filter((handle) => {
      const entity = this.state?.entities[handle];
      if (!entity) return false;
      if (handle.toLowerCase() === needle) return true;
      const layer = this.state?.layers[entity.layer];
      if (layer && layer.name.toLowerCase() === needle) return true;
      if (entity.type === 'insert' && entity.block.toLowerCase() === needle) return true;
      return false;
    });
    if (!this.findMatches.length) {
      count.textContent = 'No matches.';
      return;
    }
    this.findIndex = 0;
    const handle = this.findMatches[0];
    this.selection = new Set([handle]);
    this.panToEntity(handle);
    count.textContent = `1 of ${this.findMatches.length}`;
    this.renderEntities();
    this.renderPanels();
  }

  protected findNext(): void {
    if (!this.findMatches.length) return;
    this.findIndex = (this.findIndex + 1) % this.findMatches.length;
    const handle = this.findMatches[this.findIndex];
    this.selection = new Set([handle]);
    this.panToEntity(handle);
    const count = this.root.querySelector('.find-bar [role="status"]');
    if (count) count.textContent = `${this.findIndex + 1} of ${this.findMatches.length}`;
    this.renderEntities();
    this.renderPanels();
  }

}

// The concrete screen overrides these members.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function stageRequiresPositive(stage: string): boolean {
  return stage.includes('radius') || stage.includes('factor') || stage.includes('count') || stage.includes('rows') || stage.includes('columns') || stage.includes('distance');
}
