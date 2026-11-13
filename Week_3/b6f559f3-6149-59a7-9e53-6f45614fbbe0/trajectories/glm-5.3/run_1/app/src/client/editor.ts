// The editor: layers, preview bar, stage, inspector, readouts and timeline.
import { el, api, keepFocus } from './dom';
import type { Person, ProjectSummary } from './types';
import type {
  SceneBundle,
  SceneDocument,
  Layer,
  Breakpoint,
  Variable,
} from '../domain/types';
import { ADD_MENU_ITEMS } from '../domain/types';
import {
  makeDefaultProps,
  RANGE,
  PRIMITIVES,
  DEFAULT_LIMITS,
} from '../domain/props';
import { makeEvalContext, evaluateScene, sourceLevel } from '../domain/evaluate';
import { createStage, meshesFor } from './stage';
import { formatTimeReadout, formatFixed } from '../domain/format';
import type { ModelInfo } from '../domain/evaluate';

interface EditorState {
  project: ProjectSummary;
  bundle: SceneBundle;
  sceneId: string;
  scene: SceneDocument;
  frame: number;
  playing: boolean;
  breakpoint: Breakpoint;
  preview: boolean;
  reduced: boolean;
  scroll: number;
  selectedIds: string[];
  focusedLayerId: string | null;
  focusedFieldPath: string | null;
  lastSaved: 'idle' | 'saving' | 'saved' | 'error';
  pending: Change2[];
  saveTimer: number | null;
  undoDepth: number;
  redoDepth: number;
  pointer: { x: number; y: number } | null;
  pointerFrames: number;
  modelInfo: Map<string, ModelInfo>;
  svgInfo: Map<string, { points: { x: number; y: number }[]; width: number; height: number }>;
  variableName: string | null;
  viewerNotice: string | null;
  lockHolders: Map<string, { id: string; name: string }>;
  presence: { id: string; name: string }[];
  opCounter: number;
}

type Change2 = Record<string, unknown> & { type: string };

const LIMITS = DEFAULT_LIMITS;

