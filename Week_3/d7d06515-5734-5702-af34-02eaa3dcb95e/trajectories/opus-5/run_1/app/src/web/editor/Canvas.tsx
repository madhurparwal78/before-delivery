import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Drawing, DrawingObject, Point } from '../../shared/api';
import { applyGrid, applyOrtho, applyPolar } from './coords';
import { drawScene, objectPathData, objectVertices } from './draw';
import {
  candidatesInAperture,
  MOUSE_APERTURE,
  PICK_PIXELS,
  pickObject,
  selectableObjects,
  snapCandidates,
  TOUCH_APERTURE,
  type SnapCandidate,
} from './snap';
import { drawingExtents, fittedScale, fitView, toModel, toScreen, zoomAbout, type ViewState } from './view';
import { useReducedMotion } from '../shell';
import type { DraftingAids } from './useEditor';

const PAPER = { sheetWidth: 420, sheetHeight: 297 };

export interface CanvasProps {
  drawing: Drawing;
  traceObjects: DrawingObject[];
  dimBase: boolean;
  aids: DraftingAids;
  selection: string[];
  changed: string[];
  playback: DrawingObject[] | null;
  layout: string;
  viewportScale: string | null;
  awaitingPoint: boolean;
  awaitingSelection: boolean;
  lastPoint: Point | null;
  onPick: (point: Point) => void;
  onSelect: (handle: string, additive: boolean) => void;
  onClearSelection: () => void;
  onCoordinates: (point: Point) => void;
  onZoom: (percent: number) => void;
  installZoom: (extents: () => void, by: (factor: number) => void) => void;
  onGripDrag: (handle: string, index: number, point: Point, done: boolean) => void;
  children?: React.ReactNode;
}

