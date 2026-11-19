import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent, type Ref, type RefObject } from "react";
import type { Category } from "../../shared/api";
import { flatRenderer, webglRenderer, type SkyRenderer } from "./renderers";
import { anchorPoint, busy, placeStars, type SceneContent, type SkyScene } from "./scene";

const KEY_PAN_PX = 40;
const MAX_RATIO = 2;
const FOG_FRAME_MS = 33;

export interface SkyPoints {
  /** Viewport coordinates of a constellation anchor, or of one star when its id is given. */
  pointFor(category: Category, starId?: string): { x: number; y: number } | null;
}

interface SkyProps {
  scene: SceneContent;
  reduced: boolean;
  /** The accessible description naming each constellation's drawn star count. */
  description: string;
  points?: Ref<SkyPoints>;
}

/** Sizes a canvas to its box (device pixels capped at 2) and redraws on every resize. */
function useCanvasSize(canvas: RefObject<HTMLCanvasElement | null>, redraw: () => void) {
  const size = useRef({ width: 0, height: 0, ratio: 1, clearRight: 0 });
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      const ratio = Math.min(MAX_RATIO, window.devicePixelRatio || 1);
      // The layout names how much of the sky's right edge the legend chip covers.
      const clearRight = parseFloat(getComputedStyle(element).getPropertyValue("--sky-clear-right")) || 0;
      size.current = { width: Math.max(1, box.width), height: Math.max(1, box.height), ratio, clearRight };
      element.width = Math.round(size.current.width * ratio);
      element.height = Math.round(size.current.height * ratio);
      redraw();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [canvas, redraw]);
  return size;
}

/** The night sky: WebGL with drifting fog, or a still picture without WebGL; pans by drag, touch and arrow keys. */
export function Sky({ scene, reduced, description, points }: SkyProps) {
  const descriptionId = useId();
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<SkyRenderer | null>(null);
  const sceneRef = useRef<SkyScene>({ ...scene, pan: { x: 0, y: 0 }, clearRight: 0 });
  const fog = useRef({ seconds: 0, last: performance.now() });
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const loop = useRef(0);
  const lastDraw = useRef(-Infinity);

  const draw = useRef(() => {
    const element = renderer.current;
    if (!element) return;
    const now = performance.now();
    lastDraw.current = now;
    element.draw({ ...sceneRef.current, clearRight: size.current.clearRight }, size.current.width, size.current.height, size.current.ratio, now, fog.current.seconds);
  }).current;
  const size = useCanvasSize(canvas, draw);

  const animate = useRef(() => {
    if (loop.current) return;
    const tick = () => {
      loop.current = 0;
      const now = performance.now();
      const drifting = renderer.current?.animated === true && !reducedRef.current && document.visibilityState === "visible";
      if (drifting) fog.current.seconds += Math.min(100, now - fog.current.last) / 1000;
      fog.current.last = now;
      const settling = busy(sceneRef.current, now);
      if (settling || (drifting && now - lastDraw.current >= FOG_FRAME_MS)) draw();
      if (drifting || settling) loop.current = requestAnimationFrame(tick);
    };
    fog.current.last = performance.now();
    loop.current = requestAnimationFrame(tick);
  }).current;
  const reducedRef = useRef(reduced);

  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    renderer.current = webglRenderer(element) ?? flatRenderer(element);
    draw();
    return () => {
      cancelAnimationFrame(loop.current);
      loop.current = 0;
      renderer.current?.dispose();
      renderer.current = null;
    };
  }, [draw]);

  useLayoutEffect(() => {
    reducedRef.current = reduced;
    sceneRef.current = { ...scene, pan: sceneRef.current.pan, clearRight: 0 };
    draw();
    animate();
  }, [scene, reduced, draw, animate]);

  useEffect(() => {
    // The fog stops while the page is hidden and resumes where it left off.
    const resume = () => {
      if (document.visibilityState === "visible") animate();
    };
    document.addEventListener("visibilitychange", resume);
    return () => document.removeEventListener("visibilitychange", resume);
  }, [animate]);

  useImperativeHandle(points, () => ({
    pointFor(category, starId) {
      const box = frame.current?.getBoundingClientRect();
      if (!box || box.width === 0) return null;
      const { width, height, clearRight } = size.current;
      const { pan } = sceneRef.current;
      const star = starId ? placeStars({ ...sceneRef.current, clearRight }, width, height, Infinity).find((s) => s.id === starId) : undefined;
      const spot = star ?? anchorPoint(category, width, height, clearRight);
      return { x: box.left + spot.x + pan.x, y: box.top + spot.y + pan.y };
    },
  }));

  const panTo = (x: number, y: number) => {
    const { width, height } = size.current;
    const pan = { x: Math.max(-width / 2, Math.min(width / 2, x)), y: Math.max(-height / 2, Math.min(height / 2, y)) };
    sceneRef.current = { ...sceneRef.current, pan };
    draw();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const { x, y } = sceneRef.current.pan;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [x + KEY_PAN_PX, y],
      ArrowRight: [x - KEY_PAN_PX, y],
      ArrowUp: [x, y + KEY_PAN_PX],
      ArrowDown: [x, y - KEY_PAN_PX],
      Home: [0, 0],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    panTo(move[0], move[1]);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const from = drag.current;
    if (!from || from.id !== event.pointerId) return;
    drag.current = { id: from.id, x: event.clientX, y: event.clientY };
    const { x, y } = sceneRef.current.pan;
    panTo(x + event.clientX - from.x, y + event.clientY - from.y);
  };
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === event.pointerId) drag.current = null;
  };

  return (
    <>
    <p id={descriptionId} hidden>
      {description}
    </p>
    <div
      ref={frame}
      className="sky"
      role="img"
      aria-label="Dream-sign sky"
      aria-describedby={descriptionId}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      <canvas ref={canvas} aria-hidden="true" />
    </div>
    </>
  );
}

/** The phone's horizon strip: a still miniature of the same sky. */
export function SkyMiniature({ scene, points }: { scene: SceneContent; points?: Ref<SkyPoints> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<SkyScene>({ ...scene, pan: { x: 0, y: 0 }, clearRight: 0 });
  const painter = useRef<SkyRenderer | null>(null);
  const draw = useRef(() => {
    const element = canvas.current;
    if (!element) return;
    painter.current ??= flatRenderer(element);
    painter.current.draw(sceneRef.current, size.current.width, size.current.height, size.current.ratio, Infinity, 0);
  }).current;
  const size = useCanvasSize(canvas, draw);
  useLayoutEffect(() => {
    sceneRef.current = { ...scene, pan: { x: 0, y: 0 }, clearRight: 0 };
    draw();
  }, [scene, draw]);
  useImperativeHandle(points, () => ({
    pointFor(category) {
      const box = canvas.current?.getBoundingClientRect();
      if (!box) return null;
      const spot = anchorPoint(category, box.width, box.height);
      return { x: box.left + spot.x, y: box.top + spot.y };
    },
  }));
  return <canvas ref={canvas} aria-hidden="true" />;
}
