import { useEffect, useRef, useState } from 'react';
import type { Keyframe, PieceTimeline, PieceUniform } from '../../../shared/api.js';
import { EASING_LABELS, type EasingValue } from '../../../shared/copy.js';
import { useReducedMotion } from '../../lib/hooks.js';

const STEP = 0.1;
const BIG_STEP = 1;

export function roundTime(value: number): number {
  return Math.round(value * 10) / 10;
}

export function formatTime(value: number): string {
  return value.toFixed(1);
}

export interface TimelineProps {
  readonly timeline: PieceTimeline;
  readonly uniforms: readonly PieceUniform[];
  readonly playhead: number;
  readonly selectedUniform: string;
  readonly audioFilename: string | null;
  onPlayheadChange(value: number): void;
  onSelectUniform(name: string): void;
  onTimelineChange(timeline: PieceTimeline, announcement: string | null): void;
  readonly footer: JSX.Element;
}

interface FocusedKeyframe {
  readonly uniform: string;
  readonly index: number;
}

function labelFor(uniforms: readonly PieceUniform[], name: string): string {
  return uniforms.find((uniform) => uniform.name === name)?.label ?? name;
}

function trackOf(timeline: PieceTimeline, uniform: string): Keyframe[] {
  return timeline.tracks.find((track) => track.uniform === uniform)?.keyframes ?? [];
}

function withTrack(timeline: PieceTimeline, uniform: string, keyframes: Keyframe[]): PieceTimeline {
  const exists = timeline.tracks.some((track) => track.uniform === uniform);
  const tracks = exists
    ? timeline.tracks.map((track) => (track.uniform === uniform ? { ...track, keyframes } : track))
    : [...timeline.tracks, { uniform, keyframes }];
  return { ...timeline, tracks };
}

function sortKeyframes(keyframes: readonly Keyframe[]): Keyframe[] {
  return [...keyframes].sort((a, b) => a.time_s - b.time_s);
}

/**
 * The keyframe timeline and export panel. Every keyframe is reachable and
 * editable from the keyboard, and each change is announced in the studio status
 * region. Below 768 px the lane gives way to a stacked track list.
 */