export function Canvas(props: CanvasProps): JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [view, setView] = useState<ViewState | null>(null);
  const [marker, setMarker] = useState<SnapCandidate | null>(null);
  const [cycleIndex, setCycleIndex] = useState(0);
  const pointerRef = useRef<Point | null>(null);
  const panRef = useRef<{ start: Point; centre: Point } | null>(null);
  const dragRef = useRef<{ handle: string; index: number } | null>(null);
  const touchRef = useRef<{ start: number; point: Point; distance: number | null }>({
    start: 0,
    point: [0, 0],
    distance: null,
  });
  const reduced = useReducedMotion();

  useLayoutEffect(() => {
    const node = wrapRef.current;
    if (node === null) return;
    const update = (): void => {
      const box = node.getBoundingClientRect();
      setSize({ width: Math.max(1, Math.round(box.width)), height: Math.max(1, Math.round(box.height)) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const paper = props.layout === 'Model' ? null : { ...PAPER, viewportScale: 1 };
  const extents = paper === null
    ? drawingExtents(props.drawing.objects, props.drawing.layers)
    : { min: [-PAPER.sheetWidth / 2, -PAPER.sheetHeight / 2] as Point, max: [PAPER.sheetWidth / 2, PAPER.sheetHeight / 2] as Point };
  const fitted = fittedScale(extents, size.width, size.height);

  const zoomExtents = useCallback(() => {
    setView(fitView(extents, size.width, size.height));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height, JSON.stringify(extents)]);

  useEffect(() => {
    if (view === null) zoomExtents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomExtents, view]);

  // A resize keeps the current scale and centre; only opening a space re-fits the extents.
  useEffect(() => {
    setView(fitView(extents, size.width, size.height));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.layout]);

  const zoomBy = useCallback(
    (factor: number) => {
      setView((current) => (current === null ? current : zoomAbout(current, factor, current.centre)));
    },
    [],
  );

  useEffect(() => {
    props.installZoom(zoomExtents, zoomBy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomExtents, zoomBy]);

  useEffect(() => {
    if (view !== null) props.onZoom(Math.round((view.scale / fitted) * 100));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, fitted]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || view === null) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawScene({
      ctx,
      width: size.width,
      height: size.height,
      view,
      drawing: props.drawing,
      traceObjects: props.traceObjects,
      dimBase: props.dimBase,
      showGrid: props.aids['SNAP & GRID'],
      paper,
    });
  }, [view, size, props.drawing, props.traceObjects, props.dimBase, props.aids, props.layout]);

  const map = useCallback(
    (point: Point): Point => (view === null ? [0, 0] : toScreen(view, size.width, size.height, point)),
    [view, size],
  );

  const toModelPoint = useCallback(
    (screen: Point): Point => (view === null ? [0, 0] : toModel(view, size.width, size.height, screen)),
    [view, size],
  );

  const candidates = snapCandidates(props.drawing);

  const resolveMarker = useCallback(
    (screen: Point, aperture: number, index: number): SnapCandidate | null => {
      if (!props.aids.OSNAP || view === null) return null;
      const inside = candidatesInAperture(candidates, screen, view, size.width, size.height, aperture);
      if (inside.length === 0) return null;
      return inside[index % inside.length] ?? null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.aids.OSNAP, view, size, props.drawing],
  );

  const constrain = useCallback(
    (point: Point, snapped: SnapCandidate | null, last: Point | null): Point => {
      if (snapped !== null) return snapped.point;
      let result = point;
      if (last !== null && props.aids.ORTHO) result = applyOrtho(result, last);
      else if (last !== null && props.aids.POLAR) result = applyPolar(result, last);
      if (props.aids['SNAP & GRID']) result = applyGrid(result);
      return result;
    },
    [props.aids],
  );

  const localPoint = (event: { clientX: number; clientY: number }): Point => {
    const box = wrapRef.current!.getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top];
  };

  const onPointerMove = (event: React.PointerEvent): void => {
    const screen = localPoint(event);
    pointerRef.current = screen;
    if (panRef.current !== null && view !== null) {
      const pan = panRef.current;
      setView({
        scale: view.scale,
        centre: [
          pan.centre[0] - (screen[0] - pan.start[0]) / view.scale,
          pan.centre[1] + (screen[1] - pan.start[1]) / view.scale,
        ],
      });
      return;
    }
    const aperture = event.pointerType === 'touch' ? TOUCH_APERTURE : MOUSE_APERTURE;
    const snapped = resolveMarker(screen, aperture, cycleIndex);
    setMarker(snapped);
    const model = toModelPoint(screen);
    const constrained = constrain(model, snapped, props.lastPoint);
    props.onCoordinates(constrained);
    if (dragRef.current !== null) {
      props.onGripDrag(dragRef.current.handle, dragRef.current.index, constrained, false);
    }
  };

  const onPointerDown = (event: React.PointerEvent): void => {
    const screen = localPoint(event);
    if (event.button === 1) {
      event.preventDefault();
      panRef.current = { start: screen, centre: view?.centre ?? [0, 0] };
      return;
    }
    if (event.button !== 0) return;
    if (event.pointerType === 'touch') {
      touchRef.current = { start: Date.now(), point: screen, distance: null };
      return;
    }
    const model = toModelPoint(screen);
    if (props.selection.length > 0) {
      const target = props.drawing.objects.find((object) => props.selection.includes(object.handle));
      if (target !== undefined) {
        const vertices = objectVertices(target);
        for (const [index, vertex] of vertices.entries()) {
          const at = map(vertex);
          if (Math.hypot(at[0] - screen[0], at[1] - screen[1]) <= 7) {
            dragRef.current = { handle: target.handle, index };
            (event.target as Element).setPointerCapture?.(event.pointerId);
            return;
          }
        }
      }
    }
    handlePick(screen, model, event.shiftKey, MOUSE_APERTURE);
  };

  const handlePick = (screen: Point, model: Point, additive: boolean, aperture: number): void => {
    const snapped = resolveMarker(screen, aperture, cycleIndex);
    if (props.awaitingPoint) {
      props.onPick(constrain(model, snapped, props.lastPoint));
      return;
    }
    const tolerance = view === null ? 0 : PICK_PIXELS / view.scale;
    const found = pickObject(selectableObjects(props.drawing), model, tolerance);
    if (found === null) {
      if (props.awaitingSelection) return;
      props.onClearSelection();
      return;
    }
    props.onSelect(found.handle, additive);
  };

  const onPointerUp = (event: React.PointerEvent): void => {
    panRef.current = null;
    if (dragRef.current !== null) {
      const screen = localPoint(event);
      const snapped = resolveMarker(screen, MOUSE_APERTURE, cycleIndex);
      props.onGripDrag(
        dragRef.current.handle,
        dragRef.current.index,
        constrain(toModelPoint(screen), snapped, props.lastPoint),
        true,
      );
      dragRef.current = null;
      return;
    }
    if (event.pointerType === 'touch') {
      const screen = localPoint(event);
      const moved = Math.hypot(screen[0] - touchRef.current.point[0], screen[1] - touchRef.current.point[1]);
      if (Date.now() - touchRef.current.start < 300 && moved < 8) {
        const model = toModelPoint(screen);
        props.onCoordinates(model);
        handlePick(screen, model, false, TOUCH_APERTURE);
      }
    }
  };

  const onWheel = (event: React.WheelEvent): void => {
    if (view === null) return;
    event.preventDefault();
    const screen = localPoint(event);
    const anchor = toModelPoint(screen);
    setView(zoomAbout(view, event.deltaY < 0 ? 1.25 : 1 / 1.25, anchor));
  };

  const touchState = useRef<{ points: Map<number, Point>; distance: number | null }>({
    points: new Map(),
    distance: null,
  });

  const onTouchMove = (event: React.TouchEvent): void => {
    if (view === null) return;
    if (event.touches.length === 2) {
      const box = wrapRef.current!.getBoundingClientRect();
      const a: Point = [event.touches[0]!.clientX - box.left, event.touches[0]!.clientY - box.top];
      const b: Point = [event.touches[1]!.clientX - box.left, event.touches[1]!.clientY - box.top];
      const distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const previous = touchState.current.distance;
      touchState.current.distance = distance;
      if (previous !== null && previous > 0) {
        const anchor = toModelPoint([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
        setView(zoomAbout(view, distance / previous, anchor));
      }
      return;
    }
    if (event.touches.length === 1) {
      const box = wrapRef.current!.getBoundingClientRect();
      const screen: Point = [event.touches[0]!.clientX - box.left, event.touches[0]!.clientY - box.top];
      const start = touchRef.current.point;
      const moved = Math.hypot(screen[0] - start[0], screen[1] - start[1]);
      if (moved > 8) {
        setView({
          scale: view.scale,
          centre: [
            view.centre[0] - (screen[0] - start[0]) / view.scale,
            view.centre[1] + (screen[1] - start[1]) / view.scale,
          ],
        });
        touchRef.current.point = screen;
      }
    }
  };

  const onTouchEnd = (): void => {
    touchState.current.distance = null;
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab' || marker === null || !props.awaitingPoint) return;
      event.preventDefault();
      setCycleIndex((index) => index + 1);
      const screen = pointerRef.current;
      if (screen !== null) setMarker(resolveMarker(screen, MOUSE_APERTURE, cycleIndex + 1));
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [marker, props.awaitingPoint, cycleIndex, resolveMarker]);

  const gripObjects = props.drawing.objects.filter(
    (object) => props.selection.includes(object.handle) || props.changed.includes(object.handle),
  );
  const traceGripObjects = props.traceObjects.filter((object) => props.selection.includes(object.handle));
  const changedObjects = props.drawing.objects.filter((object) => props.changed.includes(object.handle));

  useEffect(() => {
    const node = overlayRef.current;
    if (node === null || reduced) return;
    const strokes = [...node.querySelectorAll<SVGPathElement>('path[data-changed]')];
    strokes.forEach((path, index) => {
      const length = path.getTotalLength();
      path.style.strokeDasharray = `${length}`;
      path.animate([{ strokeDashoffset: length }, { strokeDashoffset: 0 }], {
        duration: 900,
        delay: index * 40,
        easing: 'cubic-bezier(0.2, 0.9, 0.1, 1)',
        fill: 'both',
      });
    });
  }, [props.changed, reduced]);

  useEffect(() => {
    const node = overlayRef.current;
    if (node === null || props.playback === null || reduced) return;
    const strokes = [...node.querySelectorAll<SVGPathElement>('path[data-trace-stroke]')];
    const stagger = strokes.length > 10 ? 400 / Math.max(1, strokes.length - 1) : 40;
    strokes.forEach((path, index) => {
      const length = path.getTotalLength();
      path.style.strokeDasharray = `${length}`;
      path.animate([{ strokeDashoffset: length }, { strokeDashoffset: 0 }], {
        duration: 500,
        delay: index * stagger,
        easing: 'linear',
        fill: 'both',
      });
    });
  }, [props.playback, reduced]);

  const markerShape = (candidate: SnapCandidate): JSX.Element => {
    if (candidate.kind === 'Endpoint') return <rect x="1" y="1" width="10" height="10" />;
    if (candidate.kind === 'Midpoint') return <polygon points="6,1 11,11 1,11" />;
    if (candidate.kind === 'Center') return <circle cx="6" cy="6" r="5" />;
    return <path d="M1 1 L11 11 M11 1 L1 11" />;
  };

  return (
    <div
      className={`canvas-wrap${props.dimBase ? ' tracing' : ''}`}
      ref={wrapRef}
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={() => {
        panRef.current = null;
        setMarker(null);
      }}
      onWheel={onWheel}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onContextMenu={(event) => event.preventDefault()}
    >
      <canvas
        ref={canvasRef}
        className="canvas-surface"
        role="application"
        aria-label="Drawing canvas"
        tabIndex={0}
        style={{ width: size.width, height: size.height }}
      />

      <svg className="canvas-overlay" ref={overlayRef} width={size.width} height={size.height} aria-hidden="true">
        {changedObjects.map((object) => (
          <path
            key={`changed-${object.handle}`}
            data-changed=""
            d={objectPathData(object, map)}
            fill="none"
            stroke="#8fd8f7"
            strokeWidth="2"
          />
        ))}
        {(props.playback ?? []).map((object) => (
          <path
            key={`stroke-${object.handle}`}
            data-trace-stroke=""
            d={objectPathData(object, map)}
            fill="none"
            stroke="#8fd8f7"
            strokeWidth="2"
          />
        ))}
      </svg>

      <div className="canvas-overlay" role="group" aria-label="Change highlight">
        {changedObjects.map((object) => (
          <span key={`c-${object.handle}`} role="img" aria-label={`Changed ${object.handle}`} />
        ))}
        {(props.playback ?? []).map((object) => (
          <span key={`t-${object.handle}`} role="img" aria-label={`Trace stroke ${object.handle}`} />
        ))}
      </div>

      <div className="canvas-overlay" role="group" aria-label="Grips">
        {[...gripObjects, ...traceGripObjects].flatMap((object) =>
          objectVertices(object).map((vertex, index) => {
            const at = map(vertex);
            return (
              <span
                key={`${object.handle}-${index}`}
                role="img"
                aria-label={`Grip ${object.handle}`}
                className="grip"
                style={{ left: at[0], top: at[1] }}
              />
            );
          }),
        )}
      </div>

      {props.children}

      {marker !== null ? (
        <svg
          className="snap-marker"
          role="img"
          aria-label={`${marker.kind} snap`}
          viewBox="0 0 12 12"
          style={{ left: map(marker.point)[0], top: map(marker.point)[1] }}
        >
          <g fill="none" stroke="#8fd8f7" strokeWidth="1.5">
            {markerShape(marker)}
          </g>
        </svg>
      ) : null}
    </div>
  );
}
