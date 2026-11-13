import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { Diamond, Pause, Play } from 'lucide-react';
import { SPRING_DEFAULTS } from '../../shared/easing';
import { framesIn, timeReadout } from '../../shared/format';
import { findLayerDefinition } from '../../shared/properties';
import type { Easing, EasingName, Keyframe, Layer } from '../../shared/types';
import { editGate, NumberField, Notice } from './controls';
import { SPRING_LIMITS } from '../../shared/document';
import { useEditorSelector, useEditorStore } from './EditorProvider';
import { CAMERA_ID } from './model';

const SNAP_PX = 4;

const EASING_CHOICES: { value: EasingName | 'spring'; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'ease', label: 'Ease' },
  { value: 'ease-in', label: 'Ease in' },
  { value: 'ease-out', label: 'Ease out' },
  { value: 'ease-in-out', label: 'Ease in-out' },
  { value: 'glide', label: 'Glide' },
  { value: 'anticipate', label: 'Anticipate' },
  { value: 'elastic', label: 'Elastic' },
  { value: 'bouncy', label: 'Bouncy' },
  { value: 'spring', label: 'Spring' },
];

const SPRING_FIELDS = [
  { key: 'stiffness', label: 'Spring stiffness', step: 1, shift: 10 },
  { key: 'damping', label: 'Spring damping', step: 1, shift: 10 },
  { key: 'mass', label: 'Spring mass', step: 0.1, shift: 1 },
] as const;

interface Track {
  property: string;
  label: string;
  keyframes: Keyframe[];
}

function tracksOf(layer: Layer | undefined): Track[] {
  if (!layer) return [];
  const byProperty = new Map<string, Keyframe[]>();
  for (const keyframe of layer.keyframes) byProperty.set(keyframe.property, [...(byProperty.get(keyframe.property) ?? []), keyframe]);
  return [...byProperty].map(([property, keyframes]) => ({
    property,
    label: findLayerDefinition(layer, property)?.label ?? property,
    keyframes: keyframes.sort((a, b) => a.frame - b.frame),
  }));
}

