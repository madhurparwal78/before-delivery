import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { tierName, type Tier } from '../shared/benches.js';
import {
  ATELIER_SOLD_OUT_BANNER,
  ATELIER_SOLD_OUT_HEADING,
  NO_WEBGL_LINE,
  holdEndedDialog,
} from '../shared/copy.js';
import { BenchMap, benchStateText } from './BenchMap.js';
import { HoldPanel } from './HoldPanel.js';
import { hasWebGl, useReducedMotion, type Viewport } from './hooks.js';
import { LabScene } from './labScene.js';
import { useLab } from './store.js';
import { Dialog, LiveRegion } from './ui.js';

const AZIMUTH_RANGE = { min: -35, max: 35 };
const ELEVATION_RANGE = { min: 20, max: 62 };
const OVERSHOOT = 8;
const SPRING_MS = 600;
const LIFT_MS = 600;
const PRELOADER_MS = 900;

function easeOutBack(progress: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (progress - 1) ** 3 + c1 * (progress - 1) ** 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Past the published range the camera resists, never going more than 8 degrees out. */
function rubberBand(value: number, min: number, max: number): number {
  if (value > max) {
    const past = value - max;
    return max + (OVERSHOOT * past) / (past + OVERSHOOT * 2);
  }
  if (value < min) {
    const past = min - value;
    return min - (OVERSHOOT * past) / (past + OVERSHOOT * 2);
  }
  return value;
}

function Preloader({ onDone }: { readonly onDone: () => void }): ReactNode {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const started = performance.now();
    let frame = 0;
    const step = (): void => {
      const progress = Math.min(1, (performance.now() - started) / PRELOADER_MS);
      setValue(Math.round(progress * 100));
      if (progress < 1) frame = requestAnimationFrame(step);
      else onDone();
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [onDone]);
  return (
    <div
      role="progressbar"
      aria-label="Loading the lab"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className="preloader"
    >
      <span className="num">{value}</span>
    </div>
  );
}

function useScrollProgress(ref: React.RefObject<HTMLElement | null>): number {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const onScroll = (): void => {
      const element = ref.current;
      if (element === null) return;
      const rect = element.getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      setProgress(span <= 0 ? 0 : clamp(-rect.top / span, 0, 1));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [ref]);
  return progress;
}

interface SceneProps {
  readonly scrollProgress: number;
  readonly onPickBench: (bench: string) => void;
  readonly ready: boolean;
  readonly onReady: () => void;
}

function LabSceneRegion({ scrollProgress, onPickBench, ready, onReady }: SceneProps): ReactNode {
  const lab = useLab();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<LabScene | null>(null);
  const azimuthRaw = useRef(0);
  const elevationRaw = useRef(0);
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    axis: 'unknown' | 'horizontal' | 'vertical';
    touch: boolean;
    moved: boolean;
  } | null>(null);
  const spring = useRef<{ from: number; to: number; started: number } | null>(null);
  const liftStart = useRef<{ at: number; from: number; to: number } | null>(null);
  const lift = useRef(0);

  const held = lab.holdReservations[0] ?? null;
  const pending = lab.pendingBenches !== null;
  const confirmed = lab.notice.kind === 'confirmed';
  const lastSelected = useRef<string | null>(null);
  if (!pending) lastSelected.current = held?.bench ?? lab.activeBench;
  const selectedBench = lastSelected.current;
  const liftTarget = pending ? 0 : held !== null || confirmed ? 1 : lab.selection.length > 0 ? 1 : 0;

  useEffect(() => {
    if (liftStart.current?.to === liftTarget) return;
    liftStart.current = { at: performance.now(), from: lift.current, to: liftTarget };
  }, [liftTarget]);

  useEffect(() => {
    if (!ready || canvasRef.current === null) return;
    try {
      sceneRef.current = new LabScene(canvasRef.current);
    } catch {
      sceneRef.current = null;
    }
    const scene = sceneRef.current;
    return () => scene?.dispose();
  }, [ready]);

  const ringState = pending
    ? 'none'
    : confirmed
      ? 'band'
      : held !== null
        ? 'depleting'
        : 'none';
  const ringRemaining =
    ringState === 'depleting' && lab.holdDuration > 0
      ? clamp(lab.holdSecondsRemaining / lab.holdDuration, 0, 1)
      : null;

  const benchesForScene = useMemo(() => {
    const soldOut = lab.benches?.tiers.atelier.sold_out ?? false;
    return (lab.benches?.benches ?? []).map((bench) => ({
      label: bench.label,
      state: bench.state,
      selected:
        bench.label === selectedBench ||
        (lab.selection.includes(bench.label) && held === null && !pending),
      text: benchStateText(bench, lab.tier, soldOut),
    }));
  }, [held, lab.benches, lab.selection, lab.tier, pending, selectedBench]);

  useEffect(() => {
    let frame = 0;
    const step = (): void => {
      frame = requestAnimationFrame(step);
      const scene = sceneRef.current;
      const region = regionRef.current;
      const moving = liftStart.current;
      if (moving !== null) {
        const progress = Math.min(1, (performance.now() - moving.at) / LIFT_MS);
        lift.current =
          moving.from + (moving.to - moving.from) * (progress >= 1 ? 1 : easeOutBack(progress));
        if (progress >= 1) lift.current = moving.to;
      }
      const springing = spring.current;
      if (springing !== null) {
        const progress = Math.min(1, (performance.now() - springing.started) / SPRING_MS);
        azimuthRaw.current =
          springing.from + (springing.to - springing.from) * (progress >= 1 ? 1 : easeOutBack(progress));
        if (progress >= 1) spring.current = null;
      }
      const azimuth = rubberBand(azimuthRaw.current, AZIMUTH_RANGE.min, AZIMUTH_RANGE.max);
      const scrollElevation =
        ELEVATION_RANGE.max - scrollProgress * (ELEVATION_RANGE.max - ELEVATION_RANGE.min);
      const elevation = rubberBand(
        scrollElevation + elevationRaw.current,
        ELEVATION_RANGE.min,
        ELEVATION_RANGE.max,
      );
      scene?.setCamera({ azimuth, elevation });
      scene?.setState({
        benches: benchesForScene,
        lift: lift.current,
        ring: ringState,
        ringRemaining: ringRemaining ?? 0,
      });
      if (region !== null) {
        region.dataset['azimuth'] = azimuth.toFixed(1);
        region.dataset['elevation'] = elevation.toFixed(1);
        region.dataset['scrollProgress'] = scrollProgress.toFixed(2);
        region.dataset['selectedBench'] = selectedBench ?? '';
        region.dataset['ready'] = ready ? 'true' : 'false';
        region.dataset['lift'] = lift.current.toFixed(2);
        region.dataset['ring'] = ringState;
        region.dataset['ringRemaining'] = ringRemaining === null ? '' : ringRemaining.toFixed(2);
      }
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [benchesForScene, ready, ringRemaining, ringState, scrollProgress, selectedBench]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      axis: event.pointerType === 'touch' ? 'unknown' : 'horizontal',
      touch: event.pointerType === 'touch',
      moved: false,
    };
    spring.current = null;
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const state = drag.current;
    if (state === null || state.pointerId !== event.pointerId) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (state.axis === 'unknown') {
      if (Math.hypot(dx, dy) < 8) return;
      state.axis = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
      if (state.axis === 'vertical') {
        drag.current = null;
        return;
      }
    }
    state.x = event.clientX;
    state.y = event.clientY;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) state.moved = true;
    azimuthRaw.current = clamp(azimuthRaw.current + dx * 0.35, -180, 180);
    if (!state.touch) {
      elevationRaw.current = clamp(elevationRaw.current - dy * 0.25, -90, 90);
    }
  }, []);

  const settle = useCallback(() => {
    const state = drag.current;
    drag.current = null;
    const raw = azimuthRaw.current;
    if (raw > AZIMUTH_RANGE.max || raw < AZIMUTH_RANGE.min) {
      spring.current = {
        from: raw,
        to: clamp(raw, AZIMUTH_RANGE.min, AZIMUTH_RANGE.max),
        started: performance.now(),
      };
    }
    const scrollElevation =
      ELEVATION_RANGE.max - scrollProgress * (ELEVATION_RANGE.max - ELEVATION_RANGE.min);
    const elevation = scrollElevation + elevationRaw.current;
    if (elevation > ELEVATION_RANGE.max) elevationRaw.current = ELEVATION_RANGE.max - scrollElevation;
    if (elevation < ELEVATION_RANGE.min) elevationRaw.current = ELEVATION_RANGE.min - scrollElevation;
    return state;
  }, [scrollProgress]);

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const state = settle();
      if (state !== null && !state.moved) {
        const bench = sceneRef.current?.benchAtPoint(event.clientX, event.clientY) ?? null;
        if (bench !== null) onPickBench(bench);
      }
    },
    [onPickBench, settle],
  );

  return (
    <>
      {ready ? null : <Preloader onDone={onReady} />}
      <div className="lab-scene" role="region" aria-label="Lab scene" ref={regionRef}>
        <canvas
          ref={canvasRef}
          className="lab-canvas"
          aria-hidden="true"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => settle()}
          onLostPointerCapture={() => settle()}
        />
      </div>
    </>
  );
}

