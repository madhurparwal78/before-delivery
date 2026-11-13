// SVG and element overlays above the canvas: grips, the remote-change highlight, trace strokes, the snap marker,
// the drafting-aid guides and the running command's rubber band. The motion here is element.animate() on these elements.
import { useLayoutEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { presentObject, primitivesOf } from '../../../shared/geometry.ts';
import type { ApiObject, Point, StoredObject } from '../../../shared/types.ts';
import { drawPath, popGrip, reducedMotion } from '../../ui/motion.ts';
import { anchorOf, expects, rubberBand, type Shape } from '../commandLine/machine.ts';
import { roundPoint } from '../commandLine/parse.ts';
import { useObservable } from '../observable.ts';
import { useEditorState, useEditorStore, type EditorStore } from '../store.ts';
import { scaleOf, toModel, toScreen, type CameraState } from './camera.ts';
import { draggableEnds, gripPoints } from './grips.ts';
import { constrain, snapNow, type Candidate } from './snap.ts';
import { svgPath } from './svgPath.ts';
import type { Projection } from './draw.ts';

const HOLD_MS = 1200;
const FADE_MS = 200;
const STROKE_MS = 500;
const STAGGER_MS = 40;
const LAST_START_MS = 400;
const LONG_TRACE = 10;

export const projectionOf = (camera: CameraState): Projection => {
  const k = scaleOf(camera);
  return { k, ox: camera.width / 2 - camera.center[0] * k, oy: camera.height / 2 + camera.center[1] * k };
};

const pathOfObject = (object: StoredObject, units: 'mm' | 'm', p: Projection): string =>
  primitivesOf(object, units).map((primitive) => svgPath(primitive, p)).join('');

function Marker({ candidate, camera }: { candidate: Candidate; camera: CameraState }) {
  const [x, y] = toScreen(camera, candidate.point);
  return (
    <svg role="img" aria-label={`${candidate.kind} snap`} className="snap-marker" width="12" height="12" viewBox="0 0 12 12" style={{ left: x - 6, top: y - 6 }}>
      {candidate.kind === 'Endpoint' && <rect x="1" y="1" width="10" height="10" />}
      {candidate.kind === 'Midpoint' && <path d="M6 1L11 11H1Z" />}
      {candidate.kind === 'Center' && <circle cx="6" cy="6" r="5" />}
      {candidate.kind === 'Intersection' && <path d="M1 1L11 11M11 1L1 11" />}
    </svg>
  );
}

function ShapeView({ shape, camera }: { shape: Shape; camera: CameraState }) {
  const at = (point: Point): string => toScreen(camera, point).map((value) => value.toFixed(1)).join(' ');
  switch (shape.kind) {
    case 'polyline': return <path d={`M${shape.points.map(at).join('L')}`} />;
    case 'rect': {
      const [ax, ay] = toScreen(camera, shape.a);
      const [bx, by] = toScreen(camera, shape.b);
      return <rect x={Math.min(ax, bx)} y={Math.min(ay, by)} width={Math.abs(bx - ax)} height={Math.abs(by - ay)} />;
    }
    case 'circle': {
      const [cx, cy] = toScreen(camera, shape.center);
      return <circle cx={cx} cy={cy} r={shape.radius * scaleOf(camera)} />;
    }
  }
}

/** Dotted paths: the ORTHO/POLAR direction from the last point and the OTRACK alignments through the last snap. */
function Guides({ store, camera, cursor }: { store: EditorStore; camera: CameraState; cursor: Point | null }) {
  const { aids, machine } = store.current;
  const track = store.hud.get().track;
  const anchor = anchorOf(machine);
  const far = camera.width + camera.height;
  const lines: string[] = [];
  if (aids.otrack && track && expects(machine) === 'point') {
    const [x, y] = toScreen(camera, track);
    lines.push(`M${x} 0V${camera.height}`, `M0 ${y}H${camera.width}`);
  }
  if ((aids.ortho || aids.polar) && anchor && cursor) {
    const [ax, ay] = toScreen(camera, anchor);
    const [cx, cy] = toScreen(camera, cursor);
    const length = Math.hypot(cx - ax, cy - ay);
    if (length > 0) lines.push(`M${ax} ${ay}L${ax + ((cx - ax) / length) * far} ${ay + ((cy - ay) / length) * far}`);
  }
  return <>{lines.map((d) => <path key={d} d={d} className="guide" />)}</>;
}

interface GripProps {
  object: ApiObject;
  camera: CameraState;
  store: EditorStore;
  highlight?: boolean;
}

function GripsOf({ object, camera, store, highlight }: GripProps) {
  const points = gripPoints(object);
  const ends = draggableEnds(object);
  return (
    <>
      {points.map((point, index) => {
        const [x, y] = toScreen(camera, point);
        const end = object.type === 'line' ? ends[index] : undefined;
        return (
          <div
            key={`${object.handle}:${index}`}
            role="img"
            aria-label={`Grip ${object.handle}`}
            className={end ? 'grip grip-drag' : 'grip'}
            data-highlight={highlight ? '' : undefined}
            style={{ left: x - 4, top: y - 4 }}
            onPointerDown={end ? (event) => beginDrag(event, store, object, end) : undefined}
          />
        );
      })}
    </>
  );
}

/** Dragging a line's end: the Properties panel follows the pointer through `preview`; the saved result replaces it on release. */
function beginDrag(event: ReactPointerEvent<HTMLElement>, store: EditorStore, object: ApiObject, end: 'start' | 'end'): void {
  if (object.type !== 'line' || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const grip = event.currentTarget;
  grip.setPointerCapture(event.pointerId);
  const frame = grip.closest('.canvas-frame')?.getBoundingClientRect();
  if (!frame) return;
  const other = end === 'start' ? object.end : object.start;
  const exclude = new Set([object.handle]);
  let latest: Point | null = null;

  const at = (e: PointerEvent): Point => {
    const x = e.clientX - frame.left;
    const y = e.clientY - frame.top;
    store.hud.update({ pointer: { x, y, touch: false }, cleared: false, cycle: 0 });
    const snap = snapNow(store, exclude);
    return roundPoint(snap ? snap.point : constrain(toModel(store.camera.get(), x, y), store.current.aids, other));
  };
  const onMove = (e: PointerEvent): void => {
    latest = at(e);
    const moved = presentObject({ ...object, [end]: latest }, store.current.drawing?.units ?? 'mm');
    store.setState({ preview: { [object.handle]: moved } });
  };
  const onUp = async (e: PointerEvent): Promise<void> => {
    grip.removeEventListener('pointermove', onMove);
    grip.removeEventListener('pointerup', onUp);
    grip.releasePointerCapture(e.pointerId);
    const point = latest;
    if (!point) return;
    try {
      await store.runCommand('PROPERTIES', { handles: [object.handle], set: { [end]: point } });
    } catch {
      store.pushHistory('The change could not be saved.');
    } finally {
      store.setState({ preview: null });
    }
  };
  grip.addEventListener('pointermove', onMove);
  grip.addEventListener('pointerup', onUp);
}

export function Overlay() {
  const store = useEditorStore();
  const state = useEditorState();
  const camera = useObservable(store.camera);
  const hud = useObservable(store.hud);
  const { drawing, selection, highlight, preview, activeTrace, playback, machine, aids } = state;
  const grips = useRef<HTMLDivElement>(null);
  const changes = useRef<HTMLDivElement>(null);
  const strokes = useRef<HTMLDivElement>(null);
  const units = drawing?.units ?? 'mm';
  const p = projectionOf(camera);

  const byHandle = useMemo(() => new Map((drawing?.objects ?? []).map((object) => [object.handle, object])), [drawing]);
  const traceObjects = (playback ?? activeTrace)?.objects ?? [];
  const selected = selection.flatMap((handle) => {
    const object = preview?.[handle] ?? byHandle.get(handle) ?? traceObjects.find((candidate) => candidate.handle === handle);
    return object ? [object] : [];
  });
  const changed = (highlight?.handles ?? []).flatMap((handle) => byHandle.get(handle) ?? []);

  // The snap marker, the constrained cursor and the rubber band only exist while a command awaits a point.
  const awaiting = expects(machine) === 'point' && hud.pointer !== null;
  const snap = awaiting ? snapNow(store) : null;
  const cursor = awaiting && hud.pointer ? (snap ? snap.point : constrain(toModel(camera, hud.pointer.x, hud.pointer.y), aids, anchorOf(machine))) : null;
  const shapes = cursor ? rubberBand(machine, cursor) : [];

  // Remote change: strokes draw in, grips pop, hold, then fade away and are removed.
  useLayoutEffect(() => {
    if (!highlight) return;
    const paths = [...(changes.current?.querySelectorAll('path') ?? [])];
    const popped = [...(grips.current?.querySelectorAll('[data-highlight]') ?? [])];
    const running: Animation[] = [];
    const reduced = reducedMotion();
    if (!reduced) {
      paths.forEach((path, index) => running.push(drawPath(path, index)));
      for (const grip of popped) running.push(popGrip(grip, 0));
    }
    const hold = setTimeout(() => {
      if (reduced) {
        store.setState({ highlight: null });
        return;
      }
      const fades = [...paths, ...popped].map((element) => element.animate({ opacity: [1, 0] }, { duration: FADE_MS, fill: 'both' }));
      void Promise.all(fades.map((fade) => fade.finished)).then(() => store.setState({ highlight: null }), () => undefined);
    }, HOLD_MS);
    return () => {
      clearTimeout(hold);
      for (const animation of running) animation.cancel();
    };
  }, [highlight?.key]);

  // Trace playback: each stroke draws in, in authored order; grips pop at the stroke ends and fade afterwards.
  useLayoutEffect(() => {
    if (!playback || reducedMotion()) return;
    const paths = [...(strokes.current?.querySelectorAll('path') ?? [])];
    const popped = [...(grips.current?.querySelectorAll('[data-playback]') ?? [])];
    const stagger = paths.length > LONG_TRACE ? LAST_START_MS / (paths.length - 1) : STAGGER_MS;
    const running = paths.map((path, index) => drawPath(path, (index * stagger) / STAGGER_MS, STROKE_MS));
    for (const grip of popped) running.push(popGrip(grip, Number(grip.getAttribute('data-playback')) * stagger + STROKE_MS));
    const hold = setTimeout(() => {
      for (const grip of popped) running.push(grip.animate({ opacity: [1, 0] }, { duration: FADE_MS, fill: 'both' }));
    }, HOLD_MS + STROKE_MS);
    return () => {
      clearTimeout(hold);
      for (const animation of running) animation.cancel();
    };
  }, [state.playbackKey, playback]);

  return (
    <div className="canvas-overlay">
      <svg className="overlay-svg" width={camera.width} height={camera.height} aria-hidden="true">
        <g className="rubber">{shapes.map((shape, index) => <ShapeView key={index} shape={shape} camera={camera} />)}</g>
        <Guides store={store} camera={camera} cursor={cursor} />
        {preview && Object.values(preview).map((object) => <path key={object.handle} d={pathOfObject(object, units, p)} className="preview" />)}
      </svg>
      <div role="group" aria-label="Change highlight" ref={changes}>
        {changed.map((object) => (
          <svg key={`${highlight?.key}:${object.handle}`} role="img" aria-label={`Changed ${object.handle}`} className="overlay-stroke" width={camera.width} height={camera.height}>
            <path d={pathOfObject(object, units, p)} pathLength={1} strokeDasharray={1} className="stroke-changed" />
          </svg>
        ))}
        <div ref={strokes} className="strokes">
          {traceObjects.map((object) => (
            <svg key={object.handle} role="img" aria-label={`Trace stroke ${object.handle}`} className="overlay-stroke" width={camera.width} height={camera.height}>
              <path d={pathOfObject(object, units, p)} pathLength={1} strokeDasharray={1} className="stroke-trace" />
            </svg>
          ))}
        </div>
      </div>
      <div role="group" aria-label="Grips" ref={grips}>
        {selected.map((object) => <GripsOf key={object.handle} object={object} camera={camera} store={store} />)}
        {changed.map((object) => <GripsOf key={`${highlight?.key}:${object.handle}`} object={object} camera={camera} store={store} highlight />)}
        {playback && traceObjects.flatMap((object, index) =>
          gripPoints(object).map((point, at) => {
            const [x, y] = toScreen(camera, point);
            return <div key={`${object.handle}:${at}`} role="img" aria-label={`Grip ${object.handle}`} className="grip" data-playback={index} style={{ left: x - 4, top: y - 4 }} />;
          }),
        )}
      </div>
      {snap && <Marker candidate={snap} camera={camera} />}
    </div>
  );
}
