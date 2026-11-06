import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import * as THREE from 'three';
import { SVGRenderer } from 'three/examples/jsm/renderers/SVGRenderer.js';
import { COLOURS } from './build.js';
import { useSceneSnapshot } from './hooks.js';
import type { DimensionLine } from './layout.js';
import type { SceneModel, SceneSnapshot } from './model.js';

interface Backend { kind: 'webgl'; canvas: HTMLCanvasElement; gl: WebGLRenderingContext | WebGL2RenderingContext }
type Detected = Backend | { kind: 'still' };

function detect(): Detected {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { antialias: true }) ?? canvas.getContext('webgl', { antialias: true });
  return gl ? { kind: 'webgl', canvas, gl } : { kind: 'still' };
}

interface SceneViewProps {
  model: SceneModel;
  mode: 'config' | 'story';
  /** Escape pressed on the scene: the page moves focus to the selected parts row (or `Parts schedule`). */
  onEscape?: () => void;
  /** Rendered inside the ruled frame beneath the scene, for example `<TitleBlock .../>`. */
  titleBlock?: ReactNode;
}

const DRAG_PX = 4;
const AXIS_PX = 10;

export function SceneView({ model, mode, onEscape, titleBlock }: SceneViewProps): ReactNode {
  const snap = useSceneSnapshot(model);
  const [backend] = useState<Detected>(detect);
  const stageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture>({ pointers: new Map(), mode: 'none', moved: 0, pinch: 0 });

  useLayoutEffect(() => {
    model.setRendererKind(backend.kind);
    model.setMode(mode);
  }, [model, backend.kind, mode]);

  useEffect(() => {
    const stage = stageRef.current;
    const host = hostRef.current;
    if (!stage || !host) return undefined;
    model.measure = () => stage.getBoundingClientRect();
    let draw: () => void;
    let resize: (w: number, h: number) => void;
    let dispose: () => void;
    if (backend.kind === 'webgl') {
      const renderer = new THREE.WebGLRenderer({ canvas: backend.canvas, context: backend.gl, antialias: true });
      renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
      renderer.setClearColor(COLOURS.ground, 1);
      backend.canvas.className = 'scene-canvas';
      host.appendChild(backend.canvas);
      draw = () => renderer.render(model.moped.scene, model.camera);
      resize = (w, h) => { renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setSize(w, h, false); };
      dispose = () => { renderer.dispose(); renderer.forceContextLoss(); backend.canvas.remove(); };
    } else {
      const renderer = new SVGRenderer();
      renderer.setClearColor(new THREE.Color(COLOURS.ground), 1);
      renderer.domElement.setAttribute('class', 'scene-canvas');
      host.appendChild(renderer.domElement);
      draw = () => { model.orderForStill(); renderer.render(model.moped.scene, model.camera); };
      resize = (w, h) => renderer.setSize(w, h);
      dispose = () => renderer.domElement.remove();
    }
    const fit = (): void => {
      const rect = stage.getBoundingClientRect();
      resize(rect.width, rect.height);
      model.setSize(rect.width, rect.height);
      model.invalidate();
    };
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    fit();
    const relayout = (): void => model.refresh();
    window.addEventListener('scroll', relayout, { passive: true });
    window.addEventListener('resize', relayout);
    const removeRenderer = model.addRenderer(draw);
    const removeSnap = model.onSnap(() => host.animate([{ opacity: 0.45 }, { opacity: 1 }], { duration: 120, easing: 'linear' }));
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', relayout);
      window.removeEventListener('resize', relayout);
      removeRenderer();
      removeSnap();
      model.measure = null;
      dispose();
    };
  }, [model, backend]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const handled = sceneKey(model, event.key, onEscape);
    if (handled) event.preventDefault();
  };

  const down = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const g = gesture.current;
    const target = event.currentTarget;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    g.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY });
    if (event.pointerType === 'mouse') target.setPointerCapture(event.pointerId);
    if (g.pointers.size === 2) {
      g.mode = 'pinch';
      g.pinch = pointerDistance(g);
    } else if (g.pointers.size === 1) {
      g.mode = event.pointerType === 'mouse' ? 'orbit' : 'undecided';
      g.moved = 0;
    }
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const g = gesture.current;
    const p = g.pointers.get(event.pointerId);
    if (!p) return;
    const dx = event.clientX - p.x;
    const dy = event.clientY - p.y;
    p.x = event.clientX;
    p.y = event.clientY;
    const perPx = 180 / Math.max(1, snap.width);
    if (g.mode === 'pinch') {
      const distance = pointerDistance(g);
      if (g.pinch > 0 && distance > 0) model.scaleZoom(distance / g.pinch);
      g.pinch = distance;
      return;
    }
    g.moved = Math.max(g.moved, Math.hypot(event.clientX - p.startX, event.clientY - p.startY));
    if (g.mode === 'undecided') {
      const tx = event.clientX - p.startX;
      const ty = event.clientY - p.startY;
      if (Math.max(Math.abs(tx), Math.abs(ty)) < AXIS_PX) return;
      g.mode = Math.abs(tx) > Math.abs(ty) ? 'orbit-h' : 'scroll';
      if (g.mode === 'orbit-h') model.orbit(-tx * perPx, 0);
      return;
    }
    if (g.mode === 'orbit') model.orbit(-dx * perPx, dy * perPx);
    else if (g.mode === 'orbit-h') model.orbit(-dx * perPx, 0);
  };
  const up = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const g = gesture.current;
    const p = g.pointers.get(event.pointerId);
    g.pointers.delete(event.pointerId);
    if (g.pointers.size === 0) {
      if (p && g.mode !== 'pinch' && g.mode !== 'scroll' && g.moved < (event.pointerType === 'mouse' ? DRAG_PX : AXIS_PX)) model.clickSelect(event.clientX, event.clientY);
      g.mode = 'none';
    } else if (g.mode === 'pinch') {
      g.mode = 'scroll';
    }
  };
  const cancel = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const g = gesture.current;
    g.pointers.delete(event.pointerId);
    if (g.pointers.size === 0) g.mode = 'none';
    else g.mode = 'scroll';
  };

  const still = backend.kind === 'still';
  const role = still ? 'img' : 'application';
  const label = still ? 'Moped drawing' : 'Moped scene';
  const lead = snap.rail?.leadingEdgeLocal;
  const handleX = lead ? Math.min(snap.width, Math.max(0, lead.x)) : 0;
  const handleY = lead ? Math.min(snap.height, Math.max(0, lead.y)) : 0;

  return (
    <div className="scene-frame" data-scene-mode={mode}>
      <div className="scene-stage" ref={stageRef}>
        <div
          ref={hostRef}
          className="scene-surface"
          role={role}
          aria-label={label}
          tabIndex={0}
          data-renderer={snap.renderer}
          data-mesh-count={snap.meshCount}
          data-azimuth-deg={snap.azimuthDeg}
          data-elevation-deg={snap.elevationDeg}
          data-zoom={snap.zoom}
          data-selected-part={snap.selectedPart}
          data-story-offsets={snap.storyOffsetsJson}
          onKeyDown={onKeyDown}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={cancel}
        />
        <Overlay snap={snap} />
        {snap.rail ? (
          <RailHandle model={model} x={handleX} y={handleY} />
        ) : null}
      </div>
      {titleBlock}
    </div>
  );
}