export function LabChapter({ viewport }: { readonly viewport: Viewport }): ReactNode {
  const lab = useLab();
  const reduced = useReducedMotion();
  const webgl = useMemo(() => hasWebGl(), []);
  const chapterRef = useRef<HTMLElement>(null);
  const scrollProgress = useScrollProgress(chapterRef);
  const [sceneReady, setSceneReady] = useState(false);
  const onReady = useCallback(() => setSceneReady(true), []);
  const sceneRuns = !reduced && webgl;
  const isClinic = lab.me?.account.role === 'clinic';

  const soldOut = lab.benches?.tiers.atelier.sold_out ?? false;
  const tierRemaining =
    lab.tier === 'atelier'
      ? (lab.benches?.tiers.atelier.remaining ?? 0)
      : (lab.benches?.tiers.bench.remaining ?? 0);
  const canHoldInTier = tierRemaining > 0;

  const onPickBench = useCallback(
    (bench: string) => {
      const view = lab.benches?.benches.find((candidate) => candidate.label === bench);
      if (view === undefined) return;
      const text = benchStateText(view, lab.tier, soldOut);
      if (text === 'Atelier only' || text !== 'Open') {
        document.querySelector<HTMLButtonElement>(`button[data-bench="${bench}"]`)?.click();
        return;
      }
      if (isClinic) lab.toggleSelection(bench);
      else void lab.holdBenches([bench]);
    },
    [isClinic, lab, soldOut],
  );

  return (
    <section className="chapter chapter-lab" id="chapter-lab" ref={chapterRef} aria-labelledby="lab-heading">
      <div className="chapter-inner lab-grid">
        <div className="lab-left">
          <h2 className="headline" id="lab-heading" tabIndex={-1}>
            <span>The lab</span>
            <span>24 benches</span>
          </h2>
          {sceneRuns ? (
            <LabSceneRegion
              scrollProgress={scrollProgress}
              onPickBench={onPickBench}
              ready={sceneReady}
              onReady={onReady}
            />
          ) : (
            <div className="flat-plan-note">{webgl ? null : <p>{NO_WEBGL_LINE}</p>}</div>
          )}
        </div>
        <div className="lab-right">
          <div
            className="tier-switch"
            role="radiogroup"
            aria-label="Tier"
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') lab.setTier('bench');
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') lab.setTier('atelier');
            }}
          >
            {(['bench', 'atelier'] as Tier[]).map((candidate) => (
              <button
                key={candidate}
                type="button"
                role="radio"
                aria-checked={lab.tier === candidate}
                tabIndex={lab.tier === candidate ? 0 : -1}
                className={`tier-option${lab.tier === candidate ? ' tier-on' : ''}`}
                onClick={() => lab.setTier(candidate)}
              >
                {tierName(candidate)}
                {candidate === 'atelier' && soldOut ? <span className="tier-note"> Sold out</span> : null}
              </button>
            ))}
          </div>

          {lab.tier === 'atelier' && soldOut ? (
            <div className="sold-out">
              <h3>{ATELIER_SOLD_OUT_HEADING}</h3>
              <p>{ATELIER_SOLD_OUT_BANNER}</p>
            </div>
          ) : null}

          {lab.billingOffline ? (
            <p role="alert" className="banner">
              {lab.notice.text}
            </p>
          ) : null}

          <BenchMap viewport={viewport} />

          {!canHoldInTier ? (
            <button type="button" onClick={() => void lab.joinWaitlist(lab.tier)}>
              Join the {tierName(lab.tier)} waitlist
            </button>
          ) : null}

          {viewport === 'phone' ? null : <HoldPanel kinetic={sceneRuns} />}

          <LiveRegion name="Bench updates" message={lab.notice.text} />
        </div>
      </div>
      {lab.holdEndedBench === null ? null : (
        <Dialog name="Hold ended" onClose={lab.dismissHoldEnded}>
          <h2>{holdEndedDialog.heading}</h2>
          <p>{holdEndedDialog.body(lab.holdEndedBench)}</p>
          <button
            type="button"
            onClick={() => {
              lab.dismissHoldEnded();
              document.getElementById('bench-map')?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus();
            }}
          >
            Back to the map
          </button>
        </Dialog>
      )}
    </section>
  );
}
