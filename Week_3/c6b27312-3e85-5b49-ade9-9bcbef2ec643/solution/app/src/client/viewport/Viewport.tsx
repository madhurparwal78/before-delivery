// The viewport shared by the home hero, part, compare, tape and room pages.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { Pose, Vec3 } from "../../shared/tine";
import { Crosshair, Frame } from "../chrome";
import { Engine, type Scene } from "./engine";

export interface ViewportHandle {
  glideTo: (pose: Pose) => void;
  resetView: () => void;
  getPose: () => Pose | null;
  pick: (clientX: number, clientY: number) => Vec3 | null;
  project: (point: Vec3) => { x: number; y: number; visible: boolean } | null;
}

export interface Pin {
  id: string;
  position: Vec3;
  kind: "finding" | "comment" | "leader";
  label?: string;
}

interface Props {
  attrs: Record<string, string | number | undefined>;
  scene: Scene | null;
  defaultPose: Pose | null;
  pins?: Pin[];
  fade?: boolean;
  onFadeEnd?: () => void;
  onCanvasClick?: (point: Vec3 | null) => void;
  outage?: { lastGood: string | null } | null;
  fallback?: { src: string; alt: string } | null;
  dot?: number;
  toolbar?: boolean;
  className?: string;
  children?: ReactNode;
}

const WEBGL_NEEDED = "3D view needs WebGL. Values and checks still work.";

let available: boolean | null = null;

/** Probes once on a throw-away canvas, so a browser without WebGL never makes three.js log an error. */
function webglAvailable(): boolean {
  if (available === null) {
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2") ?? probe.getContext("webgl");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    available = gl !== null;
  }
  return available;
}
const reducedQuery = "(prefers-reduced-motion: reduce)";

