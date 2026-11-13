import { combobox, el, spinbutton } from './dom';
import type { EditorStore } from './editor-state';
import { timeReadout } from '../shared/format';
import { MSG } from '../shared/messages';
import { SPRING_DEFAULTS, SPRING_RANGES, isSpring } from '../shared/easing';
import { easingChoices } from './editor-inspector';
import { layerPropDef } from '../shared/properties';
import type { Keyframe, JsonValue } from '../shared/types';
import { resolveLayer } from '../shared/evaluator';

export interface TimelineCallbacks {
  rerender: () => void;
}

export function durationFrames(store: EditorStore): number {
  const scene = store.scene;
  return Math.max(1, Math.round(((scene?.durationMs ?? 5000) / 1000) * 60));
}

export function addKeyframeAtPlayhead(store: EditorStore, callbacks: TimelineCallbacks): void {
  const layer = store.selectedLayer;
  const path = store.state.focusedProperty;
  if (!layer || !path || path.startsWith('scene:')) {
    store.setNotice(MSG.chooseProperty);
    return;
  }
  const def = layerPropDef(layer.kind, path);
  if (!def) {
    store.setNotice(MSG.chooseProperty);
    return;
  }
  const resolution = resolveLayer(store.state.document, layer, store.state);
  const value = resolution.values.get(path);
  store.queue({
    type: 'setKeyframe',
    layerId: layer.id,
    property: path,
    frame: store.state.frame,
    value: (value ?? 0) as JsonValue,
    easing: 'linear',
  });
  store.state.focusedKeyframe = { property: path, frame: store.state.frame };
  store.state.focusTarget = `keyframe:${path}:${store.state.frame}`;
  store.setStatus(`Keyframe added at ${timeReadout(store.state.frame)}`);
  void store.flush().then(() => callbacks.rerender());
}

function moveKeyframe(
  store: EditorStore,
  keyframe: Keyframe,
  toFrame: number,
  callbacks: TimelineCallbacks,
): void {
  const layer = store.selectedLayer;
  if (!layer) return;
  const clamped = Math.max(0, Math.min(durationFrames(store), toFrame));
  if (clamped === keyframe.frame) return;
  store.queue({
    type: 'moveKeyframe',
    layerId: layer.id,
    property: keyframe.property,
    fromFrame: keyframe.frame,
    toFrame: clamped,
  });
  store.state.focusedKeyframe = { property: keyframe.property, frame: clamped };
  store.state.focusTarget = `keyframe:${keyframe.property}:${clamped}`;
  void store.flush().then(() => callbacks.rerender());
}

