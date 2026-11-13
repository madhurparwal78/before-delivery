import '../styles/stage.css';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { MESSAGES } from '../../shared/messages';
import { pointerOf } from '../../shared/evaluator/follow';
import { num } from '../../shared/evaluator/resolve';
import { projectPoint } from '../../shared/projection';
import { ARTBOARDS } from '../../shared/types';
import { publicSettings } from '../api';
import { CAMERA_ID, useEditor } from '../editor/model';
import { AssetLoader } from './assets';
import { StageDynamics } from './dynamics';
import { screenRect, type Rect, type SceneState } from './display';
import { layerAt } from './interaction';
import { publishFollow } from './follow';
import { SceneSurface, type SurfaceHandle } from './SceneSurface';
import type { RendererKind } from './engine';

const VIRTUAL_STEP = 0.1;
const GIZMO_RADIUS = 66;
const MOVE_PER_PX = 0.01;
const ROTATE_PER_PX = 0.5;

const SOLID = new Set(['Primitive', 'Extrusion', 'Model', 'Particles', 'Cloth']);

interface Handle {
  label: string;
  path: string;
  mode: 'move' | 'rotate';
  axis: 'x' | 'y' | 'z';
  /** Angle on the ring around the layer's centre, in degrees. */
  angle: number;
}

const HANDLES: Handle[] = [
  { label: 'Move along X', path: 'position.x', mode: 'move', axis: 'x', angle: 0 },
  { label: 'Move along Y', path: 'position.y', mode: 'move', axis: 'y', angle: -60 },
  { label: 'Move along Z', path: 'position.z', mode: 'move', axis: 'z', angle: -120 },
  { label: 'Rotate around X', path: 'rotation.x', mode: 'rotate', axis: 'x', angle: 180 },
  { label: 'Rotate around Y', path: 'rotation.y', mode: 'rotate', axis: 'y', angle: 120 },
  { label: 'Rotate around Z', path: 'rotation.z', mode: 'rotate', axis: 'z', angle: 60 },
];

const snap = (value: number, step: number): number => Math.round(Math.round(value / step) * step * 1000) / 1000;
const clampTo = (value: number, limit: number): number => Math.min(limit, Math.max(-limit, value));

interface Overlay {
  rect: Rect | null;
  centre: { x: number; y: number } | null;
}

const sameRect = (a: Rect | null, b: Rect | null): boolean =>
  a === b || (a !== null && b !== null && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.right - b.right) < 0.5 && Math.abs(a.bottom - b.bottom) < 0.5);