export const Viewport = forwardRef<ViewportHandle, Props>(function Viewport(props, ref) {
  const { attrs, scene, defaultPose, pins = [], fade = true, onFadeEnd, onCanvasClick, outage, fallback, dot = 8, toolbar = true, className = "", children } = props;
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<Engine | null>(null);
  const initial = useRef(false);
  const pinNodes = useRef(new Map<string, HTMLElement>());
  const [webgl, setWebgl] = useState(true);
  const [ortho, setOrtho] = useState(false);
  const fadeEnd = useRef(onFadeEnd);
  fadeEnd.current = onFadeEnd;
  const pinList = useRef(pins);
  pinList.current = pins;
  const defaultRef = useRef(defaultPose);
  defaultRef.current = defaultPose;

  const placePins = useCallback(() => {
    const e = engine.current;
    if (!e) return;
    for (const pin of pinList.current) {
      const node = pinNodes.current.get(pin.id);
      if (!node) continue;
      const at = e.project(pin.position);
      node.style.transform = `translate(${at.x}px, ${at.y}px)`;
      node.style.visibility = at.visible ? "visible" : "hidden";
    }
  }, []);

  useLayoutEffect(() => {
    const el = host.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    if (!webglAvailable()) {
      setWebgl(false);
      return;
    }
    const created = new Engine(el, cv);
    created.reduced = window.matchMedia(reducedQuery).matches;
    created.onFrame = placePins;
    engine.current = created;
    el.setAttribute("data-camera-moving", "false");
    const observer = new ResizeObserver(() => created.resize());
    observer.observe(el);
    const media = window.matchMedia(reducedQuery);
    const onMedia = () => {
      created.reduced = media.matches;
    };
    media.addEventListener("change", onMedia);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", onMedia);
      created.dispose();
      engine.current = null;
      initial.current = false;
    };
  }, [placePins]);

  useEffect(() => {
    const e = engine.current;
    if (!e || !scene) return;
    if (!initial.current && defaultRef.current) {
      e.setPose(defaultRef.current);
      initial.current = true;
    }
    e.setScene(scene, fade && sceneDrawn.has(e), () => fadeEnd.current?.());
    sceneDrawn.add(e);
    placePins();
  }, [scene, fade, placePins]);

  useEffect(() => {
    const e = engine.current;
    if (e && !initial.current && defaultPose) {
      e.setPose(defaultPose);
      initial.current = true;
    }
  }, [defaultPose]);

  useEffect(() => placePins(), [pins, placePins]);

  useImperativeHandle(ref, () => ({
    glideTo: (pose) => engine.current?.glideTo(pose),
    resetView: () => {
      if (defaultRef.current) engine.current?.glideTo(defaultRef.current);
    },
    getPose: () => engine.current?.getPose() ?? null,
    pick: (x, y) => engine.current?.pick(x, y) ?? null,
    project: (point) => engine.current?.project(point) ?? null,
  }));

  // Orbit, pinch and wheel: the only inputs that move the camera besides selecting a finding, hunk or thread.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const down = useRef<{ x: number; y: number; at: number } | null>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      engine.current?.zoom(Math.exp(event.deltaY * 0.0012));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("[data-ui-control]")) return;
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    down.current = pointers.current.size === 1 ? { x: event.clientX, y: event.clientY, at: performance.now() } : null;
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const last = pointers.current.get(event.pointerId);
    if (!last) return;
    const e = engine.current;
    if (pointers.current.size === 1) {
      e?.orbit(event.clientX - last.x, event.clientY - last.y);
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const before = Math.hypot(a.x - b.x, a.y - b.y);
      const moved = { x: event.clientX, y: event.clientY };
      const other = pointers.current.get([...pointers.current.keys()].find((k) => k !== event.pointerId) as number) as { x: number; y: number };
      const after = Math.hypot(moved.x - other.x, moved.y - other.y);
      if (after > 0 && before > 0) e?.zoom(before / after);
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  };
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.delete(event.pointerId);
    const start = down.current;
    down.current = null;
    if (start && event.type === "pointerup" && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5 && onCanvasClick) {
      onCanvasClick(engine.current?.pick(event.clientX, event.clientY) ?? null);
    }
  };

  const items = ["Reset view", "Orthographic"];
  const [active, setActive] = useState(0);
  const toolbarRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const onToolbarKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const move = event.key === "ArrowRight" ? Math.min(items.length - 1, active + 1) : event.key === "ArrowLeft" ? Math.max(0, active - 1) : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : -1;
    if (move < 0) return;
    event.preventDefault();
    setActive(move);
    toolbarRefs.current[move]?.focus();
  };

  const showGlow = !outage;
  return (
    <div className={`viewport-wrap ${className}`}>
      <div
        ref={host}
        className={showGlow ? "viewport viewport-glow" : "viewport"}
        data-ui="viewport"
        {...attrs}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {webgl ? <canvas ref={canvas} className="viewport-canvas" /> : null}
        {!webgl && fallback ? (
          <div className="viewport-fallback">
            <img src={fallback.src} alt={fallback.alt} />
            <p>{WEBGL_NEEDED}</p>
          </div>
        ) : null}
        <Crosshair />
        {outage ? (
          <div className="outage-panel" data-ui="outage-panel">
            <p>Replay is paused: part storage is unreachable.</p>
            <p>{outage.lastGood ? `Last good solid: ${outage.lastGood}` : "Last good solid: none yet"}</p>
          </div>
        ) : null}
        {pins.map((pin) => (
          <span
            key={pin.id}
            ref={(node) => {
              if (node) pinNodes.current.set(pin.id, node);
              else pinNodes.current.delete(pin.id);
            }}
            className={`pin pin-${pin.kind}`}
            data-ui={pin.kind === "finding" ? "finding-pin" : pin.kind === "comment" ? "comment-pin" : "finding-leader"}
            aria-hidden="true"
          />
        ))}
        {toolbar ? (
          <div className="view-toolbar" role="toolbar" aria-label="View" data-ui-control onKeyDown={onToolbarKey}>
            <button
              type="button"
              ref={(node) => {
                toolbarRefs.current[0] = node;
              }}
              tabIndex={active === 0 ? 0 : -1}
              onFocus={() => setActive(0)}
              onClick={() => engine.current && defaultRef.current && engine.current.glideTo(defaultRef.current)}
            >
              Reset view
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={ortho}
              ref={(node) => {
                toolbarRefs.current[1] = node;
              }}
              tabIndex={active === 1 ? 0 : -1}
              onFocus={() => setActive(1)}
              onClick={() => {
                engine.current?.setOrthographic(!ortho);
                setOrtho(!ortho);
              }}
            >
              Orthographic
            </button>
          </div>
        ) : null}
        {children}
      </div>
      <Frame dot={dot} running={attrs["data-evaluating"] === "true"} />
    </div>
  );
});

const sceneDrawn = new WeakSet<Engine>();
