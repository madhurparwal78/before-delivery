import { api, isApiError, errorBody, getStaffId, setStaffId, getUnit, setUnit } from './api.js';
import type {
  Staff, Unit, ViewName, Placement, ObjectRecord, Preview, EventEntry, ServiceStatus,
  Exhibition, Gallery, Lender, UndoInfo,
} from './types.js';
import {
  formatLength, formatLux, formatLuxHours, formatCountdown,
  placementStatusText, photoCountText,
} from './types.js';
import { el, banner, skipLink, focusHeading } from './ui.js';
import { Scene3D, webglAvailable, wallFacingYaw, type SceneState } from './scene3d.js';
import { FlatScene } from './flat-scene.js';

const PLAN_HEIGHT_CM = 1800;
const EYE_HEIGHT_CM = 145;

export class Workspace {
  private staffList: Staff[] = [];
  private staffId = getStaffId();
  private unit: Unit = getUnit();
  private exhibition: Exhibition | null = null;
  private gallery: Gallery | null = null;
  private lenders: Lender[] = [];
  private objects: ObjectRecord[] = [];
  private placements: Placement[] = [];
  private preview: Preview | null = null;
  private latestSeq = 0;
  private seenSeqs = new Set<number>();

  /** Changes made in this tab are never announced as team updates. */
  private markOwnSeq(seq: number | undefined): void {
    if (seq !== undefined) this.seenSeqs.add(seq);
  }
  private view: ViewName = 'plan';
  private cameraAtEye = false;
  private selectedPlacementId: string | null = null;
  private overBudgetCount = 0;
  private status: ServiceStatus | null = null;
  private undo: (UndoInfo & { title: string; wallName: string }) | null = null;
  private undoDeadline = 0;
  private railOpen = false;
  private previewSheetOpen = false;
  private legendOpen = false;
  private scene3d: Scene3D | null = null;
  private flat: FlatScene | null = null;

  private wasDbDown = false;
  private announcementText = '';
  private teamUpdatesText = '';
  private sceneHost: HTMLElement | null = null;
  private sceneEl: HTMLElement | null = null;

  constructor(private root: HTMLElement) {}

  async start(): Promise<void> {
    this.restoreFromUrl();
    this.root.replaceChildren(this.render());
    this.mountScene();
    await this.refreshBase();
    this.applyRestoredView();
    this.startPolling();
    this.attachShortcuts();
  }

  /** Restores the view, camera and selection the address carries, as a cut. */
  private restoreFromUrl(): void {
    const params = new URL(window.location.href).searchParams;
    const view = params.get('view');
    if (view === 'wall') {
      this.view = 'wall';
      this.cameraAtEye = true;
    } else if (view === 'light') {
      this.view = 'light';
      this.cameraAtEye = false;
    } else if (view === 'light-eye') {
      this.view = 'light';
      this.cameraAtEye = true;
    }
    const work = params.get('work');
    this.selectedPlacementId = work;
    this.previewSheetOpen = params.get('panel') === 'preview';
  }

  private applyRestoredView(): void {
    if (this.scene3d === null) return;
    const target: SceneState = {
      view: this.view,
      cameraHeightCm: this.cameraAtEye ? EYE_HEIGHT_CM : PLAN_HEIGHT_CM,
      cameraYawDeg: this.view === 'plan' ? 0 : this.currentYaw(),
      hangLine: this.view === 'wall' || (this.view === 'light' && this.cameraAtEye) ? 'visible' : 'hidden',
      transitioning: false,
    };
    this.scene3d.applyView(target, true);
    this.updateScene();
    if (this.previewSheetOpen && window.innerWidth < 600) {
      focusHeading(this.root, '.preview-heading');
    }
  }

  /** Mounts the WebGL scene, or the flat drawing without WebGL. */
  private mountScene(): void {
    if (this.sceneHost !== null) return;
    const host = this.root.querySelector('.gallery-scene') as HTMLElement | null;
    if (host === null) return;
    this.sceneHost = host;
    this.sceneEl = host;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.inset = '0';
    host.prepend(container);
    if (webglAvailable()) {
      this.scene3d = new Scene3D(container, {
        onStateChanged: (state) => this.applySceneState(state),
        onMarkerClick: (id) => { this.selectedPlacementId = id; this.rerender(); },
        onDragMove: (id, deltaMm) => this.handleDrag(id, deltaMm),
        onDragEnd: (id) => this.commitDrag(id),
        onOrbit: (delta) => this.scene3d?.orbitBy(delta),
        onZoom: (scale) => this.scene3d?.zoomBy(scale),
      });
      this.scene3d.mount();
    } else {
      this.flat = new FlatScene(container);
      this.flat.mount();
      host.append(el('div', { class: 'no-webgl-notice', text: `3D view isn't available on this device. Showing a flat drawing instead.` }));
    }
    this.updateScene();
    void reduced;
  }

  private applySceneState(state: SceneState): void {
    const scene = this.sceneEl;
    if (scene === null) return;
    scene.setAttribute('data-view', state.view);
    scene.setAttribute('data-transitioning', state.transitioning ? 'true' : 'false');
    scene.setAttribute('data-camera-height-cm', String(state.cameraHeightCm));
    scene.setAttribute('data-camera-yaw-deg', String(state.cameraYawDeg));
    scene.setAttribute('data-hang-line', state.hangLine);
    const readout = scene.parentElement?.querySelector('.scene-readout');
    if (readout !== null && readout !== undefined) {
      readout.textContent = state.cameraHeightCm === EYE_HEIGHT_CM ? 'Eye height 145 cm' : 'Plan view';
    }
  }

  private updateScene(): void {
    if (this.scene3d !== null) {
      this.scene3d.rebuildMarkers(
        {
          walls: this.gallery?.walls ?? [],
          placements: this.placements,
          selectedId: this.selectedPlacementId,
          luxOverlay: this.view === 'light',
        },
        { width: this.sceneHost?.clientWidth ?? 800, height: this.sceneHost?.clientHeight ?? 400 }
      );
    }
    if (this.flat !== null) {
      this.flat.draw({
        walls: this.gallery?.walls ?? [],
        placements: this.placements,
        view: this.view,
        facingWallId: this.facingWallId(),
        luxOverlay: this.view === 'light',
      });
    }
  }

  private facingWallId(): string | null {
    if (this.selectedPlacementId !== null) {
      const placement = this.placements.find((p) => p.id === this.selectedPlacementId);
      if (placement !== undefined) return placement.wallId;
    }
    const first = this.placements[0];
    return first?.wallId ?? null;
  }