export function renderTimeline(store: EditorStore, callbacks: TimelineCallbacks): HTMLElement {
  const total = durationFrames(store);
  const layer = store.selectedLayer;
  const region = el('section', { role: 'region', 'aria-label': 'Timeline', class: 'panel timeline-panel' });

  const playhead = el('input', {
    type: 'range',
    class: 'slider',
    'aria-label': 'Playhead',
    min: '0',
    max: String(total),
    step: '1',
    value: String(store.state.frame),
    'aria-valuetext': timeReadout(store.state.frame),
    'data-focus-key': 'playhead',
  });
  playhead.addEventListener('input', () => {
    store.state.frame = Number(playhead.value);
    store.state.focusTarget = 'playhead';
    callbacks.rerender();
  });
  playhead.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 10 : 1;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const next = store.state.frame + (event.key === 'ArrowRight' ? step : -step);
      store.state.frame = Math.max(0, Math.min(total, next));
    } else if (event.key === 'Home') {
      event.preventDefault();
      store.state.frame = 0;
    } else if (event.key === 'End') {
      event.preventDefault();
      store.state.frame = total;
    } else {
      return;
    }
    store.state.focusTarget = 'playhead';
    callbacks.rerender();
  });

  const playing = store.state.playing;
  const play = el('button', {
    type: 'button',
    class: 'button',
    text: playing ? 'Pause' : 'Play',
    'aria-label': playing ? 'Pause' : 'Play',
    'data-focus-key': 'play',
  });
  play.addEventListener('click', () => {
    store.state.playing = !store.state.playing;
    store.state.focusTarget = 'play';
    callbacks.rerender();
  });

  const addKeyframe = el('button', {
    type: 'button',
    class: 'button',
    text: 'Add keyframe',
    'aria-label': 'Add keyframe',
    'aria-disabled': store.canEdit ? null : 'true',
    title: store.canEdit ? null : MSG.viewerCantEdit,
    'data-focus-key': 'add-keyframe',
  });
  addKeyframe.addEventListener('click', () => {
    if (!store.canEdit) return;
    addKeyframeAtPlayhead(store, callbacks);
  });

  const duration = spinbutton({
    name: 'Duration',
    value: (store.scene?.durationMs ?? 5000) / 1000,
    min: 0.5,
    max: 60,
    step: 0.5,
    shiftStep: 5,
    decimals: 3,
    disabled: !store.canEdit,
    description: store.canEdit ? undefined : MSG.viewerCantEdit,
    onCommit: (next) => {
      store.updateSceneValue('durationMs', Math.round(next * 1000));
      callbacks.rerender();
    },
  });

  const track = el('div', { class: 'timeline-track' });
  const line = el('div', { class: 'playhead-line' });
  line.style.left = `${(store.state.frame / total) * 100}%`;
  track.append(line);
  track.addEventListener('pointerdown', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('.keyframe-button')) return;
    const rect = track.getBoundingClientRect();
    const fraction = (event.clientX - rect.left) / rect.width;
    store.state.frame = Math.max(0, Math.min(total, Math.round(fraction * total)));
    callbacks.rerender();
  });

  if (layer) {
    const properties = [...new Set(layer.keyframes.map((keyframe) => keyframe.property))];
    for (const property of properties) {
      const def = layerPropDef(layer.kind, property);
      const row = el('div', { class: 'keyframe-row' }, [
        el('span', { class: 'caption', text: def?.field ?? property }),
      ]);
      for (const keyframe of layer.keyframes.filter((entry) => entry.property === property)) {
        const label = `${def?.field ?? property} keyframe at ${timeReadout(keyframe.frame)}`;
        const marker = el('button', {
          type: 'button',
          class: 'keyframe-button',
          'aria-label': label,
          'data-focus-key': `keyframe:${property}:${keyframe.frame}`,
        });
        marker.style.left = `${(keyframe.frame / total) * 100}%`;
        marker.addEventListener('focus', () => {
          store.state.focusedKeyframe = { property, frame: keyframe.frame };
        });
        marker.addEventListener('click', () => {
          store.state.focusedKeyframe = { property, frame: keyframe.frame };
          store.state.focusTarget = `keyframe:${property}:${keyframe.frame}`;
          callbacks.rerender();
        });
        marker.addEventListener('keydown', (event) => {
          const step = event.shiftKey ? 10 : 1;
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            moveKeyframe(store, keyframe, keyframe.frame + (event.key === 'ArrowRight' ? step : -step), callbacks);
            return;
          }
          if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            store.queue({
              type: 'deleteKeyframe',
              layerId: layer.id,
              property,
              frame: keyframe.frame,
            });
            store.state.focusedKeyframe = null;
            void store.flush().then(() => callbacks.rerender());
          }
        });
        let dragging = false;
        marker.addEventListener('pointerdown', (event) => {
          if (!store.canEdit) return;
          dragging = true;
          marker.setPointerCapture(event.pointerId);
        });
        marker.addEventListener('pointerup', (event) => {
          if (!dragging) return;
          dragging = false;
          const rect = track.getBoundingClientRect();
          const fraction = (event.clientX - rect.left) / rect.width;
          let frame = Math.round(fraction * total);
          const snapWindow = Math.max(1, Math.round((4 / rect.width) * total));
          const candidates = [
            store.state.frame,
            ...layer.keyframes
              .filter((entry) => entry.property === property && entry !== keyframe)
              .map((entry) => entry.frame),
          ];
          for (const candidate of candidates) {
            if (Math.abs(candidate - frame) <= snapWindow) frame = candidate;
          }
          moveKeyframe(store, keyframe, frame, callbacks);
        });
        row.append(marker);
      }
      track.append(row);
    }
  }

  const controls = el('div', { class: 'preview-bar' }, [play, addKeyframe, duration.wrapper]);

  const focused = store.state.focusedKeyframe;
  const focusedKeyframe = layer?.keyframes.find(
    (entry) => focused && entry.property === focused.property && entry.frame === focused.frame,
  );
  if (focusedKeyframe) {
    const current = isSpring(focusedKeyframe.easing) ? 'spring' : focusedKeyframe.easing;
    controls.append(
      combobox({
        name: 'Easing',
        value: current,
        choices: easingChoices(true),
        disabled: !store.canEdit,
        description: store.canEdit ? undefined : MSG.viewerCantEdit,
        onChange: (next) => {
          if (!layer) return;
          store.queue({
            type: 'setKeyframe',
            layerId: layer.id,
            property: focusedKeyframe.property,
            frame: focusedKeyframe.frame,
            value: focusedKeyframe.value,
            easing: next === 'spring' ? (SPRING_DEFAULTS as unknown as JsonValue) : next,
          });
          void store.flush().then(() => callbacks.rerender());
        },
      }).wrapper,
    );
    if (isSpring(focusedKeyframe.easing)) {
      const spring = focusedKeyframe.easing;
      for (const key of ['stiffness', 'damping', 'mass'] as const) {
        const range = SPRING_RANGES[key];
        controls.append(
          spinbutton({
            name: range.field,
            value: spring[key],
            min: range.min,
            max: range.max,
            step: range.step,
            shiftStep: range.shiftStep,
            disabled: !store.canEdit,
            description: store.canEdit ? undefined : MSG.viewerCantEdit,
            onCommit: (next) => {
              if (!layer) return;
              store.queue({
                type: 'setKeyframe',
                layerId: layer.id,
                property: focusedKeyframe.property,
                frame: focusedKeyframe.frame,
                value: focusedKeyframe.value,
                easing: { ...spring, [key]: next } as unknown as JsonValue,
              });
              void store.flush().then(() => callbacks.rerender());
            },
          }).wrapper,
        );
      }
    }
  }

  region.append(el('h3', { text: 'Timeline' }), controls, playhead, track);
  return region;
}
