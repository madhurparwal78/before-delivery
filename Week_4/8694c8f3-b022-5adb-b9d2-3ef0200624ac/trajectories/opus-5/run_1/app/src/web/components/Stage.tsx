import { useEffect, useRef, useState } from 'react';
import { StageRenderer, type GizmoAxis } from '../gl/renderer.js';
import { store } from '../store.js';
import { useStoreState } from './common.js';
import { findLayer } from '../document.js';
import { clampToRange, rangeForPath } from '../../shared/domain.js';

const GIZMO_MODES: { mode: 'move' | 'rotate' | 'scale'; label: string }[] = [
  { mode: 'move', label: 'Move' },
  { mode: 'rotate', label: 'Rotate' },
  { mode: 'scale', label: 'Scale' },
];

function pathFor(mode: 'move' | 'rotate' | 'scale', axis: GizmoAxis): string {
  const group = mode === 'move' ? 'position' : mode === 'rotate' ? 'rotation' : 'scale';
  return `${group}.${axis}`;
}

function snapped(mode: 'move' | 'rotate' | 'scale', value: number, grid: boolean, angle: boolean): number {
  if (mode === 'move' && grid) return Math.round(value / 0.5) * 0.5;
  if (mode === 'rotate' && angle) return Math.round(value / 15) * 15;
  return value;
}

export function Stage({ chrome = true }: { chrome?: boolean }) {
  const state = useStoreState();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    const renderer = new StageRenderer(canvas);
    setAvailable(renderer.available);
    if (!renderer.available) return undefined;
    store.attachRenderer(renderer, canvas);
    const onResize = (): void => store.markDirty();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      store.attachRenderer(null, null);
    };
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    const renderer = store.renderer;
    if (canvas === null || renderer === null) return;
    const bounds = canvas.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const axis = chrome ? renderer.pickGrip(x, y) : null;
    const layer = findLayer(state.doc, state.selection);

    if (axis !== null && layer !== null) {
      const mode = state.gizmoMode;
      const path = pathFor(mode, axis);
      const range = rangeForPath(path);
      const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
      const group = mode === 'move' ? 'position' : mode === 'rotate' ? 'rotation' : 'scale';
      const start = layer[group][index];
      const direction = renderer.gizmoDirections[axis];
      const perPixel = mode === 'rotate' ? 1 : 0.01;
      store.beginInteraction();
      let current = start;
      const move = (pointer: PointerEvent): void => {
        const along =
          (pointer.clientX - bounds.left - x) * direction[0] + (pointer.clientY - bounds.top - y) * direction[1];
        const raw = start + along * perPixel;
        current = snapped(mode, raw, state.gridSnap, state.angleSnap);
        if (range !== null) current = clampToRange(current, range);
        store.preview(layer.id, path, current);
      };
      const up = (): void => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        store.endInteraction();
        if (current !== start) store.setLayerPath(layer.id, path, current);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }

    let lastX = event.clientX;
    let lastY = event.clientY;
    let velocityX = 0;
    let velocityY = 0;
    store.beginInteraction();
    const orbit = (pointer: PointerEvent): void => {
      velocityX = pointer.clientX - lastX;
      velocityY = pointer.clientY - lastY;
      renderer.orbitBy(velocityX, velocityY);
      lastX = pointer.clientX;
      lastY = pointer.clientY;
      store.markDirty();
    };
    const release = (): void => {
      window.removeEventListener('pointermove', orbit);
      window.removeEventListener('pointerup', release);
      store.endInteraction();
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const until = performance.now() + 450;
      const coast = (): void => {
        velocityX *= 0.9;
        velocityY *= 0.9;
        renderer.orbitBy(velocityX, velocityY);
        store.markDirty();
        if (performance.now() < until && Math.hypot(velocityX, velocityY) > 0.05) {
          window.requestAnimationFrame(coast);
        }
      };
      if (Math.hypot(velocityX, velocityY) > 0.5) window.requestAnimationFrame(coast);
    };
    window.addEventListener('pointermove', orbit);
    window.addEventListener('pointerup', release);
  };

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>): void => {
    event.preventDefault();
    store.renderer?.zoomBy(event.deltaY);
    store.markDirty();
  };

  const cameras = (state.doc?.layers ?? []).filter((layer) => layer.kind === 'camera');
  const activeCamera = findLayer(state.doc, state.doc?.set.active_camera_id ?? null);

  return (
    <div className="stage">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={chrome ? 'Stage viewport' : 'Show stage'}
        data-frame={state.frames}
        onPointerDown={onPointerDown}
        onWheel={onWheel}
      />
      {available ? null : (
        <div className="stage-fallback">This browser can&#39;t draw the stage. Your set still saves.</div>
      )}
      {chrome ? (
        <>
          <div className="snap-strip" role="toolbar" aria-label="Snapping">
            <button
              type="button"
              aria-pressed={state.gridSnap}
              onClick={() => store.patch({ gridSnap: !state.gridSnap })}
            >
              Grid snap
            </button>
            <button
              type="button"
              aria-pressed={state.angleSnap}
              onClick={() => store.patch({ angleSnap: !state.angleSnap })}
            >
              Angle snap
            </button>
          </div>
          <div className="gizmo-strip" role="toolbar" aria-label="Gizmos">
            {GIZMO_MODES.map((entry) => (
              <button
                key={entry.mode}
                type="button"
                role="radio"
                aria-checked={state.gizmoMode === entry.mode}
                onClick={() => store.patch({ gizmoMode: entry.mode })}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <div className="stage-camera">
            <select
              aria-label="Stage camera"
              value={state.doc?.set.active_camera_id ?? ''}
              onChange={(event) => {
                const doc = state.doc;
                if (doc === null) return;
                store.commit({
                  target: 'set',
                  type: 'set.update',
                  payload: { active_camera_id: event.target.value },
                  baseVersion: doc.set.settings_version,
                });
              }}
            >
              {cameras.map((camera) => (
                <option key={camera.id} value={camera.id}>
                  {camera.name}
                </option>
              ))}
            </select>
            <span>{activeCamera?.name ?? 'Default view'}</span>
          </div>
        </>
      ) : null}
    </div>
  );
}
