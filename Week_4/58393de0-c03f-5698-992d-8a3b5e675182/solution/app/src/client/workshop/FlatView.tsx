import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { DesignObject, Vec3 } from "../../shared/types";
import { displayColor } from "../render";
import type { Camera } from "./camera";
import { worldBounds } from "./model";
import { attachPointerControls, type Hit, type PickView } from "./pointer";
import type { WorkshopStore } from "./store";

const GRID_HALF_MM = 150;
const GRID_STEP_MM = 10;
const GRID_MAJOR_EVERY = 5;
/** How much of the view's height the camera distance spans, as a share of that distance. */
const VIEW_SPAN = 0.73;

interface Size {
  width: number;
  height: number;
}

/** World (x right, y up) to screen pixels: scaled by the camera distance and turned by the azimuth. */
function viewMatrix(camera: Camera, size: Size): [number, number, number, number, number, number] {
  const scale = size.height / (camera.distance * VIEW_SPAN);
  const angle = (camera.azimuth * Math.PI) / 180;
  const a = scale * Math.cos(angle);
  const b = scale * Math.sin(angle);
  return [a, b, b, -a, size.width / 2, size.height / 2];
}

function gridPath(): { minor: string; major: string } {
  const minor: string[] = [];
  const major: string[] = [];
  const count = GRID_HALF_MM / GRID_STEP_MM;
  for (let i = -count; i <= count; i++) {
    const at = i * GRID_STEP_MM;
    const target = i % GRID_MAJOR_EVERY === 0 ? major : minor;
    target.push(`M${at} ${-GRID_HALF_MM}V${GRID_HALF_MM}M${-GRID_HALF_MM} ${at}H${GRID_HALF_MM}`);
  }
  return { minor: minor.join(""), major: major.join("") };
}

const GRID = gridPath();

function Shape({ object, index }: { object: DesignObject; index: number }) {
  const hole = object.mode === "hole";
  const common = {
    "data-pick": object.id,
    transform: `translate(${object.x} ${object.y}) rotate(${object.rotationZ})`,
    fill: hole ? "url(#hole-stripes)" : displayColor(object.color, index),
    className: hole ? "flat-shape flat-shape--hole" : "flat-shape",
    strokeDasharray: hole ? "4 3" : undefined,
    vectorEffect: "non-scaling-stroke",
  } as const;
  if (object.kind === "cylinder" || object.kind === "sphere") {
    return <ellipse {...common} rx={object.w / 2} ry={object.d / 2} />;
  }
  return <rect {...common} x={-object.w / 2} y={-object.d / 2} width={object.w} height={object.d} />;
}

/**
 * The flat top-view drawing used where WebGL is unavailable. It is the same editor surface: it takes focus, selects
 * by click, orbits (turns the plan) and zooms, and the shape hit by the pointer is the topmost drawn one.
 */
export function FlatView({ store }: { store: WorkshopStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<Size>({ width: 600, height: 400 });
  const latest = useRef({ camera: state.camera, size });
  latest.current = { camera: state.camera, size };

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return undefined;
    const measure = () => setSize({ width: svg.clientWidth || 600, height: svg.clientHeight || 400 });
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    measure();
    const view: PickView = {
      pick: (x, y): Hit | null => {
        const id = document.elementFromPoint(x, y)?.closest("[data-pick]")?.getAttribute("data-pick");
        return id ? { id, normal: [0, 0, 1] } : null;
      },
      planePoint: (x, y, origin, normal): Vec3 | null => {
        if (normal[2] === 0) return null;
        const rect = svg.getBoundingClientRect();
        const [a, b, c, d, e, f] = viewMatrix(latest.current.camera, latest.current.size);
        const sx = x - rect.left - e;
        const sy = y - rect.top - f;
        const det = a * d - b * c;
        return [(d * sx - c * sy) / det, (-b * sx + a * sy) / det, origin[2]];
      },
    };
    store.canvas = svg;
    const release = attachPointerControls(svg, view, store);
    return () => {
      release();
      observer.disconnect();
      store.canvas = null;
    };
  }, [store]);

  const matrix = viewMatrix(state.camera, size).join(" ");
  const drawn = useMemo(
    () => state.design.objects.map((object, index) => ({ object, index })).sort((p, q) => p.object.z - q.object.z),
    [state.design.objects],
  );
  const { origin } = state.design.workplane;
  return (
    <svg
      ref={ref}
      className="workshop-canvas workshop-canvas--flat"
      role="application"
      aria-label="3D workplane"
      tabIndex={0}
      data-mode={state.mode}
    >
      <defs>
        <pattern id="hole-stripes" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" className="flat-hole-pale" />
          <rect width="3" height="6" className="flat-hole-dark" />
        </pattern>
      </defs>
      <g transform={`matrix(${matrix})`} aria-hidden="true">
        <path d={GRID.minor} className="flat-grid" vectorEffect="non-scaling-stroke" />
        <path d={GRID.major} className="flat-grid flat-grid--major" vectorEffect="non-scaling-stroke" />
        <circle cx={origin[0]} cy={origin[1]} r={3} className="flat-origin" vectorEffect="non-scaling-stroke" />
        {drawn.map(({ object, index }) => <Shape key={object.id} object={object} index={index} />)}
        {state.selected.map((id) => {
          const object = state.design.objects.find((candidate) => candidate.id === id);
          if (!object) return null;
          const { min, max } = worldBounds(object);
          return (
            <rect
              key={id}
              className="flat-selection"
              x={min[0]}
              y={min[1]}
              width={max[0] - min[0]}
              height={max[1] - min[1]}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </g>
    </svg>
  );
}
