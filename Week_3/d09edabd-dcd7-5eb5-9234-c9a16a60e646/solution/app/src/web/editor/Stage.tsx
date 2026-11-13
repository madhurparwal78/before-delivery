import { useEffect, useMemo, useRef, useState } from 'react';
import { FloorPlan } from '../ui/FloorPlan';
import { prefersReducedMotion } from '../ui/hooks';
import { RoomView, webglSupported, type DrawPlacement, type Pose } from '../three/roomView';
import { DOLLY_MS, dolly, eyePose, overviewPose, startStance } from '../three/poses';
import { changePlacement, selectPlacement } from './placements';
import { clampPitch, roundHalfUp, setCameraLabel, setOrbit, wrapYaw } from './camera';
import { drawPlacements } from './model';
import { editor, useEditor } from './state';

const DEGREES_PER_PIXEL = 0.5;
const CLICK_SLOP = 4;

type Drag =
  | { kind: 'orbit'; x: number; y: number; yaw: number; pitch: number; moved: boolean }
  | { kind: 'move'; id: string; dx: number; dz: number; moved: boolean }
  | { kind: 'rotate'; id: string; x: number; from: number; moved: boolean }
  | { kind: 'scale'; id: string; moved: boolean };

const snap = (mm: number): number => Math.round(mm / 10) * 10;

/** With no room open the camera frames this nominal footprint, so the bare grid stage shows behind the picker. */
const EMPTY_STAGE = { widthMm: 4000, depthMm: 4000, heightMm: 2400 };