export async function renderEditor(
  root: HTMLElement,
  person: Person,
  projectId: string,
): Promise<void> {
  const res = await api<{ project: ProjectSummary; document: SceneBundle; assets: unknown[] }>(
    `/api/projects/${projectId}`,
  );
  if (!res.ok || !res.data) {
    root.append(el('main', { class: 'missing-panel' }, 'Not found.'));
    return;
  }
  const { project, document: bundle } = res.data;
  const scene = bundle.scenes[0]!;

  const state: EditorState = {
    project,
    bundle,
    sceneId: scene.id,
    scene,
    frame: 0,
    playing: false,
    breakpoint: 'desktop',
    preview: false,
    reduced: false,
    scroll: 0,
    selectedIds: [],
    focusedLayerId: null,
    focusedFieldPath: null,
    lastSaved: 'idle',
    pending: [],
    saveTimer: null,
    undoDepth: 0,
    redoDepth: 0,
    pointer: null,
    pointerFrames: 0,
    modelInfo: new Map(),
    svgInfo: new Map(),
    variableName: null,
    viewerNotice: null,
    lockHolders: new Map(),
    presence: [],
    opCounter: 0,
  };

  const shell = el('div', { class: 'editor-shell' });
  const header = buildEditorHeader(person, state);
  shell.append(header);
  const main = el('div', { class: 'editor-main' });
  shell.append(main);

  const layersPanel = el('div', { class: 'panel panel-scroll', role: 'region', 'aria-label': 'Layers' });
  const variablesCard = el('div', { class: 'panel', role: 'region', 'aria-label': 'Variables and presets' });
  const stagePanel = el('div', { class: 'stage-panel', role: 'group', 'aria-label': 'Stage', tabindex: '0' });
  const inspectorPanel = el('div', { class: 'panel panel-scroll', role: 'region', 'aria-label': 'Inspector' });
  const readoutsPanel = el('div', { class: 'panel', role: 'region', 'aria-label': 'Readouts' });
  const timelinePanel = el('div', { class: 'timeline-panel', role: 'region', 'aria-label': 'Timeline' });

  main.append(layersPanel, variablesCard, stagePanel, inspectorPanel, readoutsPanel);
  shell.append(timelinePanel);
  root.append(shell);

  // On a phone the panels sit behind a tablist named Editor panels; on wider
  // screens the tabs hide and every panel shows.
  const phoneTabs = el('div', { class: 'tabs phone-tabs', role: 'tablist', 'aria-label': 'Editor panels' });
  const phonePanels: [string, HTMLElement][] = [
    ['Layers', layersPanel],
    ['Stage', stagePanel],
    ['Inspector', inspectorPanel],
    ['Timeline', timelinePanel],
  ];
  phonePanels.forEach(([name], i) => {
    const tab = el('button', { role: 'tab', 'aria-selected': i === 0 ? 'true' : 'false', 'aria-label': name }, name);
    tab.addEventListener('click', () => {
      for (const t of phoneTabs.querySelectorAll('[role="tab"]')) t.setAttribute('aria-selected', 'false');
      tab.setAttribute('aria-selected', 'true');
      showPhonePanel(i);
    });
    phoneTabs.append(tab);
  });
  const showPhonePanel = (index: number): void => {
    const isPhone = window.innerWidth < 640;
    phonePanels.forEach(([, panel], i) => {
      panel.style.display = isPhone && i !== index ? 'none' : '';
    });
  };
  shell.insertBefore(phoneTabs, main);
  const applyLayout = (): void => {
    const isPhone = window.innerWidth < 640;
    phoneTabs.style.display = isPhone ? 'flex' : 'none';
    main.style.display = isPhone ? 'block' : '';
    if (isPhone) {
      const tabs = [...phoneTabs.querySelectorAll('[role="tab"]')];
      showPhonePanel(Math.max(0, tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true')));
    } else {
      for (const [, panel] of phonePanels) panel.style.display = '';
      timelinePanel.style.display = '';
    }
  };
  window.addEventListener('resize', applyLayout);
  applyLayout();

  const stage = createStage(stagePanel);
  stagePanel.dataset.renderer = stage.renderer;

  // ---- Rendering ----
  const renderLoop = (): void => {
    const ctx = makeEvalContext({
      frame: state.frame,
      breakpoint: state.breakpoint,
      scroll: state.scroll,
      reducedMotion: state.reduced,
      pointer: state.pointer,
      pointerFrames: state.pointerFrames,
      hoverLayerIds: new Set(),
      hoverFrames: 0,
      limits: { particleMax: LIMITS.particleMax },
      modelInfo: state.modelInfo,
      svgInfo: state.svgInfo,
    });
    stagePanel.dataset.breakpoint = state.breakpoint;
    stagePanel.dataset.frame = String(state.frame);
    stage.render({
      bundle: state.bundle,
      scene: state.scene,
      ctx,
      variables: state.bundle.variables,
      meshes: meshesFor(state.scene, state.bundle, state.modelInfo),
    });
    updateReadouts(ctx);
    requestAnimationFrame(renderLoop);
  };
  requestAnimationFrame(renderLoop);

  const updateReadouts = (ctx: ReturnType<typeof makeEvalContext>): void => {
    const resolved = evaluateScene(state.scene, ctx, state.bundle.variables);
    const selectedId = state.selectedIds[0];
    const layer = resolved.layers.find((l) => l.layer.id === selectedId);
    readoutsPanel.textContent = '';
    const list = el('div', { class: 'readout-list' });
    const add = (key: string, text: string): void => {
      const row = el('div');
      row.append(el('span', {}, key));
      row.append(el('span', { 'data-readout': key }, text));
      list.append(row);
    };
    add('time', formatTimeReadout(state.frame));
    if (layer) {
      if (layer.screenPoint) {
        add('screen-point', `${formatFixed(layer.screenPoint.x, 2)}, ${formatFixed(layer.screenPoint.y, 2)} px`);
      } else if (layer.props.position) {
        add('screen-point', 'Not visible');
      }
      const mat = layer.props.material as { kind: string; refraction: number } | undefined;
      if (mat?.kind === 'Glass') {
        add('ior', `IOR ${formatFixed(1 + 0.25 * mat.refraction, 3)}`);
      }
      const prim = layer.props.primitive as string | undefined;
      if (prim && PRIMITIVES[prim as keyof typeof PRIMITIVES]) {
        add('triangles', `Triangles ${PRIMITIVES[prim as keyof typeof PRIMITIVES].triangles}`);
      }
      if (layer.layer.events.tilt?.enabled) {
        add('tilt-x', `Tilt X ${formatFixed(layer.tilt.x, 3)}`);
        add('tilt-y', `Tilt Y ${formatFixed(layer.tilt.y, 3)}`);
        add('tilt-target', `Tilt target ${formatFixed(layer.tiltTarget.x, 3)}, ${formatFixed(layer.tiltTarget.y, 3)}`);
      }
    }
    if (state.scene.orbit.enabled) {
      add('camera-azimuth', `Camera azimuth ${formatFixed(resolved.camera.azimuth, 3)}°`);
    }
    if (state.scene.light.enabled) {
      add('light-focus', `Light focus ${formatFixed(resolved.lightFocus.x, 3)}, ${formatFixed(resolved.lightFocus.y, 3)}`);
    }
    readoutsPanel.append(el('h3', { class: 'muted small' }, 'Readouts'));
    readoutsPanel.append(list);

    // Draw order list
    const order = el('ul', { role: 'list', 'aria-label': 'Draw order', class: 'small muted' });
    const visible = resolved.layers.filter((l) => l.layer.visible);
    const depthOn = visible.filter((l) => (l.props.depthTest as boolean) !== false).sort((a, b) => a.layer.order - b.layer.order);
    const depthOff = visible.filter((l) => (l.props.depthTest as boolean) === false).sort((a, b) => a.layer.order - b.layer.order);
    for (const l of depthOn) order.append(el('li', {}, `${l.layer.name} · depth on`));
    for (const l of depthOff) order.append(el('li', {}, `${l.layer.name} · depth off · on top`));
    readoutsPanel.append(order);
  };

  // ---- Autosave ----
  const submitChanges = async (): Promise<void> => {
    if (state.pending.length === 0) return;
    const changes = state.pending;
    state.pending = [];
    state.opCounter += 1;
    const opId = `op-${Date.now()}-${state.opCounter}`;
    state.lastSaved = 'saving';
    updateSaveStatus();
    const res = await api<{ undoDepth: number; redoDepth: number }>(
      `/api/projects/${projectId}/ops`,
      {
        method: 'POST',
        body: JSON.stringify({ opId, sceneId: state.sceneId, changes }),
      },
    );
    if (res.ok && res.data) {
      state.lastSaved = 'saved';
      state.undoDepth = res.data.undoDepth;
      state.redoDepth = res.data.redoDepth;
    } else {
      state.lastSaved = 'error';
      // Keep retrying the same change.
      state.pending = [...changes, ...state.pending];
      if (state.saveTimer === null) {
        state.saveTimer = window.setTimeout(() => {
          state.saveTimer = null;
          void submitChanges();
        }, 800);
      }
    }
    updateSaveStatus();
  };

  const pushChange = (change: Change2): void => {
    state.pending.push(change);
    if (state.saveTimer !== null) {
      window.clearTimeout(state.saveTimer);
    }
    state.saveTimer = window.setTimeout(() => {
      state.saveTimer = null;
      void submitChanges();
    }, 800);
    renderPanels();
  };

  const updateSaveStatus = (): void => {
    const node = shell.querySelector<HTMLElement>('[aria-label="Save status"]');
    if (node) {
      node.textContent =
        state.lastSaved === 'saving'
          ? 'Saving…'
          : state.lastSaved === 'saved'
            ? 'All changes saved'
            : state.lastSaved === 'error'
              ? 'Not saved — retrying'
              : '';
    }
  };

  // ---- Panels ----
  let gizmoRefresh: (() => void) | null = null;
  const renderPanels = (): void => {
    renderLayersPanel();
    renderInspector();
    renderVariablesCard();
    if (gizmoRefresh) gizmoRefresh();
  };

  const renderLayersPanel = (): void => {
    layersPanel.textContent = '';
    const tree = el('ul', {
      class: 'layers-tree',
      role: 'tree',
      'aria-label': 'Layers',
      'aria-multiselectable': 'true',
    });
    // The first row is the fixed Camera row.
    const cameraRow = el('li', {
      role: 'treeitem',
      'aria-label': 'Camera, Camera',
      'data-layer-id': 'camera',
      'data-kind': 'Camera',
      'data-order': '-1',
      class: 'layer-row',
      tabindex: '0',
    });
    cameraRow.append(el('span', { class: 'name' }, 'Camera'));
    cameraRow.addEventListener('click', () => {
      state.selectedIds = [];
      state.focusedLayerId = 'camera';
      renderInspector();
    });
    tree.append(cameraRow);

    // Rows list the topmost layer first.
    const sorted = [...state.scene.layers].sort((a, b) => b.order - a.order);
    for (const layer of sorted) {
      tree.append(layerRow(layer));
    }
    layersPanel.append(tree);

    const addBtn = el('button', { class: 'btn', 'aria-label': 'Add layer', style: 'margin-top:8px' }, 'Add layer');
    addBtn.addEventListener('click', () => openAddMenu(addBtn));
    layersPanel.append(addBtn);
  };

  const layerRow = (layer: Layer): HTMLElement => {
    const selected = state.selectedIds.includes(layer.id);
    const held = state.lockHolders.get(layer.id);
    const row = el('li', {
      role: 'treeitem',
      'aria-label': `${layer.name}, ${layer.kind}`,
      'data-layer-id': layer.id,
      'data-kind': layer.kind,
      'data-order': String(layer.order),
      class: `layer-row${selected ? ' selected' : ''}`,
      tabindex: '0',
    });
    const expand = el(
      'button',
      { 'aria-label': layer.kind === 'Group' ? `Expand ${layer.name}` : `Select ${layer.name}` },
      layer.kind === 'Group' ? '▸' : '·',
    );
    if (layer.kind === 'Group') {
      expand.addEventListener('click', (e) => {
        e.stopPropagation();
        expand.textContent = expand.textContent === '▸' ? '▾' : '▸';
      });
    }
    const name = el('span', { class: 'name' }, layer.name);
    if (held && held.id !== person.id) {
      name.append(el('span', { class: 'small muted' }, ` — Held by ${held.name}`));
    }
    row.append(expand, name);

    const hide = el('button', { 'aria-label': layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}` }, layer.visible ? '👁' : '◌');
    hide.addEventListener('click', (e) => {
      e.stopPropagation();
      pushChange({ type: 'updateLayer', layerId: layer.id, set: 'visible', value: !layer.visible });
    });
    const lock = el('button', { 'aria-label': layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}` }, layer.locked ? '🔒' : '○');
    lock.addEventListener('click', (e) => {
      e.stopPropagation();
      pushChange({ type: 'updateLayer', layerId: layer.id, set: 'locked', value: !layer.locked });
    });
    const actions = el('button', { 'aria-label': `Actions for ${layer.name}` }, '⋯');
    actions.addEventListener('click', (e) => {
      e.stopPropagation();
      openRowMenu(actions, layer);
    });
    const drag = el('button', { 'aria-label': `Drag ${layer.name}`, draggable: 'true' }, '⠿');
    row.append(drag, hide, lock, actions);

    row.addEventListener('click', () => {
      if (e_shiftHeld(row)) {
        if (!state.selectedIds.includes(layer.id)) state.selectedIds.push(layer.id);
      } else {
        state.selectedIds = [layer.id];
      }
      state.focusedLayerId = layer.id;
      renderInspector();
      renderLayersPanel();
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const rows = [...row.parentElement?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []];
        const idx = rows.indexOf(row);
        const next = rows[idx + (e.key === 'ArrowDown' ? 1 : -1)];
        if (next) next.focus();
      } else if (e.key === ' ') {
        e.preventDefault();
        if (!state.selectedIds.includes(layer.id)) state.selectedIds.push(layer.id);
        else state.selectedIds = state.selectedIds.filter((x) => x !== layer.id);
        renderLayersPanel();
      } else if (e.key === 'ArrowUp' && e.altKey) {
        e.preventDefault();
        pushChange({ type: 'moveLayer', layerId: layer.id, parentId: layer.parentId, order: layer.order + 1 });
      } else if (e.key === 'ArrowDown' && e.altKey) {
        e.preventDefault();
        pushChange({ type: 'moveLayer', layerId: layer.id, parentId: layer.parentId, order: layer.order - 1 });
      }
    });
    return row;
  };

  const e_shiftHeld = (node: HTMLElement): boolean => {
    void node;
    return lastShift;
  };
  let lastShift = false;
  window.addEventListener('keydown', (e) => (lastShift = e.shiftKey));
  window.addEventListener('keyup', (e) => (lastShift = e.shiftKey));

  const openAddMenu = (anchor: HTMLElement): void => {
    const menu = el('div', { class: 'menu', role: 'menu', 'aria-label': 'Add layer' });
    const close = (): void => {
      menu.remove();
      document.removeEventListener('click', close, true);
      anchor.focus();
    };
    for (const kind of ADD_MENU_ITEMS) {
      const item = el('button', { role: 'menuitem', 'aria-label': kind }, kind);
      item.addEventListener('click', async () => {
        close();
        await addLayer(kind);
      });
      menu.append(item);
    }
    document.body.append(menu);
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    menu.querySelector<HTMLElement>('button')?.focus();
    setTimeout(() => document.addEventListener('click', close, true), 0);
  };

  const addLayer = async (kind: (typeof ADD_MENU_ITEMS)[number]): Promise<void> => {
    if (project.role === 'Viewer') {
      showEditorStatus("Viewers can't edit this project.");
      return;
    }
    let preset: string | null = null;
    if (kind === 'Model') {
      preset = 'Pebble';
    }
    const name = nextName(kind);
    const ref = `ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const maxOrder = state.scene.layers.reduce((m, l) => Math.max(m, l.order), -1);
    const props = makeDefaultProps(kind, preset as never, LIMITS);
    const layer: Record<string, unknown> = {
      id: '',
      name,
      kind,
      parentId: null,
      order: maxOrder + 1,
      visible: true,
      locked: false,
      maskAbove: false,
      blendMode: 'Normal',
      props,
      overrides: { tablet: {}, mobile: {} },
      keyframes: [],
      events: {},
      bindings: {},
    };
    if (kind === 'Model' && preset) {
      layer.props = { ...props, preset };
    }
    pushChange({ type: 'addLayer', layer, ref });
    const res = await api<{ ids: Record<string, string> }>(`/api/projects/${projectId}/ops`, {
      method: 'POST',
      body: JSON.stringify({ opId: `add-${Date.now()}`, sceneId: state.sceneId, changes: state.pending }),
    });
    if (res.ok && res.data) {
      state.pending = [];
      const newId = res.data.ids[ref];
      if (newId) {
        // Refresh and focus the new layer's row.
        await reloadScene();
        state.selectedIds = [newId];
        state.focusedLayerId = newId;
        renderPanels();
        const row = layersPanel.querySelector<HTMLElement>(`[data-layer-id="${newId}"]`);
        row?.focus();
      }
    }
  };

  const nextName = (kind: string): string => {
    const existing = state.scene.layers.filter((l) => l.name === kind || l.name.startsWith(`${kind} `));
    if (existing.length === 0) return kind;
    let n = 2;
    while (existing.some((l) => l.name === `${kind} ${n}`)) n += 1;
    return `${kind} ${n}`;
  };

  const reloadScene = async (): Promise<void> => {
    const res = await api<{ document: SceneBundle }>(`/api/projects/${projectId}`);
    if (res.ok && res.data) {
      state.bundle = res.data.document;
      state.scene = state.bundle.scenes.find((s) => s.id === state.sceneId) ?? state.bundle.scenes[0]!;
    }
  };

  const openRowMenu = (anchor: HTMLElement, layer: Layer): void => {
    const menu = el('div', { class: 'menu', role: 'menu', 'aria-label': `Actions for ${layer.name}` });
    const close = (): void => {
      menu.remove();
      document.removeEventListener('click', close, true);
      anchor.focus();
    };
    const item = (label: string, fn: () => void): void => {
      const b = el('button', { role: 'menuitem', 'aria-label': label }, label);
      b.addEventListener('click', () => {
        close();
        fn();
      });
      menu.append(b);
    };
    item('Move up', () => pushChange({ type: 'moveLayer', layerId: layer.id, parentId: layer.parentId, order: layer.order + 1 }));
    item('Move down', () => pushChange({ type: 'moveLayer', layerId: layer.id, parentId: layer.parentId, order: layer.order - 1 }));
    item('Duplicate', () => pushChange({ type: 'duplicateLayer', layerId: layer.id }));
    item('Group', () => {
      const ids = state.selectedIds.length > 0 ? state.selectedIds : [layer.id];
      pushChange({ type: 'group', layerIds: ids });
    });
    if (layer.kind === 'Group') item('Ungroup', () => pushChange({ type: 'ungroup', groupId: layer.id }));
    item('Delete', () => pushChange({ type: 'deleteLayer', layerId: layer.id }));
    document.body.append(menu);
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    menu.querySelector<HTMLElement>('button')?.focus();
    setTimeout(() => document.addEventListener('click', close, true), 0);
  };

  const showEditorStatus = (text: string): void => {
    const node = shell.querySelector<HTMLElement>('[aria-label="Editor status"]');
    if (node) node.textContent = text;
  };

  const renderInspector = (): void => {
    inspectorPanel.textContent = '';
    const selected = state.scene.layers.find((l) => l.id === state.selectedIds[0]);
    if (state.focusedLayerId === 'camera' || !selected) {
      renderSceneInspector(inspectorPanel);
    } else {
      renderLayerInspector(inspectorPanel, selected);
    }
  };

  const renderSceneInspector = (panel: HTMLElement): void => {
    const doc = state.scene;
    const fields: [string, string, number, string][] = [
      ['Field of view', 'camera.fov', doc.camera.fov, 'fov'],
      ['Camera position X', 'camera.position.x', doc.camera.position.x, 'camPos'],
      ['Camera position Y', 'camera.position.y', doc.camera.position.y, 'camPos'],
      ['Camera position Z', 'camera.position.z', doc.camera.position.z, 'camPos'],
      ['Camera target X', 'camera.target.x', doc.camera.target.x, 'camTarget'],
      ['Camera target Y', 'camera.target.y', doc.camera.target.y, 'camTarget'],
      ['Camera target Z', 'camera.target.z', doc.camera.target.z, 'camTarget'],
      ['Near', 'camera.near', doc.camera.near, 'near'],
      ['Far', 'camera.far', doc.camera.far, 'far'],
      ['Start angle', 'orbit.startAngle', doc.orbit.startAngle, 'angle'],
      ['End angle', 'orbit.endAngle', doc.orbit.endAngle, 'angle'],
    ];
    for (const [label, path, value, rangeKey] of fields) {
      const row = el('div', { class: 'field-row' });
      row.append(el('label', {}, label));
      const input = numberInput(label, path, value, rangeKey, (v) => {
        setSceneValue(path, v);
      });
      row.append(input);
      panel.append(row);
    }
    panel.append(switchRow('Scroll orbit', 'orbit.enabled', doc.orbit.enabled, (v) => setSceneValue('orbit.enabled', v)));
    panel.append(switchRow('Light field', 'light.enabled', doc.light.enabled, (v) => setSceneValue('light.enabled', v)));
    const envRow = el('div', { class: 'field-row' });
    envRow.append(el('label', {}, 'Environment'));
    const env = el('select', { 'aria-label': 'Environment' });
    for (const opt of ['Dusk room', 'Night grid', 'Flat']) {
      const o = el('option', { value: opt }, opt);
      if (doc.environment === opt) o.selected = true;
      env.append(o);
    }
    env.addEventListener('change', () => setSceneValue('environment', (env as HTMLSelectElement).value));
    envRow.append(env);
    panel.append(envRow);
    const bgRow = el('div', { class: 'field-row' });
    bgRow.append(el('label', {}, 'Background'));
    const bg = el('input', { type: 'text', value: doc.background, 'aria-label': 'Background' });
    bg.addEventListener('change', () => setSceneValue('background', (bg as HTMLInputElement).value));
    bgRow.append(bg);
    panel.append(bgRow);
  };

  const setSceneValue = (path: string, value: unknown): void => {
    setNested(state.scene as unknown as Record<string, unknown>, path, value);
    pushChange({ type: 'updateScene', set: path, value });
  };

  const renderLayerInspector = (panel: HTMLElement, layer: Layer): void => {
    const isViewer = project.role === 'Viewer';
    const disabled = isViewer;
    if (disabled) {
      panel.append(
        el('p', { class: 'small muted', title: "Viewers can't edit this project." }, 'Viewers can read every value.'),
      );
    }
    const props = layer.props;
    const numRow = (label: string, path: string, value: number, rangeKey: string): void => {
      const row = el('div', { class: 'field-row' });
      row.append(el('label', {}, label));
      const input = numberInput(label, path, value, rangeKey, (v) => {
        void takeLock(layer.id);
        pushChange({ type: 'updateLayer', layerId: layer.id, set: path, value: v, breakpoint: state.breakpoint });
      });
      if (disabled) {
        input.setAttribute('disabled', '');
        input.title = "Viewers can't edit this project.";
      }
      row.append(input);
      // Overridden fields show a reset marker.
      const src = sourceLevel(path, state.breakpoint, layer.overrides);
      if (src !== 'desktop') {
        const reset = el('button', {
          class: 'btn',
          'aria-label': `Reset ${label} to inherited value`,
          title: 'Reset',
          style: 'min-width:32px',
        }, '↺');
        reset.addEventListener('click', () => {
          pushChange({ type: 'clearOverride', layerId: layer.id, breakpoint: state.breakpoint === 'mobile' ? 'mobile' : 'tablet', path });
        });
        row.append(reset);
      }
      const binding = layer.bindings[path];
      if (binding) {
        row.append(el('span', { class: 'small muted' }, `Bound to ${binding}`));
      }
      panel.append(row);
    };
    const vecRow = (group: string, axes: string[], obj: Record<string, number>, rangeKey: string): void => {
      for (const axis of axes) {
        numRow(`${group} ${axis.toUpperCase()}`, `${group}.${axis}`, obj[axis] ?? 0, rangeKey);
      }
    };

    if (['Rectangle', 'Ellipse', 'Polygon', 'Text', 'Image', 'Gradient'].includes(layer.kind)) {
      numRow('X', 'x', props.x as number, 'x2d');
      numRow('Y', 'y', props.y as number, 'x2d');
      numRow('Width', 'width', props.width as number, 'size');
      numRow('Height', 'height', props.height as number, 'size');
      numRow('Opacity', 'opacity', props.opacity as number, 'opacityPct');
      if (layer.kind === 'Polygon') numRow('Sides', 'sides', props.sides as number, 'sides');
      if (layer.kind === 'Text') {
        numRow('Text size', 'textSize', props.textSize as number, 'textSize');
        const textRow = el('div', { class: 'field-row' });
        textRow.append(el('label', {}, 'Text'));
        const ti = el('input', { type: 'text', value: props.text as string, 'aria-label': 'Text' });
        ti.addEventListener('change', () => pushChange({ type: 'updateLayer', layerId: layer.id, set: 'text', value: (ti as HTMLInputElement).value }));
        textRow.append(ti);
        panel.append(textRow);
      } else if (layer.kind !== 'Gradient') {
        const fillRow = el('div', { class: 'field-row' });
        fillRow.append(el('label', {}, 'Fill'));
        const fi = el('input', { type: 'text', value: props.fill as string, 'aria-label': 'Fill' });
        fi.addEventListener('change', () => pushChange({ type: 'updateLayer', layerId: layer.id, set: 'fill', value: (fi as HTMLInputElement).value }));
        fillRow.append(fi);
        panel.append(fillRow);
      }
      if (layer.kind === 'Gradient') {
        const g = props.gradient as Record<string, unknown>;
        const typeRow = el('div', { class: 'field-row' });
        typeRow.append(el('label', {}, 'Gradient type'));
        const sel = el('select', { 'aria-label': 'Gradient type' });
        for (const t of ['Linear', 'Radial']) {
          const o = el('option', { value: t }, t);
          if (g.type === t) o.selected = true;
          sel.append(o);
        }
        sel.addEventListener('change', () => pushChange({ type: 'updateLayer', layerId: layer.id, set: 'gradient.type', value: (sel as HTMLSelectElement).value, breakpoint: 'desktop' }));
        typeRow.append(sel);
        panel.append(typeRow);
        numRow('Angle', 'gradient.angle', g.angle as number, 'gradientAngle');
        numRow('Centre X', 'gradient.centerX', g.centerX as number, 'gradientPos');
        numRow('Centre Y', 'gradient.centerY', g.centerY as number, 'gradientPos');
        numRow('Radius', 'gradient.radius', g.radius as number, 'gradientRadius');
      }
    }

    const is3D = ['Primitive', 'Extrusion', 'Model', 'Particles', 'Cloth'].includes(layer.kind);
    if (is3D) {
      vecRow('Position', ['x', 'y', 'z'], props.position as Record<string, number>, 'pos');
      vecRow('Rotation', ['x', 'y', 'z'], props.rotation as Record<string, number>, 'rot');
      vecRow('Scale', ['x', 'y', 'z'], props.scale as Record<string, number>, 'scale');
      const matRow = el('div', { class: 'field-row' });
      matRow.append(el('label', {}, 'Material'));
      const sel = el('select', { 'aria-label': 'Material' });
      for (const m of ['Matcap', 'Glass']) {
        const o = el('option', { value: m }, m);
        if ((props.material as Record<string, unknown>).kind === m) o.selected = true;
        sel.append(o);
      }
      sel.addEventListener('change', () => {
        const kind = (sel as HTMLSelectElement).value as 'Matcap' | 'Glass';
        const mat = props.material as Record<string, unknown>;
        mat.kind = kind;
        mat.color = kind === 'Matcap' ? '#FFFFFF' : '#B7A4FF';
        mat.opacity = kind === 'Matcap' ? 1 : 0.35;
        pushChange({ type: 'updateLayer', layerId: layer.id, set: 'material.kind', value: kind, breakpoint: 'desktop' });
        pushChange({ type: 'updateLayer', layerId: layer.id, set: 'material.color', value: mat.color, breakpoint: 'desktop' });
        pushChange({ type: 'updateLayer', layerId: layer.id, set: 'material.opacity', value: mat.opacity, breakpoint: 'desktop' });
      });
      matRow.append(sel);
      panel.append(matRow);
      numRow('Material opacity', 'material.opacity', (props.material as Record<string, number>).opacity, 'matOpacity');
      numRow('Refraction strength', 'material.refraction', (props.material as Record<string, number>).refraction, 'refraction');
      panel.append(switchRow('Back-face refraction', 'material.backFaceRefraction', (props.material as Record<string, boolean>).backFaceRefraction, (v) =>
        pushChange({ type: 'updateLayer', layerId: layer.id, set: 'material.backFaceRefraction', value: v, breakpoint: 'desktop' })));
      panel.append(switchRow('Depth testing', 'depthTest', props.depthTest as boolean, (v) => pushChange({ type: 'updateLayer', layerId: layer.id, set: 'depthTest', value: v, breakpoint: 'desktop' })));
      const facesRow = el('div', { class: 'field-row' });
      facesRow.append(el('label', {}, 'Faces'));
      const faces = el('div', { role: 'radiogroup', 'aria-label': 'Faces', style: 'display:flex;gap:12px' });
      for (const [value, label] of [['front', 'Front only'], ['both', 'Both sides']] as [string, string][]) {
        const id = `faces-${layer.id}-${value}`;
        const input = el('input', { type: 'radio', id, name: `faces-${layer.id}`, value });
        if ((props.faces as string) === value) input.checked = true;
        input.addEventListener('change', () => pushChange({ type: 'updateLayer', layerId: layer.id, set: 'faces', value, breakpoint: 'desktop' }));
        faces.append(input, el('label', { for: id }, label));
      }
      facesRow.append(faces);
      panel.append(facesRow);
    }

    if (layer.kind === 'Primitive') {
      const primRow = el('div', { class: 'field-row' });
      primRow.append(el('label', {}, 'Primitive'));
      const info = el('span', { class: 'small muted' }, String(props.primitive));
      primRow.append(info);
      panel.append(primRow);
    }

    if (layer.kind === 'Extrusion') {
      const textRow = el('div', { class: 'field-row' });
      textRow.append(el('label', {}, 'Extrude text'));
      const ti = el('input', { type: 'text', value: props.text as string, 'aria-label': 'Extrude text' });
      ti.addEventListener('change', () => pushChange({ type: 'updateLayer', layerId: layer.id, set: 'text', value: (ti as HTMLInputElement).value, breakpoint: 'desktop' }));
      textRow.append(ti);
      panel.append(textRow);
      numRow('Letter height', 'letterHeight', props.letterHeight as number, 'letterHeight');
      numRow('Extrude depth', 'depth', props.depth as number, 'extrudeDepth');
      numRow('Bevel size', 'bevelSize', props.bevelSize as number, 'bevelSize');
      numRow('Bevel segments', 'bevelSegments', props.bevelSegments as number, 'bevelSegments');
    }

    if (layer.kind === 'Particles') {
      const modeRow = el('div', { class: 'field-row' });
      modeRow.append(el('label', {}, 'Particle mode'));
      const mode = el('div', { role: 'radiogroup', 'aria-label': 'Particle mode', style: 'display:flex;gap:12px' });
      for (const [value, label] of [['emit', 'Emit'], ['form', 'Form into']] as [string, string][]) {
        const id = `mode-${layer.id}-${value}`;
        const input = el('input', { type: 'radio', id, name: `mode-${layer.id}`, value });
        if ((props.mode as string) === value) input.checked = true;
        input.addEventListener('change', () => pushChange({ type: 'updateLayer', layerId: layer.id, set: 'mode', value, breakpoint: 'desktop' }));
        mode.append(input, el('label', { for: id }, label));
      }
      modeRow.append(mode);
      panel.append(modeRow);
      numRow('Particle seed', 'seed', props.seed as number, 'seed');
      numRow('Rate', 'rate', props.rate as number, 'pRate');
      numRow('Burst', 'burst', props.burst as number, 'pBurst');
      numRow('Lifetime', 'lifetime', props.lifetime as number, 'pLifetime');
      numRow('Particle speed', 'speed', props.speed as number, 'pSpeed');
      numRow('Particle gravity', 'gravity', props.gravity as number, 'pGravity');
      numRow('Trail length', 'trailLength', props.trailLength as number, 'pTrail');
      numRow('Orbit', 'orbit', props.orbit as number, 'pOrbit');
      numRow('Attractor X', 'attractor.x', (props.attractor as Record<string, number>).x, 'pAttr');
      numRow('Attractor Y', 'attractor.y', (props.attractor as Record<string, number>).y, 'pAttr');
      numRow('Attractor Z', 'attractor.z', (props.attractor as Record<string, number>).z, 'pAttr');
      numRow('Attractor strength', 'attractor.strength', (props.attractor as Record<string, number>).strength, 'pAttrStrength');
      if (props.mode === 'form') {
        numRow('Count', 'formation.count', (props.formation as Record<string, number>).count, 'pCount');
        numRow('Formation duration', 'formation.durationMs', (props.formation as Record<string, number>).durationMs, 'pDuration');
      }
    }

    if (layer.kind === 'Cloth') {
      numRow('Columns', 'columns', props.columns as number, 'clothCR');
      numRow('Rows', 'rows', props.rows as number, 'clothCR');
      numRow('Cloth gravity', 'clothGravity', props.clothGravity as number, 'clothGravity');
      numRow('Wind strength', 'windStrength', props.windStrength as number, 'clothWind');
      numRow('Wind direction', 'windDirection', props.windDirection as number, 'clothWindDir');
      numRow('Cloth stiffness', 'stiffness', props.stiffness as number, 'clothStiff');
      numRow('Cloth damping', 'damping', props.damping as number, 'clothDamp');
      numRow('Constraint iterations', 'iterations', props.iterations as number, 'clothIter');
      numRow('Cloth seed', 'clothSeed', props.clothSeed as number, 'seed');
      const pinRow = el('div', { class: 'field-row' });
      pinRow.append(el('label', {}, 'Pinned edge'));
      const sel = el('select', { 'aria-label': 'Pinned edge' });
      for (const p of ['Top', 'Left', 'Corners', 'None']) {
        const o = el('option', { value: p }, p);
        if ((props.pinned as string) === p) o.selected = true;
        sel.append(o);
      }
      sel.addEventListener('change', () => pushChange({ type: 'updateLayer', layerId: layer.id, set: 'pinned', value: (sel as HTMLSelectElement).value, breakpoint: 'desktop' }));
      pinRow.append(sel);
      panel.append(pinRow);
    }

    // Sample readout fields
    const sampleX = el('input', { type: 'number', value: '100', 'aria-label': 'Sample X', style: 'width:80px' });
    const sampleY = el('input', { type: 'number', value: '100', 'aria-label': 'Sample Y', style: 'width:80px' });
    const sampleRow = el('div', { class: 'field-row' });
    sampleRow.append(el('label', {}, 'Sample'), sampleX, sampleY);
    panel.append(sampleRow);
  };

  const numberInput = (
    label: string,
    _path: string,
    value: number,
    rangeKey: string,
    commit: (v: number) => void,
  ): HTMLInputElement => {
    const input = el('input', {
      type: 'number',
      step: String(RANGE[rangeKey]?.step ?? 1),
      value: String(value),
      'aria-label': label,
    });
    const step = RANGE[rangeKey]?.step ?? 1;
    const shiftStep = RANGE[rangeKey]?.shiftStep ?? step * 10;
    const min = RANGE[rangeKey]?.min ?? -Infinity;
    const max = RANGE[rangeKey]?.max ?? Infinity;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const delta = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? shiftStep : step);
        let v = Number((input as HTMLInputElement).value) + delta;
        v = Math.min(max, Math.max(min, v));
        (input as HTMLInputElement).value = String(v);
        commit(v);
        keepFocus(input);
      }
    });
    input.addEventListener('change', () => {
      let v = Number((input as HTMLInputElement).value);
      if (!Number.isFinite(v)) return;
      v = Math.min(max, Math.max(min, v));
      (input as HTMLInputElement).value = String(v);
      commit(v);
    });
    return input as HTMLInputElement;
  };

  const switchRow = (label: string, _path: string, value: boolean, commit: (v: boolean) => void): HTMLElement => {
    const row = el('div', { class: 'field-row' });
    row.append(el('label', {}, label));
    const input = el('input', { type: 'checkbox', 'aria-label': label });
    (input as HTMLInputElement).checked = value;
    input.addEventListener('change', () => commit((input as HTMLInputElement).checked));
    row.append(input);
    return row;
  };

  const takeLock = async (layerId: string): Promise<void> => {
    if (project.role === 'Viewer') return;
    await api(`/api/projects/${projectId}/layers/${layerId}/lock`, { method: 'PUT', body: '{}' });
  };

  const renderVariablesCard = (): void => {
    variablesCard.textContent = '';
    const tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Variables and presets' });
    const varTab = el('button', { role: 'tab', 'aria-selected': 'true', 'aria-label': 'Variables' }, 'Variables');
    const presetTab = el('button', { role: 'tab', 'aria-selected': 'false', 'aria-label': 'Presets' }, 'Presets');
    tabs.append(varTab, presetTab);
    const varBody = el('div', {});
    const presetBody = el('div', { style: 'display:none' });
    variablesCard.append(tabs, varBody, presetBody);

    varTab.addEventListener('click', () => {
      varTab.setAttribute('aria-selected', 'true');
      presetTab.setAttribute('aria-selected', 'false');
      varBody.style.display = '';
      presetBody.style.display = 'none';
    });
    presetTab.addEventListener('click', () => {
      presetTab.setAttribute('aria-selected', 'true');
      varTab.setAttribute('aria-selected', 'false');
      presetBody.style.display = '';
      varBody.style.display = 'none';
    });

    // New variable row
    const row = el('div', { class: 'field-row' });
    const name = el('input', { type: 'text', 'aria-label': 'New variable name', placeholder: 'name' });
    const type = el('select', { 'aria-label': 'Variable type' });
    for (const t of ['Number', 'Boolean', 'Text', 'Colour', 'Vector 2', 'Vector 3']) {
      type.append(el('option', { value: t }, t));
    }
    const add = el('button', { class: 'btn', 'aria-label': 'Add variable' }, 'Add variable');
    row.append(name, type, add);
    varBody.append(row);
    add.addEventListener('click', () => {
      const n = (name as HTMLInputElement).value.trim();
      if (!/^[a-z][a-z0-9_]{0,31}$/.test(n)) {
        showEditorStatus('Use a lowercase letter first, then lowercase letters, digits or _ (at most 32 characters).');
        return;
      }
      const t = (type as HTMLSelectElement).value as Variable['type'];
      const value = t === 'Number' ? 0 : t === 'Boolean' ? true : t === 'Text' ? '' : t === 'Colour' ? '#FFFFFF' : t === 'Vector 2' ? { x: 0, y: 0 } : { x: 0, y: 0, z: 0 };
      pushChange({ type: 'addVariable', variable: { name: n, type: t, value } });
      (name as HTMLInputElement).value = '';
    });

    for (const v of state.bundle.variables) {
      const r = el('div', { class: 'field-row' });
      r.append(el('label', {}, v.name));
      if (v.type === 'Number' || v.type === 'Text' || v.type === 'Colour') {
        const input = el('input', {
          type: v.type === 'Number' ? 'number' : 'text',
          value: String(v.value),
          'aria-label': `${v.name} value`,
        });
        input.addEventListener('change', () => {
          const value = v.type === 'Number' ? Number((input as HTMLInputElement).value) : (input as HTMLInputElement).value;
          pushChange({ type: 'updateVariable', name: v.name, value });
        });
        r.append(input);
      } else if (v.type === 'Boolean') {
        const input = el('input', { type: 'checkbox', 'aria-label': `${v.name} value` });
        (input as HTMLInputElement).checked = v.value === true;
        input.addEventListener('change', () => {
          pushChange({ type: 'updateVariable', name: v.name, value: (input as HTMLInputElement).checked });
        });
        r.append(input);
      } else if (v.type === 'Vector 2' || v.type === 'Vector 3') {
        const val = v.value as Record<string, number>;
        for (const axis of v.type === 'Vector 2' ? ['x', 'y'] : ['x', 'y', 'z']) {
          const input = el('input', { type: 'number', value: String(val[axis] ?? 0), 'aria-label': `${v.name} ${axis}` });
          input.addEventListener('change', () => {
            const next = { ...(v.value as Record<string, number>) };
            next[axis] = Number((input as HTMLInputElement).value);
            pushChange({ type: 'updateVariable', name: v.name, value: next });
          });
          r.append(input);
        }
      }
      const del = el('button', { class: 'btn', 'aria-label': `Delete ${v.name}` }, 'Delete');
      del.addEventListener('click', () => {
        pushChange({ type: 'deleteVariable', name: v.name });
        showEditorStatus(`Deleted ${v.name}.`);
      });
      r.append(del);
      varBody.append(r);
    }

    for (const p of state.bundle.presets) {
      const b = el('button', { class: 'btn', 'aria-label': `Apply ${p.name}` }, `Apply ${p.name}`);
      b.addEventListener('click', () => {
        pushChange({ type: 'applyPreset', name: p.name, values: p.values });
        showEditorStatus(`Applied ${p.name}.`);
      });
      presetBody.append(b);
    }
    const nameRow = el('div', { class: 'field-row' });
    const presetName = el('input', { type: 'text', 'aria-label': 'Preset name' });
    const saveBtn = el('button', { class: 'btn', 'aria-label': 'Save preset' }, 'Save preset');
    saveBtn.addEventListener('click', () => {
      const n = (presetName as HTMLInputElement).value.trim();
      if (!n) return;
      pushChange({ type: 'savePreset', name: n });
    });
    nameRow.append(presetName, saveBtn);
    presetBody.append(nameRow);
  };

  renderPanels();

  // ---- Timeline ----
  renderTimeline(
    timelinePanel,
    state,
    (frame) => {
      state.frame = frame;
    },
    () => void addKeyframe(),
    () => renderPanels(),
    () => void submitChanges(),
  );

  // ---- Preview bar (above the stage) ----
  const previewBar = el('div', { class: 'preview-bar panel', style: 'padding:8px 12px;margin-bottom:8px' });
  const bpGroup = el('div', { role: 'radiogroup', 'aria-label': 'Breakpoint', class: 'group' });
  for (const bp of ['Desktop', 'Tablet', 'Mobile'] as const) {
    const id = `bp-${bp}`;
    const input = el('input', { type: 'radio', id, name: 'breakpoint', value: bp.toLowerCase() });
    if (bp === 'Desktop') input.checked = true;
    input.addEventListener('change', () => {
      state.breakpoint = bp.toLowerCase() as Breakpoint;
      renderPanels();
    });
    bpGroup.append(input, el('label', { for: id }, bp));
  }
  const previewSwitch = el('input', { type: 'checkbox', 'aria-label': 'Preview' });
  previewSwitch.addEventListener('change', () => {
    state.preview = (previewSwitch as HTMLInputElement).checked;
  });
  const reduceSwitch = el('input', { type: 'checkbox', 'aria-label': 'Reduce motion' });
  reduceSwitch.addEventListener('change', () => {
    state.reduced = (reduceSwitch as HTMLInputElement).checked;
  });
  const scrollInput = el('input', {
    type: 'range',
    min: '0',
    max: '100',
    step: '1',
    value: '0',
    'aria-label': 'Scroll progress',
    style: 'min-width:180px',
  });
  scrollInput.addEventListener('input', () => {
    state.scroll = Number((scrollInput as HTMLInputElement).value);
  });
  previewBar.append(bpGroup, previewSwitch, el('span', { class: 'small muted' }, 'Preview'), reduceSwitch, el('span', { class: 'small muted' }, 'Reduce motion'), scrollInput);

  const stageWrap = el('div', {});
  stageWrap.append(previewBar, stagePanel);
  stagePanel.replaceWith(stageWrap);

  // The Scene combobox switches between the project's scenes.
  const sceneSelect = el('select', { 'aria-label': 'Scene' });
  const refreshScenes = (): void => {
    sceneSelect.textContent = '';
    for (const scene of state.bundle.scenes) {
      const o = el('option', { value: scene.id }, scene.name);
      if (scene.id === state.sceneId) o.selected = true;
      sceneSelect.append(o);
    }
  };
  refreshScenes();
  sceneSelect.addEventListener('change', () => {
    state.sceneId = (sceneSelect as HTMLSelectElement).value;
    state.scene = state.bundle.scenes.find((s) => s.id === state.sceneId) ?? state.bundle.scenes[0]!;
    state.selectedIds = [];
    renderPanels();
  });
  const actionsRow = shell.querySelector<HTMLElement>('[class="header-actions"]');
  actionsRow?.append(sceneSelect);

  // The gizmo: move and rotate handles for the selected 3D layer, shown when
  // Preview is off.
  const gizmo = el('div', { role: 'group', 'aria-label': 'Gizmo', style: 'position:absolute;left:8px;bottom:8px;display:none;flex-wrap:wrap;gap:6px' });
  stagePanel.parentElement?.style.setProperty('position', 'relative');
  stageWrap.style.position = 'relative';
  stageWrap.append(gizmo);
  const refreshGizmo = (): void => {
    const selected = state.scene.layers.find((l) => l.id === state.selectedIds[0]);
    const is3D = selected && ['Primitive', 'Extrusion', 'Model', 'Particles', 'Cloth'].includes(selected.kind);
    gizmo.style.display = !state.preview && is3D ? 'flex' : 'none';
    gizmo.textContent = '';
    if (!is3D) return;
    const groups: [string, string][] = [
      ['Move along X', 'position.x'],
      ['Move along Y', 'position.y'],
      ['Move along Z', 'position.z'],
      ['Rotate around X', 'rotation.x'],
      ['Rotate around Y', 'rotation.y'],
      ['Rotate around Z', 'rotation.z'],
    ];
    for (const [label, path] of groups) {
      const btn = el('button', { class: 'btn', 'aria-label': label, style: 'min-width:44px;min-height:44px' }, label.split(' ').pop()!);
      // Dragging a handle changes the value live; Shift uses the coarse snap.
      let dragging = false;
      let startValue = 0;
      let startX = 0;
      btn.addEventListener('pointerdown', (e) => {
        dragging = true;
        startX = e.clientX;
        startValue = Number(getNested(selected!.props, path) ?? 0);
        btn.setPointerCapture(e.pointerId);
      });
      btn.addEventListener('pointermove', (e) => {
        if (!dragging || !selected) return;
        e.preventDefault();
        const delta = e.clientX - startX;
        if (path.startsWith('position')) {
          const step = e.shiftKey ? 0.1 : 0.01;
          const v = snap(startValue + delta * step, step);
          setNested(selected.props, path, v);
          pushChange({ type: 'updateLayer', layerId: selected.id, set: path, value: v, breakpoint: state.breakpoint });
        } else {
          const step = e.shiftKey ? 15 : 1;
          const v = snap(startValue + delta * 0.5, step);
          setNested(selected.props, path, v);
          pushChange({ type: 'updateLayer', layerId: selected.id, set: path, value: v, breakpoint: state.breakpoint });
        }
      });
      btn.addEventListener('pointerup', () => {
        dragging = false;
      });
      gizmo.append(btn);
    }
  };
  const snap = (v: number, step: number): number => Math.round(v / step) * step;
  gizmoRefresh = refreshGizmo;

  // The pointer over the stage drives cursor tilt and the light focus, and
  // the arrow keys move a virtual pointer while the stage is focused.
  const updatePointer = (e: PointerEvent): void => {
    const rect = stagePanel.getBoundingClientRect();
    state.pointer = {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  };
  stagePanel.addEventListener('pointermove', (e) => {
    if (state.preview) updatePointer(e);
  });
  stagePanel.addEventListener('pointerleave', () => {
    state.pointer = null;
    state.pointerFrames = 0;
  });
  stagePanel.addEventListener('keydown', (e) => {
    const delta = 0.1;
    if (!state.pointer) state.pointer = { x: 0.5, y: 0.5 };
    if (e.key === 'ArrowLeft') state.pointer.x = Math.max(0, state.pointer.x - delta);
    else if (e.key === 'ArrowRight') state.pointer.x = Math.min(1, state.pointer.x + delta);
    else if (e.key === 'ArrowUp') state.pointer.y = Math.max(0, state.pointer.y - delta);
    else if (e.key === 'ArrowDown') state.pointer.y = Math.min(1, state.pointer.y + delta);
    else if (e.key === 'Escape') state.pointer = null;
    else return;
    e.preventDefault();
    state.pointerFrames = 0;
  });
  // A pointer change takes effect at the next frame; frames are counted from
  // elapsed clock time.
  setInterval(() => {
    if (state.pointer) state.pointerFrames += 1;
  }, 1000 / 60);

  // ---- Keyboard shortcuts ----
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    const inTextEntry =
      target.tagName === 'TEXTAREA' ||
      (target.tagName === 'INPUT' &&
        (target.getAttribute('type') === 'text' ||
          target.getAttribute('aria-label') === 'Extrude text' ||
          target.getAttribute('aria-label') === 'Text'));
    if (target && inTextEntry) {
      // Keys type as usual inside text entry.
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault();
      void doUndo();
    } else if (mod && e.key.toLowerCase() === 'z' && e.shiftKey) {
      e.preventDefault();
      void doRedo();
    } else if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      const id = state.selectedIds[0];
      if (id) pushChange({ type: 'duplicateLayer', layerId: id });
    } else if (mod && e.key.toLowerCase() === 'g' && !e.shiftKey) {
      e.preventDefault();
      if (state.selectedIds.length > 0) pushChange({ type: 'group', layerIds: state.selectedIds });
    } else if (mod && e.key.toLowerCase() === 'g' && e.shiftKey) {
      e.preventDefault();
      const id = state.selectedIds[0];
      const layer = state.scene.layers.find((l) => l.id === id);
      if (layer?.kind === 'Group') pushChange({ type: 'ungroup', groupId: id });
    } else if (e.key === 'Delete') {
      const id = state.selectedIds[0];
      if (id) pushChange({ type: 'deleteLayer', layerId: id });
    } else if (e.key.toLowerCase() === 'k') {
      e.preventDefault();
      addKeyframe();
    }
  });

  const addKeyframe = (): void => {
    const layerId = state.selectedIds[0];
    if (!layerId) {
      showEditorStatus('Choose a property first.');
      return;
    }
    const layer = state.scene.layers.find((l) => l.id === layerId);
    if (!layer) return;
    let path = state.focusedFieldPath;
    if (!path) {
      // The inspector field that most recently had focus.
      const focused = inspectorPanel.querySelector<HTMLElement>('input:focus');
      path = focused?.getAttribute('aria-label')?.toLowerCase().replace(/ /g, '.') ?? null;
    }
    if (!path) {
      showEditorStatus('Choose a property first.');
      return;
    }
    const value = readProp(layer, path);
    pushChange({
      type: 'setKeyframe',
      layerId,
      property: path,
      frame: state.frame,
      value,
      easing: 'linear',
    });
    showEditorStatus(`Keyframe added at ${formatTimeReadout(state.frame)}`);
  };

  const readProp = (layer: Layer, path: string): number | string | boolean => {
    const v = getNested(layer.props, path);
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
    return 0;
  };

  const doUndo = async (): Promise<void> => {
    state.opCounter += 1;
    const res = await api(`/api/projects/${projectId}/undo`, {
      method: 'POST',
      body: JSON.stringify({ opId: `undo-${Date.now()}-${state.opCounter}` }),
    });
    if (res.ok) {
      showEditorStatus('Undone');
      await reloadScene();
      renderPanels();
    } else {
      showEditorStatus(res.message ?? 'Nothing to undo');
    }
  };

  const doRedo = async (): Promise<void> => {
    state.opCounter += 1;
    const res = await api(`/api/projects/${projectId}/redo`, {
      method: 'POST',
      body: JSON.stringify({ opId: `redo-${Date.now()}-${state.opCounter}` }),
    });
    if (res.ok) {
      showEditorStatus('Redone');
      await reloadScene();
      renderPanels();
    } else {
      showEditorStatus(res.message ?? 'Nothing to redo');
    }
  };

  // ---- Live channel ----
  const connectWs = (): void => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'subscribe', projectId, personId: person.id, name: person.name }));
      showEditorStatus('Reconnected');
    });
    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as {
          type: string;
          people?: { id: string; name: string }[];
          changes?: Change2[];
          lock?: { layerId: string; heldBy: { id: string; name: string } | null };
        };
        if (msg.type === 'presence' && msg.people) {
          state.presence = msg.people.filter((p) => p.id !== person.id);
          renderPresence();
        } else if (msg.type === 'change') {
          void reloadScene().then(() => renderPanels());
        } else if (msg.type === 'lock' && msg.lock) {
          if (msg.lock.heldBy) state.lockHolders.set(msg.lock.layerId, msg.lock.heldBy);
          else state.lockHolders.delete(msg.lock.layerId);
          renderLayersPanel();
        }
      } catch {
        // ignore
      }
    });
    ws.addEventListener('close', () => {
      showEditorStatus('Connection lost — reconnecting');
      setTimeout(connectWs, 2000);
    });
  };
  connectWs();

  const renderPresence = (): void => {
    const row = shell.querySelector<HTMLElement>('[aria-label="Presence"]');
    if (row) {
      row.textContent = '';
      for (const p of state.presence) {
        const img = el('img', { alt: `${p.name} is here`, src: '/avatar.svg', style: 'width:28px;height:28px' });
        row.append(img);
      }
    }
  };

  renderPresence();

  // ---- Members, Versions and Publish ----
  const membersBtn = header.querySelector<HTMLButtonElement>('[aria-label="Members"]');
  const versionsBtn = header.querySelector<HTMLButtonElement>('[aria-label="Versions"]');
  const publishBtn = header.querySelector<HTMLButtonElement>('[aria-label="Publish"]');
  const undoBtn = header.querySelector<HTMLButtonElement>('[aria-label="Undo"]');
  const redoBtn = header.querySelector<HTMLButtonElement>('[aria-label="Redo"]');
  undoBtn?.addEventListener('click', () => void doUndo());
  redoBtn?.addEventListener('click', () => void doRedo());

  membersBtn?.addEventListener('click', () => void openMembersDialog());
  versionsBtn?.addEventListener('click', () => void openVersionsDialog());
  publishBtn?.addEventListener('click', () => void doPublish());

  const openMembersDialog = async (): Promise<void> => {
    const dlg = el('dialog', { 'aria-label': 'Members' });
    dlg.append(el('h3', {}, 'Members'));
    const status = el('div', { role: 'status', 'aria-label': 'Members status', class: 'status-line' });
    const res = await api<{ members: { personId: string; name: string; email: string; role: string }[]; invites: { id: string; email: string; role: string; status: string; expiresAt: string }[] }>(
      `/api/projects/${projectId}/members`,
    );
    const list = el('ul', { role: 'list', 'aria-label': 'Members', style: 'list-style:none;padding:0' });
    for (const m of res.data?.members ?? []) {
      const li = el('li', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0' });
      li.append(el('span', {}, `${m.name} · ${m.role}`));
      if (m.role !== 'Owner') {
        const rm = el('button', { class: 'btn', 'aria-label': `Remove ${m.name}` }, 'Remove');
        rm.addEventListener('click', async () => {
          const r = await api(`/api/projects/${projectId}/members/${m.personId}`, { method: 'DELETE' });
          if (r.ok) {
            li.remove();
          } else {
            status.textContent = r.message ?? '';
          }
        });
        li.append(rm);
      }
      list.append(li);
    }
    for (const inv of res.data?.invites ?? []) {
      const li = el('li', { style: 'display:flex;justify-content:space-between;padding:6px 0' });
      const text =
        inv.status === 'queued'
          ? `${inv.email} · ${inv.role} · Invite queued — mail is unavailable`
          : `${inv.email} · ${inv.role} · Invite sent`;
      li.append(el('span', { class: 'small muted' }, text));
      list.append(li);
    }
    dlg.append(list, status);
    const inviteBtn = el('button', { class: 'btn btn-primary', 'aria-label': 'Invite people' }, 'Invite people');
    inviteBtn.addEventListener('click', () => {
      const invDlg = el('dialog', { 'aria-label': 'Invite people' });
      invDlg.append(el('h3', {}, 'Invite people'));
      const email = el('input', { type: 'email', 'aria-label': 'Email', style: 'width:100%;margin:8px 0;padding:10px;background:var(--raised);border:1px solid var(--hairline);border-radius:4px' });
      const roleGroup = el('div', { role: 'radiogroup', 'aria-label': 'Role', style: 'display:flex;gap:12px;margin:8px 0' });
      const editorRadio = el('input', { type: 'radio', id: 'role-editor', name: 'invite-role', value: 'Editor', checked: '' });
      const viewerRadio = el('input', { type: 'radio', id: 'role-viewer', name: 'invite-role', value: 'Viewer' });
      roleGroup.append(editorRadio, el('label', { for: 'role-editor' }, 'Editor'), viewerRadio, el('label', { for: 'role-viewer' }, 'Viewer'));
      const send = el('button', { class: 'btn btn-primary', 'aria-label': 'Send invite', style: 'width:100%' }, 'Send invite');
      const closeBtn = el('button', { class: 'btn', 'aria-label': 'Close' }, 'Close');
      invDlg.append(email, roleGroup, send, closeBtn);
      document.body.append(invDlg);
      invDlg.showModal();
      email.focus();
      closeBtn.addEventListener('click', () => invDlg.close());
      send.addEventListener('click', async () => {
        send.textContent = 'Sending…';
        send.setAttribute('disabled', '');
        const role = editorRadio.checked ? 'Editor' : 'Viewer';
        const r = await api<{ invite: { status: string } }>(`/api/projects/${projectId}/invites`, {
          method: 'POST',
          body: JSON.stringify({ email: (email as HTMLInputElement).value, role }),
        });
        send.textContent = 'Send invite';
        send.removeAttribute('disabled');
        if (r.ok) {
          status.textContent = `Invite sent to ${(email as HTMLInputElement).value}.`;
          invDlg.close();
          dlg.close();
          void openMembersDialog();
        } else {
          status.textContent = r.message ?? '';
        }
      });
    });
    const close = el('button', { class: 'btn', 'aria-label': 'Close' }, 'Close');
    dlg.append(inviteBtn, close);
    document.body.append(dlg);
    dlg.showModal();
    close.addEventListener('click', () => dlg.close());
  };

  const openVersionsDialog = async (): Promise<void> => {
    const dlg = el('dialog', { 'aria-label': 'Versions' });
    dlg.append(el('h3', {}, 'Versions'));
    const res = await api<{ versions: { number: number; status: string; publishedAt: string; notice: string }[] }>(
      `/api/projects/${projectId}/versions`,
    );
    const list = el('ul', { role: 'list', 'aria-label': 'Versions', style: 'list-style:none;padding:0' });
    for (const v of res.data?.versions ?? []) {
      const li = el('li', { style: 'display:flex;flex-direction:column;gap:6px;padding:8px 0;border-bottom:1px solid var(--hairline)' });
      const when = formatDateTimeLocal(v.publishedAt);
      const liveText = v.status === 'live' ? 'Live' : 'Superseded';
      li.append(el('span', {}, `Version ${v.number} · ${when} · ${liveText}`));
      li.append(
        el(
          'span',
          { class: 'small ' + (v.notice === 'queued' ? 'amber' : 'muted') },
          v.notice === 'queued' ? 'Notice queued — mail is unavailable' : 'Notice sent',
        ),
      );
      const row = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' });
      if (project.role === 'Owner') {
        const repub = el('button', { class: 'btn', 'aria-label': `Republish version ${v.number}` }, `Republish version ${v.number}`);
        repub.addEventListener('click', async () => {
          await doPublish(v.number);
          dlg.close();
        });
        row.append(repub);
      }
      const exportLink = el('a', { class: 'btn', href: `/api/projects/${projectId}/versions/${v.number}/export`, 'aria-label': `Export version ${v.number} JSON` }, `Export version ${v.number} JSON`);
      row.append(exportLink);
      li.append(row);
      list.append(li);
    }
    dlg.append(list);
    const embedCode = el('input', {
      type: 'text',
      readonly: '',
      value: `<iframe src="${window.location.origin}/embed/${projectId}" width="100%" height="600" allowtransparency></iframe>`,
      'aria-label': 'Embed code',
      style: 'width:100%;margin:8px 0;padding:10px;background:var(--raised);border:1px solid var(--hairline);border-radius:4px',
    });
    const copyBtn = el('button', { class: 'btn', 'aria-label': 'Copy embed code' }, 'Copy embed code');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText((embedCode as HTMLInputElement).value);
        showEditorStatus('Embed code copied.');
      } catch {
        showEditorStatus('Embed code copied.');
      }
    });
    const exportWorking = el('a', { class: 'btn', href: `/api/projects/${projectId}/export`, 'aria-label': 'Export working JSON' }, 'Export working JSON');
    const close = el('button', { class: 'btn', 'aria-label': 'Close' }, 'Close');
    dlg.append(embedCode, copyBtn, exportWorking, close);
    document.body.append(dlg);
    dlg.showModal();
    close.addEventListener('click', () => dlg.close());
  };

  const doPublish = async (fromVersion?: number): Promise<void> => {
    if (!publishBtn) return;
    const label = publishBtn.getAttribute('aria-label') ?? 'Publish';
    publishBtn.textContent = 'Publishing…';
    publishBtn.setAttribute('disabled', '');
    const key = `pub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const res = await api<{ version: { number: number } }>(`/api/projects/${projectId}/versions`, {
      method: 'POST',
      headers: { 'idempotency-key': key },
      body: JSON.stringify(fromVersion ? { fromVersion } : {}),
    });
    publishBtn.textContent = label;
    publishBtn.removeAttribute('disabled');
    if (res.ok) {
      showEditorStatus(`Version ${res.data!.version.number} is live.`);
      state.project.liveVersion = res.data!.version.number;
    } else {
      showEditorStatus(res.message ?? 'Publishing failed.');
    }
  };
}