export function Timeline({
  timeline,
  uniforms,
  playhead,
  selectedUniform,
  audioFilename,
  onPlayheadChange,
  onSelectUniform,
  onTimelineChange,
  footer,
}: TimelineProps): JSX.Element {
  const reducedMotion = useReducedMotion();
  const [focused, setFocused] = useState<FocusedKeyframe | null>(null);
  const [playing, setPlaying] = useState(false);
  const regionRef = useRef<HTMLElement | null>(null);
  const keyframeRefs = useRef(new Map<string, HTMLButtonElement>());

  const duration = timeline.duration_s;
  const selectedKeyframes = sortKeyframes(trackOf(timeline, selectedUniform));

  // Play preview animates the playhead; under reduced motion it steps 0.1 s a second.
  useEffect(() => {
    if (!playing) return;
    if (reducedMotion) {
      const timer = window.setInterval(() => {
        onPlayheadChange(roundTime((playhead + STEP) % (duration + STEP)));
      }, 1000);
      return () => window.clearInterval(timer);
    }
    let frame = 0;
    let last = performance.now();
    const step = (now: number): void => {
      const delta = (now - last) / 1000;
      last = now;
      onPlayheadChange(roundTime((playhead + delta) % duration));
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, reducedMotion, playhead, duration]);

  const applyKeyframes = (
    uniform: string,
    keyframes: readonly Keyframe[],
    announcement: string | null,
  ): void => {
    onTimelineChange(withTrack(timeline, uniform, sortKeyframes(keyframes)), announcement);
  };

  const addKeyframe = (): void => {
    const label = labelFor(uniforms, selectedUniform);
    const time = roundTime(playhead);
    const existing = trackOf(timeline, selectedUniform);
    if (existing.some((keyframe) => roundTime(keyframe.time_s) === time)) {
      onTimelineChange(timeline, `${label} already has a keyframe at ${formatTime(time)} s.`);
      return;
    }
    const value = uniforms.find((uniform) => uniform.name === selectedUniform)?.value ?? 0;
    applyKeyframes(
      selectedUniform,
      [...existing, { time_s: time, value, easing: 'linear' }],
      `${label} keyframe added at ${formatTime(time)} s.`,
    );
  };

  const moveKeyframe = (index: number, delta: number): void => {
    const label = labelFor(uniforms, selectedUniform);
    const keyframes = selectedKeyframes;
    const keyframe = keyframes[index];
    if (!keyframe) return;
    const target = roundTime(Math.min(duration, Math.max(0, keyframe.time_s + delta)));
    if (target === roundTime(keyframe.time_s)) return;
    if (keyframes.some((other, position) => position !== index && roundTime(other.time_s) === target)) {
      onTimelineChange(timeline, `${label} already has a keyframe at ${formatTime(target)} s.`);
      return;
    }
    const next = keyframes.map((other, position) =>
      position === index ? { ...other, time_s: target } : other,
    );
    applyKeyframes(selectedUniform, next, `${label} keyframe moved to ${formatTime(target)} s.`);
    const movedIndex = sortKeyframes(next).findIndex((entry) => entry.time_s === target);
    setFocused({ uniform: selectedUniform, index: movedIndex });
    window.requestAnimationFrame(() => {
      keyframeRefs.current.get(`${selectedUniform}:${movedIndex}`)?.focus();
    });
  };

  const removeKeyframe = (index: number): void => {
    const label = labelFor(uniforms, selectedUniform);
    const keyframes = selectedKeyframes;
    if (!keyframes[index]) return;
    const next = keyframes.filter((_, position) => position !== index);
    applyKeyframes(selectedUniform, next, `${label} keyframe removed.`);

    if (next.length === 0) {
      setFocused(null);
      window.requestAnimationFrame(() => {
        regionRef.current?.querySelector<HTMLElement>(`[data-layer="${selectedUniform}"]`)?.focus();
      });
      return;
    }
    const nextIndex = Math.min(index, next.length - 1);
    setFocused({ uniform: selectedUniform, index: nextIndex });
    window.requestAnimationFrame(() => {
      keyframeRefs.current.get(`${selectedUniform}:${nextIndex}`)?.focus();
    });
  };

  const setEasing = (easing: EasingValue): void => {
    const label = labelFor(uniforms, selectedUniform);
    const index = focused?.index ?? selectedKeyframes.length - 1;
    if (index < 0 || !selectedKeyframes[index]) return;
    const next = selectedKeyframes.map((keyframe, position) =>
      position === index ? { ...keyframe, easing } : keyframe,
    );
    applyKeyframes(selectedUniform, next, `${label} keyframe easing set to ${EASING_LABELS[easing]}.`);
  };

  /** K adds a keyframe while focus is anywhere inside the timeline region. */
  const onRegionKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'k' && event.key !== 'K') return;
    const target = event.target as HTMLElement;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    event.preventDefault();
    addKeyframe();
  };

  const onKeyframeKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        moveKeyframe(index, event.shiftKey ? -BIG_STEP : -STEP);
        break;
      case 'ArrowRight':
        event.preventDefault();
        moveKeyframe(index, event.shiftKey ? BIG_STEP : STEP);
        break;
      case 'ArrowUp':
      case 'ArrowDown': {
        event.preventDefault();
        const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
        if (next >= 0 && next < selectedKeyframes.length) {
          setFocused({ uniform: selectedUniform, index: next });
          keyframeRefs.current.get(`${selectedUniform}:${next}`)?.focus();
        }
        break;
      }
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        removeKeyframe(index);
        break;
      default:
        break;
    }
  };

  const focusedEasing: EasingValue =
    (focused ? selectedKeyframes[focused.index]?.easing : undefined) ??
    selectedKeyframes[selectedKeyframes.length - 1]?.easing ??
    'linear';

  const EASING_CURVES: Readonly<Record<EasingValue, string>> = {
    linear: 'M0,40 L120,0',
    'ease-in': 'M0,40 C48,40 84,24 120,0',
    'ease-out': 'M0,40 C36,16 72,0 120,0',
    'ease-in-out': 'M0,40 C42,40 78,0 120,0',
  };

  return (
    <section className="timeline" aria-label="Timeline" ref={regionRef} onKeyDown={onRegionKeyDown}>
      <div className="timeline__layers">
        {uniforms.map((uniform) => {
          const keyframes = sortKeyframes(trackOf(timeline, uniform.name));
          const isSelected = uniform.name === selectedUniform;
          const focusIndex = isSelected ? (focused?.index ?? 0) : -1;
          return (
            <div className={`timeline__layer${isSelected ? ' is-selected' : ''}`} key={uniform.name}>
              <button
                type="button"
                className="timeline__layer-button"
                data-layer={uniform.name}
                aria-pressed={isSelected}
                onClick={() => onSelectUniform(uniform.name)}
              >
                Select {uniform.label} layer
              </button>

              <div className="timeline__lane">
                <span
                  className="timeline__playhead-mark"
                  style={{ left: `${(playhead / duration) * 100}%` }}
                  aria-hidden="true"
                />
                {keyframes.map((keyframe, index) => (
                  <button
                    key={`${uniform.name}-lane-${index}`}
                    type="button"
                    ref={(node) => {
                      if (node) keyframeRefs.current.set(`${uniform.name}:${index}`, node);
                      else keyframeRefs.current.delete(`${uniform.name}:${index}`);
                    }}
                    className="timeline__keyframe"
                    style={{ left: `${(keyframe.time_s / duration) * 100}%` }}
                    tabIndex={isSelected && focusIndex === index ? 0 : -1}
                    onFocus={() => {
                      onSelectUniform(uniform.name);
                      setFocused({ uniform: uniform.name, index });
                    }}
                    onKeyDown={(event) => onKeyframeKeyDown(event, index)}
                  >
                    <span className="visually-hidden">
                      Keyframe {uniform.label} at {formatTime(keyframe.time_s)} s
                    </span>
                    <span className="timeline__diamond" aria-hidden="true" />
                  </button>
                ))}
              </div>

              <ul className="timeline__track-list">
                {keyframes.map((keyframe, index) => (
                  <li key={`${uniform.name}-row-${index}`}>
                    <button
                      type="button"
                      className="timeline__track-row"
                      onFocus={() => {
                        onSelectUniform(uniform.name);
                        setFocused({ uniform: uniform.name, index });
                      }}
                      onKeyDown={(event) => onKeyframeKeyDown(event, index)}
                    >
                      Keyframe {uniform.label} at {formatTime(keyframe.time_s)} s
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="timeline__controls">
        <label className="field field--inline" htmlFor="playhead">
          <span className="field__label">Playhead</span>
          <input
            id="playhead"
            type="range"
            aria-label="Playhead"
            min={0}
            max={duration}
            step={STEP}
            value={playhead}
            onChange={(event) => onPlayheadChange(roundTime(Number(event.target.value)))}
          />
          <span className="tabular">{formatTime(playhead)} s</span>
        </label>

        <button type="button" className="ghost-button" onClick={() => setPlaying((value) => !value)}>
          {playing ? 'Pause preview' : 'Play preview'}
        </button>

        <fieldset className="timeline__easing">
          <legend className="field__label">Easing</legend>
          <div role="radiogroup" aria-label="Easing" className="timeline__easing-options">
            {(Object.keys(EASING_LABELS) as EasingValue[]).map((value) => (
              <label key={value} className="radio">
                <input
                  type="radio"
                  name="easing"
                  value={value}
                  checked={focusedEasing === value}
                  onChange={() => setEasing(value)}
                />
                <span>{EASING_LABELS[value]}</span>
              </label>
            ))}
          </div>
          <svg className="timeline__curve" viewBox="0 0 120 40" aria-hidden="true">
            <path d={EASING_CURVES[focusedEasing]} fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        </fieldset>
      </div>

      <div className="timeline__audio">
        {audioFilename ? (
          <div className="timeline__waveform" role="img" aria-label="Audio waveform">
            <svg viewBox="0 0 240 40" preserveAspectRatio="none" aria-hidden="true">
              {Array.from({ length: 60 }, (_, index) => {
                const height = 6 + Math.abs(Math.sin(index * 0.7)) * 28;
                return (
                  <rect
                    key={index}
                    x={index * 4}
                    y={(40 - height) / 2}
                    width="2"
                    height={height}
                    fill="currentColor"
                  />
                );
              })}
            </svg>
          </div>
        ) : (
          <p className="muted">No audio stem.</p>
        )}
      </div>

      {footer}
    </section>
  );
}
