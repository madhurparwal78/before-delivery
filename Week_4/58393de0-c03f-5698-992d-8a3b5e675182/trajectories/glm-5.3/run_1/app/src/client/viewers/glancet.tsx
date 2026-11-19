import type { VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { createContext, drawScene, hexToRgb, meshFor, type CameraState, type DrawItem } from '../gl.js';
import type { Scene3D, CircuitSnapshot, BlocksSnapshot, ShapeObject } from '../../shared/scene.js';
import { useReducedMotion } from '../pages/landing.js';

export type GlancetSnapshot = Scene3D | CircuitSnapshot | BlocksSnapshot;

export interface GlancetProps {
  studentId: string;
  nickname: string;
  revision: number;
  snapshot: GlancetSnapshot | null;
  onClose: () => void;
  fadeMs: number;
  openerButton: HTMLElement | null;
  classroomId: string;
}

export function topLevelsOf(snapshot: GlancetSnapshot | null): { meshCount: number; items: DrawItem[] } {
  if (!snapshot) return { meshCount: 0, items: [] };
  if (snapshot.kind === 'circuit') {
    return {
      meshCount: snapshot.components.length,
      items: snapshot.components.map((c, i) => {
        const shape = c.type === 'battery' ? 'box' : c.type === 'resistor' ? 'box' : c.type === 'switch' ? 'box' : 'sphere';
        return {
          mesh: meshFor(shape, 16, 16, 16, 0),
          x: (i % 4) * 24 - 36, y: Math.floor(i / 4) * 24 - 12, z: 8,
          color: hexToRgb(c.type === 'battery' ? '#ff9800' : c.type === 'led' ? '#4caf50' : c.type === 'resistor' ? '#9c27b0' : '#2196f3'),
          mode: 'solid' as const,
        };
      }),
    };
  }
  const objects = (snapshot.kind === '3d' ? snapshot.objects : (snapshot as BlocksSnapshot).objects) as ShapeObject[];
  return {
    meshCount: objects.length,
    items: objects.map((o) => ({
      mesh: meshFor(o.kind === 'group' ? 'box' : o.kind, o.w, o.d, o.h, o.rotationZ),
      x: o.x, y: o.y, z: o.z,
      color: hexToRgb(o.color),
      mode: o.mode,
    })),
  };
}

export function Glancet(props: GlancetProps): VNode {
  const ref = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [turnPaused, setTurnPaused] = useState(false);
  const [hasGl, setHasGl] = useState(true);
  const reduced = useReducedMotion();
  const scrollYRef = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Fade in over fadeMs (instant under reduced motion); focus enters the viewer.
  useEffect(() => {
    const firstBtn = dialogRef.current?.querySelector<HTMLElement>('button');
    firstBtn?.focus();
    if (reduced) { setTurnPaused(true); return; }
    const t = setTimeout(() => undefined, 0);
    const styleTimer = setTimeout(() => {
      if (stageRef.current) stageRef.current.style.opacity = '1';
    }, props.fadeMs);
    if (dialogRef.current) {
      dialogRef.current.style.opacity = '0';
      dialogRef.current.style.transition = `opacity ${props.fadeMs}ms linear`;
      requestAnimationFrame(() => {
        if (dialogRef.current) dialogRef.current.style.opacity = '1';
      });
    }
    return () => { clearTimeout(t); clearTimeout(styleTimer); };
  }, [reduced, props.fadeMs, props.studentId, props.nickname]);

  // Escape closes when focus is inside the viewer (or the page, when docked).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (expanded) return; // expanded is modal: handled by its own trap
      e.preventDefault();
      props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  // Draw the turntable.
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !hasGl) return;
    const ctx = createContext(canvas);
    if (!ctx) { setHasGl(false); return; }
    const { items } = topLevelsOf(props.snapshot);
    let raf = 0;
    let t0 = -1;
    const draw = (t: number) => {
      if (t0 < 0) t0 = t;
      const az = turnPaused || reduced ? 300 : 45 + (((t - t0) / 12000) % 1) * 360;
      const camera: CameraState = { azimuth: az, elevation: 35, distance: 260, target: [0, 0, 20] };
      drawScene(ctx, items, camera, [0.965, 0.973, 0.996, 1]);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [props.snapshot, turnPaused, reduced, hasGl]);

  const close = () => {
    if (dialogRef.current && !reduced) {
      dialogRef.current.style.opacity = '0';
    }
    const doClose = () => {
      window.scrollTo(0, scrollYRef.current);
      props.onClose();
    };
    if (reduced) doClose();
    else setTimeout(doClose, props.fadeMs);
  };

  const { meshCount } = topLevelsOf(props.snapshot);

  // F6 moves focus between the viewer and the opener tile.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F6') {
        e.preventDefault();
        if (document.activeElement && dialogRef.current?.contains(document.activeElement)) {
          props.openerButton?.focus();
        } else {
          const firstBtn = dialogRef.current?.querySelector<HTMLElement>('button');
          firstBtn?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.openerButton]);

  return (
    <div
      class={`glancet ${expanded ? 'expanded' : ''}`}
      role="dialog"
      aria-label={`Glancet: ${props.nickname}`}
      ref={dialogRef}
      data-playing={String(!(turnPaused || reduced))}
    >
      <div class="top">
        <span class="nick">{props.nickname}</span>
        <span class="rev num">Rev {props.revision}</span>
        <span class="grow" />
        <button
          class="btn"
          aria-label="Pause turntable"
          aria-pressed={turnPaused}
          onClick={() => setTurnPaused(!turnPaused)}
        >
          {turnPaused ? '▶' : '❚❚'}
        </button>
        <button
          class="btn expand-btn"
          aria-label="Expand viewer"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '⤡' : '⤢'}
        </button>
        <button class="btn" aria-label="Close viewer" onClick={close}>✕</button>
      </div>
      <div class="stage" ref={stageRef}>
        {hasGl ? <canvas ref={ref} aria-hidden="true" /> : null}
      </div>
      <div id="qy-glancet-state" class="qy-hidden" aria-hidden="true" data-student={props.studentId} data-revision={props.revision} data-mesh-count={meshCount} />
    </div>
  );
}
