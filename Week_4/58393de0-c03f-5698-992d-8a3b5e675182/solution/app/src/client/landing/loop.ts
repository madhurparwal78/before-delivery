import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { prefersReducedMotion } from "../lib/motion";

interface Playback {
  playing: boolean;
  toggle: () => void;
}

/**
 * Whether a looping preview is playing. It starts playing unless the device asks for reduced motion or the preview
 * cannot loop here (`available` false); the toggle flips it at once, from the click itself.
 */
export function usePlayback(available = true): Playback {
  const [playing, setPlaying] = useState(() => available && !prefersReducedMotion());
  const toggle = useCallback(() => setPlaying((current) => !current), []);
  return { playing, toggle };
}

interface LoopOptions<T extends Element> {
  playing: boolean;
  /** Length of one loop, and the phase shown while the loop is not running (the finished frame). */
  periodMs: number;
  restMs: number;
  /** Phase the very first frame shows when the loop starts playing. */
  startMs?: number;
  /** Minimum time between two painted frames. */
  frameGapMs: number;
  /** Paints the element for a phase inside the loop. Called once on mount, on every resize, and every frame while playing. */
  paint: (phaseMs: number, element: T) => void;
}

/**
 * A preview loop driven by requestAnimationFrame and performance.now(), so a stepped page clock moves it. It paints once
 * synchronously on mount (the paused clock never fires a first frame), repaints when the element resizes, runs only while
 * the element is on screen and playing, and holds its phase across pauses.
 */
export function useLoop<T extends HTMLElement | SVGElement>(options: LoopOptions<T>): { ref: RefObject<T | null>; repaint: () => void } {
  const ref = useRef<T | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const phase = useRef(options.playing ? (options.startMs ?? 0) : options.restMs);
  const paintNow = useRef<() => void>(() => undefined);
  const { playing, periodMs } = options;

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    let frame = 0;
    let last = 0;
    let lastPaint = Number.NEGATIVE_INFINITY;
    let visible = true;

    const paint = () => latest.current.paint(phase.current, element);
    const tick = () => {
      const now = performance.now();
      phase.current = (phase.current + (now - last)) % periodMs;
      last = now;
      if (now - lastPaint >= latest.current.frameGapMs) {
        lastPaint = now;
        paint();
      }
      frame = requestAnimationFrame(tick);
    };
    const start = () => {
      if (frame || !playing || !visible) return;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };

    paintNow.current = paint;
    paint();
    start();
    const watcher = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (visible) {
        paint();
        start();
      } else stop();
    });
    watcher.observe(element);
    const sizer = new ResizeObserver(paint);
    sizer.observe(element);
    return () => {
      watcher.disconnect();
      sizer.disconnect();
      stop();
    };
  }, [playing, periodMs]);

  const repaint = useCallback(() => paintNow.current(), []);
  return { ref, repaint };
}
