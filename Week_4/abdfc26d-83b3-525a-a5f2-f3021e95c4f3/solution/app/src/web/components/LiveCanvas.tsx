import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { copy } from "../copy";
import { draw, drawStill, webglAvailable, type ProgramSpec } from "../gl/renderer";

// One live piece canvas. It draws every animation frame while on screen and stops the moment it is
// fully off screen. `still` draws a single frame (reduced motion) and redraws only on demand.
// Without WebGL it shows the still Canvas 2D colour field and says so.

interface Scene {
  seed: number;
  uniforms: Record<string, number>;
  /** Seconds for this frame; `elapsed` is the canvas's own running clock. */
  time: (elapsed: number) => number;
}

export interface LiveCanvasHandle {
  redraw: () => void;
  canvas: () => HTMLCanvasElement | null;
}

interface Props {
  program: ProgramSpec;
  slug: string;
  scene: () => Scene;
  still: boolean;
  /** Fraction of device pixels to shade (large stages render softer for speed). */
  scale?: number;
  className?: string;
  /** Shows the WebGL fallback sentence on this canvas. */
  noteFallback?: boolean;
}

export const LiveCanvas = forwardRef<LiveCanvasHandle, Props>(function LiveCanvas(
  { program, slug, scene, still, scale = 1, className, noteFallback = false },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const programRef = useRef(program);
  programRef.current = program;
  const [fallback, setFallback] = useState(false);
  const paint = useRef<() => void>(() => undefined);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const started = performance.now();
    let visible = true;
    let frame = 0;

    const size = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2) * scale;
      const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };

    paint.current = () => {
      size();
      const current = sceneRef.current();
      const elapsed = still ? 0 : (performance.now() - started) / 1000;
      const drawn = draw(context, {
        program: programRef.current,
        width: canvas.width,
        height: canvas.height,
        time: current.time(elapsed),
        seed: current.seed,
        uniforms: current.uniforms,
      });
      if (drawn) return;
      if (webglAvailable()) {
        context.fillStyle = "#0a0a0a";
        context.fillRect(0, 0, canvas.width, canvas.height);
      } else {
        drawStill(context, slug, canvas.width, canvas.height);
        setFallback(true);
      }
    };

    const loop = () => {
      frame = 0;
      if (!visible) return;
      paint.current();
      if (!still) frame = requestAnimationFrame(loop);
    };
    const start = () => {
      if (!frame) frame = requestAnimationFrame(loop);
    };

    paint.current();
    if (!still) start();
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible && !still) start();
      if (!visible && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    });
    observer.observe(canvas);
    const resize = new ResizeObserver(() => {
      if (still) paint.current();
    });
    resize.observe(canvas);
    return () => {
      observer.disconnect();
      resize.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [still, scale, slug]);

  useImperativeHandle(ref, () => ({ redraw: () => paint.current(), canvas: () => canvasRef.current }), []);

  return (
    <>
      <canvas ref={canvasRef} className={className} aria-hidden="true" />
      {fallback && noteFallback ? <p className="still-note">{copy.stillFrame}</p> : null}
    </>
  );
});
