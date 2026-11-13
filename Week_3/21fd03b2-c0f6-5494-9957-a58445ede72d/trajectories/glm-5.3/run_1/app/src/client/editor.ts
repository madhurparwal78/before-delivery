import { api } from './api';
import { h, chip, focusTrap } from './ui';
import { setWorkspaceContext } from './chrome';
import { COPY, MATERIALS } from '../bench/copy';
import type { SceneDocument, SceneObject, ObjectKind } from '../bench/scene';
import type { Op } from '../bench/ops';
import { makeBody, runSteps, stepZeroState, stateHashInput, type Body } from '../bench/sim';
import { sha256Hex } from '../bench/hash';
import { StageRenderer } from './render';
import {
  type EditorRoute, type SceneData, type PresenceData, type AssetData,
  ensureMe, localApplyOps, stepStateFor, vis, round6,
} from './editor-util';
import { drawOutline, drawInspector, drawProps, renderReadouts } from './editor-panels';
import { drawAssets, openPublish, openShare } from './editor-assets';
import { loadMe, type Me } from './auth';

type PanelWithBody = { body: HTMLElement };

export class EditorState {
  route: EditorRoute;
  me: Me | null = null;
  doc: SceneDocument | null = null;
  scene: SceneData['scene'] | null = null;
  role: 'owner' | 'editor' | 'viewer' = 'editor';
  selected: string | null = null;
  leaseFence = new Map<string, number>();
  locks = new Map<string, { userId: string; displayName: string }>();
  people: PresenceData['people'] = [];
  mode: 'edit' | 'run' = 'edit';
  paused = false;
  tool: 'move' | 'rotate' | 'scale' = 'move';
  snap = false;
  grid = true;
  colliders = false;
  bodies: Body[] = [];
  stepCount = 0;
  runHash = '';
  preRunDoc: SceneDocument | null = null;
  undoStack: Array<() => void> = [];
  redoStack: Array<() => void> = [];
  saveQueue: Array<{ changeId: string; ops: Op[] }> = [];
  sending = false;
  baseRevision = 1;
  fieldText = new Map<string, string>();
  tab: string;
  conflictOpen = false;
  fieldErrorShown = false;
  saveStatusBeforeError: string = COPY.saveStatus.success;
  servicesDown = { locks: false, storage: false };
  frameTimes: number[] = [];
  sse: EventSource | null = null;
  rafHandle: number | null = null;
  cursorPos: [number, number, number] | null = null;
  renameOpenFor: string | null = null;

  stageHost!: HTMLElement;
  layoutRoot!: HTMLElement;
  bannerHost!: HTMLElement;
  telemetry!: HTMLElement;
  fpsLine!: HTMLElement;
  msLine!: HTMLElement;
  stepLine!: HTMLElement;
  hashLine!: HTMLElement;
  modePill!: HTMLElement;
  centreMark!: HTMLElement;
  cameraWidget!: HTMLElement;
  canvas: HTMLCanvasElement | null = null;
  statusSave!: HTMLElement;
  statusCollab!: HTMLElement;
  statusNotices!: HTMLElement;
  statusUpload!: HTMLElement;
  lockNotice!: HTMLElement;
  cursorLayer!: HTMLElement;
  renderer: StageRenderer | null = null;
  webgl = true;
  panels: Record<string, HTMLElement> = {};
  readoutsHost: HTMLElement | null = null;
  tbRun!: HTMLButtonElement;
  tbPause!: HTMLButtonElement;
  tbStep!: HTMLButtonElement;
  viewOnlyPill: HTMLElement | null = null;
  peopleHost: HTMLElement | null = null;
  pendingAssets = new Map<string, AssetData>();

  constructor(route: EditorRoute) {
    this.route = route;
    this.tab = `tab-${Math.random().toString(36).slice(2, 12).padEnd(8, '0').slice(0, 12)}`;
  }

  build(): HTMLElement {
    const shell = h('div', { class: 'app-root', style: { height: '100vh', overflow: 'hidden', position: 'relative' } });
    this.bannerHost = h('div', {});
    shell.append(this.bannerHost);
    this.stageHost = h('div', { class: 'stage-root' });
    shell.append(this.stageHost);
    this.layoutRoot = h('div', {});
    shell.append(this.layoutRoot);
    void this.init();
    return shell;
  }

  panelBody(title: string): HTMLElement {
    return (this.panels[title.toLowerCase()] as unknown as PanelWithBody).body;
  }

  setSaveStatus(text: string, isFieldError = false): void {
    if (isFieldError) {
      if (!this.fieldErrorShown) this.saveStatusBeforeError = this.statusSave.textContent ?? COPY.saveStatus.success;
      this.fieldErrorShown = true;
    }
    this.statusSave.textContent = text;
  }

  clearFieldErrorIfAny(): void {
    if (!this.fieldErrorShown) return;
    this.fieldErrorShown = false;
    this.statusSave.textContent = COPY.saveStatus.pending;
  }

  setNotice(text: string): void {
    this.statusNotices.textContent = text;
  }

  announceCollab(text: string): void {
    this.statusCollab.textContent = text;
  }

  async init(): Promise<void> {
    this.me = await ensureMe();
    if (!this.me) return;
    const result = await api('GET', `/api/scenes/${this.route.sid}`);
    if (!result.ok) {
      this.layoutRoot.append(h('h1', { style: { padding: '20px' } }, COPY.pages.notFound));
      return;
    }
    const data = result.body as SceneData;
    this.scene = data.scene;
    this.doc = data.document;
    this.baseRevision = data.scene.revision;
    const ws = await api('GET', `/api/workspaces/${data.workspaceId}`);
    if (ws.ok) {
      this.role = (ws.body as { workspace: { role: 'owner' | 'editor' | 'viewer' } }).workspace.role;
    }
    setWorkspaceContext(data.workspaceId);
    this.buildStage();
    this.buildPanels();
    this.applyRole();
    this.draw();
    this.runHash = await this.hashStep0();
    this.updateTelemetry();
    this.openLive();
    this.startPresence();
    this.watchStatus();
    this.bindShortcuts();
  }

