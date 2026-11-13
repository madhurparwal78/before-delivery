import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  distanceTo,
  fitViewport,
  markerLabel,
  markerShape,
  nearestSnap,
  objectVertices,
  snapCandidates,
  toModel,
  toScreen,
  type CanvasBox,
  type Point,
  type SnapCandidate,
  type Viewport,
} from "./canvas.js";
import { formatLength } from "../shared/format.js";
import type { DrawingObject, Layer, Units } from "../shared/types.js";
import type { DrawingResponse } from "./types.js";

export interface CanvasViewProps {
  drawing: DrawingResponse;
  view: Viewport;
  box: CanvasBox;
  aids: { osnap: boolean; ortho: boolean; polar: boolean; snapGrid: boolean; otrack: boolean };
  selection: string[];
  traceActive: string | null;
  remoteHighlights: string[];
  traceStrokes: DrawingObject[];
  units: Units;
  onCursor: (p: Point | null) => void;
  onPick: (point: Point, snapped: SnapCandidate | null) => void;
  onTrackInput: () => void;
}

interface PointerState {
  mode: "none" | "pan" | "pinch";
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  startTime: number;
  touchStartDist: number;
  touchStartScale: number;
}

export function CanvasView(props: CanvasViewProps): JSX.Element {
  const { drawing, view, box, aids, selection } = props;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [snap, setSnap] = useState<SnapCandidate | null>(null);
  const pointer = useRef<PointerState>({ mode: "none", startX: 0, startY: 0, lastX: 0, lastY: 0, moved: false, startTime: 0, touchStartDist: 0, touchStartScale: 1 });
  const reduced = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  const layerMap = useMemo(() => {
    const map = new Map<string, Layer>();
    for (const layer of drawing.layers) map.set(layer.name, layer);
    return map;
  }, [drawing.layers]);

  const visibleObjects = useMemo(
    () =>
      drawing.objects.filter((o) => {
        const layer = layerMap.get(o.layer);
        return layer && layer.on && !layer.frozen;
      }),
    [drawing.objects, layerMap],
  );

  const candidates = useMemo(
    () => snapCandidates(visibleObjects, drawing.intersections),
    [visibleObjects, drawing.intersections],
  );

  const colourOf = (obj: DrawingObject): string => {
    const layer = layerMap.get(obj.layer);
    const colourMap: Record<string, string> = {
      Red: "#e5606d",
      Yellow: "#e8d873",
      Green: "#7fc98f",
      Cyan: "#7ad7e8",
      Blue: "#7f97e8",
      Magenta: "#d78ae0",
      White: "#e8e8e8",
    };
    return obj.color !== "ByLayer" ? colourMap[obj.color] ?? "#e8e8e8" : colourMap[layer?.color ?? "White"] ?? "#e8e8e8";
  };

  const updateCursor = useCallback(
    (x: number, y: number, touch = false): void => {
      const model = toModel(x, y, view, box);
      const aperture = touch ? 24 : 10;
      const found = aids.osnap ? nearestSnap(candidates, model, aperture / view.scale) : null;
      setSnap(found);
      setCursor(found ? found.point : model);
      props.onCursor(found ? found.point : model);
    },
    [aids.osnap, box, candidates, props, view],
  );

  const handlePointerDown = (e: React.PointerEvent): void => {
    props.onTrackInput();
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (e.button === 1 || e.pointerType === "touch") {
      pointer.current = {
        mode: "pan",
        startX: e.clientX - rect.left,
        startY: e.clientY - rect.top,
        lastX: e.clientX - rect.left,
        lastY: e.clientY - rect.top,
        moved: false,
        startTime: Date.now(),
        touchStartDist: 0,
        touchStartScale: view.scale,
      };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent): void => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (pointer.current.mode === "pan") {
      const dx = x - pointer.current.lastX;
      const dy = y - pointer.current.lastY;
      if (Math.abs(x - pointer.current.startX) > 5 || Math.abs(y - pointer.current.startY) > 5) {
        pointer.current.moved = true;
      }
      pointer.current.lastX = x;
      pointer.current.lastY = y;
      return;
    }
    if (e.pointerType === "touch") return;
    updateCursor(x, y);
  };

  const handlePointerUp = (e: React.PointerEvent): void => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const wasPan = pointer.current.mode === "pan";
    const moved = pointer.current.moved;
    const duration = Date.now() - pointer.current.startTime;
    pointer.current.mode = "none";
    if (wasPan && moved) return;
    const touch = e.pointerType === "touch";
    if (touch && duration >= 300) return;
    updateCursor(x, y, touch);
    const model = toModel(x, y, view, box);
    const aperture = touch ? 24 : 10;
    const found = aids.osnap ? nearestSnap(candidates, model, aperture / view.scale) : null;
    props.onPick(found ? found.point : model, found);
  };

  const onWheel = (e: React.WheelEvent): void => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.preventDefault();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.25 : 1 / 1.25;
    const model = toModel(x, y, view, box);
    void model;
    window.dispatchEvent(new CustomEvent("corbel-zoom", { detail: { factor, x, y } }));
  };

  const objectElems = visibleObjects.map((obj) => {
    const selected = selection.includes(obj.handle);
    const remote = props.remoteHighlights.includes(obj.handle);
    const path = objectPathFor(obj, view, box);
    return (
      <g key={obj.handle}>
        {path && (
          <path
            d={path}
            fill="none"
            stroke={selected ? "#7ad7e8" : colourOf(obj)}
            strokeWidth={selected ? 2 : 1}
            strokeDasharray={layerMap.get(obj.layer)?.linetype === "Dashed" ? "8 6" : layerMap.get(obj.layer)?.linetype === "Center" ? "16 4 4 4" : layerMap.get(obj.layer)?.linetype === "Hidden" ? "6 6" : undefined}
            className={remote && !reduced ? "draw-in" : undefined}
            style={remote && !reduced ? { ["--len" as string]: "1" } : undefined}
          />
        )}
        {obj.type === "mtext" && (
          <text
            x={toScreen(obj.position, view, box)[0]}
            y={toScreen(obj.position, view, box)[1]}
            fill={colourOf(obj)}
            fontSize={Math.max(8, obj.height * view.scale)}
            fontFamily="Fira Sans"
          >
            {obj.contents}
          </text>
        )}
        {obj.type === "dimension" && <DimensionMark obj={obj} view={view} box={box} units={props.units} />}
      </g>
    );
  });

  const traceElems = props.traceStrokes.map((obj, index) => {
    const path = objectPathFor(obj, view, box);
    const start = toScreen(objectVertices(obj)[0] ?? [0, 0], view, box);
    return (
      <g key={obj.handle}>
        <path
          d={path}
          fill="none"
          stroke="#7ad7e8"
          strokeWidth={1.5}
          className={reduced ? undefined : "draw-in"}
          style={{ animationDelay: `${Math.min(index * 40, 400)}ms` }}
        />
        {!reduced && <rect className="grip-pop" x={start[0] - 5} y={start[1] - 5} width={10} height={10} fill="#ff2f6d" />}
      </g>
    );
  });

  const gripElems: JSX.Element[] = [];
  for (const handle of [...selection, ...props.remoteHighlights]) {
    const obj = drawing.objects.find((o) => o.handle === handle);
    if (!obj) continue;
    for (const vertex of objectVertices(obj)) {
      const [sx, sy] = toScreen(vertex, view, box);
      gripElems.push(
        <img
          key={`grip-${handle}`}
          src="/brand/grip.svg"
          alt={`Grip ${handle}`}
          className={`grip ${reduced ? "" : "grip-pop"}`}
          style={{ left: sx, top: sy, position: "absolute", ...(reduced ? {} : { animationDelay: "0.9s" }) }}
        />,
      );
    }
  }

  const remoteElems = props.remoteHighlights.map((handle) => {
    const obj = drawing.objects.find((o) => o.handle === handle);
    if (!obj) return null;
    const [sx, sy] = toScreen(objectVertices(obj)[0] ?? [0, 0], view, box);
    return (
      <img
        key={`changed-${handle}`}
        src="/brand/grip.svg"
        alt={`Changed ${handle}`}
        className={`grip ${reduced ? "" : "grip-pop"}`}
        style={{ left: sx, top: sy, position: "absolute" }}
      />
    );
  });

  return (
    <div
      ref={wrapRef}
      className={`drawing-canvas ${props.traceActive ? "trace-mode" : ""}`}
      role="application"
      aria-label="Drawing canvas"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={onWheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg className="canvas-svg" aria-hidden="true">
        <g transform={`translate(0,0)`}>
          {aids.snapGrid && (
            <g stroke="#22303f" strokeWidth="0.5">
              {Array.from({ length: Math.ceil(box.width / 100) + 1 }, (_, i) => {
                const stepModel = 100 * view.scale;
                if (stepModel < 12) return null;
                const x = i * stepModel;
                return <line key={`v${i}`} x1={x} y1={0} x2={x} y2={box.height} />;
              })}
              {Array.from({ length: Math.ceil(box.height / 100) + 1 }, (_, i) => {
                const stepModel = 100 * view.scale;
                if (stepModel < 12) return null;
                const y = i * stepModel;
                return <line key={`h${i}`} x1={0} y1={y} x2={box.width} y2={y} />;
              })}
            </g>
          )}
          {objectElems}
          {props.traceActive && traceElems}
        </g>
      </svg>
      {gripElems}
      {remoteElems}
      {snap && (
        <span
          className="snap-marker"
          role="img"
          aria-label={markerLabel(snap.kind)}
          style={{
            left: toScreen(snap.point, view, box)[0],
            top: toScreen(snap.point, view, box)[1],
            clipPath: markerClip(snap.kind),
          }}
        />
      )}
      {cursor && (
        <span className="sr-only">
          {formatLength(cursor[0], props.units)}, {formatLength(cursor[1], props.units)}
        </span>
      )}
    </div>
  );
}