export function StagePanel() {
  const editor = useEditor();
  const latest = useRef(editor);
  latest.current = editor;
  const board = ARTBOARDS[editor.breakpoint];
  const fit = useRef<HTMLDivElement>(null);
  const group = useRef<HTMLDivElement>(null);
  const surface = useRef<SurfaceHandle>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [kind, setKind] = useState<RendererKind | null>(null);
  const [overlay, setOverlay] = useState<Overlay>({ rect: null, centre: null });
  const loader = useMemo(() => new AssetLoader((id) => `/api/assets/${id}/original`), []);
  const webgl = true;
  const motion = useRef(new StageDynamics());
  const dirty = useRef(true);
  const loaderVersion = useRef(-1);
  const drag = useRef<{ handle: Handle; startX: number; startY: number; start: number; key: string } | null>(null);

  useLayoutEffect(() => {
    const element = fit.current as HTMLDivElement;
    const measure = (): void => {
      const ratio = board.width / board.height;
      const availableWidth = element.clientWidth;
      const availableHeight = element.clientHeight;
      const width = availableHeight > 80 ? Math.min(availableWidth, availableHeight * ratio) : availableWidth;
      setBox({ width: Math.floor(width), height: Math.floor(width / ratio) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [board.width, board.height]);

  useEffect(() => {
    dirty.current = true;
  }, [editor.document, editor.scene, editor.assets, editor.breakpoint, editor.frame, editor.scroll, editor.reduceMotion, editor.preview, editor.selection, box]);

  const draw = useCallback((now: number): void => {
    const e = latest.current;
    const handle = surface.current;
    if (!handle) return;
    const { moved, snapshot, dynamics } = motion.current.step(now, {
      prepared: handle.prepared,
      assets: e.assets,
      breakpoint: e.breakpoint,
      lightEnabled: e.scene.light.enabled,
      lightMomentum: e.scene.light.momentum,
      reduced: e.reduceMotion,
      active: e.preview,
    });
    if (!moved && !dirty.current && loaderVersion.current === loader.version) return;
    dirty.current = false;
    loaderVersion.current = loader.version;
    const state: SceneState = {
      document: e.document,
      scene: e.scene,
      assets: e.assets,
      breakpoint: e.breakpoint,
      frame: e.frame,
      scroll: e.scroll,
      reducedMotion: e.reduceMotion,
      dynamics,
      particleMax: publicSettings().particleMax,
      lightFocus: e.preview ? snapshot.focus : { x: 0.8, y: 0.9 },
    };
    handle.draw(state);
    if (e.preview) publishFollow(snapshot);
    const drawn = handle.prepared;
    const primary = drawn?.solids.find((s) => s.rl.layer.id === e.primary);
    const flat = drawn?.scenery.layers.find((l) => l.layer.id === e.primary);
    let rect: Rect | null = null;
    let centre: Overlay['centre'] = null;
    if (drawn && primary) {
      rect = screenRect(primary, drawn, e.assets);
      centre = projectPoint(primary.transform.position, drawn.scenery.scene.camera, drawn.scenery.artboard);
    } else if (flat && !SOLID.has(flat.layer.kind) && flat.layer.kind !== 'Group' && flat.layer.kind !== 'Effect') {
      const x = num(flat.values, 'x');
      const y = num(flat.values, 'y');
      rect = { left: x, top: y, right: x + num(flat.values, 'width', 200), bottom: y + num(flat.values, 'height', 200) };
    }
    setOverlay((current) => (sameRect(current.rect, rect) && current.centre?.x === centre?.x && current.centre?.y === centre?.y ? current : { rect, centre }));
  }, [loader]);

  useEffect(() => {
    let raf = 0;
    const loop = (now: number): void => {
      draw(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  useEffect(() => {
    if (!editor.preview) {
      motion.current.reset();
      publishFollow(null);
      dirty.current = true;
    }
  }, [editor.preview]);

  const place = (event: { clientX: number; clientY: number }): { n: number; m: number } | null => {
    const rect = group.current?.getBoundingClientRect();
    return rect && rect.width > 0 ? pointerOf(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height) : null;
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!editor.preview) return;
    const at = place(event);
    if (at) motion.current.follow.setPointer(at.n, at.m);
  };
  const release = (): void => motion.current.follow.release(performance.now());
  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (editor.preview && event.pointerType === 'touch') onPointerMove(event);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (editor.preview && event.pointerType === 'touch') release();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!editor.preview) return;
    const current = motion.current.follow.pointerPosition ?? { n: 0, m: 0 };
    const move: Record<string, [number, number]> = {
      ArrowRight: [VIRTUAL_STEP, 0],
      ArrowLeft: [-VIRTUAL_STEP, 0],
      ArrowDown: [0, VIRTUAL_STEP],
      ArrowUp: [0, -VIRTUAL_STEP],
    };
    const step = move[event.key];
    if (step) {
      event.preventDefault();
      motion.current.follow.setPointer(current.n + step[0], current.m + step[1]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      release();
    }
  };

  const onClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (editor.preview) return;
    const rect = group.current?.getBoundingClientRect();
    const prepared = surface.current?.prepared;
    if (!rect || !prepared) return;
    const x = ((event.clientX - rect.left) / rect.width) * board.width;
    const y = ((event.clientY - rect.top) / rect.height) * board.height;
    const hit = layerAt(prepared, editor.assets, x, y);
    if (hit && event.shiftKey) editor.select([...new Set([...editor.selection, hit])], hit);
    else editor.select(hit ? [hit] : [], hit);
  };

  const primaryLayer = editor.scene.layers.find((l) => l.id === editor.primary);
  const showGizmo = !editor.preview && primaryLayer !== undefined && SOLID.has(primaryLayer.kind) && editor.primary !== CAMERA_ID;
  const scale = box.width > 0 ? box.width / board.width : 1;

  const startDrag = (handle: Handle) => (event: PointerEvent<HTMLButtonElement>): void => {
    if (!editor.canEdit || !editor.primary) return;
    const resolved = surface.current?.prepared?.scenery.layers.find((l) => l.layer.id === editor.primary);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    drag.current = {
      handle,
      startX: event.clientX,
      startY: event.clientY,
      start: num(resolved?.values ?? {}, handle.path),
      key: `gizmo:${editor.primary}:${handle.path}:${Date.now()}`,
    };
  };
  const moveDrag = (event: PointerEvent<HTMLButtonElement>): void => {
    const current = drag.current;
    if (!current || !editor.primary) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    let value: number;
    if (current.handle.mode === 'rotate') value = clampTo(snap(current.start + dx * ROTATE_PER_PX, event.shiftKey ? 15 : 1), 360);
    else {
      const delta = (current.handle.axis === 'y' ? -dy : dx) * MOVE_PER_PX;
      value = clampTo(snap(current.start + delta, event.shiftKey ? 0.1 : 0.01), 100);
    }
    editor.editLayer(editor.primary, { [current.handle.path]: value }, current.key);
  };
  const endDrag = (event: PointerEvent<HTMLButtonElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
  };

  const centre = overlay.centre ?? { x: board.width / 2, y: board.height / 2 };
  const middle = {
    x: Math.min(Math.max(centre.x * scale, GIZMO_RADIUS + 22), Math.max(box.width - GIZMO_RADIUS - 22, GIZMO_RADIUS + 22)),
    y: Math.min(Math.max(centre.y * scale, GIZMO_RADIUS + 22), Math.max(box.height - GIZMO_RADIUS - 22, GIZMO_RADIUS + 22)),
  };

  return (
    <div className="stage-panel panel">
      <div className="stage-fit" ref={fit}>
        <div
          ref={group}
          className="stage-group"
          role="group"
          aria-label="Stage"
          tabIndex={0}
          data-renderer={kind ?? undefined}
          data-breakpoint={editor.breakpoint}
          data-frame={editor.frame}
          data-preview={editor.preview}
          style={{ width: box.width, height: box.height }}
          onPointerMove={onPointerMove}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => editor.preview && release()}
          onPointerLeave={(event) => event.pointerType !== 'touch' && editor.preview && release()}
          onKeyDown={onKeyDown}
          onClick={onClick}
        >
          <SceneSurface ref={surface} webgl={webgl} loader={loader} onKind={setKind} />
          <div className="stage-overlay">
            {!editor.preview && overlay.rect && (
              <div
                className="stage-selection"
                style={{
                  left: overlay.rect.left * scale,
                  top: overlay.rect.top * scale,
                  width: Math.max((overlay.rect.right - overlay.rect.left) * scale, 2),
                  height: Math.max((overlay.rect.bottom - overlay.rect.top) * scale, 2),
                }}
              />
            )}
            {showGizmo &&
              HANDLES.map((handle) => (
                <button
                  key={handle.label}
                  type="button"
                  className="gizmo-handle"
                  data-axis={handle.axis}
                  data-ring={handle.mode === 'rotate'}
                  aria-label={handle.label}
                  disabled={!editor.canEdit}
                  title={editor.canEdit ? undefined : MESSAGES.viewerRefusal}
                  style={{
                    left: middle.x + GIZMO_RADIUS * Math.cos((handle.angle * Math.PI) / 180),
                    top: middle.y + GIZMO_RADIUS * Math.sin((handle.angle * Math.PI) / 180),
                  }}
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={startDrag(handle)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                >
                  {handle.axis.toUpperCase()}
                </button>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