  buildStage(): void {
    try {
      this.canvas = h('canvas', { class: 'stage-canvas', role: 'application', 'aria-label': 'Stage', tabindex: '0' }) as HTMLCanvasElement;
      this.renderer = new StageRenderer(this.canvas);
      this.stageHost.append(this.canvas);
      this.bindCamera();
    } catch {
      this.webgl = false;
      this.stageHost.append(h('div', { role: 'application', 'aria-label': 'Stage', tabindex: '0', style: { position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink)', padding: '0 15%', textAlign: 'center' } }, COPY.pages.noWebgl));
    }
    this.telemetry = h('div', { class: 'telemetry-card', role: 'group', 'aria-label': 'Run telemetry' });
    this.fpsLine = h('div', { class: 'fps-go', style: { fontWeight: '700' } }, 'fps 0');
    this.msLine = h('div', {}, 'ms 0.0');
    this.stepLine = h('div', {}, 'step 0');
    this.hashLine = h('div', {}, 'hash 0');
    this.telemetry.append(this.fpsLine, this.msLine, this.stepLine, this.hashLine,
      h('button', { class: 'glyph-btn expander', 'aria-label': 'More telemetry', onclick: () => {
        this.hashLine.textContent = `hash ${this.runHash}`;
      } }, '+'));
    this.stageHost.append(this.telemetry);
    this.modePill = h('div', { class: 'mode-pill', role: 'status', 'aria-label': 'Mode', style: { display: 'none' } }, 'RUNNING');
    this.stageHost.append(this.modePill);
    this.centreMark = h('div', { class: 'centre-mark', role: 'img', 'aria-label': 'Centre mark', style: { display: 'none' } });
    this.stageHost.append(this.centreMark);
    this.cameraWidget = h('div', { class: 'camera-widget', role: 'group', 'aria-label': 'Camera view' });
    const grid = h('div', { class: 'camera-grid' });
    const views: Array<[string, string]> = [
      ['Top', 'stripe-y'], ['Bottom', 'stripe-y'], ['Front', 'stripe-z'],
      ['Back', 'stripe-z'], ['Right', 'stripe-x'], ['Left', 'stripe-x'],
    ];
    for (const [name, stripe] of views) {
      grid.append(h('button', { class: `cam-btn ${stripe}`, onclick: () => this.renderer?.setView(name.toLowerCase() as never) }, name));
    }
    this.cameraWidget.append(grid, h('button', { class: 'cam-btn cam-iso', onclick: () => this.renderer?.setView('iso') }, 'Iso'));
    this.stageHost.append(this.cameraWidget);
    this.cursorLayer = h('div', { style: { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' } });
    this.stageHost.append(this.cursorLayer);
    this.statusSave = h('div', { role: 'status', 'aria-label': 'Save status', 'aria-live': 'polite', style: vis() }, COPY.saveStatus.success);
    this.statusCollab = h('div', { role: 'status', 'aria-label': 'Collaboration', 'aria-live': 'polite', style: vis() });
    this.statusNotices = h('div', { role: 'status', 'aria-label': 'Notices', 'aria-live': 'polite', style: vis() });
    this.statusUpload = h('div', { role: 'status', 'aria-label': 'Upload status', 'aria-live': 'polite', style: vis() });
    this.lockNotice = h('div', { role: 'status', 'aria-label': 'Lock notice', 'aria-live': 'polite', style: vis() });
    this.stageHost.append(this.statusSave, this.statusCollab, this.statusNotices, this.statusUpload, this.lockNotice);
  }

  buildPanels(): void {
    const { root, runBtn, pauseBtn, stepBtn } = this.buildToolbar();
    this.tbRun = runBtn;
    this.tbPause = pauseBtn;
    this.tbStep = stepBtn;
    this.layoutRoot.append(root);

    const floating = h('div', { class: 'editor-floating' });
    const docked = h('div', { class: 'editor-docked' });
    const phone = h('div', { class: 'editor-phone' });
    this.panels = {
      outline: this.makePanel('Outline', 'panel-outline'),
      inspector: this.makePanel('Inspector', 'panel-inspector'),
      props: this.makePanel('Props', 'panel-props'),
      assets: this.makePanel('Assets', 'panel-assets'),
    };
    floating.append(this.panels.outline!, this.panels.props!, this.panels.inspector!, this.panels.assets!);
    docked.append(this.panels.outline!, this.panels.inspector!, this.panels.props!, this.panels.assets!);
    const tabs = h('div', { class: 'phone-tabs', role: 'tablist', 'aria-label': 'Panels' });
    const sheet = h('div', { class: 'phone-sheet' });
    const tabDefs: Array<[string, string]> = [['Outline', 'outline'], ['Inspector', 'inspector'], ['Props', 'props'], ['Assets', 'assets']];
    for (const [name, id] of tabDefs) {
      const tab = h('button', { role: 'tab', 'aria-selected': String(id === 'outline'), onclick: () => {
        tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', 'false'));
        tab.setAttribute('aria-selected', 'true');
        sheet.replaceChildren(this.panels[id]!);
      } }, name);
      tabs.append(tab);
    }
    phone.append(tabs, sheet);
    this.layoutRoot.append(floating, docked, phone);
    this.applyLayout();
    window.addEventListener('resize', () => this.applyLayout());
    drawOutline(this);
    drawInspector(this);
    drawProps(this);
    drawAssets(this);
  }

  buildToolbar() {
    const bar = h('div', { class: 'bench-toolbar', role: 'toolbar', 'aria-label': 'Bench tools', style: { position: 'absolute', top: '0', left: '0', right: '0', zIndex: '30' } });
    const runBtn = chip(this.mode === 'run' ? 'Stop' : 'Run', { onClick: () => void this.run() });
    const pauseBtn = chip('Pause', { disabled: true, onClick: () => this.pause() });
    const stepBtn = chip('Step', { disabled: true, onClick: () => this.stepOnce() });
    bar.append(runBtn, pauseBtn, stepBtn);
    bar.append(h('span', { class: 'tb-divider' }));
    for (const tool of ['move', 'rotate', 'scale'] as const) {
      bar.append(chip(tool.charAt(0).toUpperCase() + tool.slice(1), { pressed: tool === this.tool, onClick: () => this.setTool(tool) }));
    }
    bar.append(h('span', { class: 'tb-divider' }));
    bar.append(chip('Snap', { pressed: false, onClick: () => { this.snap = !this.snap; (bar.children[7] as HTMLElement).setAttribute('aria-pressed', String(this.snap)); } }));
    bar.append(chip('Grid', { pressed: true, onClick: () => { this.grid = !this.grid; (bar.children[8] as HTMLElement).setAttribute('aria-pressed', String(this.grid)); this.draw(); } }));
    bar.append(chip('Colliders', { pressed: false, onClick: () => { this.colliders = !this.colliders; (bar.children[9] as HTMLElement).setAttribute('aria-pressed', String(this.colliders)); } }));
    bar.append(h('span', { class: 'tb-divider' }));
    const labsLink = h('a', { href: `/w/${this.route.wid}/p/${this.scene?.projectId ?? ''}`, class: 'chip publish-chip', role: 'link', 'aria-label': 'Labs', style: { textDecoration: 'none' } }, 'Labs');
    const assetsBtn = chip('Assets', { extraClass: 'publish-chip', onClick: () => {
      const panel = this.panels.assets!;
      panel.style.display = panel.style.display === 'none' ? '' : 'none';
    } });
    const shareBtn = chip('Share', { extraClass: 'publish-chip', disabled: this.role !== 'owner', title: this.role !== 'owner' ? 'Only the workspace owner can share or publish.' : undefined, onClick: () => openShare(this) });
    const publishBtn = chip('Publish', { extraClass: 'publish-chip', disabled: this.role !== 'owner', title: this.role !== 'owner' ? 'Only the workspace owner can share or publish.' : undefined, onClick: () => openPublish(this) });
    const windowsBtn = chip('Windows', { onClick: () => this.openWindowsMenu(bar) });
    const shortcutsBtn = chip('Shortcuts', { onClick: () => this.openShortcuts() });
    bar.append(labsLink, assetsBtn, shareBtn, publishBtn, windowsBtn, shortcutsBtn);
    bar.append(h('span', { class: 'tb-divider' }));
    const peopleList = h('ul', { role: 'list', 'aria-label': 'People here', style: { display: 'flex', gap: '6px', listStyle: 'none', margin: '0', padding: '0' } });
    this.peopleHost = peopleList;
    bar.append(peopleList);
    if (this.me) {
      const pill = h('span', { class: 'account-pill' });
      pill.append(h('span', { class: 'avatar-disc', 'aria-hidden': 'true' }, this.me.user.displayName.slice(0, 1).toUpperCase()));
      pill.append(h('span', { style: { fontWeight: '700' } }, this.me.user.displayName));
      bar.append(pill);
      bar.append(h('button', { class: 'chip', onclick: () => { void api('POST', '/api/auth/sign-out', {}).then(() => { location.href = '/sign-in'; }); } }, 'Sign out'));
    }
    const viewOnlyPill = h('span', { role: 'status', 'aria-label': 'View only', class: 'chip', style: { pointerEvents: 'none' } }, 'View only');
    if (this.role !== 'viewer') viewOnlyPill.style.display = 'none';
    this.viewOnlyPill = viewOnlyPill;
    bar.append(viewOnlyPill);
    bar.append(h('span', { class: 'tb-spacer' }));
    bar.append(h('span', { class: 'wordmark', 'aria-hidden': 'true' }, 'Rampwright'));
    return { root: bar, runBtn, pauseBtn, stepBtn };
  }

  makePanel(title: string, extraClass: string): HTMLElement {
    const panel = h('div', { class: `dock-panel ${extraClass}`, role: 'region', 'aria-label': title });
    const head = h('div', { class: 'dock-panel-head' });
    head.append(h('span', { class: 'panel-title' }, title));
    head.append(h('button', { class: 'glyph-btn', 'aria-label': `Maximise ${title}`, onclick: () => {
      if (panel.style.width === '70%') { panel.style.width = ''; panel.style.height = ''; }
      else { panel.style.width = '70%'; panel.style.height = '70%'; }
    } }, '⤢'));
    head.append(h('button', { class: 'glyph-btn', 'aria-label': `Close ${title}`, onclick: () => { panel.style.display = 'none'; } }, '✕'));
    const body = h('div', { class: 'dock-panel-body' });
    panel.append(head, body);
    (panel as unknown as PanelWithBody).body = body;
    return panel;
  }

  applyLayout(): void {
    const width = window.innerWidth;
    const floating = this.layoutRoot.querySelector('.editor-floating') as HTMLElement | null;
    const docked = this.layoutRoot.querySelector('.editor-docked') as HTMLElement | null;
    const phone = this.layoutRoot.querySelector('.editor-phone') as HTMLElement | null;
    const sheet = phone?.querySelector('.phone-sheet') as HTMLElement | null;
    if (!floating || !docked || !phone || !sheet) return;
    const panelList = [this.panels.outline!, this.panels.inspector!, this.panels.props!, this.panels.assets!];
    if (width >= 1000) {
      for (const panel of panelList) { panel.style.position = ''; panel.style.width = ''; panel.style.maxHeight = ''; floating.append(panel); }
      floating.style.display = 'block';
      docked.style.display = 'none';
      phone.style.display = 'none';
    } else if (width >= 600) {
      for (const panel of panelList) { panel.style.position = ''; panel.style.width = ''; panel.style.maxHeight = ''; docked.append(panel); }
      floating.style.display = 'none';
      docked.style.display = 'flex';
      phone.style.display = 'none';
    } else {
      for (const panel of panelList) { panel.style.position = ''; panel.style.width = ''; panel.style.maxHeight = ''; sheet.append(panel); }
      const tabs = phone.querySelectorAll('[role="tab"]');
      let anySelected = false;
      tabs.forEach((t) => { if (t.getAttribute('aria-selected') === 'true') anySelected = true; });
      if (!anySelected && tabs.length > 0) tabs[0]!.setAttribute('aria-selected', 'true');
      const selected = [...tabs].find((t) => t.getAttribute('aria-selected') === 'true');
      if (selected) {
        const idx = [...tabs].indexOf(selected);
        sheet.replaceChildren(panelList[idx] ?? panelList[0]!);
      }
      floating.style.display = 'none';
      docked.style.display = 'none';
      phone.style.display = 'flex';
    }
  }

  applyRole(): void {
    const isViewer = this.role === 'viewer';
    if (this.viewOnlyPill) this.viewOnlyPill.style.display = isViewer ? '' : 'none';
    this.tbRun.disabled = !this.webgl;
    this.tbPause.disabled = !this.webgl || this.mode !== 'run';
    this.tbStep.disabled = !this.webgl || this.mode !== 'run';
    drawOutline(this);
    drawInspector(this);
    drawProps(this);
    this.drawPeople();
  }

  draw(): void {
    if (!this.renderer || !this.doc) return;
    this.renderer.draw(this.doc, this.grid, null);
  }

  async selectObject(objectId: string): Promise<void> {
    const treeHadFocus = document.activeElement !== null
      && document.activeElement.closest?.('[role="tree"][aria-label="Scene outline"]') !== null;
    const previous = this.selected;
    this.selected = objectId;
    drawOutline(this);
    drawInspector(this);
    renderReadouts(this);
    if (treeHadFocus) {
      const body = (this.panels.outline as unknown as { body: HTMLElement }).body;
      body.querySelector<HTMLElement>('[role="tree"]')?.focus();
    }
    if (this.role === 'viewer') return;
    if (this.mode === 'run') return;
    if (previous !== null && previous !== objectId && this.leaseFence.has(previous)) {
      this.leaseFence.delete(previous);
      void api('DELETE', `/api/scenes/${this.route.sid}/locks/${previous}?tab=${this.tab}`);
    }
    await this.requestLease(objectId);
  }

  async requestLease(objectId: string): Promise<void> {
    const result = await api('POST', `/api/scenes/${this.route.sid}/locks/${objectId}`, { tab: this.tab });
    if (!result.ok) {
      if (result.error.status === 503) {
        this.servicesDown.locks = true;
        this.updateBanners();
        return;
      }
      if (result.error.code === 'lock_held') {
        const holder = (result.error.details as { holder?: { displayName: string } } | undefined)?.holder;
        const name = holder?.displayName ?? 'Another editor';
        const object = this.doc?.objects.find((o) => o.id === objectId);
        this.lockNotice.textContent = COPY.lockNotice(name, object?.name ?? objectId);
        drawInspector(this);
        return;
      }
      return;
    }
    const lock = (result.body as { lock: { fence: number; holder: { displayName: string } } }).lock;
    this.leaseFence.set(objectId, lock.fence);
    this.lockNotice.textContent = '';
  }

  place(kind: ObjectKind): void {
    if (this.mode === 'run' || this.role === 'viewer' || !this.doc) return;
    const prefixes: Record<string, string> = { ramp: 'Ramp', pendulum: 'Pendulum', launcher: 'Launcher', crate: 'Crate' };
    const names = this.doc.objects.map((o) => o.name);
    let n = 1;
    while (names.includes(`${prefixes[kind]} ${n}`)) n++;
    const object = {
      id: `${kind}-${Math.random().toString(36).slice(2, 10)}`,
      kind, name: `${prefixes[kind]} ${n}`,
      params: defaultParams(kind),
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0, 1] as [number, number, number, number],
      scale: [1, 1, 1] as [number, number, number],
      assetId: null,
    };
    void this.applyChange([{ op: 'add', object }]);
    this.selected = object.id;
  }

  placeModel(asset: AssetData): void {
    if (this.mode === 'run' || this.role === 'viewer' || !this.doc) return;
    const name = asset.name.replace(/\.[^.]+$/, '');
    const object = {
      id: `model-${Math.random().toString(36).slice(2, 10)}`,
      kind: 'model' as const, name,
      params: {} as Record<string, number>,
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0, 1] as [number, number, number, number],
      scale: [1, 1, 1] as [number, number, number],
      assetId: asset.id,
    };
    const scale = asset.scaleToMetres ?? 1;
    object.scale = [scale, scale, scale];
    void this.applyChange([{ op: 'add', object }]);
    this.selected = object.id;
  }

  async uploadAsset(file: File, unit: string): Promise<void> {
    if (!this.scene) return;
    this.statusUpload.textContent = COPY.upload.pending(file.name);
    const buffer = await file.arrayBuffer();
    const result = await api('POST', `/api/projects/${this.scene.projectId}/assets?name=${encodeURIComponent(file.name)}&unit=${encodeURIComponent(unit)}`, buffer, { raw: true });
    if (!result.ok) {
      this.statusUpload.textContent = result.error.status === 503
        ? COPY.upload.outage
        : result.error.fields?.file ?? result.error.fields?.name ?? result.error.fields?.unit ?? result.error.message;
      return;
    }
    const body = result.body as { asset: AssetData };
    const folderName = body.asset.kind === 'png' || body.asset.kind === 'jpeg' ? 'Images' : 'Models';
    this.statusUpload.textContent = result.status === 200
      ? COPY.upload.replay(file.name)
      : COPY.upload.success(file.name, folderName);
    drawAssets(this);
    drawProps(this);
  }

  async applyChange(ops: Op[]): Promise<void> {
    if (!this.doc || this.role === 'viewer' || this.conflictOpen) return;
    const before = structuredClone(this.doc);
    const fenceFor = (objectId: string): number => this.leaseFence.get(objectId) ?? 0;
    const undoEntry = (): void => {
      this.doc = structuredClone(before);
      const inverse = diffOps(before, localApplyOps(before, ops), fenceFor);
      if (inverse.length > 0) this.saveQueue.push({ changeId: crypto.randomUUID(), ops: inverse });
      drawOutline(this);
      drawInspector(this);
      renderReadouts(this);
      this.draw();
      void this.flushQueue();
    };
    this.undoStack.push(undoEntry);
    this.redoStack = [];
    this.doc = localApplyOps(this.doc, ops);
    drawOutline(this);
    drawInspector(this);
    renderReadouts(this);
    this.draw();
    this.queueOps(ops, true);
  }

  queueOps(ops: Op[], announce: boolean): void {
    if (ops.length === 0) return;
    this.saveQueue.push({ changeId: crypto.randomUUID(), ops });
    if (announce) this.setSaveStatus(COPY.saveStatus.pending);
    void this.flushQueue();
  }

  async flushQueue(): Promise<void> {
    if (this.sending || this.conflictOpen) return;
    while (this.saveQueue.length > 0) {
      const change = this.saveQueue[0]!;
      this.sending = true;
      const result = await api('PATCH', `/api/scenes/${this.route.sid}`, {
        baseRevision: this.baseRevision,
        changeId: change.changeId,
        ops: change.ops,
      });
      this.sending = false;
      if (result.ok) {
        const body = result.body as { revision: number; stateHash: string };
        this.baseRevision = body.revision;
        this.saveQueue.shift();
        if (!this.fieldErrorShown) this.setSaveStatus(COPY.saveStatus.success);
        this.runHash = await this.hashStep0();
        this.updateTelemetry();
        continue;
      }
      const err = result.error;
      if (err.status === 412) {
        this.saveQueue.shift();
        this.openConflictDialog();
        this.setSaveStatus(COPY.saveStatus.revisionConflict);
        return;
      }
      if (err.status === 409 && err.code === 'stale_lock') {
        this.saveQueue.shift();
        const objectId = (err.details as { objectId?: string } | undefined)?.objectId ?? '';
        const name = this.doc?.objects.find((o) => o.id === objectId)?.name ?? objectId;
        this.setSaveStatus(COPY.saveStatus.leaseLost(name));
        await this.requestLease(objectId);
        continue;
      }
      if (err.status === 503) {
        this.setSaveStatus(err.code === 'lock_store_unavailable' ? COPY.saveStatus.lockOutage : COPY.saveStatus.offline);
        await sleep(500);
        continue;
      }
      if (err.status === 403) {
        this.saveQueue.shift();
        this.setSaveStatus(COPY.saveStatus.demoted);
        this.role = 'viewer';
        this.applyRole();
        return;
      }
      if (err.status === 422) {
        this.saveQueue.shift();
        this.setSaveStatus(COPY.saveStatus.fieldError, true);
        return;
      }
      if (err.status === 0 || err.status >= 500) {
        this.setSaveStatus(COPY.saveStatus.offline);
        await sleep(1000);
        continue;
      }
      this.saveQueue.shift();
    }
  }

  openConflictDialog(): void {
    if (this.conflictOpen) return;
    this.conflictOpen = true;
    const backdrop = h('div', { class: 'dialog-backdrop' });
    const dialog = h('div', { class: 'dialog', role: 'alertdialog', 'aria-label': 'Scene changed elsewhere' },
      h('h2', {}, 'Scene changed elsewhere'),
      h('p', {}, 'This scene changed in another editor. Choose which version to keep.'),
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'chip', onclick: async () => {
          const pending = this.saveQueue.splice(0);
          await this.reloadDocument();
          this.conflictOpen = false;
          for (const change of pending) this.saveQueue.push(change);
          void this.flushQueue();
          backdrop.remove();
        } }, 'Keep my changes'),
        h('button', { class: 'chip', onclick: async () => {
          this.saveQueue.splice(0);
          await this.reloadDocument();
          this.conflictOpen = false;
          this.setSaveStatus(COPY.saveStatus.success);
          backdrop.remove();
        } }, 'Use their version'),
      ),
    );
    backdrop.append(dialog);
    document.body.append(backdrop);
    focusTrap(dialog, () => { /* stays until a choice */ });
    (dialog.querySelector('button') as HTMLButtonElement).focus();
  }

  async reloadDocument(): Promise<void> {
    const result = await api('GET', `/api/scenes/${this.route.sid}`);
    if (!result.ok) return;
    const data = result.body as SceneData;
    this.doc = data.document;
    this.scene = data.scene;
    this.baseRevision = data.scene.revision;
    this.runHash = await this.hashStep0();
    drawOutline(this);
    drawInspector(this);
    renderReadouts(this);
    this.draw();
    this.updateTelemetry();
  }

  openLive(): void {
    const sse = new EventSource(`/api/scenes/${this.route.sid}/live?tab=${this.tab}`);
    this.sse = sse;
    sse.addEventListener('revision', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { revision: number; stateHash: string };
      if (data.revision === this.baseRevision) return;
      if (this.saveQueue.length > 0 || this.sending) {
        this.baseRevision = data.revision;
        return;
      }
      void this.reloadDocument();
    });
    sse.addEventListener('presence', (e) => {
      this.applyPresence(JSON.parse((e as MessageEvent).data) as PresenceData);
    });
    sse.addEventListener('role', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { role: 'owner' | 'editor' | 'viewer' };
      const before = this.role;
      this.role = data.role;
      if (before !== data.role) {
        this.applyRole();
        this.announceCollab(COPY.collaboration.roleNow(this.me?.user.displayName ?? '', data.role === 'editor' ? 'Editor' : 'Viewer'));
        if (data.role === 'viewer') this.setSaveStatus(COPY.saveStatus.demoted);
      }
    });
    sse.addEventListener('status', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { locks: string; storage: string };
      this.servicesDown.locks = data.locks === 'down';
      this.servicesDown.storage = data.storage === 'down';
      this.updateBanners();
    });
  }

  applyPresence(data: PresenceData): void {
    const beforeIds = new Set(this.people.map((p) => p.userId));
    const afterIds = new Set(data.people.map((p) => p.userId));
    for (const person of data.people) {
      if (!beforeIds.has(person.userId)) this.announceCollab(COPY.collaboration.joined(person.displayName));
    }
    for (const person of this.people) {
      if (!afterIds.has(person.userId)) this.announceCollab(COPY.collaboration.left(person.displayName));
    }
    const oldLocks = new Map(this.locks);
    this.locks = new Map(data.locks.map((l) => [l.objectId, l.holder]));
    for (const [objectId, holder] of this.locks) {
      if (!oldLocks.has(objectId) && holder.userId !== this.me?.user.id) {
        const object = this.doc?.objects.find((o) => o.id === objectId);
        if (object) this.announceCollab(COPY.collaboration.nowEditing(holder.displayName, object.name));
      }
    }
    for (const [objectId, holder] of oldLocks) {
      if (!this.locks.has(objectId)) {
        const object = this.doc?.objects.find((o) => o.id === objectId);
        if (object && holder.userId !== this.me?.user.id) this.announceCollab(COPY.collaboration.free(object.name));
      }
    }
    this.people = data.people;
    this.drawCursors();
    this.drawPeople();
    drawOutline(this);
    if (this.selected) {
      const holder = this.locks.get(this.selected);
      if (holder && holder.userId !== this.me?.user.id) {
        const object = this.doc?.objects.find((o) => o.id === this.selected);
        this.lockNotice.textContent = COPY.lockNotice(holder.displayName, object?.name ?? this.selected);
        drawInspector(this);
      } else if (!holder && this.lockNotice.textContent !== '' && this.role !== 'viewer' && this.mode !== 'run') {
        this.lockNotice.textContent = '';
        drawInspector(this);
        void this.requestLease(this.selected);
      }
    }
  }

  drawPeople(): void {
    if (!this.peopleHost) return;
    this.peopleHost.replaceChildren();
    for (const person of this.people) {
      const li = h('li', { style: { whiteSpace: 'nowrap' } }, person.displayName);
      this.peopleHost.append(li);
    }
  }

  drawCursors(): void {
    if (!this.cursorLayer) return;
    this.cursorLayer.replaceChildren();
    const rect = this.stageHost.getBoundingClientRect();
    for (const person of this.people) {
      if (person.userId === this.me?.user.id || !person.cursor) continue;
      const x = rect.width / 2 + person.cursor[0] * 20;
      const y = rect.height / 2 - person.cursor[2] * 20;
      if (x < 0 || x > rect.width || y < 0 || y > rect.height) continue;
      const tag = h('div', { class: 'cursor-tag', role: 'img', 'aria-label': `Cursor: ${person.displayName}`, style: { left: `${x}px`, top: `${y}px` } });
      tag.append(h('div', { class: 'cursor-dot' }), h('span', { class: 'cursor-name' }, person.displayName));
      this.cursorLayer.append(tag);
    }
  }

  startPresence(): void {
    const send = (): Promise<void> => api('PUT', `/api/scenes/${this.route.sid}/presence`, {
      tab: this.tab,
      cursor: this.cursorPos,
      selected: this.selected,
    }).then(() => undefined);
    void send();
    window.setInterval(() => void send(), 2000);
    // renew held leases every third of the TTL while selected
    window.setInterval(() => {
      if (this.role === 'viewer' || this.mode === 'run') return;
      for (const objectId of this.leaseFence.keys()) {
        if (objectId !== this.selected) continue;
        void api('POST', `/api/scenes/${this.route.sid}/locks/${objectId}`, { tab: this.tab });
      }
    }, 10000);
    window.addEventListener('beforeunload', () => {
      void api('DELETE', `/api/scenes/${this.route.sid}/presence?tab=${this.tab}`);
      this.sse?.close();
    });
  }

  watchStatus(): void {
    window.setInterval(async () => {
      const result = await api('GET', '/api/status');
      if (result.ok) {
        const data = result.body as { locks: string; storage: string };
        const locksDown = data.locks === 'down';
        const storageDown = data.storage === 'down';
        if (locksDown !== this.servicesDown.locks || storageDown !== this.servicesDown.storage) {
          this.servicesDown.locks = locksDown;
          this.servicesDown.storage = storageDown;
          this.updateBanners();
        }
      }
    }, 5000);
  }

  updateBanners(): void {
    this.bannerHost.replaceChildren();
    if (this.servicesDown.locks) {
      this.bannerHost.append(h('div', { class: 'banner-alert', role: 'alert' }, COPY.banners.lockOutage));
      if (this.peopleHost) {
        this.peopleHost.replaceChildren(h('li', { class: 'empty-state', style: { padding: '0' } }, COPY.empty.presence));
      }
    }
    if (this.servicesDown.storage) {
      this.bannerHost.append(h('div', { class: 'banner-alert', role: 'alert' }, COPY.banners.storageOutage));
    }
  }

  bindCamera(): void {
    if (!this.canvas) return;
    const canvas = this.canvas;
    let dragging = false;
    let panning = false;
    let lastX = 0;
    let lastY = 0;
    let moved = 0;
    let pinchStart = 0;
    // drag-and-drop prop placement (DP-14)
    canvas.addEventListener('dragover', (e) => e.preventDefault());
    canvas.addEventListener('drop', (e) => {
      e.preventDefault();
      const payload = (e as DragEvent).dataTransfer?.getData('text/plain') ?? '';
      if (!payload) return;
      const rect = canvas.getBoundingClientRect();
      let worldX = round6((e.clientX - rect.left - rect.width / 2) / 20);
      let worldZ = round6((rect.height / 2 - (e.clientY - rect.top)) / 20);
      if (this.snap) {
        worldX = round6(Math.round(worldX / 0.25) * 0.25);
        worldZ = round6(Math.round(worldZ / 0.25) * 0.25);
      }
      if (payload.startsWith('kind:')) {
        const kind = payload.slice(5) as ObjectKind;
        const prefixes: Record<string, string> = { ramp: 'Ramp', pendulum: 'Pendulum', launcher: 'Launcher', crate: 'Crate' };
        const names = (this.doc?.objects ?? []).map((o) => o.name);
        let n = 1;
        while (names.includes(`${prefixes[kind]} ${n}`)) n++;
        const object = {
          id: `${kind}-${Math.random().toString(36).slice(2, 12)}`,
          kind,
          name: `${prefixes[kind]} ${n}`,
          params: defaultParams(kind),
          position: [worldX, 0, worldZ] as [number, number, number],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [1, 1, 1] as [number, number, number],
          assetId: null,
        };
        void this.applyChange([{ op: 'add', object }]);
        this.selected = object.id;
        return;
      }
      const asset = this.pendingAssets.get(payload);
      if (!asset) return;
      const object = {
        id: `model-${Math.random().toString(36).slice(2, 12)}`,
        kind: 'model' as const,
        name: asset.name.replace(/\.[^.]+$/, ''),
        params: {} as Record<string, number>,
        position: [worldX, 0, worldZ] as [number, number, number],
        rotation: [0, 0, 0, 1] as [number, number, number, number],
        scale: [1, 1, 1] as [number, number, number],
        assetId: asset.id,
      };
      const scale = asset.scaleToMetres ?? 1;
      object.scale = [scale, scale, scale];
      void this.applyChange([{ op: 'add', object }]);
      this.selected = object.id;
    });
    // rig tiles drag onto the stage: handled by the tile's own dragstart marker
    canvas.addEventListener('pointerdown', (e) => {
      if (this.mode === 'run') return;
      dragging = e.button !== 2;
      panning = e.button === 2;
      lastX = e.clientX;
      lastY = e.clientY;
      moved = 0;
      canvas.setPointerCapture(e.pointerId);
      canvas.focus();
    });
    canvas.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect();
      this.cursorPos = [
        (e.clientX - rect.left - rect.width / 2) / 20,
        0,
        (rect.height / 2 - (e.clientY - rect.top)) / 20,
      ];
      if (dragging && this.renderer) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        moved += Math.abs(dx) + Math.abs(dy);
        this.renderer.camera.yaw -= dx * 0.01;
        this.renderer.camera.pitch = Math.max(-1.5, Math.min(1.5, this.renderer.camera.pitch + dy * 0.01));
        lastX = e.clientX;
        lastY = e.clientY;
        this.draw();
      } else if (panning && this.renderer) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        moved += Math.abs(dx) + Math.abs(dy);
        this.renderer.camera.target[0] -= dx * 0.02;
        this.renderer.camera.target[1] += dy * 0.02;
        lastX = e.clientX;
        lastY = e.clientY;
        this.draw();
      }
    });
    canvas.addEventListener('pointerup', (e) => {
      dragging = false;
      panning = false;
      if (moved < 4 && this.doc) {
        // click on stage: pick nearest object by x distance, else clear selection
        const rect = canvas.getBoundingClientRect();
        const worldX = (e.clientX - rect.left - rect.width / 2) / 20;
        let hit: SceneObject | null = null;
        for (const object of this.doc.objects) {
          if (Math.abs(object.position[0] - worldX) < 0.8) { hit = object; break; }
        }
        if (hit) void this.selectObject(hit.id);
        else { this.selected = null; drawOutline(this); drawInspector(this); }
      }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.renderer) {
        this.renderer.camera.distance = Math.max(3, Math.min(60, this.renderer.camera.distance + e.deltaY * 0.01));
        this.draw();
      }
    }, { passive: false });
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        pinchStart = Math.hypot(e.touches[0]!.clientX - e.touches[1]!.clientX, e.touches[0]!.clientY - e.touches[1]!.clientY);
      }
    });
    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && pinchStart > 0 && this.renderer) {
        const dist = Math.hypot(e.touches[0]!.clientX - e.touches[1]!.clientX, e.touches[0]!.clientY - e.touches[1]!.clientY);
        this.renderer.camera.distance = Math.max(3, Math.min(60, this.renderer.camera.distance * (pinchStart / Math.max(1, dist))));
        pinchStart = dist;
        this.draw();
      }
    }, { passive: true });
  }

  // ---------- run ----------

  async run(): Promise<void> {
    if (!this.doc || !this.webgl) return;
    if (this.mode === 'run') {
      await this.stop();
      return;
    }
    this.preRunDoc = structuredClone(this.doc);
    this.mode = 'run';
    this.paused = false;
    this.stepCount = 0;
    this.bodies = this.doc.objects.map((o) => makeBody(o));
    this.tbRun.textContent = 'Stop';
    this.tbRun.classList.add('go');
    this.tbRun.setAttribute('aria-pressed', 'true');
    this.tbPause.disabled = false;
    this.tbStep.disabled = false;
    this.tbPause.textContent = 'Pause';
    this.modePill.style.display = 'block';
    this.modePill.textContent = 'RUNNING';
    this.centreMark.style.display = 'block';
    for (const panel of Object.values(this.panels)) panel.style.visibility = 'hidden';
    this.cameraWidget.style.display = 'none';
    this.drawRunBodies();
    const tick = (): void => {
      if (this.mode !== 'run') return;
      const start = performance.now();
      if (!this.paused) {
        const steps = 2;
        runSteps(this.bodies, steps);
        this.stepCount += steps;
      }
      this.frameTimes.push(performance.now() - start);
      if (this.frameTimes.length > 60) this.frameTimes.shift();
      this.drawRunBodies();
      this.updateTelemetry();
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  async stop(): Promise<void> {
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
    this.mode = 'edit';
    this.paused = false;
    if (this.preRunDoc) this.doc = structuredClone(this.preRunDoc);
    this.bodies = [];
    this.stepCount = 0;
    this.tbRun.textContent = 'Run';
    this.tbRun.classList.remove('go');
    this.tbRun.setAttribute('aria-pressed', 'false');
    this.tbPause.disabled = true;
    this.tbStep.disabled = true;
    this.modePill.style.display = 'none';
    this.centreMark.style.display = 'none';
    for (const panel of Object.values(this.panels)) panel.style.visibility = 'visible';
    this.cameraWidget.style.display = 'block';
    this.runHash = await this.hashStep0();
    this.draw();
    this.updateTelemetry();
  }

  pause(): void {
    if (this.mode !== 'run') return;
    this.paused = !this.paused;
    this.modePill.textContent = this.paused ? 'PAUSED' : 'RUNNING';
    this.tbPause.textContent = this.paused ? 'Resume' : 'Pause';
    if (this.paused) {
      void this.computeHashAt(this.stepCount);
      this.updateTelemetry();
    }
  }

  stepOnce(): void {
    if (this.mode !== 'run') return;
    if (!this.paused) {
      this.paused = true;
      this.modePill.textContent = 'PAUSED';
      this.tbPause.textContent = 'Resume';
    }
    runSteps(this.bodies, 1);
    this.stepCount += 1;
    void this.computeHashAt(this.stepCount);
    this.drawRunBodies();
    this.updateTelemetry();
  }

  drawRunBodies(): void {
    if (!this.renderer || !this.doc) return;
    const doc: SceneDocument = {
      ...this.doc,
      objects: this.doc.objects.map((o, i) => ({
        ...o,
        position: this.bodies[i]?.position ?? o.position,
        rotation: this.bodies[i]?.kind === 'pendulum'
          ? [0, 0, Math.sin(this.bodies[i]!.angle / 2), Math.cos(this.bodies[i]!.angle / 2)] as [number, number, number, number]
          : o.rotation,
      })),
    };
    this.renderer.draw(doc, this.grid, null);
  }

  async computeHashAt(step: number): Promise<void> {
    if (!this.doc) return;
    const state = stepStateFor(this.doc, this.bodies, step);
    this.runHash = await sha256Hex(stateHashInput(state));
  }

  async hashStep0(): Promise<string> {
    if (!this.doc) return '';
    return sha256Hex(stateHashInput(stepZeroState(this.doc)));
  }

  updateTelemetry(): void {
    const avg = this.frameTimes.length > 0 ? this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length : 0;
    const fps = avg > 0 ? Math.min(999, Math.round(1000 / Math.max(0.1, avg))) : 0;
    this.fpsLine.textContent = `fps ${this.mode === 'run' ? fps : 0}`;
    this.fpsLine.className = fps >= 50 ? 'fps-go' : fps >= 30 ? 'fps-warn' : 'fps-bad';
    this.fpsLine.style.fontWeight = '700';
    this.msLine.textContent = `ms ${avg.toFixed(1)}`;
    this.stepLine.textContent = `step ${this.stepCount}`;
    this.hashLine.textContent = `hash ${this.runHash.slice(0, 12)}`;
  }

  bindShortcuts(): void {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      const inText = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
      const dialogOpen = document.querySelector('.dialog-backdrop') !== null;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.openCommandPalette();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (inText) return;
        e.preventDefault();
        this.undo();
        return;
      }
      if ((e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z') || (e.ctrlKey && e.key.toLowerCase() === 'y')) {
        if (inText) return;
        e.preventDefault();
        this.redo();
        return;
      }
      if (inText || dialogOpen) return;
      switch (e.key.toLowerCase()) {
        case 'r': e.preventDefault(); void this.run(); break;
        case 'p': e.preventDefault(); this.pause(); break;
        case 'n': e.preventDefault(); this.stepOnce(); break;
        case 'escape':
          if (this.mode === 'run') void this.stop();
          else { this.selected = null; drawOutline(this); drawInspector(this); }
          break;
        case 'w': this.setTool('move'); break;
        case 'e': this.setTool('rotate'); break;
        case 't': this.setTool('scale'); break;
        case 's': this.snap = !this.snap; break;
        case 'g': this.grid = !this.grid; this.draw(); break;
        case 'f': this.frameSelected(); break;
        case 'delete':
        case 'backspace':
          e.preventDefault();
          void this.removeSelected();
          break;
        case 'f2':
          e.preventDefault();
          if (this.selected) this.openRename(this.selected);
          break;
        case '?': this.openShortcuts(); break;
      }
    });
    this.stageHost.addEventListener('keydown', (e) => {
      if (this.mode === 'run' || !this.selected || this.role === 'viewer') return;
      const object = this.doc?.objects.find((o) => o.id === this.selected);
      if (!object) return;
      const nudge = this.snap ? 0.25 : e.shiftKey ? 0.01 : 0.1;
      const next = [...object.position] as [number, number, number];
      let moved = false;
      switch (e.key) {
        case 'ArrowLeft': next[0] -= nudge; moved = true; break;
        case 'ArrowRight': next[0] += nudge; moved = true; break;
        case 'ArrowUp': next[2] -= nudge; moved = true; break;
        case 'ArrowDown': next[2] += nudge; moved = true; break;
        case 'PageUp': next[1] += nudge; moved = true; break;
        case 'PageDown': next[1] -= nudge; moved = true; break;
      }
      if (!moved) return;
      e.preventDefault();
      if (this.snap) {
        for (let i = 0; i < 3; i++) next[i] = round6(Math.round(next[i]! / 0.25) * 0.25);
      } else {
        for (let i = 0; i < 3; i++) next[i] = round6(next[i]!);
      }
      void this.applyChange([{ op: 'set', objectId: object.id, fence: this.leaseFence.get(object.id) ?? 0, field: 'position', value: next }]);
    });
  }

  setTool(tool: 'move' | 'rotate' | 'scale'): void {
    this.tool = tool;
    const bar = this.layoutRoot.querySelector('[role="toolbar"]');
    bar?.querySelectorAll('button').forEach((b) => {
      const labels: Record<string, string> = { move: 'Move', rotate: 'Rotate', scale: 'Scale' };
      if (b.textContent === labels[tool]) {
        b.setAttribute('aria-pressed', 'true');
        b.classList.add('pressed');
      } else if (Object.values(labels).includes(b.textContent ?? '')) {
        b.setAttribute('aria-pressed', 'false');
        b.classList.remove('pressed');
      }
    });
  }

  frameSelected(): void {
    const object = this.doc?.objects.find((o) => o.id === this.selected);
    if (object && this.renderer) {
      this.renderer.camera.target = [...object.position] as [number, number, number];
      this.renderer.camera.distance = 6;
      this.draw();
    }
  }

  async removeSelected(): Promise<void> {
    if (!this.selected || !this.doc || this.role === 'viewer' || this.mode === 'run') return;
    const objectId = this.selected;
    const fence = this.leaseFence.get(objectId) ?? 0;
    this.selected = null;
    await this.applyChange([{ op: 'remove', objectId, fence }]);
  }

  openRename(objectId: string): void {
    if (this.role === 'viewer' || this.mode === 'run') return;
    this.renameOpenFor = objectId;
    drawOutline(this);
  }

  async commitRename(objectId: string, value: string): Promise<void> {
    this.renameOpenFor = null;
    if (!this.doc) return;
    const object = this.doc.objects.find((o) => o.id === objectId);
    if (!object || object.name === value) {
      drawOutline(this);
      return;
    }
    await this.applyChange([{ op: 'set', objectId, fence: this.leaseFence.get(objectId) ?? 0, field: 'name', value }]);
    drawOutline(this);
  }

  undo(): void {
    const entry = this.undoStack.pop();
    if (entry) {
      this.redoStack.push(entry);
      entry();
    }
  }

  redo(): void {
    const entry = this.redoStack.pop();
    if (entry) {
      this.undoStack.push(entry);
      entry();
    }
  }

  openMaterial(object: SceneObject): void {
    const opener = document.activeElement as HTMLElement | null;
    const backdrop = h('div', { class: 'dialog-backdrop', style: { alignItems: 'center', paddingTop: '30vh' } });
    const dialog = h('div', { class: 'dialog', role: 'dialog', 'aria-label': 'Material' }, h('h2', {}, 'Material'));
    const close = (): void => {
      backdrop.remove();
      opener?.focus();
    };
    let focused = 0;
    const inputs: HTMLInputElement[] = [];
    MATERIALS.forEach((m, i) => {
      const id = `mat-${m.label.replace(/\s+/g, '-')}`;
      const input = h('input', { type: 'radio', name: 'material', id, value: m.label, ...(object.params.friction === m.friction ? { checked: true } : {}) }) as HTMLInputElement;
      inputs.push(input);
      const label = h('label', { for: id, style: { display: 'block', padding: '4px 0' } }, input, ` ${m.label}`);
      dialog.append(label);
      if (object.params.friction === m.friction) focused = i;
    });
    backdrop.append(dialog);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    document.body.append(backdrop);
    focusTrap(dialog, close);
    const apply = (label: string): void => {
      const friction = MATERIALS.find((m) => m.label === label)?.friction ?? 0;
      void this.applyChange([{ op: 'set', objectId: object.id, fence: this.leaseFence.get(object.id) ?? 0, field: 'params.friction', value: friction }]);
      close();
    };
    inputs.forEach((input, i) => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); apply(input.value); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const next = e.key === 'ArrowDown' ? (i + 1) % inputs.length : (i - 1 + inputs.length) % inputs.length;
          inputs[next]!.focus();
        }
      });
      input.addEventListener('change', () => apply(input.value));
    });
    inputs[focused]?.focus();
  }

  openCommandPalette(): void {
    const opener = document.activeElement as HTMLElement | null;
    const backdrop = h('div', { class: 'dialog-backdrop' });
    const dialog = h('div', { class: 'dialog', role: 'dialog', 'aria-label': 'Commands' });
    const input = h('input', { type: 'text', 'aria-label': 'Command', style: { width: '100%' } }) as HTMLInputElement;
    const list = h('ul', { role: 'listbox', 'aria-label': 'Matching commands', style: { listStyle: 'none', padding: '0', margin: '4px 0 0', maxHeight: '200px', overflow: 'auto' } });
    const commands: Array<{ label: string; run: () => void }> = [
      { label: 'Run', run: () => void this.run() },
      { label: 'Stop', run: () => void this.stop() },
      { label: 'Pause', run: () => this.pause() },
      { label: 'Step', run: () => this.stepOnce() },
      { label: 'Add ramp', run: () => this.place('ramp') },
      { label: 'Add pendulum', run: () => this.place('pendulum') },
      { label: 'Add launcher', run: () => this.place('launcher') },
      { label: 'Add crate', run: () => this.place('crate') },
      { label: 'Toggle snap', run: () => { this.snap = !this.snap; } },
      { label: 'Toggle grid', run: () => { this.grid = !this.grid; this.draw(); } },
      { label: 'Undo', run: () => this.undo() },
      { label: 'Redo', run: () => this.redo() },
      { label: 'New checkpoint', run: () => drawAssets(this) },
      { label: 'Open publish', run: () => openPublish(this) },
      { label: 'Open share', run: () => openShare(this) },
      { label: 'Reset layout', run: () => this.applyLayout() },
      ...(this.doc?.objects ?? []).map((o) => ({ label: `Select ${o.name}`, run: () => { void this.selectObject(o.id); } })),
    ];
    let active = 0;
    let matches = commands;
    const close = (): void => {
      backdrop.remove();
      opener?.focus();
    };
    const render = (): void => {
      const filter = input.value.trim().toLowerCase();
      matches = commands.filter((c) => c.label.toLowerCase().includes(filter));
      if (active >= matches.length) active = Math.max(0, matches.length - 1);
      list.replaceChildren();
      matches.forEach((m, i) => {
        const li = h('li', {
          role: 'option', 'aria-selected': String(i === active),
          style: { padding: '4px 8px', background: i === active ? 'var(--surface-2)' : 'transparent', cursor: 'pointer' },
          onclick: () => { m.run(); close(); },
        }, m.label);
        list.append(li);
      });
    };
    input.addEventListener('input', render);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(matches.length - 1, active + 1); render(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); render(); }
      if (e.key === 'Enter') { e.preventDefault(); const m = matches[active]; if (m) { m.run(); close(); } }
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    dialog.append(h('h2', {}, 'Commands'), input, list);
    backdrop.append(dialog);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    document.body.append(backdrop);
    focusTrap(dialog, close);
    input.focus();
    render();
  }

  openShortcuts(): void {
    const opener = document.activeElement as HTMLElement | null;
    const backdrop = h('div', { class: 'dialog-backdrop' });
    const close = (): void => {
      backdrop.remove();
      opener?.focus();
    };
    const dialog = h('div', { class: 'dialog', role: 'dialog', 'aria-label': 'Keyboard shortcuts' },
      h('h2', {}, 'Keyboard shortcuts'),
      h('table', { class: 'bench' },
        ...[
          ['R', 'Run, or Stop while running'],
          ['P', 'Pause or Resume'],
          ['N', 'Step'],
          ['Escape', 'Stop while running'],
          ['W / E / T', 'Move, Rotate, Scale'],
          ['S', 'Toggle Snap'],
          ['G', 'Toggle Grid'],
          ['F', 'Frame the selected object'],
          ['Delete / Backspace', 'Remove the selected object'],
          ['F2', 'Rename the selected object'],
          ['Ctrl+Z', 'Undo'],
          ['Ctrl+Shift+Z / Ctrl+Y', 'Redo'],
          ['Ctrl+K', 'Command palette'],
          ['?', 'This list'],
        ].map(([key, action]) => h('tr', {}, h('td', {}, key), h('td', {}, action)))),
      h('div', { class: 'dialog-actions' }, h('button', { class: 'chip', onclick: () => close() }, 'Close')),
    );
    backdrop.append(dialog);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    document.body.append(backdrop);
    focusTrap(dialog, close);
    (dialog.querySelector('button') as HTMLButtonElement).focus();
  }

  openWindowsMenu(bar: HTMLElement): void {
    document.querySelectorAll('[data-windows-menu]').forEach((m) => m.remove());
    const menu = h('div', { class: 'menu', role: 'menu', 'aria-label': 'Windows', 'data-windows-menu': '1', style: { position: 'absolute', top: '38px', left: '40%', zIndex: '90' } });
    for (const [title, id] of [['Outline', 'outline'], ['Inspector', 'inspector'], ['Props', 'props'], ['Assets', 'assets']] as Array<[string, string]>) {
      const panel = this.panels[id]!;
      const item = h('button', { class: 'menu-item', role: 'menuitemcheckbox', 'aria-checked': String(panel.style.display !== 'none'), onclick: () => {
        panel.style.display = panel.style.display === 'none' ? '' : 'none';
        menu.remove();
      } }, title);
      menu.append(item);
    }
    menu.append(h('button', { class: 'menu-item', role: 'menuitem', onclick: () => {
      for (const panel of Object.values(this.panels)) { panel.style.display = ''; panel.style.width = ''; panel.style.height = ''; }
      this.applyLayout();
      menu.remove();
    } }, 'Reset layout'));
    document.body.append(menu);
    void bar;
  }
}

