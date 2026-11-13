import { api, RequestFailed } from './api';
import { clear, combobox, el, labelledInput, openDialog, openMenu, radiogroup, spinbutton, switchControl } from './dom';
import { appState, navigate, workspaceFooter, workspaceHeader } from './shell';
import { EditorStore } from './editor-state';
import { renderLayers } from './editor-layers';
import { renderInspector } from './editor-inspector';
import { addKeyframeAtPlayhead, durationFrames, renderTimeline } from './editor-timeline';
import { StageView } from './stage-view';
import { LightField, MotionClock, TiltField, prefersReducedMotion } from './follow-light';
import type { Pointer } from './follow-light';
import { config } from './client-config';
import { copy, MSG } from '../shared/messages';
import {
  cameraAzimuth,
  evaluate,
  layerTransform,
  layerVertexOptions,
  numberAt,
  resolveLayer,
} from '../shared/evaluator';
import type { EvaluateOutput } from '../shared/evaluator';
import { applyTransform, orbitedCamera, projectPoint } from '../shared/math3d';
import { ARTBOARDS } from '../shared/types';
import type { Breakpoint, JsonValue, Layer, Scene, VariableType } from '../shared/types';
import { formatDate, formatTime } from '../shared/format';
import { is2D, is3D, layerPropDef } from '../shared/properties';

const PHONE_TABS = ['Layers', 'Stage', 'Inspector', 'Timeline'] as const;
const LIMIT_READOUTS = new Set(['Not visible']);

