import { el, clear, uid, announce } from '../dom.js';
import { api } from '../api.js';
import type { UserInfo, LockEvent, LayerDoc } from '../api.js';
import { SetStore } from '../store.js';
import { StageRenderer } from '../stage.js';
import { runScript, beatRunner, type ConsoleLine, type BeatContext } from '../scripts.js';
import { icon } from '../icons.js';
import { makeContext, layerOf, type EditorContext } from './context.js';
import { buildLayerTree, buildInspector, selectLayer } from './panels.js';
import { buildTimelineDock, updatePlayhead } from './timeline.js';
import { buildRigPanel, refreshAssets, renderShows } from './rig.js';
import type { PresenceMember } from '../api.js';
import { commitOp } from './context.js';

const ADD_ITEMS = ['Group', 'Cube', 'Sphere', 'Plane', 'Torus', 'Tube', 'Camera', 'Light', 'Model', 'Shader layer'] as const;

export async function renderSetEditor (setId: string, user: UserInfo | null): Promise<void> {
  const store = new SetStore(setId);
  await store.load();

  const canvas = el('canvas', { class: 'stage-canvas' }) as unknown as HTMLCanvasElement;
  let renderer: StageRenderer | null = null;
  if (StageRenderer.isSupported()) {
    try { renderer = new StageRenderer(canvas); } catch { renderer = null; }
  }
  const ctx = makeContext(setId, store, renderer, canvas, user);
  ctx.transport.bpm = store.getDocument()?.set.bpm ?? 120;

  // ---------- Shell ----------
  const doc = store.getDocument();
  void doc;
  const playButton = el('button', { text: 'Play', 'aria-pressed': 'false' });
  const pauseButton = el('button', { text: 'Pause' });
  const stepButton = el('button', { text: 'Step beat' });
  const stopButton = el('button', { text: 'Stop' });
  const syncPlay = (playing: boolean): void => { playButton.setAttribute('aria-pressed', String(playing)); };
  playButton.addEventListener('click', () => { ctx.transport.play(); syncPlay(true); ctx.redrawOnce(); });
  pauseButton.addEventListener('click', () => { ctx.transport.pause(); syncPlay(false); ctx.redrawOnce(); });
  stepButton.addEventListener('click', () => { ctx.transport.stepBeat(); syncPlay(false); ctx.redrawOnce(); });
  stopButton.addEventListener('click', () => { ctx.transport.stop(); syncPlay(false); ctx.redrawOnce(); });

  const accountButton = el('button', { text: 'Account' });
  accountButton.addEventListener('click', () => {
    const menu = el('div', { class: 'menu-popover', role: 'menu', style: 'top: 100%;' });
    menu.append(el('button', {
      role: 'menuitem', text: 'Sign out',
      click: async () => {
        await api.post('/api/auth/logout');
        window.history.pushState({}, '', '/');
        window.dispatchEvent(new PopStateEvent('popstate'));
      },
    }));
    accountButton.append(menu);
    menu.querySelector('button')?.focus();
    const dismiss = (event: Event): void => {
      if (!menu.contains(event.target as Node)) { menu.remove(); document.removeEventListener('click', dismiss, true); }
    };
    document.addEventListener('click', dismiss, true);
  });

  const menubar = el('div', { class: 'menubar', role: 'menubar', 'aria-label': 'Set menu' });
  const menus: { label: string; items: { label: string; run: () => void }[] }[] = [
    {
      label: 'Set', items: [
        { label: 'Rename set', run: () => {} },
      ],
    },
    {
      label: 'Edit', items: [],
    },
    {
      label: 'Add', items: ADD_ITEMS.map((item) => ({
        label: item,
        run: () => { void addLayer(ctx, item); },
      })),
    },
    { label: 'Stage', items: [] },
    { label: 'Timeline', items: [] },
    { label: 'Share', items: [] },
    { label: 'Help', items: [] },
  ];
  for (const menu of menus) {
    const button = el('button', { class: 'menu-button', role: 'menuitem', text: menu.label, 'aria-haspopup': 'true' });
    button.addEventListener('click', () => {
      const popover = el('div', { class: 'menu-popover', role: 'menu' });
      for (const item of menu.items) {
        popover.append(el('button', { role: 'menuitem', text: item.label, click: () => { item.run(); popover.remove(); } }));
      }
      button.append(popover);
      if (popover.childElementCount === 0) return;
      popover.querySelector('button')?.focus();
      const dismiss = (event: Event): void => {
        if (!popover.contains(event.target as Node)) { popover.remove(); document.removeEventListener('click', dismiss, true); }
      };
      document.addEventListener('click', dismiss, true);
    });
    menubar.append(button);
  }
  menubar.append(
    el('div', { class: 'transport', role: 'group', 'aria-label': 'Beat transport' }, playButton, pauseButton, stepButton, stopButton),
    accountButton,
  );

  const bannerStrip = el('div', { class: 'banner-strip' });
  ctx.rebuildBanners = (): void => rebuildBanners(ctx, bannerStrip);

  const gizmoStrip = el('div', { class: 'gizmo-strip strip', role: 'toolbar', 'aria-label': 'Gizmos' });
  const gizmoRadios: Record<'move' | 'rotate' | 'scale', HTMLButtonElement> = {} as Record<'move' | 'rotate' | 'scale', HTMLButtonElement>;
  for (const mode of ['move', 'rotate', 'scale'] as const) {
    const button = el('button', { role: 'radio', text: mode[0].toUpperCase() + mode.slice(1), 'aria-checked': String(mode === 'move') }) as unknown as HTMLButtonElement;
    button.addEventListener('click', () => { setGizmoMode(mode); });
    gizmoRadios[mode] = button;
    gizmoStrip.append(button);
  }
  const setGizmoMode = (mode: 'move' | 'rotate' | 'scale'): void => {
    ctx.gizmoMode = mode;
    for (const [key, button] of Object.entries(gizmoRadios)) button.setAttribute('aria-checked', String(key === mode));
  };

  const snapStrip = el('div', { class: 'snap-strip strip', role: 'toolbar', 'aria-label': 'Snapping' });
  const gridButton = el('button', { text: 'Grid snap', 'aria-pressed': 'false' });
  const angleButton = el('button', { text: 'Angle snap', 'aria-pressed': 'false' });
  gridButton.addEventListener('click', () => { ctx.gridSnap = !ctx.gridSnap; gridButton.setAttribute('aria-pressed', String(ctx.gridSnap)); });
  angleButton.addEventListener('click', () => { ctx.angleSnap = !ctx.angleSnap; angleButton.setAttribute('aria-pressed', String(ctx.angleSnap)); });
  snapStrip.append(gridButton, angleButton);

  const cameraSelect = el('select', { class: 'camera-select', 'aria-label': 'Stage camera' }) as unknown as HTMLSelectElement;
  ctx.rebuildCameraSelect = (): void => {
    clear(cameraSelect);
    const d = ctx.store.getDocument();
    if (d === null) return;
    for (const camera of d.layers.filter((l) => l.kind === 'camera')) {
      const option = el('option', { value: camera.id, text: camera.name }) as unknown as HTMLOptionElement;
      if (d.set.active_camera_id === camera.id) option.selected = true;
      cameraSelect.append(option);
    }
  };
  cameraSelect.addEventListener('change', () => {
    void commitOp(ctx, {
      target: 'set',
      baseVersion: ctx.store.settingsVersion,
      type: 'set.update',
      payload: { active_camera_id: cameraSelect.value },
    }, () => {
      const d = ctx.store.getDocument();
      if (d !== null) d.set.active_camera_id = cameraSelect.value;
    });
  });

  const stageViewport = el('div', { class: 'stage-viewport' },
    renderer === null
      ? el('div', { class: 'stage-no-webgl', text: "This browser can't draw the stage. Your set still saves." })
      : canvas,
    gizmoStrip, snapStrip,
  );
  const cameraLabel = el('div', { class: 'camera-label' }, cameraSelect);
  stageViewport.append(cameraLabel);
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Stage viewport');
  canvas.setAttribute('data-frame', '0');

  const dock = el('div', { class: 'dock', role: 'navigation', 'aria-label': 'Workbench' });
  const dockButtons: Record<string, HTMLElement> = {};
  for (const [name, key, caption] of [
    ['layers', 'layers', 'Layers'], ['assets', 'assets', 'Assets'], ['shaders', 'shaders', 'Shaders'],
    ['graph', 'graph', 'Graph'], ['scripts', 'scripts', 'Scripts'], ['shows', 'shows', 'Shows'],
    ['activity', 'activity', 'Activity'],
  ] as const) {
    const button = el('button', { 'aria-current': String(ctx.dockChoice === key) });
    button.innerHTML = icon(name);
    button.append(el('span', { class: 'caption', text: caption }));
    button.addEventListener('click', () => {
      if (key === 'shaders') { ctx.activeTab = 'shader'; ctx.rebuildTabs(); }
      else if (key === 'graph') { ctx.activeTab = 'node-graph'; ctx.rebuildTabs(); }
      else if (key === 'scripts') { ctx.activeTab = 'script'; ctx.rebuildTabs(); }
      else { ctx.dockChoice = key; ctx.rebuildRigPanel(); }
      for (const [otherKey, other] of Object.entries(dockButtons)) other.setAttribute('aria-current', String(otherKey === key));
    });
    dockButtons[key] = button as unknown as HTMLElement;
    dock.append(button);
  }

  const tree = buildLayerTree(ctx);
  const inspector = buildInspector(ctx);
  const { tabs, panel: tabPanel } = buildTimelineDock(ctx);
  const rigPanels = buildRigPanel(ctx);
  const rigPanel = rigPanels.panel;
  rigPanels.layersPane.append(tree, inspector);

  ctx.updatePlayhead = (tick, bpm) => updatePlayhead(ctx, tick, bpm);

  const shell = el('div', { class: 'shell' },
    dock,
    menubar,
    bannerStrip,
    el('div', { class: 'stage-area' }, stageViewport),
    el('div', { class: 'timeline-dock' }, tabs, tabPanel),
    rigPanel,
  );

  const root = el('div');
  root.append(shell);
  for (const node of Object.values(ctx.regions)) root.append(node);
  clear(document.body);
  document.body.append(root);

  // ---------- Autosave ----------
  ctx.updateAutosave = (): void => {
    if (ctx.store.queueLength > 0 || !ctx.store.online) {
      announce(ctx.regions['Autosave'], 'Waiting to sync');
      ctx.rebuildBanners();
    } else {
      announce(ctx.regions['Autosave'], 'Saved');
    }
  };

  // ---------- Scripts ----------
  ctx.runAllScripts = (): void => {
    const d = ctx.store.getDocument();
    if (d === null) return;
    ctx.pluginNodes = [];
    ctx.scriptRuns = new Map();
    for (const script of d.scripts) {
      const run = runScript(script.name, script.source, {
        registerNode: (definition) => {
          ctx.pluginNodes.push(definition);
          ctx.evaluator.registerPlugin(definition);
        },
        consoleLine: (line: ConsoleLine) => {
          ctx.consoleLines.push(line);
          ctx.rebuildConsole();
          const region = ctx.regions['Script status'];
          region.textContent = line.text;
        },
      });
      ctx.scriptRuns.set(script.id, { onBeat: run.onBeat, stopped: run.stopped });
    }
    ctx.rebuildGraph();
  };

  const runScriptsOnBeat = (beat: number): void => {
    const d = ctx.store.getDocument();
    if (d === null || !ctx.transport.playing) return;
    const bar = Math.floor(beat / 4) + 1;
    for (const script of d.scripts) {
      const run = ctx.scriptRuns.get(script.id);
      if (run === undefined || run.stopped || run.onBeat === undefined) continue;
      const runner = beatRunner(script.name, run.onBeat, {
        consoleLine: (line: ConsoleLine) => {
          ctx.consoleLines.push(line);
          ctx.rebuildConsole();
          ctx.regions['Script status'].textContent = line.text;
        },
        onStop: () => { run.stopped = true; },
      });
      const beatCtx: BeatContext = {
        beat: Math.floor(beat),
        bar,
        bpm: d.set.bpm,
        set: (layerName, property, value) => {
          const layer = d.layers.find((l) => l.name === layerName);
          if (layer === undefined) return;
          let map = ctx.scriptOverrides.get(layer.id);
          if (map === undefined) { map = new Map(); ctx.scriptOverrides.set(layer.id, map); }
          map.set(property, value);
        },
      };
      runner(beatCtx);
    }
  };

  // ---------- Stage loop ----------
  const redrawOnce = (): void => { ctx.needsDraw = true; };
  ctx.redrawOnce = redrawOnce;

  const needsDraw = (): boolean =>
    ctx.transport.playing || ctx.draggingGizmo !== null || ctx.scrubbing || ctx.orbiting || ctx.needsDraw;

  function renderFrame (): void {
    if (ctx.renderer === null) return;
    const d = ctx.store.getDocument();
    if (d === null) return;
    ctx.transport.bpm = d.set.bpm;
    const tick = ctx.transport.currentTick();
    ctx.beat = tick / 96;
    const overrides = new Map(ctx.evaluator.evaluate(d.graph, ctx.beat, d.set.bpm));
    for (const [key, value] of ctx.scriptOverrides) overrides.set(key, value);
    const keysByLayer = new Map<string, { property: string; tick: number; value: number }[]>();
    for (const key of d.keys) {
      const list = keysByLayer.get(key.layer_id) ?? [];
      list.push(key);
      keysByLayer.set(key.layer_id, list);
    }
    ctx.renderer.render({
      layers: d.layers,
      keysByLayer,
      overrides,
      cameraLayer: layerOf(ctx, d.set.active_camera_id),
      tick,
      beat: ctx.beat,
      bpm: d.set.bpm,
      selectedId: ctx.selectedLayerId,
      orbit: ctx.orbit,
      onGizmos: (positions) => { ctx.gizmoPositions = positions; },
      gizmoMode: ctx.selectedLayerId !== null ? ctx.gizmoMode : null,
    });
    canvas.setAttribute('data-frame', String(ctx.renderer.getFrameCount()));
    if (ctx.gizmoPositions !== null) {
      canvas.setAttribute('data-gizmo-x', `${Math.round(ctx.gizmoPositions.x[0])},${Math.round(ctx.gizmoPositions.x[1])}`);
      canvas.setAttribute('data-gizmo-y', `${Math.round(ctx.gizmoPositions.y[0])},${Math.round(ctx.gizmoPositions.y[1])}`);
      canvas.setAttribute('data-gizmo-z', `${Math.round(ctx.gizmoPositions.z[0])},${Math.round(ctx.gizmoPositions.z[1])}`);
    } else {
      canvas.removeAttribute('data-gizmo-x');
      canvas.removeAttribute('data-gizmo-y');
      canvas.removeAttribute('data-gizmo-z');
    }
    ctx.updatePlayhead(tick, d.set.bpm);
  }

  function frameLoop (): void {
    const beatNow = ctx.beat;
    if (ctx.transport.playing && Math.floor(beatNow) !== Math.floor(ctx.lastBeat)) {
      ctx.lastBeat = beatNow;
      runScriptsOnBeat(beatNow);
    }
    if (needsDraw()) {
      renderFrame();
      ctx.needsDraw = false;
    }
    requestAnimationFrame(frameLoop);
  }
  requestAnimationFrame(frameLoop);

  // ---------- Stage pointer: gizmo drag and orbit ----------
  if (renderer !== null) {
    canvas.addEventListener('pointerdown', (event) => {
      if (ctx.selectedLayerId === null || ctx.gizmoPositions === null) { ctx.orbiting = true; return; }
      const rect = canvas.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const within8 = (position: [number, number]): boolean => Math.hypot(position[0] - px, position[1] - py) <= 8;
      if (within8(ctx.gizmoPositions.x)) { ctx.draggingGizmo = 'x'; canvas.setPointerCapture(event.pointerId); }
      else if (within8(ctx.gizmoPositions.y)) { ctx.draggingGizmo = 'y'; canvas.setPointerCapture(event.pointerId); }
      else if (within8(ctx.gizmoPositions.z)) { ctx.draggingGizmo = 'z'; canvas.setPointerCapture(event.pointerId); }
      else ctx.orbiting = true;
    });
    canvas.addEventListener('pointermove', (event) => {
      if (ctx.orbiting) {
        ctx.orbit.yaw += event.movementX * 0.01;
        ctx.orbit.pitch = Math.max(-1.4, Math.min(1.4, ctx.orbit.pitch + event.movementY * 0.01));
        ctx.needsDraw = true;
        return;
      }
      if (ctx.draggingGizmo === null) return;
      const layer = layerOf(ctx, ctx.selectedLayerId);
      if (layer === null) return;
      const delta = ctx.draggingGizmo === 'y' ? event.movementY : event.movementX;
      const index = ctx.draggingGizmo === 'x' ? 0 : ctx.draggingGizmo === 'y' ? 1 : 2;
      if (ctx.gizmoMode === 'move') layer.position[index] += delta * 0.01;
      else if (ctx.gizmoMode === 'rotate') layer.rotation[index] += delta * 1;
      else layer.scale[index] = Math.max(0.001, layer.scale[index] + delta * 0.01);
      ctx.needsDraw = true;
    });
    const endDrag = (): void => {
      if (ctx.draggingGizmo !== null && ctx.selectedLayerId !== null) {
        const layer = layerOf(ctx, ctx.selectedLayerId);
        if (layer !== null) {
          let position = [...layer.position] as [number, number, number];
          let rotation = [...layer.rotation] as [number, number, number];
          let scale = [...layer.scale] as [number, number, number];
          if (ctx.gridSnap) position = position.map((v) => Math.round(v * 2) / 2) as [number, number, number];
          if (ctx.angleSnap) rotation = rotation.map((v) => Math.round(v / 15) * 15) as [number, number, number];
          const path = ctx.gizmoMode === 'move' ? 'position' : ctx.gizmoMode === 'rotate' ? 'rotation' : 'scale';
          const value = ctx.gizmoMode === 'move' ? position : ctx.gizmoMode === 'rotate' ? rotation : scale;
          void commitOp(ctx, {
            target: layer.id,
            baseVersion: ctx.store.layerVersion(layer.id),
            type: 'layer.set',
            payload: { path, value },
          }, () => {});
          ctx.rebuildInspector();
        }
      }
      ctx.draggingGizmo = null;
      ctx.orbiting = false;
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      ctx.orbit.distance = Math.max(2, ctx.orbit.distance + event.deltaY * 0.01);
      ctx.needsDraw = true;
    }, { passive: false });
  }

  // ---------- Shortcuts ----------
  document.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    const typing = target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement || target.isContentEditable;
    if (event.key === ' ' && !typing) {
      event.preventDefault();
      if (ctx.transport.playing) { ctx.transport.pause(); syncPlay(false); }
      else { ctx.transport.play(); syncPlay(true); }
    } else if (!typing && (event.key === 'w' || event.key === 'e' || event.key === 'r')) {
      const mode = event.key === 'w' ? 'move' : event.key === 'e' ? 'rotate' : 'scale';
      setGizmoMode(mode);
    } else if (!typing && (event.key === 'k' || event.key === 'K')) {
      // Key the focused row's property: handled by inspector key dots when focus
      // is in the inspector; here it keys the selected layer's twist if present.
      const layer = layerOf(ctx, ctx.selectedLayerId);
      if (layer !== null && layer.kind === 'tube') {
        void import('./panels.js').then(async ({ placeKey }) => {
          await placeKey(ctx, 'props.twist', layer.props.twist);
        });
      }
    }
  });

  // ---------- Collaboration ----------
  // Queue and connection changes refresh the banner and the autosave region.
  store.subscribe(() => {
    ctx.rebuildBanners();
    ctx.updateAutosave();
  });
  store.connectEvents();
  store.lockListeners.add((event: LockEvent) => {
    ctx.rebuildTree();
    ctx.rebuildInspector();
    if (event.reason === 'expired' && event.holder?.user_id === user?.id) {
      ctx.regions['Notifications'].textContent = `Your lock on ${layerOf(ctx, event.layer_id)?.name ?? 'this layer'} expired`;
    }
  });
  store.presenceListeners.add((members: PresenceMember[]) => ctx.rebuildPresence(members));
  store.showListeners.add((liveNumber: number) => {
    ctx.regions['Show status'].textContent = `Version ${liveNumber} is live`;
    if (ctx.dockChoice === 'shows') ctx.rebuildRigPanel();
  });

  // Presence posts every 10 seconds and on every selection change.
  window.setInterval(() => { void api.post(`/api/sets/${setId}/presence`, { selection: ctx.selectedLayerId }).catch(() => {}); }, 10_000);
  // Lock leases renew every 10 seconds while the holder keeps the layer selected.
  window.setInterval(() => {
    const held = ctx.store.lockFor(ctx.selectedLayerId ?? '');
    if (held === undefined || held.holder.user_id !== user?.id) return;
    void api.post(`/api/sets/${setId}/layers/${ctx.selectedLayerId}/lock/heartbeat`, {}).catch(() => {});
  }, 10_000);
  void api.post(`/api/sets/${setId}/presence`, { selection: ctx.selectedLayerId }).catch(() => {});

  // When offline, the queue retries every few seconds until it drains, and the
  // toast announces the recovery.
  let wasQueued = false;
  store.subscribe(() => {
    if (store.queueLength > 0) wasQueued = true;
    else if (wasQueued && store.online) {
      wasQueued = false;
      announce(ctx.regions['Notifications'], 'Back online. All changes synced.');
    }
  });
  window.setInterval(() => {
    if (store.queueLength > 0) void store.replayQueue();
  }, 4000);
  // While Valkey is down, editors fetch ops after their last sequence every 5 s.
  window.setInterval(() => {
    if (!store.online) return;
    void api.get<{ ops: { seq: number; client_op_id: string; actor: { user_id: string; display_name: string }; target: string; type: string; payload: Record<string, unknown> }[] }>(`/api/sets/${setId}/ops?after=${store.head}`)
      .then((result) => {
        if (!result.ok) return;
        for (const op of result.body.ops) store.applyRemoteOp({ ...op });
      })
      .catch(() => {});
  }, 5000);

  // ---------- Service status ----------
  window.setInterval(() => {
    void api.get<{ storage: string; collab: string }>('/api/status').then((result) => {
      if (!result.ok) return;
      const nextStorage = result.body.storage === 'unreachable';
      const nextCollab = result.body.collab === 'unreachable';
      if (nextStorage !== ctx.storageDown || nextCollab !== ctx.collabDown) {
        ctx.storageDown = nextStorage;
        ctx.collabDown = nextCollab;
        ctx.rebuildBanners();
      }
    }).catch(() => {});
  }, 5000);
  void api.get<{ storage: string; collab: string }>('/api/status').then((result) => {
    if (result.ok) {
      ctx.storageDown = result.body.storage === 'unreachable';
      ctx.collabDown = result.body.collab === 'unreachable';
      ctx.rebuildBanners();
    }
  });

  // ---------- Boot ----------
  ctx.rebuildTree();
  ctx.rebuildInspector();
  ctx.rebuildTabs();
  ctx.rebuildCameraSelect();
  ctx.rebuildRigPanel();
  ctx.rebuildBanners();
  await refreshAssets(ctx);
  ctx.runAllScripts();
  renderFrame();
  updateAutosaveInitial(ctx);
}