function defaultParams(kind: ObjectKind): Record<string, number> {
  const specs: Record<string, Array<[string, number]>> = {
    ramp: [['mass_kg', 1], ['angle_deg', 30], ['length_m', 3], ['friction', 0]],
    pendulum: [['mass_kg', 0.5], ['length_m', 1], ['release_deg', 20]],
    launcher: [['mass_kg', 0.2], ['speed_mps', 5], ['launch_angle_deg', 45], ['height_m', 1]],
    crate: [['mass_kg', 1]],
    model: [],
  };
  return Object.fromEntries(specs[kind] ?? []);
}

function diffOps(before: SceneDocument, after: SceneDocument, fenceFor: (objectId: string) => number = () => 0): Op[] {
  // A simple inverse: reset changed fields back to `before` values.
  const ops: Op[] = [];
  if (before.name !== after.name) ops.push({ op: 'scene', field: 'name', value: before.name });
  if (before.gravity !== after.gravity) ops.push({ op: 'scene', field: 'gravity', value: before.gravity });
  for (const objBefore of before.objects) {
    const objAfter = after.objects.find((o) => o.id === objBefore.id);
    const fence = fenceFor(objBefore.id);
    if (!objAfter) {
      ops.push({ op: 'add', object: structuredClone(objBefore) });
      continue;
    }
    if (objBefore.name !== objAfter.name) ops.push({ op: 'set', objectId: objBefore.id, fence, field: 'name', value: objBefore.name });
    if (objBefore.position.join() !== objAfter.position.join()) ops.push({ op: 'set', objectId: objBefore.id, fence, field: 'position', value: objBefore.position });
    if (objBefore.scale.join() !== objAfter.scale.join()) ops.push({ op: 'set', objectId: objBefore.id, fence, field: 'scale', value: objBefore.scale });
    for (const [key, value] of Object.entries(objBefore.params)) {
      if (objAfter.params[key] !== value) ops.push({ op: 'set', objectId: objBefore.id, fence, field: `params.${key}`, value });
    }
  }
  for (const objAfter of after.objects) {
    if (!before.objects.some((o) => o.id === objAfter.id)) {
      ops.push({ op: 'remove', objectId: objAfter.id, fence: fenceFor(objAfter.id) });
    }
  }
  return ops;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function editorScreen(root: HTMLElement, route: EditorRoute): void {
  document.title = 'Editor - Rampwright';
  const state = new EditorState(route);
  root.append(state.build());
}