function formatDateTimeLocal(iso: string): string {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${date} ${time}`;
}

function buildEditorHeader(person: Person, state: EditorState): HTMLElement {
  const header = el('header', { class: 'workspace-header', role: 'banner' });
  const home = el('a', { class: 'wordmark', href: '/', 'aria-label': 'Halation Studio home' }, 'Halation Studio');
  header.append(home);
  const actions = el('div', { class: 'header-actions' });
  actions.append(el('span', { role: 'status', 'aria-label': 'Save status', class: 'status-line' }, ''));
  actions.append(el('span', { role: 'status', 'aria-label': 'Editor status', class: 'status-line' }, ''));
  const presence = el('span', { 'aria-label': 'Presence', class: 'avatar-row' });
  actions.append(presence);
  const undo = el('button', { class: 'btn', 'aria-label': 'Undo' }, 'Undo');
  const redo = el('button', { class: 'btn', 'aria-label': 'Redo' }, 'Redo');
  const members = el('button', { class: 'btn', 'aria-label': 'Members' }, 'Members');
  const versions = el('button', { class: 'btn', 'aria-label': 'Versions' }, 'Versions');
  const publish = el('button', { class: 'btn btn-primary', 'aria-label': 'Publish' }, 'Publish');
  actions.append(undo, redo, members, versions, publish);
  actions.append(el('span', { class: 'small muted' }, person.name));
  header.append(actions);
  void state;
  return header;
}

function renderTimeline(
  panel: HTMLElement,
  state: EditorState,
  setFrame: (f: number) => void,
  onAddKeyframe: () => void,
  refresh: () => void,
  submit: () => void | Promise<void>,
): void {
  const play = el('button', { class: 'btn', 'aria-label': 'Play' }, 'Play');
  const addKf = el('button', { class: 'btn', 'aria-label': 'Add keyframe' }, 'Add keyframe');
  const totalFrames = Math.max(1, Math.round((state.scene.durationMs / 1000) * 60));
  const playhead = el('input', {
    type: 'range',
    min: '0',
    max: String(totalFrames - 1),
    step: '1',
    value: String(state.frame),
    'aria-label': 'Playhead',
    'aria-valuetext': formatTimeReadout(state.frame),
    style: 'flex:1',
  });
  const duration = el('input', {
    type: 'number',
    value: String(state.scene.durationMs / 1000),
    step: '0.1',
    'aria-label': 'Duration',
    style: 'width:80px',
  });
  const bar = el('div', { style: 'display:flex;gap:12px;align-items:center;flex-wrap:wrap' });
  bar.append(play, addKf, playhead, el('span', { class: 'small muted' }, 'Duration'), duration);
  panel.append(bar);

  // One keyframe button per keyframe of the selected layer.
  const keyframeRow = el('div', { class: 'timeline-track', style: 'margin-top:8px' });
  const renderKeyframes = (): void => {
    keyframeRow.textContent = '';
    const selected = state.scene.layers.find((l) => l.id === state.selectedIds[0]);
    const kfs = (selected?.keyframes ?? []).slice().sort((a, b) => a.frame - b.frame);
    for (const kf of kfs) {
      const left = (kf.frame / totalFrames) * 100;
      const label = `${kf.property} keyframe at ${formatTimeReadout(kf.frame)}`;
      const btn = el('button', {
        class: 'btn',
        'aria-label': label,
        title: label,
        style: `position:absolute;left:${left}%;top:8px;min-width:12px;min-height:12px;padding:0;background:var(--accent-soft)`,
      });
      btn.addEventListener('click', () => {
        setFrame(kf.frame);
        (playhead as HTMLInputElement).value = String(kf.frame);
      });
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const delta = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1);
          const to = Math.max(0, kf.frame + delta);
          pushTimelineChange({ type: 'moveKeyframe', layerId: selected!.id, property: kf.property, fromFrame: kf.frame, toFrame: to });
        } else if (e.key === 'Delete') {
          e.preventDefault();
          pushTimelineChange({ type: 'deleteKeyframe', layerId: selected!.id, property: kf.property, frame: kf.frame });
        }
      });
      keyframeRow.append(btn);
    }
    const playheadLine = el('div', { class: 'playhead', style: `left:${(state.frame / totalFrames) * 100}%` });
    keyframeRow.append(playheadLine);
  };
  panel.append(keyframeRow);

  const pushTimelineChange = (change: Record<string, unknown>): void => {
    state.pending.push(change as never);
    if (state.saveTimer !== null) window.clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(() => {
      state.saveTimer = null;
      void submit();
    }, 800);
    refresh();
  };

  const sync = (): void => {
    (playhead as HTMLInputElement).value = String(state.frame);
    playhead.setAttribute('aria-valuetext', formatTimeReadout(state.frame));
    renderKeyframes();
  };

  playhead.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const delta = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1);
      const v = Math.max(0, Number((playhead as HTMLInputElement).value) + delta);
      (playhead as HTMLInputElement).value = String(v);
      setFrame(v);
      playhead.setAttribute('aria-valuetext', formatTimeReadout(v));
      playhead.focus();
    } else if (e.key === 'Home') {
      (playhead as HTMLInputElement).value = '0';
      setFrame(0);
    } else if (e.key === 'End') {
      (playhead as HTMLInputElement).value = String(totalFrames - 1);
      setFrame(totalFrames - 1);
    }
  });
  playhead.addEventListener('input', () => {
    const v = Number((playhead as HTMLInputElement).value);
    setFrame(v);
    playhead.setAttribute('aria-valuetext', formatTimeReadout(v));
  });
  play.addEventListener('click', () => {
    state.playing = !state.playing;
    play.textContent = state.playing ? 'Pause' : 'Play';
    play.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
  });
  addKf.addEventListener('click', () => onAddKeyframe());
  duration.addEventListener('change', () => {
    const seconds = Number((duration as HTMLInputElement).value);
    if (Number.isFinite(seconds)) {
      pushTimelineChange({ type: 'updateScene', set: 'durationMs', value: Math.round(seconds * 1000) });
    }
  });

  // The clock: Play advances the playhead with the clock.
  let last = performance.now();
  const tick = (now: number): void => {
    const dt = now - last;
    last = now;
    if (state.playing && !state.reduced) {
      const next = state.frame + (dt / 1000) * 60;
      const f = Math.floor(next) % totalFrames;
      if (f !== state.frame) {
        state.frame = f;
        setFrame(f);
      }
    }
    sync();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function setNested(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (typeof cur[key] !== 'object' || cur[key] === null) cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

function getNested(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}