function updateAutosaveInitial (ctx: EditorContext): void {
  ctx.regions['Autosave'].textContent = 'Saved';
}

function rebuildBanners (ctx: EditorContext, strip: HTMLElement): void {
  clear(strip);
  if (ctx.storageDown) strip.append(el('div', { class: 'banner', role: 'status', text: 'Asset storage is unreachable. Uploads and publishing are paused.' }));
  if (ctx.collabDown) strip.append(el('div', { class: 'banner collab', role: 'status', text: 'Live collaboration is offline. Locks can’t be taken right now.' }));
  if (!ctx.store.online || ctx.store.queueLength > 0) {
    const count = ctx.store.queueLength;
    strip.append(el('div', { class: 'banner', role: 'status', text: count === 1 ? 'Connection lost. 1 change waiting to sync.' : `Connection lost. ${count} changes waiting to sync.` }));
  }
}

async function addLayer (ctx: EditorContext, item: string): Promise<void> {
  const kind = item === 'Shader layer' ? 'shader' : item.toLowerCase();
  const name = item === 'Shader layer' ? 'Shader layer' : item;
  const layerId = uid('layer');
  const parent = layerOf(ctx, ctx.selectedLayerId);
  const target = parent !== null && parent.kind === 'group' ? parent.id : null;
  const siblings = (ctx.store.getDocument()?.layers ?? []).filter((l) => l.parent_id === target);
  await commitOp(ctx, {
    target: layerId,
    type: 'layer.add',
    baseVersion: undefined,
    payload: { parent_id: target, index: siblings.length, name, kind },
  }, () => {
    const doc = ctx.store.getDocument();
    if (doc === null) return;
    doc.layers.push(newLayerDoc(layerId, target, siblings.length, name, kind));
    if (target !== null) ctx.expanded.add(target);
  });
  selectLayer(ctx, layerId);
  ctx.rebuildTree();
}

// The local mirror of a newly added layer, matching the server's defaults.
function newLayerDoc (id: string, parentId: string | null, index: number, name: string, kind: string): LayerDoc {
  const isDrawn = ['cube', 'sphere', 'plane', 'torus', 'tube', 'model', 'shader'].includes(kind);
  return {
    id,
    parent_id: parentId,
    index,
    name,
    kind: kind as LayerDoc['kind'],
    version: 1,
    visible: true,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    props: kind === 'camera' ? { fov: 50, near: 0.1, far: 200 } : kind === 'light' ? { intensity: 1 } : kind === 'tube' ? { twist: 0, radius: 1 } : {},
    material: ['cube', 'sphere', 'plane', 'torus', 'tube', 'model'].includes(kind)
      ? { tint: [1, 1, 1], tint_alpha: 1, albedo_texture_id: null, emissive_texture_id: null }
      : null,
    model_asset_id: null,
    output_buses: isDrawn ? ['main'] : [],
    shader_version: kind === 'shader' ? 1 : null,
  };
}

export { selectLayer };
