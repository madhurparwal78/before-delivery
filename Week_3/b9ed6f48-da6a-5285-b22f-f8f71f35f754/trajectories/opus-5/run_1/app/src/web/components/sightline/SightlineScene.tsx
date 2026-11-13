import { useEffect, useMemo, useRef, useState } from 'react';
import {
  YAW_MAX,
  YAW_MIN,
  YAW_SPAN,
  YAW_STEP,
  alignmentPercent,
  formatAngle,
  isWithinResolveWindow,
  quantiseYaw,
} from '../../../shared/sightline.js';
import { copy, resolutionAnnouncement } from '../../../shared/copy.js';
import { useStore } from '../../lib/store.js';
import { useChime } from '../../lib/hooks.js';
import { buildShards, sampleText } from './geometry.js';
import { createScene, renderViewpointStill } from './renderer.js';
import type { ChapterDetail } from '../../../shared/types.js';

const SWAY_SECONDS = 16;
const SWAY_LIMIT_DEG = 2;
const SETTLE_MS = 900;
const WHEEL_NOTCH_PIXELS = 100;

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export interface SightlineSceneProps {
  chapter: ChapterDetail;
  startResolved: boolean;
  onEnter: () => void;
}

export function SightlineScene({ chapter, startResolved, onEnter }: SightlineSceneProps): JSX.Element {
  const { reducedMotion, preferences } = useStore();
  const chime = useChime(preferences.sound);
  const [hasWebgl] = useState(webglAvailable);
  const stillMode = reducedMotion || !hasWebgl;

  const [yaw, setYaw] = useState(() => (startResolved ? chapter.sightline_deg : YAW_MIN));
  const [resolved, setResolved] = useState(startResolved);
  const [statusText, setStatusText] = useState(startResolved ? resolutionAnnouncement(chapter.numeral) : '');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const sceneRegion = useRef<HTMLDivElement | null>(null);
  const settleStart = useRef<number | null>(startResolved ? 0 : null);
  const yawRef = useRef(yaw);
  yawRef.current = yaw;
  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;

  const shards = useMemo(() => {
    const points = sampleText(chapter.numeral, chapter.title, 560);
    return buildShards(chapter.sightline_deg, points, chapter.number * 7919 + 13);
  }, [chapter.numeral, chapter.title, chapter.sightline_deg, chapter.number]);

  const alignment = resolved ? 100 : alignmentPercent(yaw, chapter.sightline_deg);

  function reachYaw(next: number): void {
    const clamped = quantiseYaw(next);
    setYaw(clamped);
    if (!resolvedRef.current && isWithinResolveWindow(clamped, chapter.sightline_deg)) markResolved();
  }

  function markResolved(): void {
    setResolved(true);
    resolvedRef.current = true;
    settleStart.current = performance.now();
    setStatusText(resolutionAnnouncement(chapter.numeral));
    chime();
  }

  /* ----------------------------------------------------------- the canvas */
  useEffect(() => {
    if (stillMode) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const scene = createScene(canvas, shards);
    if (!scene) return undefined;
    let frame = 0;
    const started = performance.now();
    const render = (): void => {
      const nowMs = performance.now();
      const settleFrom = settleStart.current;
      const settle = settleFrom === null ? 0 : Math.min(1, (nowMs - settleFrom) / SETTLE_MS);
      const eased = settle === 0 ? 0 : 1 - (1 - settle) ** 3;
      const swayPhase = ((nowMs - started) / 1000 / SWAY_SECONDS) * Math.PI * 2;
      const sway = document.hidden ? 0 : (Math.sin(swayPhase) * SWAY_LIMIT_DEG * Math.PI) / 180;
      scene.draw({ yaw: yawRef.current, settle: eased, sway: reducedMotion ? 0 : sway });
      frame = window.requestAnimationFrame(render);
    };
    frame = window.requestAnimationFrame(render);
    return () => {
      window.cancelAnimationFrame(frame);
      scene.dispose();
    };
  }, [shards, stillMode, reducedMotion]);

  /* ------------------------------------------------------- the A shortcut */
  useEffect(() => {
    const region = sceneRegion.current;
    if (!region) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'a' && event.key !== 'A') return;
      const target = event.target as HTMLElement | null;
      if (target instanceof HTMLTextAreaElement) return;
      if (target instanceof HTMLInputElement && target.type !== 'radio' && target.type !== 'checkbox') return;
      event.preventDefault();
      align();
    };
    region.addEventListener('keydown', onKeyDown);
    return () => region.removeEventListener('keydown', onKeyDown);
  });

  function align(): void {
    reachYaw(chapter.sightline_deg);
  }

  /* --------------------------------------------- the wheel over the canvas */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || stillMode) return undefined;
    const onWheel = (event: WheelEvent): void => {
      const current = yawRef.current;
      const atLimit = (event.deltaY > 0 && current >= YAW_MAX) || (event.deltaY < 0 && current <= YAW_MIN);
      if (atLimit) return;
      event.preventDefault();
      reachYaw(current + (event.deltaY / WHEEL_NOTCH_PIXELS) * YAW_STEP);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  });

  /* ------------------------------------------------------------- pointers */
  const drag = useRef<{ pointerId: number; startX: number; startYaw: number } | null>(null);

  const viewpoints = chapter.viewpoints;
  const stills = useMemo(
    () => (stillMode ? viewpoints.map((angle) => renderViewpointStill(shards, angle, 220, 140)) : []),
    [stillMode, viewpoints, shards],
  );

  const enterChapter = (): void => {
    onEnter();
    headingRef.current?.focus();
  };

  return (
    <section className="scene-region" aria-label="Sightline scene" ref={sceneRegion} tabIndex={-1}>
      <div className="scene-split">
        <div className="scene-label">
          <span className="catalogue">{chapter.catalogue_number}</span>
          <span className="numeral" aria-hidden="true">
            {chapter.numeral}
          </span>
          <span className="secondary">{chapter.era}</span>
          <span
            role="meter"
            aria-label="Alignment"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={alignment}
            className={`readout${resolved ? ' readout-locked' : ''}`}
          >
            Alignment {alignment}%
          </span>
          <div className="inline-actions">
            <button type="button" onClick={align}>
              Align
            </button>
            <button type="button" disabled={!resolved} onClick={enterChapter}>
              Enter chapter
            </button>
          </div>
          <p role="status" aria-label="Sightline status" className="secondary">
            {statusText}
          </p>
        </div>

        <div className={`scene-frame${stillMode ? '' : ' is-framed'}`}>
          {stillMode ? (
            <>
              {!hasWebgl ? <p className="secondary">{copy.noWebgl}</p> : null}
              <div className="viewpoints" role="radiogroup" aria-label="Viewpoints">
                {viewpoints.map((angle, index) => {
                  const percent = alignmentPercent(angle, chapter.sightline_deg);
                  const label = `Viewpoint ${formatAngle(angle)}, alignment ${percent}%`;
                  const selected = yaw === angle;
                  return (
                    <label key={angle} className={`viewpoint${selected ? ' is-selected' : ''}`}>
                      <input
                        type="radio"
                        name={`viewpoints-${chapter.number}`}
                        aria-label={label}
                        checked={selected}
                        onChange={() => reachYaw(angle)}
                      />
                      <img src={stills[index]} alt="" />
                      <span className="readout">{label}</span>
                    </label>
                  );
                })}
              </div>
            </>
          ) : (
            <canvas
              className="scene-canvas"
              ref={canvasRef}
              onPointerDown={(event) => {
                drag.current = { pointerId: event.pointerId, startX: event.clientX, startYaw: yaw };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const current = drag.current;
                if (!current || current.pointerId !== event.pointerId) return;
                const width = event.currentTarget.clientWidth || 1;
                reachYaw(current.startYaw + ((event.clientX - current.startX) / width) * YAW_SPAN);
              }}
              onPointerUp={(event) => {
                if (drag.current?.pointerId === event.pointerId) drag.current = null;
              }}
            />
          )}
          <div className="scene-overlay">
            <h1
              ref={headingRef}
              tabIndex={-1}
              style={{ visibility: resolved ? 'visible' : 'hidden', transition: reducedMotion ? 'none' : 'opacity 0.33s ease' }}
            >
              {chapter.title}
            </h1>
          </div>
        </div>
      </div>

      {stillMode ? null : (
        <div
          role="slider"
          aria-label="Sightline"
          tabIndex={0}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={alignment}
          aria-valuetext={`Yaw ${formatAngle(yaw)}, alignment ${alignment}%`}
          className="readout sightline-slider"
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              reachYaw(yaw - YAW_STEP);
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              reachYaw(yaw + YAW_STEP);
            } else if (event.key === 'Home') {
              event.preventDefault();
              reachYaw(YAW_MIN);
            } else if (event.key === 'End') {
              event.preventDefault();
              reachYaw(YAW_MAX);
            }
          }}
        >
          Yaw {formatAngle(yaw)}
        </div>
      )}
    </section>
  );
}