  /** View shortcuts 1, 2, 3 and the undo shortcut, per Interactions. */
  private attachShortcuts(): void {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && (this.railOpen || this.previewSheetOpen)) {
        if (this.railOpen) this.toggleRail();
        else this.togglePreviewSheet();
        return;
      }
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      const dialogOpen = document.querySelector('dialog[open]') !== null;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        if (typing || dialogOpen) return;
        if (this.undo !== null && this.undoDeadline > Date.now()) {
          e.preventDefault();
          void this.doUndo();
        }
        return;
      }
      if (typing || dialogOpen || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '1') this.changeView('plan');
      if (e.key === '2') this.changeView('wall');
      if (e.key === '3') this.changeView('light');
    });
  }

  private handleDrag(placementId: string, deltaPx: number): void {
    const placement = this.placements.find((p) => p.id === placementId);
    if (placement === undefined) return;
    const wall = this.gallery?.walls.find((w) => w.id === placement.wallId);
    if (wall === undefined) return;
    // Roughly 10 px per 10 cm along the wall.
    const deltaMm = Math.round((deltaPx / 10) * 10);
    const next = Math.max(0, Math.min(wall.lengthMm, placement.offsetMm + deltaMm));
    this.dragOffsets.set(placementId, (this.dragOffsets.get(placementId) ?? placement.offsetMm));
    const current = this.dragOffsets.get(placementId) ?? placement.offsetMm;
    const stepped = Math.round((current + deltaMm) / 10) * 10;
    this.dragOffsets.set(placementId, Math.max(0, Math.min(wall.lengthMm, stepped)));
  }

  private dragOffsets = new Map<string, number>();
  private previewDate = '';
  private luxDrafts = new Map<string, string>();

  private commitDrag(placementId: string): Promise<void> {
    const target = this.dragOffsets.get(placementId);
    this.dragOffsets.delete(placementId);
    const placement = this.placements.find((p) => p.id === placementId);
    if (placement === undefined || target === undefined || target === placement.offsetMm) {
      return Promise.resolve();
    }
    this.nudge(placement, { offsetMm: target });
    return Promise.resolve();
  }

  // ---------- data ----------

  private async refreshBase(): Promise<void> {
    const staff = await api<{ staff: Staff[] }>('GET', '/api/staff');
    if (!isApiError(staff)) this.staffList = (staff.body as { staff: Staff[] }).staff;
    const exhibition = await api<{ exhibition: Exhibition; gallery: Gallery; lenders: Lender[] }>('GET', '/api/exhibition', undefined, { staffId: this.staffId });
    if (!isApiError(exhibition)) {
      const body = exhibition.body as { exhibition: Exhibition; gallery: Gallery; lenders: Lender[] };
      this.exhibition = body.exhibition;
      this.gallery = body.gallery;
      this.lenders = body.lenders;
    }
    await this.refreshWorkspace();
    await this.refreshPreview();
  }

  private async refreshWorkspace(): Promise<void> {
    const placements = await api<{ placements: Placement[]; overBudgetCount: number }>('GET', '/api/placements', undefined, { staffId: this.staffId });
    if (!isApiError(placements)) {
      const body = placements.body as { placements: Placement[]; overBudgetCount: number };
      this.placements = body.placements;
      this.overBudgetCount = body.overBudgetCount;
    }
    const objects = await api<{ objects: ObjectRecord[] }>('GET', '/api/objects', undefined, { staffId: this.staffId });
    if (!isApiError(objects)) {
      this.objects = (objects.body as { objects: ObjectRecord[] }).objects;
    }
    this.rerender();
    this.updateScene();
  }

  private async refreshPreview(): Promise<void> {
    const preview = await api<{ preview: Preview }>('GET', '/api/preview', undefined, { staffId: this.staffId });
    if (!isApiError(preview)) {
      this.preview = (preview.body as { preview: Preview }).preview;
    }
    this.rerender();
  }

  private async refreshStatus(): Promise<void> {
    const status = await api<ServiceStatus>('GET', '/api/status');
    if (!isApiError(status)) {
      this.status = status.body as ServiceStatus;
      this.rerender();
    }
  }

  private async pollEvents(): Promise<void> {
    const result = await api<{ events: EventEntry[]; latestSeq: number }>(
      'GET', `/api/events?after=${this.latestSeq}`, undefined, { staffId: this.staffId }
    );
    if (isApiError(result)) return;
    const body = result.body as { events: EventEntry[]; latestSeq: number };
    const fresh = body.events.filter((e) => !this.seenSeqs.has(e.seq));
    for (const e of fresh) this.seenSeqs.add(e.seq);
    this.latestSeq = body.latestSeq;
    if (fresh.length > 0) {
      this.announceTeamUpdate(fresh);
      await this.refreshWorkspace();
      await this.refreshPreview();
    }
  }

  private startPolling(): void {
    let lastWidth = window.innerWidth;
    window.addEventListener('resize', () => {
      if (Math.abs(window.innerWidth - lastWidth) > 24) {
        lastWidth = window.innerWidth;
        this.rerender();
      }
    });
    setInterval(() => { void this.pollEvents(); }, 2000);
    this.root.addEventListener('pointerdown', (e) => {
      if (!this.railOpen && !this.previewSheetOpen) return;
      const target = e.target as HTMLElement;
      if (target.closest('#objects-rail') !== null) return;
      if (target.closest('[aria-controls="objects-rail"]') !== null) return;
      if (target.closest('.preview-heading') !== null) return;
      const inPreviewSheet = target.closest('.inspector-section[id="preview-sheet"]') !== null;
      if (this.previewSheetOpen && !inPreviewSheet && target.closest('[aria-controls="preview-sheet"]') === null) {
        if (window.innerWidth < 600) this.togglePreviewSheet();
        return;
      }
      if (this.railOpen && window.innerWidth < 1024) this.toggleRail();
    });
    setInterval(() => { void this.refreshPreview(); }, 5000);
    setInterval(() => { void this.refreshStatus(); }, 5000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void this.refreshPreview();
      }
    });
  }

  private announceTeamUpdate(events: EventEntry[]): void {
    const sentences = events.map(teamSentence);
    this.teamUpdatesText = sentences.join(' ');
    const region = this.root.querySelector('[data-region="team-updates"]');
    if (region !== null) region.textContent = this.teamUpdatesText;
  }

  // ---------- rendering ----------

  private rerender(): void {
    const focused = document.activeElement as HTMLElement | null;
    const focusKey = focused?.getAttribute('data-focus-key') ?? null;
    // Where focus should land if the focused control is removed by this refresh.
    let fallback: { kind: 'card' | 'ledger' | 'preview'; id?: string } | null = null;
    if (focused !== null && this.root.contains(focused) && focusKey === null) {
      const card = focused.closest('.rail-card');
      if (card !== null) {
        const heading = card.querySelector('h3');
        fallback = { kind: 'card', id: heading?.textContent ?? undefined };
      } else if (focused.classList.contains('work-handle')) {
        fallback = { kind: 'ledger' };
      } else if (focused.closest('.inspector-section')?.getAttribute('aria-label') === 'Lender preview') {
        fallback = { kind: 'preview' };
      }
    }
    this.root.replaceChildren(this.render());
    this.sceneHost = null;
    this.mountScene();
    if (focusKey !== null) {
      const target = this.root.querySelector(`[data-focus-key="${focusKey}"]`) as HTMLElement | null;
      if (target !== null) {
        target.focus();
        return;
      }
    }
    if (fallback !== null) {
      const target = fallback.kind === 'card'
        ? (Array.from(this.root.querySelectorAll('.rail-card h3')).find((h) => h.textContent === fallback!.id) as HTMLElement | undefined)
        : fallback.kind === 'ledger'
          ? (this.root.querySelector('.scene-ledger-wrap')?.previousElementSibling as HTMLElement | undefined)
          : (this.root.querySelector('.preview-heading') as HTMLElement | undefined);
      target?.focus();
    } else if (focusKey !== null) {
      // The focus-keyed control is gone: focus the nearest published heading.
      const [kind] = focusKey.split('-');
      if (kind === 'handle') {
        (this.root.querySelector('.scene-ledger-wrap')?.previousElementSibling as HTMLElement | undefined)?.focus();
      } else if (kind !== 'undo' && kind !== 'lux' && kind !== 'staff' && kind !== 'preview' && kind !== 'photo') {
        const objectId = focusKey.split('-').slice(1).join('-').replace(/^obj-/, '');
        const heading = Array.from(this.root.querySelectorAll('.rail-card h3'))
          .find((h) => (h.closest('.rail-card')?.querySelector('a')?.getAttribute('href') ?? '').endsWith(objectId));
        (heading as HTMLElement | undefined)?.focus();
      }
    }
  }

  private currentRole(): string {
    return this.staffList.find((s) => s.id === this.staffId)?.role ?? 'curator';
  }

  private render(): HTMLElement {
    const page = el('div', {});
    page.append(skipLink());

    const dbDown = this.status?.services.database === 'down';
    document.body.classList.toggle('db-down', dbDown);
    const banners = el('div', { class: 'banner-stack' });
    if (dbDown) banners.append(banner('database'));
    if (this.status?.services.imageStore === 'down') banners.append(banner('imageStore'));
    if (this.status?.services.mailRelay === 'down') banners.append(banner('mailRelay'));
    page.append(banners);

    page.append(this.renderHeader());

    const main = el('main', { id: 'main', tabindex: '-1' });
    main.append(this.renderBody());
    page.append(main);

    page.append(
      el('div', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite', 'aria-label': 'Announcements', 'data-region': 'announcements', text: this.announcementText }),
      el('div', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite', 'aria-label': 'Team updates', 'data-region': 'team-updates', text: this.teamUpdatesText }),
    );

    if (dbDown) {
      const retry = page.querySelector('[data-action="db-retry"]') as HTMLButtonElement | null;
      retry?.addEventListener('click', () => {
        void this.refreshStatus();
        void this.refreshWorkspace();
        void this.refreshPreview();
      });
      setTimeout(() => retry?.focus(), 0);
    } else if (this.wasDbDown) {
      this.wasDbDown = false;
      this.announce('Database connection restored.');
      setTimeout(() => (this.root.querySelector('main') as HTMLElement | null)?.focus(), 0);
    }
    this.wasDbDown = dbDown;
    return page;
  }

  private renderHeader(): HTMLElement {
    const header = el('header', { class: 'site-header' });
    header.append(el('span', { class: 'product-name', text: 'Hangline' }));

    const nav = el('nav', { class: 'sections-nav', 'aria-label': 'Sections' });
    nav.append(
      el('a', { href: '/', 'aria-current': 'page', text: 'Gallery' }),
      el('a', { href: '/records', text: 'Loan register' }),
    );
    header.append(nav);

    const staffSelect = el('select', { 'aria-label': 'Working as', 'data-focus-key': 'staff' }) as HTMLSelectElement;
    for (const s of this.staffList) {
      const option = el('option', { value: s.id, text: `${s.name} (${s.role})` });
      if (s.id === this.staffId) option.setAttribute('selected', 'selected');
      staffSelect.append(option);
    }
    staffSelect.addEventListener('change', () => {
      this.staffId = staffSelect.value;
      setStaffId(this.staffId);
      this.rerender();
    });

    const units = el('div', { role: 'radiogroup', 'aria-label': 'Units' });
    for (const value of ['cm', 'in'] as Unit[]) {
      const radio = el('input', {
        type: 'radio', name: 'unit', id: `unit-${value}`, value,
      }) as HTMLInputElement;
      radio.addEventListener('change', () => {
        this.unit = value;
        setUnit(value);
        this.rerender();
      });
      if (this.unit === value) radio.setAttribute('checked', 'checked');
      units.append(radio, el('label', { for: `unit-${value}`, text: value }));
    }

    const controls = el('div', { class: 'header-controls' });
    controls.append(
      el('label', { class: 'control-label', text: 'Working as' }),
      staffSelect,
      units,
    );

    // The rail toggle shows at tablet widths; the phone bar carries it below 600.
    if (window.innerWidth >= 600 && window.innerWidth < 1024) {
      const toggle = el('button', {
        class: 'rail-toggle', text: 'Objects',
        'aria-expanded': this.railOpen ? 'true' : 'false',
        'aria-controls': 'objects-rail',
      });
      toggle.addEventListener('click', () => this.toggleRail());
      controls.append(toggle);
    }

    // View group at desk and tablet; on phone it sits above the scene.
    if (window.innerWidth >= 600) {
      controls.append(this.renderViewGroup());
    } else {
      header.append(controls);
      return header;
    }
    header.append(controls);
    return header;
  }

  private renderViewGroup(): HTMLElement {
    const group = el('div', { role: 'group', 'aria-label': 'View' });
    for (const [name, label] of [['plan', 'Plan'], ['wall', 'Wall'], ['light', 'Light']] as [ViewName, string][]) {
      const pressed = this.view === name;
      const button = el('button', {
        text: label,
        'aria-pressed': pressed ? 'true' : 'false',
        'data-view-button': name,
      });
      button.addEventListener('click', () => this.changeView(name));
      group.append(button);
    }
    return group;
  }

  private renderBody(): HTMLElement {
    const wrap = el('div', { class: 'workspace' });
    const rail = this.renderRail();
    const scene = this.renderSceneColumn();
    const inspector = this.renderInspector();
    if (window.innerWidth >= 1024) {
      wrap.append(rail, scene, inspector);
    } else if (window.innerWidth >= 600) {
      wrap.append(scene, inspector);
      const toggled = rail;
      toggled.classList.add('rail-column');
      wrap.append(rail);
      rail.classList.toggle('open', this.railOpen);
    } else {
      wrap.append(scene, inspector, rail);
      rail.classList.toggle('open', this.railOpen);
      const bar = el('div', { class: 'phone-bar' });
      const objectsButton = el('button', {
        text: 'Objects',
        'aria-expanded': this.railOpen ? 'true' : 'false',
        'aria-controls': 'objects-rail',
      });
      objectsButton.addEventListener('click', () => this.toggleRail());
      const previewButton = el('button', {
        text: 'Lender preview',
        'aria-expanded': this.previewSheetOpen ? 'true' : 'false',
        'aria-controls': 'preview-sheet',
      });
      previewButton.addEventListener('click', () => this.togglePreviewSheet());
      bar.append(objectsButton, previewButton);
      wrap.append(bar);
    }

    // View group above scene at phone
    if (window.innerWidth < 600) {
      const sceneColumn = wrap.querySelector('.scene-column');
      sceneColumn?.prepend(this.renderViewGroup());
    }
    return wrap;
  }

  private toggleRail(): void {
    this.railOpen = !this.railOpen;
    if (this.railOpen) this.previewSheetOpen = false;
    this.rerender();
    if (this.railOpen) {
      const firstCard = this.root.querySelector('.rail-list li h3');
      (firstCard as HTMLElement | null)?.focus();
    } else {
      const button = this.root.querySelector('[aria-controls="objects-rail"]');
      (button as HTMLElement | null)?.focus();
    }
  }

  private togglePreviewSheet(): void {
    this.previewSheetOpen = !this.previewSheetOpen;
    if (this.previewSheetOpen) this.railOpen = false;
    this.rerender();
    if (this.previewSheetOpen) {
      focusHeading(this.root, 'h2.preview-heading');
    } else {
      const button = this.root.querySelector('[aria-controls="preview-sheet"]');
      (button as HTMLElement | null)?.focus();
    }
  }

  private renderRail(): HTMLElement {
    const rail = el('aside', {
      class: 'rail-column object-rail', id: 'objects-rail',
      role: 'region', 'aria-label': 'Objects',
    });
    if (!this.railOpen && window.innerWidth < 1024) {
      rail.setAttribute('inert', '');
      rail.setAttribute('aria-hidden', 'true');
    }
    const list = el('ul', { class: 'rail-list', 'aria-label': 'Objects' });
    for (const object of this.objects) {
      list.append(this.renderCard(object));
    }
    rail.append(list);
    return rail;
  }

  private renderCard(object: ObjectRecord): HTMLElement {
    const li = el('li', {});
    const card = el('article', { class: 'rail-card' });
    const heading = el('h3', { text: object.title, tabindex: '-1', 'data-object-heading': object.id });
    card.append(heading);
    const dl = el('dl', {});
    const add = (label: string, value: string): void => {
      dl.append(el('dt', { text: label }), el('dd', { class: 'num', text: value }));
    };
    add('Object number', object.objectNumber);
    add('Lender', object.lenderName ?? 'Ashgrove collection');
    add('Dimensions', `${formatLength(object.widthMm, this.unit)} × ${formatLength(object.heightMm, this.unit)}`);
    add('Lux limit', `${formatLux(object.luxLimit)} lux`);
    const placementForCard = this.placements.find((q) => q.objectId === object.id);
    add('Placement', placementForCard !== undefined
      ? placementStatusText(placementForCard)
      : 'Not placed');
    add('Photos', photoCountText(object.photos.length));
    card.append(dl);

    const actions = el('div', { class: 'card-actions' });
    const role = this.currentRole();
    const placement = this.placements.find((p) => p.objectId === object.id);
    const canPlace = role === 'curator' && placement === undefined;
    const canClaim = role === 'preparator' && placement !== undefined && placement.status === 'proposed';
    const canRelease = role === 'preparator' && placement !== undefined && placement.status === 'claimed' && placement.claimedBy?.id === this.staffId;
    const canHang = canRelease;
    const canSignOff = role === 'registrar' && placement !== undefined && placement.status === 'hung';

    if (canPlace) {
      const button = el('button', { text: 'Place', 'data-action': 'place', 'data-object': object.id, 'data-focus-key': `place-${object.id}` });
      button.addEventListener('click', () => this.openPlaceDialog(object));
      actions.append(button);
    }
    if (canClaim) {
      const button = el('button', { text: 'Claim', 'data-action': 'claim', 'data-placement': placement!.id, 'data-object': object.id, 'data-focus-key': `claim-${object.id}` });
      button.addEventListener('click', () => this.claim(button as HTMLButtonElement, placement!, object));
      actions.append(button);
    }
    if (canRelease) {
      const button = el('button', { text: 'Release', 'data-action': 'release', 'data-placement': placement!.id, 'data-object': object.id, 'data-focus-key': `release-${object.id}` });
      button.addEventListener('click', () => this.release(placement!, object));
      actions.append(button);
    }
    if (canHang) {
      const button = el('button', { text: 'Mark hung', 'data-action': 'hang', 'data-placement': placement!.id, 'data-object': object.id, 'data-focus-key': `hang-${object.id}` });
      button.addEventListener('click', () => this.markHung(placement!, object));
      actions.append(button);
    }
    if (canSignOff) {
      const button = el('button', { text: 'Sign off', 'data-action': 'sign-off', 'data-placement': placement!.id, 'data-object': object.id, 'data-focus-key': `sign-off-${object.id}` });
      button.addEventListener('click', () => this.signOff(placement!, object));
      actions.append(button);
    }
    if (role === 'registrar') {
      const input = el('input', {
        type: 'file', accept: 'image/jpeg,image/png',
        'aria-label': `Condition photo for ${object.title}`,
        'data-focus-key': `photo-${object.id}`,
      }) as HTMLInputElement;
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (file !== undefined) void this.uploadPhoto(object, file, input);
      });
      actions.append(input);
    }
    card.append(actions);
    card.append(el('a', { href: `/records/${object.id}`, class: 'card-record-link', text: 'Open record' }));
    li.append(card);
    return li;
  }

  private renderSceneColumn(): HTMLElement {
    const column = el('section', { class: 'scene-column' });
    if (this.exhibition !== null) {
      column.append(
        el('h1', { class: 'exhibition-title', text: this.exhibition.title }),
        el('h2', { class: 'gallery-name', text: this.gallery?.name ?? '' }),
      );
    }
    if (this.view === 'light' && window.innerWidth < 1024) {
      const legendButton = el('button', {
        text: 'Lux legend',
        'aria-expanded': this.legendOpen ? 'true' : 'false',
        'aria-controls': 'lux-legend',
      });
      legendButton.addEventListener('click', () => {
        this.legendOpen = !this.legendOpen;
        this.rerender();
      });
      column.append(legendButton);
    }
    if (this.view === 'light') {
      const legend = el('div', { class: 'lux-legend', id: 'lux-legend', role: 'region', 'aria-label': 'Lux legend' });
      legend.append(
        el('span', { class: 'key' }, el('span', { class: 'legend-swatch' }), el('span', { text: 'Within limit: ink outline' })),
        el('span', { class: 'key' }, el('span', { class: 'legend-swatch over' }), el('span', { text: 'Over budget: red outline with hatching' })),
      );
      if (window.innerWidth < 1024 && !this.legendOpen) {
        legend.setAttribute('hidden', 'hidden');
        legend.setAttribute('inert', '');
      }
      column.append(legend);
    }

    const sceneWrap = el('div', { class: 'scene-wrap' });
    const scene = el('div', {
      class: 'gallery-scene',
      role: 'region',
      'aria-label': 'Gallery scene',
      'data-view': this.view,
      'data-transitioning': 'false',
      'data-camera-height-cm': String(this.cameraAtEye ? EYE_HEIGHT_CM : PLAN_HEIGHT_CM),
      'data-camera-yaw-deg': String(this.currentYaw()),
      'data-hang-line': this.view === 'wall' || (this.view === 'light' && this.cameraAtEye) ? 'visible' : 'hidden',
    });
    sceneWrap.append(scene);
    const readout = el('div', {
      class: 'scene-readout',
      text: this.cameraAtEye ? `Eye height 145 cm` : 'Plan view',
    });
    sceneWrap.append(readout);
    column.append(sceneWrap);
    column.append(el('p', { class: 'over-budget-count', text: `${this.overBudgetCount} over budget` }));

    const ledgerHeading = el('h2', { text: 'Scene ledger', tabindex: '-1' });
    column.append(ledgerHeading);
    column.append(this.renderLedger());

    if (this.undo !== null && this.undoDeadline > Date.now()) {
      const toast = el('div', {
        class: 'undo-toast', role: 'region', 'aria-label': 'Undo',
        'data-focus-key': 'undo-toast',
      });
      const seconds = Math.ceil((this.undoDeadline - Date.now()) / 1000);
      const message = this.undo.kind === 'remove'
        ? `${this.undo.title} removed.`
        : `${this.undo.title} moved.`;
      const undoButton = el('button', { text: 'Undo', 'data-focus-key': 'undo-button' });
      undoButton.addEventListener('click', () => void this.doUndo());
      toast.append(
        el('span', { text: message }),
        el('span', { class: 'undo-count', text: `${seconds} s left`, 'data-undo-count': 'true' }),
        undoButton,
      );
      column.append(toast);
      this.scheduleUndoTick();
    }
    return column;
  }

  private scheduleUndoTick(): void {
    const tick = (): void => {
      const counter = this.root.querySelector('[data-undo-count]');
      if (counter === null) return;
      const remaining = this.undoDeadline - Date.now();
      if (remaining <= 0) {
        this.undo = null;
        const focused = document.activeElement;
        if (this.root.contains(focused)) {
          focusHeading(this.root, 'h2');
        }
        this.rerender();
        return;
      }
      counter.textContent = `${Math.ceil(remaining / 1000)} s left`;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private currentYaw(): number {
    if (this.view === 'plan') return 0;
    if (this.selectedPlacementId !== null) {
      const placement = this.placements.find((p) => p.id === this.selectedPlacementId);
      if (placement !== undefined) return wallFacingYaw(placement.wallId);
    }
    return 0;
  }

  private renderLedger(): HTMLElement {
    const wrap = el('div', { class: 'scene-ledger-wrap' });
    const table = el('table', { class: 'ledger', 'aria-label': 'Scene ledger' });
    const head = el('thead', {});
    const headRow = el('tr', {});
    for (const column of ['Work', 'Wall', 'Offset', 'Centre height', 'Lux', 'Lux-hours', 'Lux status', 'Status']) {
      headRow.append(el('th', { scope: 'col', text: column }));
    }
    head.append(headRow);
    table.append(head);
    const body = el('tbody', {});
    for (const p of this.placements) {
      const row = el('tr', {});
      const workCell = el('td', {});
      const handle = el('button', {
        class: 'work-handle', text: p.objectTitle,
        'data-placement-id': p.id,
        'data-focus-key': `handle-${p.id}`,
      });
      handle.addEventListener('click', () => {
        this.selectedPlacementId = p.id;
        this.rerender();
      });
      handle.addEventListener('keydown', (e) => this.handleLedgerKeys(e, p));
      workCell.append(handle);
      row.append(
        workCell,
        el('td', { text: p.wallName }),
        el('td', { class: 'num', text: formatLength(p.offsetMm, this.unit) }),
        el('td', { class: 'num', text: formatLength(p.centreHeightMm, this.unit) }),
        el('td', { class: 'num', text: `${formatLux(p.plannedLux)} lux` }),
        el('td', { class: 'num', text: formatLuxHours(p.plannedLuxHours) }),
        el('td', { class: `lux-status ${p.luxStatus}`, text: p.luxStatus === 'over' ? 'Over budget' : 'Within limit' }),
        el('td', { text: placementStatusText(p) }),
      );
      body.append(row);
    }
    table.append(body);
    wrap.append(table);
    return wrap;
  }

  private renderInspector(): HTMLElement {
    const inspector = el('aside', { class: 'inspector-column', 'aria-label': 'Inspector', role: 'region' });
    const selected = this.placements.find((p) => p.id === this.selectedPlacementId) ?? null;

    const details = el('section', { class: 'inspector-section' });
    details.append(el('h2', { text: 'Inspector' }));
    if (selected === null) {
      details.append(el('p', { text: 'Select a work in the scene to see its details.' }));
    } else {
      const dl = el('dl', {});
      const add = (label: string, value: string): void => {
        dl.append(el('dt', { text: label }), el('dd', { class: 'num', text: value }));
      };
      add('Title', selected.objectTitle);
      add('Wall', selected.wallName);
      add('Offset', formatLength(selected.offsetMm, this.unit));
      add('Centre height', formatLength(selected.centreHeightMm, this.unit));
      add('Planned lux', `${formatLux(selected.plannedLux)} lux`);
      add('Planned lux-hours', formatLuxHours(selected.plannedLuxHours));
      add('Lux status', selected.luxStatus === 'over' ? 'Over budget' : 'Within limit');
      add('Status', placementStatusText(selected));
      details.append(dl);
      const buttons = el('div', { class: 'card-actions', style: 'margin-top:10px' });
      const detailsButton = el('button', { text: 'Details' }) as HTMLButtonElement;
      detailsButton.addEventListener('click', () => this.openPlacementDetails(selected));
      buttons.append(detailsButton);
      if (this.currentRole() === 'curator' && selected.status === 'proposed') {
        const remove = el('button', { text: 'Remove from wall', 'data-focus-key': `remove-${selected.id}` });
        remove.addEventListener('click', () => void this.removePlacement(selected));
        buttons.append(remove);
      }
      details.append(buttons);
    }
    inspector.append(details);

    const wallsSection = el('section', { class: 'inspector-section' });
    wallsSection.append(el('h2', { text: 'Walls' }));
    const wallsList = el('div', { class: 'walls-list' });
    for (const wall of this.gallery?.walls ?? []) {
      const row = el('div', { class: 'wall-row' });
      row.append(el('label', { text: wall.name }));
      if (this.currentRole() === 'curator') {
        const input = el('input', {
          type: 'number',
          value: this.luxDrafts.get(wall.id) ?? String(wall.plannedLux),
          'aria-label': `Lux on ${wall.name}`,
          'data-focus-key': `lux-${wall.id}`,
        }) as HTMLInputElement;
        input.addEventListener('input', () => { this.luxDrafts.set(wall.id, input.value); });
        const save = el('button', {
          text: `Save lux for ${wall.name}`,
          'data-focus-key': `lux-save-${wall.id}`,
        });
        save.addEventListener('click', () => void this.saveWallLux(wall, input, save as HTMLButtonElement));
        row.append(input, el('span', { class: 'lux-unit', text: 'lux' }), save);
      } else {
        row.append(el('span', { class: 'num', text: `${formatLux(wall.plannedLux)} lux` }));
      }
      wallsList.append(row);
    }
    wallsSection.append(wallsList);
    inspector.append(wallsSection);

    if (window.innerWidth >= 600 || this.previewSheetOpen) {
      inspector.append(this.renderPreviewSection());
    }
    return inspector;
  }

  private renderPreviewSection(): HTMLElement {
    const section = el('section', {
      class: 'inspector-section', id: 'preview-sheet',
      'aria-label': 'Lender preview',
    });
    const heading = el('h2', { class: 'preview-heading', text: 'Lender preview', tabindex: '-1' });
    section.append(heading);
    const preview = this.preview;
    const statusWord = el('p', {});
    statusWord.append(
      el('span', { class: 'preview-status-word', text: previewStatusWord(preview) }),
    );
    section.append(statusWord);
    if (preview?.status === 'scheduled') {
      section.append(
        el('p', { class: 'num', text: `Publishes ${preview.publishAtDisplay ?? ''}` }),
        el('p', { class: 'num', text: `Publishes in ${formatCountdown(preview.remainingMs ?? 0)}`, 'data-preview-countdown': 'true' }),
      );
      this.schedulePreviewCountdown(preview.remainingMs ?? 0);
    }
    if (preview?.status === 'published') {
      section.append(el('p', { class: 'num', text: `Published ${preview.publishedAtDisplay ?? ''}` }));
    }
    if (preview?.status === 'withdrawn') {
      section.append(el('p', { class: 'num', text: `Withdrawn ${preview.withdrawnAtDisplay ?? ''}` }));
    }

    if (this.currentRole() === 'curator') {
      const controls = el('div', { class: 'preview-controls' });
      if (preview?.status === 'draft' || preview?.status === 'withdrawn') {
        const input = el('input', {
          type: 'date', 'aria-label': 'Preview date', 'data-focus-key': 'preview-date',
          value: this.previewDate,
        }) as HTMLInputElement;
        input.addEventListener('input', () => { this.previewDate = input.value; });
        controls.append(
          input,
          el('p', { class: 'hint', text: 'Publishes at 09:00 Europe/London time on the date you choose.' }),
        );
        const schedule = el('button', { class: 'primary', text: 'Schedule preview' });
        schedule.addEventListener('click', () => void this.schedulePreview(input, schedule as HTMLButtonElement));
        controls.append(schedule);
      }
      if (preview?.status === 'scheduled') {
        const cancel = el('button', { text: 'Cancel schedule' });
        cancel.addEventListener('click', () => void this.cancelPreview(cancel as HTMLButtonElement));
        controls.append(cancel);
      }
      if (preview?.status === 'published') {
        const withdraw = el('button', { text: 'Withdraw preview' });
        withdraw.addEventListener('click', () => void this.withdrawPreview(withdraw as HTMLButtonElement));
        controls.append(withdraw);
      }
      section.append(controls);
    }

    if (preview !== null && preview.recipients.length > 0) {
      const list = el('ul', { class: 'recipients-list', 'aria-label': 'Recipients' });
      for (const r of preview.recipients) {
        const state = r.delivery === 'sent' ? 'Sent' : r.delivery === 'queued' ? 'Waiting for mail relay' : 'Not sent';
        list.append(el('li', { text: `${r.lenderName}: ${state}` }));
      }
      section.append(list);
    }
    return section;
  }

  private schedulePreviewCountdown(remainingMs: number): void {
    const deadline = Date.now() + remainingMs;
    const tick = (): void => {
      const node = this.root.querySelector('[data-preview-countdown]');
      if (node === null) return;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        node.textContent = 'Publishing now';
        void this.refreshPreview();
        return;
      }
      node.textContent = `Publishes in ${formatCountdown(remaining)}`;
      setTimeout(tick, 250);
    };
    setTimeout(tick, 250);
  }

  // ---------- interactions ----------

  private changeView(view: ViewName): void {
    if (view === this.view) return;
    const from = this.view;
    this.view = view;
    if (view === 'plan') this.cameraAtEye = false;
    if (view === 'wall') this.cameraAtEye = true;
    if (view === 'light' && from === 'wall') this.cameraAtEye = true;
    this.updateWorkspaceUrl();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const facingYaw = this.currentYaw();
    if (this.scene3d !== null) {
      const target: SceneState = {
        view,
        cameraHeightCm: this.cameraAtEye ? EYE_HEIGHT_CM : PLAN_HEIGHT_CM,
        cameraYawDeg: view === 'plan' ? 0 : facingYaw,
        hangLine: view === 'wall' || (view === 'light' && this.cameraAtEye) ? 'visible' : 'hidden',
        transitioning: false,
      };
      if (view === 'light' && !this.cameraAtEye) {
        target.cameraYawDeg = this.scene3d.currentYaw();
      }
      this.scene3d.applyView(target, reduced);
    }
    this.announce(`${view[0]!.toUpperCase()}${view.slice(1)} view.`);
    this.rerender();
  }

  private updateWorkspaceUrl(): void {
    const params = new URLSearchParams();
    const viewParam = this.view === 'plan' ? null : this.view === 'light'
      ? (this.cameraAtEye ? 'light-eye' : 'light')
      : this.view;
    if (viewParam !== null) params.set('view', viewParam);
    if (this.selectedPlacementId !== null) params.set('work', this.selectedPlacementId);
    if (this.previewSheetOpen) params.set('panel', 'preview');
    const search = params.toString();
    window.history.replaceState({}, '', search === '' ? '/' : `/?${search}`);
  }

  private handleLedgerKeys(e: KeyboardEvent, p: Placement): void {
    if (this.view === 'light') {
      const handles = this.placements.map((q) => q.id);
      const index = handles.indexOf(p.id);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = handles[Math.max(0, index - 1)] ?? handles[0]!;
        this.focusHandle(prev);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = handles[Math.min(handles.length - 1, index + 1)] ?? handles[handles.length - 1]!;
        this.focusHandle(next);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.openLuxDetails(p);
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      this.selectedPlacementId = p.id;
      this.rerender();
      this.openPlacementDetails(p);
      return;
    }
    const step = e.shiftKey ? 100 : 10;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const delta = e.key === 'ArrowLeft' ? -step : step;
      this.nudge(p, { offsetMm: p.offsetMm + delta });
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && p.heightOverride) {
      e.preventDefault();
      const delta = e.key === 'ArrowUp' ? step : -step;
      this.nudge(p, { centreHeightMm: p.centreHeightMm + delta });
    }
  }

  private focusHandle(placementId: string): void {
    const handle = this.root.querySelector(`.work-handle[data-placement-id="${placementId}"]`) as HTMLElement | null;
    handle?.focus();
  }

  private activeDialog: HTMLDialogElement | null = null;
  private nudgeTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingNudge: { placement: Placement; offsetMm: number; centreHeightMm: number } | null = null;

  private nudge(p: Placement, next: { offsetMm?: number; centreHeightMm?: number }): void {
    const role = this.currentRole();
    const mayMove =
      (role === 'curator' && p.status === 'proposed') ||
      (role === 'preparator' && p.status === 'claimed' && p.claimedBy?.id === this.staffId);
    if (!mayMove) {
      this.announce(`You can't move ${p.objectTitle} in its current state.`);
      return;
    }
    const offsetMm = next.offsetMm ?? p.offsetMm;
    const centreHeightMm = next.centreHeightMm ?? p.centreHeightMm;
    // Optimistic update on screen within 100ms.
    this.placements = this.placements.map((q) =>
      q.id === p.id ? { ...q, offsetMm, centreHeightMm } : q
    );
    this.rerender();
    this.focusHandle(p.id);
    this.pendingNudge = { placement: p, offsetMm, centreHeightMm };
    if (this.nudgeTimer !== null) clearTimeout(this.nudgeTimer);
    this.nudgeTimer = setTimeout(() => {
      void this.saveNudge();
    }, 500);
  }

  private async saveNudge(): Promise<void> {
    const pending = this.pendingNudge;
    this.pendingNudge = null;
    if (pending === null) return;
    const { placement, offsetMm, centreHeightMm } = pending;
    const result = await api<{ placement: Placement; undo: UndoInfo; seq: number } | { error: unknown }>(
      'PATCH', `/api/placements/${placement.id}`,
      { version: placement.version, offsetMm, centreHeightMm },
      { staffId: this.staffId }
    );
    if (isApiError(result)) {
      const body = errorBody(result);
      if (body.error.code === 'stale_version' && body.error.placement !== null) {
        await this.refreshWorkspace();
        this.announce(`Someone else moved ${placement.objectTitle}. Showing the latest position.`);
      } else {
        await this.refreshWorkspace();
        this.announce(body.error.message);
      }
      this.focusHandle(placement.id);
      return;
    }
    const placementAfter = (result.body as { placement: Placement }).placement;
    const undo = (result.body as { undo?: UndoInfo }).undo;
    this.markOwnSeq((result.body as { seq?: number }).seq);
    this.placements = this.placements.map((q) => (q.id === placement.id ? placementAfter : q));
    this.announce(`${placement.objectTitle} moved to ${formatLength(placementAfter.offsetMm, this.unit)} from the left end.`);
    if (undo !== undefined) {
      this.undo = { ...undo, title: placement.objectTitle, wallName: placementAfter.wallName };
      this.undoDeadline = Date.now() + undo.remainingMs;
    }
    this.rerender();
    this.focusHandle(placement.id);
    void this.pollEvents();
  }

  private async claim(button: HTMLButtonElement, placement: Placement, object: ObjectRecord): Promise<void> {
    if (button.classList.contains('busy')) return;
    button.classList.add('busy');
    const result = await api<{ placement: Placement; seq: number }>(
      'POST', `/api/placements/${placement.id}/claim`, undefined, { staffId: this.staffId }
    );
    if (isApiError(result)) {
      const body = errorBody(result);
      if (body.error.code === 'already_claimed') {
        this.announce(`${body.error.claimedBy?.name ?? 'Someone'} claimed ${placement.objectTitle} first.`);
      } else {
        this.announce(body.error.message);
      }
      await this.refreshWorkspace();
      const heading = this.root.querySelector(`[data-object-heading="${object.id}"]`) as HTMLElement | null;
      heading?.focus();
      return;
    }
    this.announce(`You claimed ${placement.objectTitle}.`);
    this.markOwnSeq((result.body as { seq?: number }).seq);
    await this.refreshWorkspace();
    const hungButton = this.root.querySelector(`[data-action="hang"][data-object="${object.id}"]`) as HTMLElement | null;
    hungButton?.focus();
  }

  private async release(placement: Placement, object: ObjectRecord): Promise<void> {
    const result = await api('POST', `/api/placements/${placement.id}/release`, undefined, { staffId: this.staffId });
    if (isApiError(result)) {
      this.announce(errorBody(result).error.message);
      return;
    }
    this.announce(`You released ${placement.objectTitle}.`);
    this.markOwnSeq((result.body as { seq?: number }).seq);
    await this.refreshWorkspace();
    const claimButton = this.root.querySelector(`[data-action="claim"][data-object="${object.id}"]`) as HTMLElement | null;
    claimButton?.focus();
  }

  private async markHung(placement: Placement, object: ObjectRecord): Promise<void> {
    const result = await api('POST', `/api/placements/${placement.id}/hang`, undefined, { staffId: this.staffId });
    if (isApiError(result)) {
      this.announce(errorBody(result).error.message);
      return;
    }
    this.announce(`${placement.objectTitle} marked hung.`);
    this.markOwnSeq((result.body as { seq?: number }).seq);
    await this.refreshWorkspace();
    const heading = this.root.querySelector(`[data-object-heading="${object.id}"]`) as HTMLElement | null;
    heading?.focus();
  }

  private async signOff(placement: Placement, object: ObjectRecord): Promise<void> {
    const result = await api('POST', `/api/placements/${placement.id}/sign-off`, undefined, { staffId: this.staffId });
    if (isApiError(result)) {
      this.announce(errorBody(result).error.message);
      await this.refreshWorkspace();
      const heading = this.root.querySelector(`[data-object-heading="${object.id}"]`) as HTMLElement | null;
      heading?.focus();
      return;
    }
    this.announce(`${placement.objectTitle} signed off.`);
    this.markOwnSeq((result.body as { seq?: number }).seq);
    await this.refreshWorkspace();
    const heading = this.root.querySelector(`[data-object-heading="${object.id}"]`) as HTMLElement | null;
    heading?.focus();
  }

  private async removePlacement(p: Placement): Promise<void> {
    const result = await api<{ placement: Placement; undo: UndoInfo; seq: number }>(
      'DELETE', `/api/placements/${p.id}`, undefined, { staffId: this.staffId }
    );
    if (isApiError(result)) {
      this.announce(errorBody(result).error.message);
      return;
    }
    const body = result.body as { placement: Placement; undo: UndoInfo; seq: number };
    this.markOwnSeq(body.seq);
    this.undo = { ...body.undo, title: p.objectTitle, wallName: p.wallName };
    this.undoDeadline = Date.now() + body.undo.remainingMs;
    this.announce(`${p.objectTitle} removed from ${p.wallName}.`);
    await this.refreshWorkspace();
    const undoButton = this.root.querySelector('[data-focus-key="undo-button"]') as HTMLElement | null;
    undoButton?.focus();
    void this.pollEvents();
  }

  private async doUndo(): Promise<void> {
    if (this.undo === null) return;
    const actionId = this.undo.actionId;
    const result = await api<{ placement: Placement; seq: number }>(
      'POST', `/api/undo/${actionId}`, undefined, { staffId: this.staffId }
    );
    if (isApiError(result)) {
      const body = errorBody(result);
      if (body.error.code === 'undo_expired') {
        this.announce('Too late to undo: the 10-second window has closed.');
      } else if (body.error.code === 'already_undone' || body.error.code === 'undo_conflict') {
        this.announce(`Can't undo: ${this.undo.title} has changed since.`);
      } else {
        this.announce(body.error.message);
      }
      this.undo = null;
      this.rerender();
      focusHeading(this.root, 'h2');
      return;
    }
    const placement = (result.body as { placement: Placement }).placement;
    this.markOwnSeq((result.body as { seq?: number }).seq);
    this.announce(`Undone: ${placement.objectTitle} is back where it was.`);
    this.undo = null;
    await this.refreshWorkspace();
    this.focusHandle(placement.id);
    void this.pollEvents();
  }

  private async uploadPhoto(object: ObjectRecord, file: File, input: HTMLInputElement): Promise<void> {
    const bytes = await file.arrayBuffer();
    const uploading = this.root.querySelector(`[data-uploading="${object.id}"]`);
    const contentType = file.type === 'image/jpeg' || file.type === 'image/png' ? file.type : null;
    if (contentType === null) {
      this.announce('Use a JPEG or PNG photo.');
      return;
    }
    const result = await fetch(`/api/objects/${object.id}/photos`, {
      method: 'POST',
      headers: {
        'X-Staff-Id': this.staffId,
        'Content-Type': contentType,
        'Idempotency-Key': `photo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
      body: bytes,
    });
    if (result.status === 201) {
      const body = await result.json() as { seq?: number };
      this.markOwnSeq(body.seq);
      this.announce(`Condition photo attached to ${object.title}.`);
      await this.refreshWorkspace();
      input.focus();
      void this.pollEvents();
    } else {
      const body = (await result.json()) as { error: { code: string; message: string } };
      if (body.error.code === 'body_too_large') {
        this.announce('That photo is over 10,000,000 bytes.');
      } else if (body.error.code === 'image_store_unavailable') {
        this.announce(`Condition photo not attached to ${object.title}. The image store is unavailable.`);
      } else {
        this.announce(body.error.message);
      }
      input.focus();
    }
  }

  private async saveWallLux(wall: { id: string; name: string }, input: HTMLInputElement, button: HTMLButtonElement): Promise<void> {
    const lux = Number(input.value);
    button.classList.add('busy');
    const result = await api<{ wall: unknown; placements: Placement[]; seq: number }>(
      'PATCH', `/api/walls/${wall.id}`, { plannedLux: lux }, { staffId: this.staffId }
    );
    button.classList.remove('busy');
    if (isApiError(result)) {
      this.announce(errorBody(result).error.message);
      return;
    }
    this.announce(`${wall.name} lighting set to ${lux} lux.`);
    this.markOwnSeq((result.body as { seq?: number }).seq);
    this.luxDrafts.delete(wall.id);
    await this.refreshWorkspace();
    button.focus();
    void this.pollEvents();
  }

  // ---------- dialogs ----------

  private openDialog(title: string, build: (dialog: HTMLDialogElement) => void, onClose: () => void): void {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', title);
    const body = el('div', { class: 'dialog-body' });
    body.append(el('h2', { text: title }));
    dialog.append(body);
    build(dialog);
    document.body.append(dialog);
    dialog.addEventListener('close', () => {
      dialog.remove();
      onClose();
    });
    dialog.showModal();
  }

  private openPlaceDialog(object: ObjectRecord): void {
    const errorBox = el('div', {});
    const summary = el('div', { class: 'error-summary', role: 'alert', tabindex: '-1' });
    summary.append(el('p', { text: 'Fix these to continue:' }), el('ul', {}));
    summary.setAttribute('hidden', 'hidden');
    errorBox.append(summary);

    const wallSelect = el('select', { 'aria-label': 'Wall' }) as HTMLSelectElement;
    for (const wall of this.gallery?.walls ?? []) {
      wallSelect.append(el('option', { value: wall.id, text: wall.name }));
    }
    const offsetInput = el('input', { type: 'text', 'aria-label': 'Offset from left end' }) as HTMLInputElement;
    const centreInput = el('input', { type: 'text', 'aria-label': 'Centre height', value: this.unit === 'cm' ? '145.0 cm' : '57.1 in' }) as HTMLInputElement;
    const exceptionInput = el('input', { type: 'checkbox', 'aria-label': 'Off the centre line (exception)' }) as HTMLInputElement;

    const form = el('form', {});
    const makeField = (label: string, control: HTMLElement, hint?: string): HTMLElement => {
      const field = el('div', { class: 'field' });
      field.append(el('label', { text: label }), control);
      if (hint !== undefined) field.append(el('p', { class: 'hint', text: hint }));
      return field;
    };
    form.append(
      errorBox,
      makeField('Wall', wallSelect),
      makeField('Offset from left end', offsetInput),
      makeField('Centre height', centreInput),
      makeField('Off the centre line (exception)', exceptionInput),
    );

    const saveButton = el('button', { class: 'primary', type: 'submit', text: 'Save placement' }) as HTMLButtonElement;
    const cancelButton = el('button', { type: 'button', text: 'Cancel', 'data-dialog-cancel': 'true' });
    const actions = el('div', { class: 'dialog-actions' });
    actions.append(cancelButton, saveButton);
    form.append(actions);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submitPlacement(
        object, wallSelect, offsetInput, centreInput, exceptionInput, summary, saveButton, () => this.activeDialog?.close()
      );
    });

    this.openDialog('Place work', (d) => {
      this.activeDialog = d;
      d.querySelector('.dialog-body')?.append(form);
      cancelButton.addEventListener('click', () => d.close());
      (d.querySelector('.field select') as HTMLElement | null)?.focus();
    }, () => {
      this.rerender();
    });
  }

  private async submitPlacement(
    object: ObjectRecord,
    wallSelect: HTMLSelectElement,
    offsetInput: HTMLInputElement,
    centreInput: HTMLInputElement,
    exceptionInput: HTMLInputElement,
    summary: HTMLElement,
    saveButton: HTMLButtonElement,
    closeDialog: () => void,
  ): Promise<void> {
    const { parseLength } = await import('./types.js');
    const offsetMm = parseLength(offsetInput.value, this.unit);
    const centreMm = parseLength(centreInput.value, this.unit);
    const fields: Record<string, string> = {};
    if (offsetMm === null) fields['offsetMm'] = 'Enter a whole number of millimetres.';
    if (centreMm === null) fields['centreHeightMm'] = 'Enter a whole number of millimetres.';
    if (Object.keys(fields).length > 0) {
      this.showSummary(summary, fields, { offsetMm: offsetInput, centreHeightMm: centreInput });
      return;
    }
    saveButton.classList.add('busy');
    const result = await api<{ placement: Placement; seq: number }>(
      'POST', '/api/placements',
      {
        objectId: object.id,
        wallId: wallSelect.value,
        offsetMm,
        centreHeightMm: centreMm,
        heightOverride: exceptionInput.checked,
      },
      { staffId: this.staffId }
    );
    saveButton.classList.remove('busy');
    if (isApiError(result)) {
      const body = errorBody(result);
      if (body.error.code === 'placement_rejected') {
        const target: Record<string, HTMLElement> = {
          off_wall: offsetInput,
          off_centre_line: centreInput,
          too_close: offsetInput,
          too_bright: wallSelect,
        };
        const reason = body.error.reason ?? 'off_wall';
        this.showSummary(summary, { [reason]: body.error.message }, { [reason]: target[reason]! });
        this.announce(body.error.message);
        return;
      }
      this.showSummary(summary, { form: body.error.message }, {});
      this.announce(body.error.message);
      return;
    }
    const placement = (result.body as { placement: Placement }).placement;
    this.markOwnSeq((result.body as { seq?: number }).seq);
    closeDialog();
    this.announce(`${placement.objectTitle} placed on ${placement.wallName}.`);
    await this.refreshWorkspace();
    this.selectedPlacementId = placement.id;
    this.rerender();
    this.focusHandle(placement.id);
    void this.pollEvents();
  }

  private showSummary(
    summary: HTMLElement,
    fields: Record<string, string>,
    targets: Record<string, HTMLElement>
  ): void {
    summary.innerHTML = '';
    summary.append(el('p', { text: 'Fix these to continue:' }));
    const list = el('ul', {});
    for (const [key, message] of Object.entries(fields)) {
      const link = el('a', { href: '#', text: message });
      link.addEventListener('click', (e) => {
        e.preventDefault();
        targets[key]?.focus();
      });
      list.append(el('li', {}, link));
    }
    summary.append(list);
    summary.removeAttribute('hidden');
    summary.focus();
  }

  private openPlacementDetails(p: Placement): void {
    const { parseLength } = { parseLength: null };
    void parseLength;
    const offsetInput = el('input', {
      type: 'text', 'aria-label': 'Offset from left end',
      value: formatLength(p.offsetMm, this.unit),
    }) as HTMLInputElement;
    const centreInput = el('input', {
      type: 'text', 'aria-label': 'Centre height',
      value: formatLength(p.centreHeightMm, this.unit),
    }) as HTMLInputElement;
    const exceptionInput = el('input', {
      type: 'checkbox', 'aria-label': 'Off the centre line (exception)',
    }) as HTMLInputElement;
    if (p.heightOverride) exceptionInput.setAttribute('checked', 'checked');
    const form = el('form', {});
    const makeField = (label: string, control: HTMLElement, suffix?: string): HTMLElement => {
      const field = el('div', { class: 'field' });
      const wrap = el('div', {});
      wrap.append(control);
      if (suffix !== undefined) wrap.append(el('span', { class: 'unit-suffix', text: suffix }));
      field.append(el('label', { text: label }), wrap);
      return field;
    };
    form.append(
      makeField('Offset from left end', offsetInput),
      makeField('Centre height', centreInput),
      makeField('Off the centre line (exception)', exceptionInput),
    );
    const save = el('button', { class: 'primary', type: 'submit', text: 'Save' });
    const actions = el('div', { class: 'dialog-actions' });
    actions.append(el('button', { type: 'button', text: 'Close', 'data-dialog-cancel': 'true' }), save);
    form.append(actions);
    this.openDialog('Placement details', (d) => {
      d.querySelector('.dialog-body')?.append(form);
      d.querySelector('[data-dialog-cancel]')?.addEventListener('click', () => d.close());
      offsetInput.focus();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const { parseLength: parse } = await import('./types.js');
        const offsetMm = parse(offsetInput.value, this.unit);
        const centreMm = parse(centreInput.value, this.unit);
        if (offsetMm === null || centreMm === null) {
          this.announce('Enter a whole number of millimetres.');
          return;
        }
        const result = await api<{ placement: Placement; undo: UndoInfo }>(
          'PATCH', `/api/placements/${p.id}`,
          { version: p.version, offsetMm, centreHeightMm: centreMm, heightOverride: exceptionInput.checked },
          { staffId: this.staffId }
        );
        if (isApiError(result)) {
          const body = errorBody(result);
          if (body.error.code === 'stale_version') {
            await this.refreshWorkspace();
            this.announce(`Someone else moved ${p.objectTitle}. Showing the latest position.`);
          } else {
            this.announce(body.error.message);
          }
        } else {
          const placement = (result.body as { placement: Placement }).placement;
          this.markOwnSeq((result.body as { seq?: number }).seq);
          this.announce(`${p.objectTitle} moved to ${formatLength(placement.offsetMm, this.unit)} from the left end.`);
        }
        d.close();
        this.focusHandle(p.id);
        void this.pollEvents();
      });
    }, () => this.focusHandle(p.id));
  }

  private openLuxDetails(p: Placement): void {
    const lines = [
      `Planned lux ${formatLux(p.plannedLux)} lux`,
      `Lux limit ${formatLux(p.luxLimit)} lux`,
      `Planned lux-hours ${formatLuxHours(p.plannedLuxHours)} lux-hours`,
      `Lux-hour budget ${formatLuxHours(p.luxHourBudget)} lux-hours`,
      `Status ${p.luxStatus === 'over' ? 'Over budget' : 'Within limit'}`,
    ];
    this.openDialog('Lux details', (d) => {
      const body = d.querySelector('.dialog-body')!;
      for (const line of lines) {
        body.append(el('p', { text: line }));
      }
      const close = el('button', { class: 'primary', text: 'Close', 'data-dialog-cancel': 'true' });
      close.addEventListener('click', () => d.close());
      body.append(close);
      close.focus();
    }, () => this.focusHandle(p.id));
  }

  private async schedulePreview(input: HTMLInputElement, button: HTMLButtonElement): Promise<void> {
    button.classList.add('busy');
    const result = await api<{ preview: Preview; seq: number }>(
      'POST', '/api/preview/schedule', { date: input.value }, { staffId: this.staffId }
    );
    button.classList.remove('busy');
    if (isApiError(result)) {
      const body = errorBody(result);
      const fields = body.error.fields ?? {};
      if (fields['date'] !== undefined) {
        this.announce(fields['date']);
        input.focus();
      } else {
        this.announce(body.error.message);
      }
      return;
    }
    const preview = (result.body as { preview: Preview }).preview;
    this.markOwnSeq((result.body as { seq?: number }).seq);
    this.preview = preview;
    this.announce(`Preview scheduled for ${preview.publishAtDisplay}.`);
    this.updateWorkspaceUrl();
    this.rerender();
    focusHeading(this.root, '.preview-heading');
    void this.pollEvents();
  }

  private async cancelPreview(button: HTMLButtonElement): Promise<void> {
    button.classList.add('busy');
    const result = await api<{ preview: Preview }>('POST', '/api/preview/cancel', undefined, { staffId: this.staffId });
    button.classList.remove('busy');
    if (isApiError(result)) return;
    this.markOwnSeq((result.body as { seq?: number }).seq);
    this.preview = (result.body as { preview: Preview }).preview;
    this.announce('Preview schedule cancelled.');
    this.updateWorkspaceUrl();
    this.rerender();
    focusHeading(this.root, '.preview-heading');
    void this.pollEvents();
  }

  private async withdrawPreview(button: HTMLButtonElement): Promise<void> {
    button.classList.add('busy');
    const result = await api<{ preview: Preview }>('POST', '/api/preview/withdraw', undefined, { staffId: this.staffId });
    button.classList.remove('busy');
    if (isApiError(result)) return;
    this.markOwnSeq((result.body as { seq?: number }).seq);
    this.preview = (result.body as { preview: Preview }).preview;
    this.announce('Preview withdrawn. Lender links no longer work.');
    this.updateWorkspaceUrl();
    this.rerender();
    focusHeading(this.root, '.preview-heading');
    void this.pollEvents();
  }

  private announce(message: string): void {
    this.announcementText = message;
    const region = this.root.querySelector('[data-region="announcements"]');
    if (region !== null) region.textContent = message;
  }
}

function previewStatusWord(preview: Preview | null): string {
  switch (preview?.status) {
    case 'scheduled': return 'Scheduled';
    case 'published': return 'Live';
    case 'withdrawn': return 'Withdrawn';
    default: return 'Draft';
  }
}

function teamSentence(e: EventEntry): string {
  const actor = e.actor?.name ?? 'Someone';
  switch (e.kind) {
    case 'placement.placed': return `${actor} placed ${e.title} on ${e.wallName}.`;
    case 'placement.moved': return `${actor} moved ${e.title} to ${e.offsetMm !== null ? `${(e.offsetMm / 10).toFixed(1)} cm` : ''} from the left end.`;
    case 'placement.removed': return `${actor} removed ${e.title} from ${e.wallName}.`;
    case 'placement.restored': return `${actor} put ${e.title} back on ${e.wallName}.`;
    case 'placement.claimed': return `${actor} claimed ${e.title}.`;
    case 'placement.released': return `${actor} released ${e.title}.`;
    case 'placement.hung': return `${actor} marked ${e.title} hung.`;
    case 'placement.signed_off': return `${actor} signed off ${e.title}.`;
    case 'object.created': return `${actor} added ${e.title} to the loan register.`;
    case 'object.updated': return `${actor} updated the record for ${e.title}.`;
    case 'photo.attached': return `${actor} attached a condition photo to ${e.title}.`;
    case 'wall.lux_changed': return `${actor} set ${e.wallName} lighting to ${e.plannedLux} lux.`;
    case 'preview.scheduled': return `${actor} scheduled the lender preview for ${e.publishAtDisplay}.`;
    case 'preview.cancelled': return `${actor} cancelled the lender preview schedule.`;
    case 'preview.published': return `Preview published. Lenders notified: ${e.recipientCount}.`;
    case 'preview.withdrawn': return `${actor} withdrew the lender preview.`;
    default: return '';
  }
}

export function mountWorkspace(root: HTMLElement): Workspace {
  const workspace = new Workspace(root);
  void workspace.start();
  return workspace;
}
