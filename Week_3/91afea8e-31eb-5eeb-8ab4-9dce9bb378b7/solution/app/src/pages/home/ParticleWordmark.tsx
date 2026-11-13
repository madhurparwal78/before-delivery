import { useEffect, useRef, useState, type ReactNode } from "react";
import { startWordmark } from "../../effects/wordmark";
import { useReducedMotion } from "../../lib/hooks";

const WORD = "chauraha";
const PARTICLE_COLOUR = "#ffd60a";

/** The wordmark as WebGL particles; the solid wordmark when WebGL is missing or motion is reduced. */
export function ParticleWordmark(): ReactNode {
  const reduced = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState("");
  const [missing, setMissing] = useState(false);
  const solid = reduced || missing;

  useEffect(() => {
    const element = box.current;
    if (!element || solid) return undefined;
    const measure = (): void => setSize(`${Math.round(element.clientWidth)}x${Math.round(element.clientHeight)}`);
    measure();
    const watcher = new ResizeObserver(measure);
    watcher.observe(element);
    return () => watcher.disconnect();
  }, [solid]);

  useEffect(() => {
    const element = canvas.current;
    if (!element || solid || size === "") return undefined;
    let cancelled = false;
    let running: { destroy: () => void } | null = null;
    void startWordmark(element, WORD, PARTICLE_COLOUR).then((started) => {
      if (cancelled) started?.destroy();
      else if (started) running = started;
      else setMissing(true);
    });
    return () => {
      cancelled = true;
      running?.destroy();
    };
  }, [solid, size]);

  return (
    <div className="wordmark" ref={box} aria-hidden="true">
      {solid ? <span className="wordmark__solid">{WORD}</span> : <canvas key={size} ref={canvas} className="wordmark__canvas" />}
    </div>
  );
}