export async function renderEditor(root: HTMLElement, projectId: string): Promise<void> {
  if (!appState.me) {
    navigate('/signin');
    return;
  }
  let loaded;
  try {
    loaded = await api.project(projectId);
  } catch (failure) {
    root.append(
      el('div', { class: 'frame' }, [
        workspaceHeader(),
        el('section', { class: 'panel' }, [
          el('div', {
            role: 'alert',
            class: 'notice',
            text: failure instanceof RequestFailed ? failure.failure.message : MSG.notFound,
          }),
        ]),
        workspaceFooter(),
      ]),
    );
    return;
  }

  const store = new EditorStore(loaded.project, loaded.document, loaded.assets, appState.me.user.id);
  const reduced = prefersReducedMotion();
  const stage = new StageView();
  const light = new LightField();
  const clock = new MotionClock();
  const tilts = new Map<string, TiltField>();
  const hovers = new Map<string, { progress: number; since: number; over: boolean }>();
  const pointer: Pointer = { x: 0.5, y: 0.5, inside: false };
  let virtualPointer: { x: number; y: number } | null = null;

  const container = el('div', { class: 'frame editor-shell' });
  root.append(container);
  store.connect();

  const rerender = (): void => render();

  let rendering = false;
  let renderQueued = false;
  let gizmoDragging = false;

  const render = (): void => {
    if (gizmoDragging) {
      drawStage();
      updateLiveReadouts();
      return;
    }
    if (rendering) {
      renderQueued = true;
      return;
    }
    rendering = true;
    try {
      paint();
    } finally {
      rendering = false;
    }
    if (renderQueued) {
      renderQueued = false;
      render();
    }
  };

  const paint = (): void => {
    clear(container);
    const state = store.state;
    const scene = store.scene;
    const width = window.innerWidth;
    const phone = width < 640;

    const saveStatus = el('span', {
      role: 'status',
      'aria-label': 'Save status',
      class: 'status-line',
      text: state.saveStatus,
    });
    const editorStatus = el('span', {
      role: 'status',
      'aria-label': 'Editor status',
      class: 'status-line',
      text: state.editorStatus,
    });

    const undo = el('button', { type: 'button', class: 'button', text: 'Undo', 'aria-label': 'Undo' });
    undo.addEventListener('click', () => void store.undo().then(rerender));
    const redo = el('button', { type: 'button', class: 'button', text: 'Redo', 'aria-label': 'Redo' });
    redo.addEventListener('click', () => void store.redo().then(rerender));

    const members = el('button', { type: 'button', class: 'button', text: 'Members', 'aria-label': 'Members' });
    members.addEventListener('click', () => openMembers(store, members, rerender));
    const versions = el('button', { type: 'button', class: 'button', text: 'Versions', 'aria-label': 'Versions' });
    versions.addEventListener('click', () => openVersions(store, versions, rerender));

    const publish = el('button', {
      type: 'button',
      class: 'button primary',
      text: state.publishing ? 'Publishing…' : 'Publish',
      'aria-label': 'Publish',
      'aria-disabled': state.publishing || state.project.role !== 'Owner' ? 'true' : null,
      title: state.project.role === 'Owner' ? null : MSG.ownerOnlyPublish,
    });
    publish.addEventListener('click', () => {
      if (state.publishing) return;
      if (state.project.role !== 'Owner') {
        store.setNotice(MSG.ownerOnlyPublish);
        return;
      }
      state.publishing = true;
      rerender();
      const key = `publish-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      void store
        .flush()
        .then(() => api.publish(state.project.id, key))
        .then((result) => {
          state.publishing = false;
          store.setStatus(copy.versionLive(result.version.number));
          void store.reload();
        })
        .catch((failure: unknown) => {
          state.publishing = false;
          store.setNotice(
            failure instanceof RequestFailed ? failure.failure.message : MSG.storagePublishing,
          );
        });
    });

    const presence = el('span', { class: 'presence' },
      state.presence.map((person) =>
        el('span', {
          role: 'img',
          class: 'avatar',
          'aria-label': `${person.name} is here`,
          text: person.name.slice(0, 1),
        }),
      ),
    );

    const sceneSelect = combobox({
      name: 'Scene',
      value: state.sceneId,
      choices: state.document.scenes.map((item) => ({ value: item.id, label: item.name })),
      onChange: (next) => {
        state.sceneId = next;
        state.selection = [];
        rerender();
      },
    }).wrapper;

    const headerActions: Node[] = [saveStatus, editorStatus, presence, sceneSelect];
    if (phone) {
      const more = el('button', { type: 'button', class: 'button', text: 'More', 'aria-label': 'More actions' });
      more.addEventListener('click', () => {
        openMenu({
          name: 'More actions',
          opener: more,
          items: [
            { label: 'Undo', onSelect: () => void store.undo().then(rerender) },
            { label: 'Redo', onSelect: () => void store.redo().then(rerender) },
            { label: 'Members', onSelect: () => openMembers(store, more, rerender) },
            { label: 'Versions', onSelect: () => openVersions(store, more, rerender) },
            { label: 'Publish', onSelect: () => publish.click() },
          ],
        });
      });
      headerActions.push(more);
    } else {
      headerActions.push(undo, redo, members, versions, publish);
    }

    container.append(workspaceHeader(headerActions));

    if (state.notice) {
      const notice = el('div', { role: 'alert', class: 'notice', text: state.notice });
      container.append(notice);
    }

    if (!scene) {
      container.append(el('section', { class: 'panel' }, [el('p', { class: 'empty-state', text: 'This project has no scenes.' })]));
      return;
    }

    const evaluation = evaluate({
      document: state.document,
      sceneId: state.sceneId,
      layerId: state.selection[0] ?? null,
      frame: state.frame,
      breakpoint: state.breakpoint,
      scroll: state.scroll,
      reducedMotion: state.reduceMotion || reduced,
      vertex: state.vertex,
      particle: state.particleNumber,
      point: state.clothPoint,
      node: state.node,
      sampleX: state.sampleX,
      sampleY: state.sampleY,
      assets: state.loaded,
      particleMax: config().particleMax,
      tilt: currentTilt(),
      tiltTarget: currentTiltTarget(),
      lightFocus: light.focus,
      hoverProgress: hoverProgressOf(state.selection[0] ?? null),
    });

    const layersPanel = renderLayers(store, { rerender, focusKey: () => undefined });
    const variablesPanel = renderVariables(store, rerender);
    const stageColumn = renderStageColumn();
    const inspectorPanel = el('section', { class: 'panel' }, [
      el('h3', { text: 'Inspector' }),
      renderInspector(store, rerender),
      renderReadouts(evaluation, store),
    ]);
    const timelinePanel = renderTimeline(store, { rerender });

    if (phone) {
      const tabs = el('div', { role: 'tablist', 'aria-label': 'Editor panels', class: 'panel-tabs' });
      for (const tab of PHONE_TABS) {
        const node = el('button', {
          type: 'button',
          role: 'tab',
          class: 'tab',
          text: tab,
          'aria-selected': state.phoneTab === tab ? 'true' : 'false',
        });
        node.addEventListener('click', () => {
          state.phoneTab = tab;
          rerender();
        });
        tabs.append(node);
      }
      container.append(tabs);
      const panels: Record<string, Node> = {
        Layers: layersPanel,
        Stage: stageColumn,
        Inspector: inspectorPanel,
        Timeline: timelinePanel,
      };
      container.append(panels[state.phoneTab]);
      if (state.phoneTab === 'Layers') container.append(variablesPanel);
    } else {
      container.append(
        el('div', { class: 'editor-columns' }, [
          el('div', { class: 'editor-column' }, [layersPanel, variablesPanel]),
          stageColumn,
          el('div', { class: 'editor-column' }, [inspectorPanel]),
        ]),
        timelinePanel,
      );
    }
    container.append(workspaceFooter());

    if (state.focusTarget) {
      const target = container.querySelector<HTMLElement>(`[data-focus-key="${state.focusTarget}"]`);
      if (target && target !== document.activeElement) target.focus();
    }
    drawStage();
  };

  container.addEventListener('focusin', (event) => {
    const target = event.target as HTMLElement | null;
    store.state.focusTarget = target?.getAttribute('data-focus-key') ?? null;
  });

  const hoverProgressOf = (layerId: string | null): number =>
    layerId ? (hovers.get(layerId)?.progress ?? 0) : 0;

  const currentTilt = (): { x: number; y: number } => {
    const layer = store.selectedLayer;
    if (!layer) return { x: 0, y: 0 };
    return tilts.get(layer.id)?.current ?? { x: 0, y: 0 };
  };
  const currentTiltTarget = (): { x: number; y: number } => {
    const layer = store.selectedLayer;
    if (!layer) return { x: 0, y: 0 };
    return tilts.get(layer.id)?.target ?? { x: 0, y: 0 };
  };

  function renderPreviewBar(storeRef: EditorStore, refresh: () => void): HTMLElement {
    const state = storeRef.state;
    return el('section', { class: 'panel preview-bar' }, [
      radiogroup({
        name: 'Breakpoint',
        value: state.breakpoint === 'desktop' ? 'Desktop' : state.breakpoint === 'tablet' ? 'Tablet' : 'Mobile',
        choices: [
          { value: 'Desktop', label: 'Desktop' },
          { value: 'Tablet', label: 'Tablet' },
          { value: 'Mobile', label: 'Mobile' },
        ],
        focusKeyPrefix: 'breakpoint',
        onChange: (next) => {
          state.breakpoint = next.toLowerCase() as Breakpoint;
          state.focusTarget = `breakpoint:${next}`;
          refresh();
        },
      }),
      el('div', { class: 'field' }, [
        switchControl({
          name: 'Preview',
          checked: state.preview,
          onChange: (checked) => {
            state.preview = checked;
            refresh();
          },
        }),
      ]),
      el('div', { class: 'field' }, [
        switchControl({
          name: 'Reduce motion',
          checked: state.reduceMotion,
          onChange: (checked) => {
            state.reduceMotion = checked;
            refresh();
          },
        }),
      ]),
      (() => {
        const slider = el('input', {
          type: 'range',
          class: 'slider',
          'aria-label': 'Scroll progress',
          min: '0',
          max: '100',
          step: '1',
          value: String(state.scroll),
        });
        slider.addEventListener('input', () => {
          state.scroll = Number(slider.value);
          refresh();
        });
        return el('div', { class: 'field' }, [
          el('span', { class: 'field-label', text: 'Scroll progress' }),
          slider,
        ]);
      })(),
    ]);
  }

  function renderStagePanel(): HTMLElement {
    const state = store.state;
    const artboard = ARTBOARDS[state.breakpoint];
    const group = el('div', {
      role: 'group',
      'aria-label': 'Stage',
      tabindex: '0',
      class: 'stage-panel',
      'data-renderer': stage.renderer,
      'data-breakpoint': state.breakpoint,
      'data-frame': String(state.frame),
    });
    stage.setArtboard(artboard.width, artboard.height);
    stage.element.style.aspectRatio = `${artboard.width} / ${artboard.height}`;
    stage.element.style.width = '100%';
    stage.element.style.maxWidth = `${artboard.width}px`;
    stage.element.style.maxHeight = '62vh';
    group.append(stage.element);

    group.addEventListener('pointermove', (event) => {
      const rect = group.getBoundingClientRect();
      pointer.x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      pointer.y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
      pointer.inside = state.preview;
      virtualPointer = null;
    });
    group.addEventListener('pointerleave', () => {
      pointer.inside = false;
    });
    group.addEventListener('keydown', (event) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Escape') {
        virtualPointer = null;
        pointer.inside = false;
        return;
      }
      const base = virtualPointer ?? { x: 0.5, y: 0.5 };
      const next = {
        x: base.x + (event.key === 'ArrowRight' ? 0.1 : event.key === 'ArrowLeft' ? -0.1 : 0),
        y: base.y + (event.key === 'ArrowDown' ? 0.1 : event.key === 'ArrowUp' ? -0.1 : 0),
      };
      virtualPointer = {
        x: Math.max(0, Math.min(1, next.x)),
        y: Math.max(0, Math.min(1, next.y)),
      };
      pointer.x = virtualPointer.x;
      pointer.y = virtualPointer.y;
      pointer.inside = true;
    });

    group.addEventListener('click', (event) => {
      if (state.preview) return;
      const target = event.target as HTMLElement;
      if (target.closest('button')) return;
      const rect = group.getBoundingClientRect();
      pointer.x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      pointer.y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
      const picked = layerAtPointer(state.breakpoint);
      state.selection = picked ? [picked] : [];
      state.focusTarget = picked ? `layer:${picked}` : 'layer:camera';
      rerender();
    });

    return group;
  }

  function renderStageColumn(): HTMLElement {
    const state = store.state;
    const column = el('div', { class: 'editor-column stage-column' }, [
      renderPreviewBar(store, rerender),
      renderStagePanel(),
    ]);
    const layer = store.selectedLayer;
    if (layer && !state.preview && layerPropDef(layer.kind, 'position.x')) {
      column.append(renderGizmo(layer.id));
    }
    return column;
  }

  /** With Preview off the stage selects: the topmost layer under the pointer wins. */
  function layerAtPointer(breakpoint: Breakpoint): string | null {
    const scene = store.scene;
    if (!scene) return null;
    const ordered = [...scene.layers].sort((a, b) => b.order - a.order);
    for (const layer of ordered) {
      if (is3D(layer.kind)) {
        if (pointerOverLayer(layer, breakpoint)) return layer.id;
        continue;
      }
      if (!is2D(layer.kind)) continue;
      const resolution = resolveLayer(store.state.document, layer, store.state);
      const artboard = ARTBOARDS[breakpoint];
      const x = pointer.x * artboard.width;
      const y = pointer.y * artboard.height;
      const left = numberAt(resolution, 'x', 0);
      const top = numberAt(resolution, 'y', 0);
      if (
        x >= left &&
        x <= left + numberAt(resolution, 'width', 0) &&
        y >= top &&
        y <= top + numberAt(resolution, 'height', 0)
      ) {
        return layer.id;
      }
    }
    return null;
  }

  function renderGizmo(layerId: string): HTMLElement {
    const gizmo = el('div', { class: 'gizmo' });
    const axes: ['x' | 'y' | 'z', string][] = [
      ['x', 'X'],
      ['y', 'Y'],
      ['z', 'Z'],
    ];
    for (const [axis, label] of axes) {
      gizmo.append(dragHandle(layerId, `Move along ${label}`, 'position', axis));
    }
    for (const [axis, label] of axes) {
      gizmo.append(dragHandle(layerId, `Rotate around ${label}`, 'rotation', axis));
    }
    return gizmo;
  }

  function dragHandle(
    layerId: string,
    label: string,
    kind: 'position' | 'rotation',
    axis: 'x' | 'y' | 'z',
  ): HTMLButtonElement {
    const handle = el('button', { type: 'button', class: 'button', text: label, 'aria-label': label });
    let startValue = 0;
    let startX = 0;
    let startY = 0;
    let dragging = false;
    const path = `${kind}.${axis}`;
    handle.addEventListener('pointerdown', (event) => {
      if (!store.canEdit) return;
      const layer = store.layer(layerId);
      if (!layer) return;
      dragging = true;
      gizmoDragging = true;
      startValue = Number(store.readValue(layer, path) ?? 0);
      startX = event.clientX;
      startY = event.clientY;
      handle.setPointerCapture(event.pointerId);
      void store.takeLock(layerId);
    });
    handle.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const deltaPixels =
        kind === 'position' && axis === 'y' ? startY - event.clientY : event.clientX - startX;
      const raw =
        kind === 'position' ? startValue + deltaPixels * 0.01 : startValue + deltaPixels * 0.5;
      const snap = kind === 'position' ? (event.shiftKey ? 0.1 : 0.01) : event.shiftKey ? 15 : 1;
      const value = Math.round(raw / snap) * snap;
      store.updateLayerValue(layerId, path, Number(value.toFixed(3)));
    });
    handle.addEventListener('pointerup', () => {
      if (!dragging) return;
      dragging = false;
      gizmoDragging = false;
      void store.flush().then(rerender);
    });
    return handle;
  }

  function renderReadouts(evaluation: EvaluateOutput, storeRef: EditorStore): HTMLElement {
    const region = el('section', { role: 'region', 'aria-label': 'Readouts', class: 'readouts' });
    region.append(el('h4', { text: 'Readouts' }));
    const entries = Object.entries(evaluation.readouts).sort(([a], [b]) => a.localeCompare(b));
    for (const [key, text] of entries) {
      if (key.startsWith('property:')) {
        region.append(
          el('span', {
            'data-readout': 'property',
            'data-path': key.slice('property:'.length),
            text,
          }),
        );
        continue;
      }
      if (key.startsWith('clip-time:')) {
        region.append(
          el('span', { 'data-readout': 'clip-time', 'data-clip': key.slice('clip-time:'.length), text }),
        );
        continue;
      }
      region.append(
        el('span', {
          'data-readout': key,
          class: LIMIT_READOUTS.has(text) ? 'readout-limit' : null,
          text,
        }),
      );
    }
    const drawOrder = el('ul', { class: 'list-reset', 'aria-label': 'Draw order' });
    for (const item of evaluation.drawOrder) drawOrder.append(el('li', { text: item }));
    region.append(el('h4', { text: 'Draw order' }), drawOrder);
    void storeRef;
    return region;
  }

  function drawStage(): void {
    const state = store.state;
    const scene = store.scene;
    if (!scene) return;
    stage.draw(
      {
        document: state.document,
        sceneId: state.sceneId,
        frame: state.frame,
        breakpoint: state.breakpoint,
        scroll: state.scroll,
        reducedMotion: state.reduceMotion || reduced,
        assets: state.loaded,
        particleMax: config().particleMax,
        tilt: currentTilt(),
        lightFocus: light.focus,
        hoverProgress: hoverProgressOf(state.selection[0] ?? null),
        imageUrl: (assetId) => `/api/assets/${assetId}/original`,
      },
      { level: light.level, focus: light.focus },
    );
  }

  const tick = (now: number): void => {
    if (!container.isConnected) {
      store.disconnect();
      return;
    }
    const state = store.state;
    const frames = clock.step(now);
    const reducedNow = state.reduceMotion || reduced;
    light.advanceLevel(now, reducedNow);
    light.advanceFocus(
      now,
      frames,
      state.preview ? pointer : { ...pointer, inside: false },
      store.scene?.light.momentum ?? 1,
      reducedNow,
    );
    const scene = store.scene;
    if (scene) {
      for (const layer of scene.layers) {
        if (!layer.events.tilt.enabled) continue;
        let field = tilts.get(layer.id);
        if (!field) {
          field = new TiltField();
          tilts.set(layer.id, field);
        }
        field.advance(
          now,
          frames,
          state.preview ? pointer : { ...pointer, inside: false },
          layer.events.tilt,
          reducedNow,
        );
      }
      advanceHover(scene, now, reducedNow);
    }
    if (state.playing && frames > 0) {
      const total = durationFrames(store);
      state.frame = Math.min(total, state.frame + frames);
      if (state.frame >= total) state.playing = false;
      render();
    } else if (frames > 0 && (state.preview || light.level < 1)) {
      drawStage();
      updateLiveReadouts();
    }
    window.requestAnimationFrame(tick);
  };

  /** The pointer is over a 3D layer when it is inside its projected bounding box. */
  function advanceHover(scene: Scene, now: number, reducedNow: boolean): void {
    const state = store.state;
    for (const layer of scene.layers) {
      if (!layer.events.hover.enabled) continue;
      const entry = hovers.get(layer.id) ?? { progress: 0, since: now, over: false };
      const over =
        state.preview && pointer.inside && !reducedNow
          ? pointerOverLayer(layer, state.breakpoint)
          : false;
      if (over !== entry.over) {
        entry.over = over;
        entry.since = now;
      }
      const duration = Math.max(1, layer.events.hover.durationMs);
      const elapsed = Math.max(0, now - entry.since - layer.events.hover.delayMs);
      if (entry.over) {
        entry.progress = Math.min(1, elapsed / duration);
      } else if (!layer.events.hover.forwardsOnly) {
        entry.progress = Math.max(0, 1 - elapsed / duration);
      }
      hovers.set(layer.id, entry);
    }
  }

  function pointerOverLayer(layer: Layer, breakpoint: Breakpoint): boolean {
    const resolution = resolveLayer(store.state.document, layer, store.state);
    const options = layerVertexOptions(layer, resolution, store.state.loaded);
    if (options.length === 0) return false;
    const transform = layerTransform(resolution);
    const scene = store.scene;
    if (!scene) return false;
    const camera = orbitedCamera(
      scene.camera,
      cameraAzimuth(scene, store.state.scroll, store.state.reduceMotion || reduced),
    );
    const artboard = ARTBOARDS[breakpoint];
    const points = options.map((option) =>
      projectPoint(applyTransform(option.point, transform), camera, breakpoint),
    );
    if (points.some((point) => !point.visible)) return false;
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const x = pointer.x * artboard.width;
    const y = pointer.y * artboard.height;
    return (
      x >= Math.min(...xs) && x <= Math.max(...xs) && y >= Math.min(...ys) && y <= Math.max(...ys)
    );
  }

  function updateLiveReadouts(): void {
    const state = store.state;
    const evaluation = evaluate({
      document: state.document,
      sceneId: state.sceneId,
      layerId: state.selection[0] ?? null,
      frame: state.frame,
      breakpoint: state.breakpoint,
      scroll: state.scroll,
      reducedMotion: state.reduceMotion || reduced,
      vertex: state.vertex,
      particle: state.particleNumber,
      point: state.clothPoint,
      node: state.node,
      sampleX: state.sampleX,
      sampleY: state.sampleY,
      assets: state.loaded,
      particleMax: config().particleMax,
      tilt: currentTilt(),
      tiltTarget: currentTiltTarget(),
      lightFocus: light.focus,
      hoverProgress: hoverProgressOf(state.selection[0] ?? null),
    });
    for (const [key, text] of Object.entries(evaluation.readouts)) {
      const selector = key.startsWith('property:')
        ? `[data-readout="property"][data-path="${key.slice('property:'.length)}"]`
        : key.startsWith('clip-time:')
          ? `[data-readout="clip-time"][data-clip="${key.slice('clip-time:'.length)}"]`
          : `[data-readout="${key}"]`;
      const node = container.querySelector(selector);
      if (node) node.textContent = text;
    }
  }

  store.subscribe(() => render());
  render();
  window.requestAnimationFrame(tick);

  document.addEventListener('keydown', (event) => {
    if (!container.isConnected) return;
    const target = event.target as HTMLElement | null;
    const typing =
      target instanceof HTMLInputElement && target.type === 'text' && target.getAttribute('role') !== 'spinbutton';
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      void (event.shiftKey ? store.redo() : store.undo()).then(rerender);
      return;
    }
    if (modifier && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      const layer = store.selectedLayer;
      if (layer) {
        store.queue({ type: 'duplicateLayer', layerId: layer.id });
        void store.flush().then(rerender);
      }
      return;
    }
    if (modifier && event.key.toLowerCase() === 'g') {
      event.preventDefault();
      if (event.shiftKey) {
        const layer = store.selectedLayer;
        const groupId = layer?.kind === 'Group' ? layer.id : layer?.parentId;
        if (groupId) {
          store.queue({ type: 'ungroup', groupId });
          void store.flush().then(rerender);
        }
      } else if (store.state.selection.length > 0) {
        store.queue({ type: 'group', layerIds: store.state.selection });
        void store.flush().then(rerender);
      }
      return;
    }
    if (typing) return;
    if (event.key === 'Delete') {
      const focusKey = target?.getAttribute('data-focus-key') ?? '';
      if (focusKey.startsWith('keyframe:')) return;
      const layer = store.selectedLayer;
      if (layer) {
        event.preventDefault();
        store.queue({ type: 'deleteLayer', layerId: layer.id });
        store.state.selection = [];
        void store.flush().then(rerender);
      }
      return;
    }
    if (event.key.toLowerCase() === 'k') {
      event.preventDefault();
      addKeyframeAtPlayhead(store, { rerender });
    }
  });
}

function renderVariables(store: EditorStore, rerender: () => void): HTMLElement {
  const state = store.state;
  const tabs = el('div', { role: 'tablist', 'aria-label': 'Variables and presets', class: 'panel-tabs' });
  const body = el('div', { class: 'form-grid' });
  let active: 'Variables' | 'Presets' = 'Variables';

  const paint = (): void => {
    clear(body);
    if (active === 'Variables') {
      const name = labelledInput({ name: 'New variable name' });
      const type = combobox({
        name: 'Variable type',
        value: 'Number',
        choices: ['Number', 'Boolean', 'Text', 'Colour', 'Vector 2', 'Vector 3'].map((item) => ({
          value: item,
          label: item,
        })),
        onChange: () => undefined,
      });
      const add = el('button', {
        type: 'button',
        class: 'button',
        text: 'Add variable',
        'aria-label': 'Add variable',
        'aria-disabled': store.canEdit ? null : 'true',
      });
      add.addEventListener('click', () => {
        if (!store.canEdit) return;
        const variableType = type.select.value as VariableType;
        const defaults: Record<VariableType, JsonValue> = {
          Number: 0,
          Boolean: false,
          Text: '',
          Colour: '#B7A4FF',
          'Vector 2': { x: 0, y: 0 },
          'Vector 3': { x: 0, y: 0, z: 0 },
        };
        store.queue({
          type: 'addVariable',
          variable: { name: name.input.value.trim(), type: variableType, value: defaults[variableType] },
        });
        void store.flush().then(rerender);
      });
      body.append(name.wrapper, type.wrapper, add);
      for (const variable of state.document.variables) {
        body.append(variableRow(store, variable, rerender));
      }
      return;
    }
    const presetName = labelledInput({ name: 'Preset name' });
    const save = el('button', {
      type: 'button',
      class: 'button',
      text: 'Save preset',
      'aria-label': 'Save preset',
      'aria-disabled': store.canEdit ? null : 'true',
    });
    save.addEventListener('click', () => {
      if (!store.canEdit) return;
      store.queue({ type: 'savePreset', name: presetName.input.value.trim() });
      void store.flush().then(rerender);
    });
    body.append(presetName.wrapper, save);
    for (const preset of state.document.presets) {
      const apply = el('button', {
        type: 'button',
        class: 'button',
        text: `Apply ${preset.name}`,
        'aria-label': `Apply ${preset.name}`,
        'aria-disabled': store.canEdit ? null : 'true',
      });
      apply.addEventListener('click', () => {
        if (!store.canEdit) return;
        store.queue({ type: 'applyPreset', name: preset.name });
        store.setStatus(copy.presetApplied(preset.name));
        void store.flush().then(rerender);
      });
      body.append(apply);
    }
  };

  for (const label of ['Variables', 'Presets'] as const) {
    const node = el('button', {
      type: 'button',
      role: 'tab',
      class: 'tab',
      text: label,
      'aria-selected': label === active ? 'true' : 'false',
    });
    node.addEventListener('click', () => {
      active = label;
      for (const item of tabs.querySelectorAll('[role="tab"]')) {
        item.setAttribute('aria-selected', item.textContent === label ? 'true' : 'false');
      }
      paint();
    });
    tabs.append(node);
  }
  paint();
  return el('section', { class: 'panel' }, [el('h3', { text: 'Variables and presets' }), tabs, body]);
}

function variableRow(
  store: EditorStore,
  variable: { name: string; type: VariableType; value: JsonValue },
  rerender: () => void,
): HTMLElement {
  const row = el('div', { class: 'form-grid' });
  const commit = (value: JsonValue): void => {
    store.queue({ type: 'updateVariable', name: variable.name, value }, `variable:${variable.name}`);
    rerender();
  };
  if (variable.type === 'Boolean') {
    row.append(
      switchControl({
        name: `${variable.name} value`,
        checked: variable.value === true,
        disabled: !store.canEdit,
        description: store.canEdit ? undefined : MSG.viewerCantEdit,
        onChange: commit,
      }),
    );
  } else if (variable.type === 'Vector 2' || variable.type === 'Vector 3') {
    const axes = variable.type === 'Vector 2' ? ['x', 'y'] : ['x', 'y', 'z'];
    const record = (variable.value ?? {}) as Record<string, number>;
    for (const axis of axes) {
      row.append(
        spinbutton({
          name: `${variable.name} ${axis}`,
          value: record[axis] ?? 0,
          min: -1000000,
          max: 1000000,
          step: 1,
          shiftStep: 10,
          disabled: !store.canEdit,
          description: store.canEdit ? undefined : MSG.viewerCantEdit,
          onCommit: (next) => commit({ ...record, [axis]: next } as JsonValue),
        }).wrapper,
      );
    }
  } else if (variable.type === 'Number') {
    row.append(
      spinbutton({
        name: `${variable.name} value`,
        value: typeof variable.value === 'number' ? variable.value : 0,
        min: -1000000,
        max: 1000000,
        step: 1,
        shiftStep: 10,
        disabled: !store.canEdit,
        description: store.canEdit ? undefined : MSG.viewerCantEdit,
        onCommit: commit,
      }).wrapper,
    );
  } else {
    const field = labelledInput({ name: `${variable.name} value`, value: String(variable.value ?? '') });
    if (!store.canEdit) {
      field.input.readOnly = true;
      field.input.setAttribute('aria-disabled', 'true');
      field.input.title = MSG.viewerCantEdit;
    }
    field.input.addEventListener('change', () => commit(field.input.value));
    row.append(field.wrapper);
  }
  const remove = el('button', {
    type: 'button',
    class: 'button',
    text: 'Delete',
    'aria-label': `Delete ${variable.name}`,
    'aria-disabled': store.canEdit ? null : 'true',
  });
  remove.addEventListener('click', () => {
    if (!store.canEdit) return;
    store.queue({ type: 'deleteVariable', name: variable.name });
    void store.flush().then(rerender);
  });
  row.append(remove);
  return row;
}

function openMembers(store: EditorStore, opener: HTMLElement, rerender: () => void): void {
  openDialog({
    name: 'Members',
    opener,
    content: (close) => {
      const list = el('ul', { class: 'list-reset', 'aria-label': 'Members' });
      const status = el('p', { role: 'status', 'aria-label': 'Members status', class: 'status-line' });
      const notice = el('div');
      const load = (): void => {
        void api.members(store.state.project.id).then((result) => {
          clear(list);
          for (const member of result.members) {
            const item = el('li', {}, [el('span', { text: `${member.name} · ${member.role}` })]);
            if (store.state.project.role === 'Owner' && member.role !== 'Owner') {
              const remove = el('button', {
                type: 'button',
                class: 'button',
                text: 'Remove',
                'aria-label': `Remove ${member.name}`,
              });
              remove.addEventListener('click', () => {
                void api.removeMember(store.state.project.id, member.personId).then(() => {
                  load();
                  void store.reload();
                });
              });
              item.append(remove);
            }
            list.append(item);
          }
          for (const invite of result.invites) {
            const suffix =
              invite.status === 'queued'
                ? 'Invite queued — mail is unavailable'
                : invite.status === 'accepted'
                  ? 'Accepted'
                  : invite.status === 'expired'
                    ? 'Expired'
                    : 'Invite sent';
            list.append(el('li', {}, [el('span', { text: `${invite.email} · ${invite.role} · ${suffix}` })]));
          }
        });
      };
      load();
      const inviteButton = el('button', {
        type: 'button',
        class: 'button primary',
        text: 'Invite people',
        'aria-label': 'Invite people',
      });
      inviteButton.addEventListener('click', () => {
        openDialog({
          name: 'Invite people',
          opener: inviteButton,
          content: (closeInvite) => {
            const email = labelledInput({ name: 'Email', type: 'email' });
            let role = 'Editor';
            const roles = radiogroup({
              name: 'Role',
              value: role,
              choices: [
                { value: 'Editor', label: 'Editor' },
                { value: 'Viewer', label: 'Viewer' },
              ],
              onChange: (next) => {
                role = next;
                for (const node of roles.querySelectorAll('[role="radio"]')) {
                  node.setAttribute('aria-checked', node.getAttribute('aria-label') === next ? 'true' : 'false');
                }
              },
            });
            const send = el('button', { type: 'button', class: 'button primary', text: 'Send invite', 'aria-label': 'Send invite' });
            const inviteNotice = el('div');
            send.addEventListener('click', () => {
              send.textContent = 'Sending…';
              clear(inviteNotice);
              void api
                .invite(store.state.project.id, email.input.value.trim(), role)
                .then(() => {
                  status.textContent = copy.inviteSent(email.input.value.trim());
                  closeInvite();
                  load();
                  void store.reload();
                })
                .catch((failure: unknown) => {
                  send.textContent = 'Send invite';
                  inviteNotice.append(
                    el('div', {
                      role: 'alert',
                      class: 'notice',
                      text: failure instanceof RequestFailed ? failure.failure.message : MSG.enterEmail,
                    }),
                  );
                });
            });
            return el('div', { class: 'form-grid' }, [
              el('h3', { text: 'Invite people' }),
              email.wrapper,
              roles,
              inviteNotice,
              send,
            ]);
          },
        });
      });
      const done = el('button', { type: 'button', class: 'button', text: 'Close' });
      done.addEventListener('click', () => {
        close();
        rerender();
      });
      return el('div', { class: 'form-grid' }, [
        el('h3', { text: 'Members' }),
        list,
        status,
        notice,
        inviteButton,
        done,
      ]);
    },
  });
}

function openVersions(store: EditorStore, opener: HTMLElement, rerender: () => void): void {
  openDialog({
    name: 'Versions',
    opener,
    content: (close) => {
      const list = el('ul', { class: 'list-reset', 'aria-label': 'Versions' });
      const status = el('p', { role: 'status', class: 'status-line' });
      const embedCode = el('input', {
        type: 'text',
        class: 'field-input',
        'aria-label': 'Embed code',
        readonly: true,
        value: `<iframe src="${window.location.origin}/embed/${store.state.project.id}" title="${store.state.project.name}"></iframe>`,
      });
      const copyButton = el('button', { type: 'button', class: 'button', text: 'Copy embed code', 'aria-label': 'Copy embed code' });
      copyButton.addEventListener('click', () => {
        void navigator.clipboard?.writeText(embedCode.value).catch(() => undefined);
        status.textContent = MSG.embedCopied;
      });
      const load = (): void => {
        void api.versions(store.state.project.id).then((result) => {
          clear(list);
          if (result.versions.length === 0) {
            list.append(el('li', { class: 'empty-state', text: 'Not published' }));
          }
          for (const version of result.versions) {
            const label = `Version ${version.number} · ${formatDate(
              version.publishedAt,
              config().timeZone,
            )} ${formatTime(version.publishedAt, config().timeZone)} · ${
              version.status === 'live' ? 'Live' : 'Superseded'
            }`;
            const item = el('li', { 'aria-label': label }, [
              el('span', { text: label }),
              el('span', {
                class: version.notice === 'queued' ? 'field-note limit' : 'field-note',
                text: version.notice === 'queued' ? 'Notice queued — mail is unavailable' : 'Notice sent',
              }),
            ]);
            if (store.state.project.role === 'Owner') {
              const republish = el('button', {
                type: 'button',
                class: 'button',
                text: `Republish version ${version.number}`,
                'aria-label': `Republish version ${version.number}`,
              });
              republish.addEventListener('click', () => {
                const key = `republish-${version.number}-${Date.now()}`;
                void api
                  .publish(store.state.project.id, key, version.number)
                  .then((result2) => {
                    status.textContent = copy.versionLive(result2.version.number);
                    load();
                    void store.reload();
                  })
                  .catch((failure: unknown) => {
                    status.textContent =
                      failure instanceof RequestFailed ? failure.failure.message : MSG.storagePublishing;
                  });
              });
              item.append(republish);
            }
            const exportLink = el('a', {
              href: `/api/projects/${store.state.project.id}/versions/${version.number}/export`,
              class: 'button',
              text: `Export version ${version.number} JSON`,
              download: `version-${version.number}.json`,
            });
            item.append(exportLink);
            list.append(item);
          }
        });
      };
      load();
      const workingExport = el('a', {
        href: `/api/projects/${store.state.project.id}/export`,
        class: 'button',
        text: 'Export working JSON',
        download: 'scene.json',
      });
      const originalImport = store.state.project.name.endsWith('(imported)')
        ? el('a', {
            href: `/api/projects/${store.state.project.id}/import/original`,
            class: 'button',
            text: 'Download original import',
            download: 'original.json',
          })
        : null;
      const done = el('button', { type: 'button', class: 'button', text: 'Close' });
      done.addEventListener('click', () => {
        close();
        rerender();
      });
      return el('div', { class: 'form-grid' }, [
        el('h3', { text: 'Versions' }),
        list,
        el('div', { class: 'field' }, [
          el('span', { class: 'field-label', text: 'Embed code' }),
          embedCode,
        ]),
        copyButton,
        workingExport,
        originalImport,
        status,
        done,
      ]);
    },
  });
}