export function Timeline() {
  const { actions } = useEditorStore();
  const scene = useEditorSelector((e) => e.scene);
  const frame = useEditorSelector((e) => e.frame);
  const playing = useEditorSelector((e) => e.playing);
  const primary = useEditorSelector((e) => e.primary);
  const canEdit = useEditorSelector((e) => e.canEdit);
  const focused = useEditorSelector((e) => e.focusedKeyframe);
  const notice = useEditorSelector((e) => e.notices.timeline);
  const gate = editGate(canEdit);
  const lanes = useRef<HTMLDivElement>(null);
  const uids = useRef(new Map<string, number>());
  const nextUid = useRef(1);

  const last = framesIn(scene.durationMs);
  const layer = primary && primary !== CAMERA_ID ? scene.layers.find((l) => l.id === primary) : undefined;
  const tracks = tracksOf(layer);
  const pct = (f: number): string => `${(f / last) * 100}%`;

  const uidOf = (layerId: string, property: string, at: number): number => {
    const key = `${layerId}|${property}|${at}`;
    let uid = uids.current.get(key);
    if (uid === undefined) {
      uid = nextUid.current++;
      uids.current.set(key, uid);
    }
    return uid;
  };

  const focusedKeyframe = layer && focused && focused.layerId === layer.id ? layer.keyframes.find((k) => k.property === focused.property && k.frame === focused.frame) : undefined;
  const easing: Easing | undefined = focusedKeyframe?.easing;
  const easingValue = easing === undefined ? '' : typeof easing === 'string' ? easing : 'spring';

  const frameAt = (clientX: number): number => {
    const rect = (lanes.current as HTMLDivElement).getBoundingClientRect();
    return Math.min(last, Math.max(0, Math.round(((clientX - rect.left) / rect.width) * last)));
  };

  // ---- the playhead: a slider on the ruler
  const onRulerKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const big = event.shiftKey ? 10 : 1;
    const to = event.key === 'ArrowRight' ? frame + big : event.key === 'ArrowLeft' ? frame - big : event.key === 'Home' ? 0 : event.key === 'End' ? last : null;
    if (to === null) return;
    event.preventDefault();
    actions.setFrame(to);
  };

  const scrub = (event: PointerEvent<HTMLDivElement>): void => {
    const ruler = event.currentTarget;
    ruler.setPointerCapture(event.pointerId);
    ruler.focus();
    actions.setFrame(frameAt(event.clientX));
    const move = (e: globalThis.PointerEvent): void => actions.setFrame(frameAt(e.clientX));
    const end = (e: globalThis.PointerEvent): void => {
      ruler.removeEventListener('pointermove', move);
      ruler.removeEventListener('pointerup', end);
      ruler.removeEventListener('pointercancel', end);
      ruler.releasePointerCapture(e.pointerId);
    };
    ruler.addEventListener('pointermove', move);
    ruler.addEventListener('pointerup', end);
    ruler.addEventListener('pointercancel', end);
  };

  // ---- keyframes
  const moveKeyframe = (track: Track, keyframe: Keyframe, to: number): void => {
    if (!layer || to === keyframe.frame) return;
    const old = `${layer.id}|${track.property}|${keyframe.frame}`;
    const uid = uidOf(layer.id, track.property, keyframe.frame);
    actions.apply([{ type: 'moveKeyframe', layerId: layer.id, property: track.property, fromFrame: keyframe.frame, toFrame: to }], undefined, 'timeline');
    if (!canEdit) return;
    uids.current.delete(old);
    uids.current.set(`${layer.id}|${track.property}|${to}`, uid);
    actions.setFocusedKeyframe({ layerId: layer.id, property: track.property, frame: to });
  };

  const onKeyframeKey = (event: KeyboardEvent<HTMLButtonElement>, track: Track, keyframe: Keyframe): void => {
    if (!layer) return;
    const big = event.shiftKey ? 10 : 1;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      moveKeyframe(track, keyframe, Math.min(last, Math.max(0, keyframe.frame + (event.key === 'ArrowRight' ? big : -big))));
    } else if (event.key === 'Delete') {
      event.preventDefault();
      actions.apply([{ type: 'deleteKeyframe', layerId: layer.id, property: track.property, frame: keyframe.frame }], undefined, 'timeline');
      actions.setFocusedKeyframe(null);
    }
  };

  const dragKeyframe = (event: PointerEvent<HTMLButtonElement>, track: Track, keyframe: Keyframe): void => {
    if (!layer || event.button !== 0) return;
    const button = event.currentTarget;
    button.setPointerCapture(event.pointerId);
    actions.setFocusedKeyframe({ layerId: layer.id, property: track.property, frame: keyframe.frame });
    let current = keyframe;
    const rect = (lanes.current as HTMLDivElement).getBoundingClientRect();
    const xOf = (f: number): number => rect.left + (f / last) * rect.width;
    const snapTargets = [
      frame,
      ...tracks.flatMap((t) => t.keyframes.filter((k) => !(t.property === track.property && k.frame === keyframe.frame)).map((k) => k.frame)),
    ];
    const move = (e: globalThis.PointerEvent): void => {
      let to = frameAt(e.clientX);
      const near = snapTargets.find((f) => Math.abs(e.clientX - xOf(f)) <= SNAP_PX);
      if (near !== undefined) to = near;
      if (to === current.frame) return;
      moveKeyframe(track, current, to);
      current = { ...current, frame: to };
    };
    const end = (e: globalThis.PointerEvent): void => {
      button.removeEventListener('pointermove', move);
      button.removeEventListener('pointerup', end);
      button.removeEventListener('pointercancel', end);
      button.releasePointerCapture(e.pointerId);
    };
    button.addEventListener('pointermove', move);
    button.addEventListener('pointerup', end);
    button.addEventListener('pointercancel', end);
  };

  const setEasing = (next: Easing): void => {
    if (!layer || !focusedKeyframe) return;
    actions.setKeyframe(layer.id, focusedKeyframe.property, focusedKeyframe.frame, focusedKeyframe.value, next);
  };

  const ticks = Array.from({ length: Math.floor(last / 60) + 1 }, (_, i) => i);

  return (
    <section className="panel timeline" role="region" aria-label="Timeline">
      <div className="timeline-controls">
        <button type="button" className="btn btn-compact" onClick={() => actions.setPlaying(!playing)}>
          {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="btn btn-compact" {...gate} onClick={actions.addKeyframeAtPlayhead}>
          <Diamond size={16} aria-hidden="true" /> Add keyframe
        </button>
        <span className="num timeline-time" aria-hidden="true">
          {timeReadout(frame)}
        </span>
        <label className="inline-field">
          <span>Duration</span>
          <NumberField
            label="Duration"
            value={scene.durationMs / 1000}
            min={0.5}
            max={60}
            step={0.5}
            shiftStep={5}
            gate={gate}
            onCommit={(seconds) => actions.apply([{ type: 'updateScene', set: { durationMs: Math.round(seconds * 1000) }, breakpoint: 'desktop' }], undefined, 'timeline')}
            onInvalid={(message) => actions.setNotice('timeline', message)}
          />
          <span className="muted">s</span>
        </label>
        <label className="inline-field">
          <span>Easing</span>
          <select
            aria-label="Easing"
            value={easingValue}
            disabled={!focusedKeyframe || !canEdit}
            onChange={(event) => setEasing(event.target.value === 'spring' ? { ...SPRING_DEFAULTS } : (event.target.value as EasingName))}
          >
            {easingValue === '' && <option value="">Select a keyframe</option>}
            {EASING_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        {easing && typeof easing === 'object' &&
          SPRING_FIELDS.map((field) => (
            <label key={field.key} className="inline-field">
              <span>{field.label}</span>
              <NumberField
                label={field.label}
                value={easing[field.key]}
                min={SPRING_LIMITS[field.key].min}
                max={SPRING_LIMITS[field.key].max}
                step={field.step}
                shiftStep={field.shift}
                gate={gate}
                onCommit={(value) => setEasing({ ...easing, [field.key]: value })}
                onInvalid={(message) => actions.setNotice('timeline', message)}
              />
            </label>
          ))}
      </div>
      <Notice message={notice} />
      <div className={`timeline-grid${tracks.length === 0 ? ' no-tracks' : ''}`}>
        <div className="timeline-labels" aria-hidden="true">
          <div className="timeline-ruler-label" />
          {tracks.map((track) => (
            <div key={track.property} className="timeline-label">
              {track.label}
            </div>
          ))}
        </div>
        <div className="timeline-lanes" ref={lanes}>
          <div
            className="timeline-ruler"
            role="slider"
            aria-label="Playhead"
            tabIndex={0}
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={last}
            aria-valuenow={frame}
            aria-valuetext={timeReadout(frame)}
            onKeyDown={onRulerKey}
            onPointerDown={scrub}
          >
            {ticks.map((second) => (
              <span key={second} className={`tick num${second * 60 >= last ? ' is-end' : ''}`} style={{ left: pct(second * 60) }}>
                {second}s
              </span>
            ))}
          </div>
          {tracks.map((track) => (
            <div key={track.property} className="timeline-track">
              {track.keyframes.map((keyframe) => (
                <button
                  key={uidOf(layer?.id ?? '', track.property, keyframe.frame)}
                  type="button"
                  className={`keyframe${focused && focused.property === track.property && focused.frame === keyframe.frame ? ' is-focused' : ''}`}
                  style={{ left: pct(keyframe.frame) }}
                  aria-label={`${track.label} keyframe at ${timeReadout(keyframe.frame)}`}
                  onFocus={() => layer && actions.setFocusedKeyframe({ layerId: layer.id, property: track.property, frame: keyframe.frame })}
                  onKeyDown={(event) => onKeyframeKey(event, track, keyframe)}
                  onPointerDown={(event) => dragKeyframe(event, track, keyframe)}
                >
                  <Diamond size={14} aria-hidden="true" />
                </button>
              ))}
            </div>
          ))}
          <div className="playhead-line" style={{ left: pct(frame) }} aria-hidden="true" />
        </div>
      </div>
      {tracks.length === 0 && <p className="muted timeline-empty">{layer ? 'No keyframes yet. Focus a field and press K.' : 'Select a layer to see its keyframes.'}</p>}
    </section>
  );
}