function markerClip(kind: SnapCandidate["kind"]): string {
  void markerShape(kind);
  switch (kind) {
    case "endpoint":
      return "none";
    case "midpoint":
      return "polygon(50% 0, 100% 100%, 0 100%)";
    case "center":
      return "circle(50% at 50% 50%)";
    case "intersection":
      return "polygon(0 0, 40% 0, 50% 40%, 60% 0, 100% 0, 100% 40%, 60% 50%, 100% 60%, 100% 100%, 60% 100%, 50% 60%, 40% 100%, 0 100%, 0 60%, 40% 50%, 0 40%)";
  }
}

function objectPathFor(obj: DrawingObject, view: Viewport, box: CanvasBox): string {
  const s = (p: Point): string => {
    const [x, y] = toScreen(p, view, box);
    return `${x} ${y}`;
  };
  switch (obj.type) {
    case "line":
      return `M ${s(obj.start)} L ${s(obj.end)}`;
    case "polyline":
    case "spline": {
      const pts = obj.type === "polyline" ? obj.vertices : obj.fit_points;
      if (pts.length === 0) return "";
      const head = `M ${s(pts[0])}`;
      const rest = pts.slice(1).map((p) => `L ${s(p)}`).join(" ");
      const close = obj.type === "polyline" && obj.closed ? " Z" : "";
      return `${head} ${rest}${close}`;
    }
    case "circle": {
      const [cx, cy] = toScreen(obj.center, view, box);
      const r = obj.radius * view.scale;
      return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 -${r * 2} 0`;
    }
    case "arc": {
      const rad = (deg: number): Point => [
        obj.center[0] + obj.radius * Math.cos((deg * Math.PI) / 180),
        obj.center[1] + obj.radius * Math.sin((deg * Math.PI) / 180),
      ];
      const s1 = rad(obj.start_angle);
      const e1 = rad(obj.end_angle);
      let sweep = ((obj.end_angle - obj.start_angle) % 360 + 360) % 360;
      if (sweep === 0) sweep = 360;
      const large = sweep > 180 ? 1 : 0;
      const [sx, sy] = toScreen(s1, view, box);
      const [ex, ey] = toScreen(e1, view, box);
      const r = obj.radius * view.scale;
      return `M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`;
    }
    case "revcloud": {
      const [x1, y1] = toScreen(obj.first, view, box);
      const [x2, y2] = toScreen(obj.opposite, view, box);
      const left = Math.min(x1, x2);
      const right = Math.max(x1, x2);
      const bottom = Math.max(y1, y2);
      const top = Math.min(y1, y2);
      const w = right - left;
      const h = bottom - top;
      const arcsX = Math.max(1, Math.ceil(Math.abs(obj.opposite[0] - obj.first[0]) / 150));
      const arcsY = Math.max(1, Math.ceil(Math.abs(obj.opposite[1] - obj.first[1]) / 150));
      const bulge = 12;
      const parts: string[] = [];
      for (let i = 0; i < arcsX; i++) {
        const seg = w / arcsX;
        parts.push(`M ${left + i * seg} ${top} q ${seg / 2} ${-bulge} ${seg} 0`);
      }
      for (let i = 0; i < arcsY; i++) {
        const seg = h / arcsY;
        parts.push(`M ${right} ${top + i * seg} q ${bulge} ${seg / 2} 0 ${seg}`);
      }
      for (let i = 0; i < arcsX; i++) {
        const seg = w / arcsX;
        parts.push(`M ${right - i * seg} ${bottom} q ${-seg / 2} ${bulge} ${-seg} 0`);
      }
      for (let i = 0; i < arcsY; i++) {
        const seg = h / arcsY;
        parts.push(`M ${left} ${bottom - i * seg} q ${-bulge} ${-seg / 2} 0 ${-seg}`);
      }
      return parts.join(" ");
    }
    case "mtext":
      return "";
    case "dimension": {
      const mid: Point = [(obj.points[0][0] + obj.points[1][0]) / 2, (obj.points[0][1] + obj.points[1][1]) / 2];
      return `M ${s(obj.points[0])} L ${s(mid)} L ${s(obj.location)} M ${s(obj.points[1])} L ${s(mid)}`;
    }
    case "insert": {
      const [x, y] = toScreen(obj.position, view, box);
      return `M ${x - 10} ${y} L ${x + 10} ${y} M ${x} ${y - 10} L ${x} ${y + 10}`;
    }
    default:
      return "";
  }
}

function DimensionMark(props: { obj: Extract<DrawingObject, { type: "dimension" }>; view: Viewport; box: CanvasBox; units: Units }): JSX.Element {
  const { obj, view, box } = props;
  const mid: Point = [(obj.points[0][0] + obj.points[1][0]) / 2, (obj.points[0][1] + obj.points[1][1]) / 2];
  const [lx, ly] = toScreen(obj.location, view, box);
  const [mx, my] = toScreen(mid, view, box);
  return (
    <text x={(lx + mx) / 2} y={(ly + my) / 2 - 4} fill="#e8e8e8" fontSize={11} fontFamily="Fira Sans" textAnchor="middle">
      {obj.text}
    </text>
  );
}

export function nearestObjectTo(doc: DrawingResponse, p: Point, maxDist: number): DrawingObject | null {
  const map = new Map<string, Layer>();
  for (const layer of doc.layers) map.set(layer.name, layer);
  let best: DrawingObject | null = null;
  let bestDist = maxDist;
  for (const obj of [...doc.objects].reverse()) {
    const layer = map.get(obj.layer);
    if (!layer || layer.frozen || !layer.on) continue;
    const dist = distanceTo(obj, p);
    if (dist <= bestDist) {
      bestDist = dist;
      best = obj;
    }
  }
  return best;
}

export { fitViewport };