export default function Stage() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const region = useRef<HTMLDivElement>(null);
  const view = useRef<RoomView | null>(null);
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const previous = useRef<'overview' | 'eye'>('overview');
  const cancelDolly = useRef<() => void>(() => undefined);
  const [aspect, setAspect] = useState(1.6);

  const room = useEditor((s) => s.room);
  const placements = useEditor((s) => s.placements);
  const queue = useEditor((s) => s.queue);
  const preview = useEditor((s) => s.preview);
  const selectedId = useEditor((s) => s.selectedId);
  const mode = useEditor((s) => s.mode);
  const cam = useEditor((s) => s.cam);
  const testers = useEditor((s) => s.testers);
  const webgl = useEditor((s) => s.webgl);

  const drawn = useMemo(() => drawPlacements(placements, queue, preview), [placements, queue, preview]);

  useEffect(() => {
    if (!webglSupported()) {
      editor.set({ webgl: false });
      return;
    }
    const instance = new RoomView(canvas.current!);
    view.current = instance;
    const fit = (): void => {
      const box = region.current!.getBoundingClientRect();
      instance.setSize(box.width, box.height, window.devicePixelRatio);
      setAspect(box.width / Math.max(1, box.height));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(region.current!);
    return () => {
      observer.disconnect();
      instance.dispose();
      view.current = null;
    };
  }, []);

  useEffect(() => {
    if (room) view.current?.setRoom(room);
  }, [room?.id, room?.widthMm, room?.depthMm, room?.heightMm]);

  useEffect(() => {
    view.current?.setPlacements(drawn as DrawPlacement[], selectedId, mode === 'scale');
  }, [drawn, selectedId, mode]);

  useEffect(() => {
    view.current?.setMarkers(testers);
  }, [testers]);

  const pose = (): Pose => overviewPose(room ?? EMPTY_STAGE, cam.yaw, cam.pitch, cam.zoom, aspect);

  useEffect(() => {
    if (cam.target === 'overview' && cam.label === 'Overview') {
      view.current?.setPose(pose());
    }
  }, [room?.widthMm, room?.depthMm, room?.heightMm, cam.yaw, cam.pitch, cam.zoom, cam.target, cam.label, aspect]);

  useEffect(() => {
    const was = previous.current;
    previous.current = cam.target;
    const current = editor.get();
    if (!current.room || was === cam.target) return;
    const stance = startStance(current.room, current.placements);
    const eye = eyePose(stance.xMm, stance.zMm, stance.headingDeg);
    const overview = overviewPose(current.room, cam.yaw, cam.pitch, cam.zoom, aspect);
    const [from, to] = cam.target === 'eye' ? [overview, eye] : [eye, overview];
    const arrived = cam.target === 'eye' ? 'Player height' : 'Overview';
    cancelDolly.current();
    if (!view.current || prefersReducedMotion()) {
      view.current?.setPose(to);
      setCameraLabel(arrived);
      return;
    }
    if (cam.target === 'eye') setCameraLabel('Walking in');
    cancelDolly.current = dolly(from, to, DOLLY_MS, (p) => view.current?.setPose(p), () => setCameraLabel(arrived));
    return () => cancelDolly.current();
  }, [cam.nonce]);

  useEffect(() => {
    const element = region.current!;
    const wheel = (event: WheelEvent): void => {
      event.preventDefault();
      const zoom = editor.get().cam.zoom * Math.exp(event.deltaY / 500);
      setOrbit(editor.get().cam.yaw, editor.get().cam.pitch, Math.max(0.4, Math.min(2.5, zoom)));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);

  const fieldsAt = (id: string): DrawPlacement | undefined => drawPlacements(editor.get().placements, editor.get().queue, null).find((p) => p.id === id);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !view.current || cam.target === 'eye') return;
    region.current!.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: editor.get().cam.zoom };
      drag.current = null;
      return;
    }
    const hit = view.current.pick(event.clientX, event.clientY);
    const state = editor.get();
    if (hit?.kind === 'handle' && hit.id === state.selectedId) {
      drag.current = { kind: 'scale', id: hit.id, moved: false };
    } else if (hit?.kind === 'placement') {
      selectPlacement(hit.id);
      const p = fieldsAt(hit.id)!;
      const floor = view.current.floorPoint(event.clientX, event.clientY);
      drag.current =
        state.mode === 'rotate'
          ? { kind: 'rotate', id: hit.id, x: event.clientX, from: p.rotationDeg, moved: false }
          : { kind: 'move', id: hit.id, dx: floor ? p.xMm - floor.xMm : 0, dz: floor ? p.zMm - floor.zMm : 0, moved: false };
      if (state.mode === 'scale') drag.current = { kind: 'move', id: hit.id, dx: 0, dz: 0, moved: false };
    } else {
      drag.current = { kind: 'orbit', x: event.clientX, y: event.clientY, yaw: state.cam.yaw, pitch: state.cam.pitch, moved: false };
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const ratio = pinch.current.distance / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      setOrbit(editor.get().cam.yaw, editor.get().cam.pitch, Math.max(0.4, Math.min(2.5, pinch.current.zoom * ratio)));
      return;
    }
    const d = drag.current;
    if (!d || !view.current) return;
    const current = editor.get();
    if (d.kind === 'orbit') {
      d.moved ||= Math.hypot(event.clientX - d.x, event.clientY - d.y) > CLICK_SLOP;
      setOrbit(wrapYaw(d.yaw + (event.clientX - d.x) * DEGREES_PER_PIXEL), clampPitch(d.pitch + (d.y - event.clientY) * DEGREES_PER_PIXEL));
      return;
    }
    const p = fieldsAt(d.id);
    const floor = view.current.floorPoint(event.clientX, event.clientY);
    if (!p || !floor || !current.room) return;
    d.moved = true;
    if (d.kind === 'move') {
      const xMm = Math.max(0, Math.min(current.room.widthMm, snap(floor.xMm + d.dx)));
      const zMm = Math.max(0, Math.min(current.room.depthMm, snap(floor.zMm + d.dz)));
      editor.set({ preview: { id: d.id, fields: { xMm, zMm } } });
    } else if (d.kind === 'rotate') {
      editor.set({ preview: { id: d.id, fields: { rotationDeg: (((roundHalfUp(d.from + (event.clientX - d.x) * DEGREES_PER_PIXEL) % 360) + 360) % 360) } } });
    } else {
      const turn = (-p.rotationDeg * Math.PI) / 180;
      const lx = (floor.xMm - p.xMm) * Math.cos(turn) - (floor.zMm - p.zMm) * Math.sin(turn);
      const lz = (floor.xMm - p.xMm) * Math.sin(turn) + (floor.zMm - p.zMm) * Math.cos(turn);
      editor.set({
        preview: {
          id: d.id,
          fields: {
            widthMm: Math.max(10, Math.min(current.room.widthMm, snap(Math.abs(lx) * 2))),
            depthMm: Math.max(10, Math.min(current.room.depthMm, snap(Math.abs(lz) * 2))),
          },
        },
      });
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    pointers.current.delete(event.pointerId);
    pinch.current = null;
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'orbit') {
      if (!d.moved) selectPlacement(null);
      return;
    }
    const finished = editor.get().preview;
    editor.set({ preview: null });
    if (d.moved && finished) changePlacement(finished.id, finished.fields);
  };

  const label = cam.label;
  return (
    <div
      ref={region}
      className="stage-region"
      role="region"
      aria-label="Room stage"
      tabIndex={0}
      data-stage=""
      data-cam-yaw={roundHalfUp(cam.yaw) % 360}
      data-cam-pitch={roundHalfUp(cam.pitch)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {webgl ? <canvas ref={canvas} aria-hidden="true" /> : null}
      {!webgl && room ? (
        <>
          <p className="stage-notice">3D view unavailable on this device. Showing the floor plan.</p>
          <div className="stage-plan">
            <FloorPlan dims={room} placements={drawn as (DrawPlacement & { entry?: boolean })[]} selectedId={selectedId} label={`Floor plan of ${room.name}`} onSelect={(id) => selectPlacement(id)} />
          </div>
        </>
      ) : null}
      {room && drawn.length === 0 ? <p className="stage-empty">This room is empty. Add a primitive or place a prop.</p> : null}
      <div role="status" aria-label="Camera" className="visually-hidden">
        {label}
      </div>
    </div>
  );
}
