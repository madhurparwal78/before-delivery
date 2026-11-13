import { useEffect, useRef, type ReactNode } from "react";
import { useReducedMotion } from "../lib/hooks";

const CELL = 18;
/** The field drifts slowly, so a few repaints a second are enough; a per-frame loop would keep a timer due on every frame of the sign-in and checkout pages. */
const REPAINT_MS = 120;

/** A slow-drifting wave field in ultramarine tones, seeded fresh on each page load; a still frame under reduced motion. */
export function Backdrop(): ReactNode {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const element = canvas.current as HTMLCanvasElement;
    const context = element.getContext("2d");
    if (!context) return undefined;
    const seed = [Math.random() * 100, Math.random() * 100, Math.random() * 100];
    let frame = 0;
    const draw = (time: number): void => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (element.width !== Math.ceil(width / CELL) || element.height !== Math.ceil(height / CELL)) {
        element.width = Math.ceil(width / CELL);
        element.height = Math.ceil(height / CELL);
      }
      const image = context.createImageData(element.width, element.height);
      for (let y = 0; y < element.height; y += 1) {
        for (let x = 0; x < element.width; x += 1) {
          const wave =
            Math.sin(x * 0.21 + seed[0]! + time * 0.00042) + Math.sin(y * 0.27 + seed[1]! - time * 0.0003) + Math.sin((x + y) * 0.14 + seed[2]! + time * 0.00035);
          const t = (wave + 3) / 6;
          const at = (y * element.width + x) * 4;
          image.data[at] = 23 + t * 40;
          image.data[at + 1] = 34 + t * 45;
          image.data[at + 2] = 201 + t * 54;
          image.data[at + 3] = 255;
        }
      }
      context.putImageData(image, 0, 0);
      if (!reduced) frame = window.setTimeout(() => draw(performance.now()), REPAINT_MS);
    };
    draw(performance.now());
    return () => window.clearTimeout(frame);
  }, [reduced]);

  return <canvas ref={canvas} className="backdrop" aria-hidden="true" style={{ imageRendering: "auto" }} />;
}