interface Pointer { x: number; y: number; startX: number; startY: number }
interface Gesture {
  pointers: Map<number, Pointer>;
  mode: 'none' | 'undecided' | 'orbit' | 'orbit-h' | 'scroll' | 'pinch';
  moved: number;
  pinch: number;
}
function pointerDistance(g: Gesture): number {
  const [a, b] = [...g.pointers.values()];
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
}

/** Scene keys. Returns true when the key was consumed. */
function sceneKey(model: SceneModel, key: string, onEscape?: () => void): boolean {
  switch (key) {
    case 'ArrowLeft': model.orbit(-15, 0); return true;
    case 'ArrowRight': model.orbit(15, 0); return true;
    case 'ArrowUp': model.orbit(0, 15); return true;
    case 'ArrowDown': model.orbit(0, -15); return true;
    case '+': case '=': model.zoomBy(0.1); return true;
    case '-': case '_': model.zoomBy(-0.1); return true;
    case 'Home': model.resetCamera(); return true;
    case 'Escape': onEscape?.(); return true;
    default: return false;
  }
}

function RailHandle({ model, x, y }: { model: SceneModel; x: number; y: number }): ReactNode {
  return (
    <button
      type="button"
      className="rail-handle"
      aria-label="Rail handle"
      tabIndex={-1}
      style={{ left: x - 22, top: y - 22 }}
      onMouseDown={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        model.beginDrag(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => model.dragTo(event.clientX, event.clientY)}
      onPointerUp={() => model.endDrag(false)}
      onPointerCancel={() => model.endDrag(true)}
    >
      <svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true">
        <path d="M2 14V2h12M30 2h12v12M42 30v12H30M14 42H2V30" className="handle-corner" />
      </svg>
    </button>
  );
}

const extensionPath = (d: DimensionLine): string => `M${d.left.x} ${d.left.y}L${d.lineFromX} ${d.rowY}M${d.right.x} ${d.right.y}L${d.lineToX} ${d.rowY}`;

function linePath(d: DimensionLine): string {
  const tick = 4;
  return `M${d.lineFromX} ${d.rowY}H${d.lineToX}M${d.lineFromX} ${d.rowY - tick}V${d.rowY + tick}M${d.lineToX} ${d.rowY - tick}V${d.rowY + tick}`;
}

/** The dimension lines over the drawing: the same layer on the live scene and on every still. */
export function Overlay({ snap }: { snap: SceneSnapshot }): ReactNode {
  return (
    <svg className="scene-dims" aria-hidden="true" width={snap.width} height={snap.height} viewBox={`0 0 ${snap.width} ${snap.height}`}>
      {snap.dimensions.map((d) => <path key={d.id} d={extensionPath(d)} className="dim-extension" />)}
      {snap.dimensions.map((d) => (
        <g key={d.id} className="dim" data-part={d.id} data-selected={d.id === snap.selectedPart}>
          <path d={linePath(d)} className="dim-line" />
          <rect x={d.label.x} y={d.label.y} width={d.label.w} height={d.label.h} className="dim-box" />
          <text x={d.label.x + d.label.w / 2} y={d.label.y + d.label.h / 2} className="dim-text" textAnchor="middle" dominantBaseline="central">{d.text}</text>
        </g>
      ))}
      {snap.selectionBox ? (
        <g className="bracket">
          <path d={bracket(snap.selectionBox)} />
          {snap.selectionBox.tag ? (
            <g>
              <rect x={snap.selectionBox.x} y={Math.max(2, snap.selectionBox.y - 22)} width={snap.selectionBox.tag.length * 7.4 + 10} height={18} className="dim-box" />
              <text x={snap.selectionBox.x + 5} y={Math.max(2, snap.selectionBox.y - 22) + 9} className="dim-text" dominantBaseline="central">{snap.selectionBox.tag}</text>
            </g>
          ) : null}
        </g>
      ) : null}
    </svg>
  );
}

function bracket(b: { x: number; y: number; w: number; h: number }): string {
  const s = Math.min(14, b.w / 3, b.h / 3);
  const { x, y, w, h } = b;
  return `M${x} ${y + s}V${y}H${x + s}M${x + w - s} ${y}H${x + w}V${y + s}M${x + w} ${y + h - s}V${y + h}H${x + w - s}M${x + s} ${y + h}H${x}V${y + h - s}`;
}
