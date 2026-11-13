import { useEffect, useRef, type CSSProperties, type ReactElement, type Ref } from "react";
import { drawScene, sceneFor, type SceneName } from "../plates/scenes";

interface Props {
  seed: string;
  caption: string;
  /** width ÷ height */
  ratio: number;
  scene?: SceneName;
  className?: string;
  style?: CSSProperties;
  figureRef?: Ref<HTMLElement>;
  canvasRef?: Ref<HTMLCanvasElement>;
  motion?: { name: string; ms: number; state: string };
  hideDrawing?: boolean;
  noCaption?: boolean;
  decorative?: boolean;
}

export function Plate({ seed, caption, ratio, scene, className, style, figureRef, canvasRef, motion, hideDrawing, noCaption, decorative }: Props): ReactElement {
  const local = useRef<HTMLCanvasElement | null>(null);
  const chosen = scene ?? sceneFor(seed);

  useEffect(() => {
    const canvas = local.current;
    if (!canvas) return;
    let last = 0;
    const paint = (): void => {
      const cssWidth = canvas.clientWidth || 320;
      if (last && Math.abs(cssWidth - last) / last < 0.3) return;
      last = cssWidth;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.min(cssWidth * dpr, 880);
      drawScene(canvas, chosen, seed, width, width / ratio);
    };
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [chosen, seed, ratio]);

  const setCanvas = (node: HTMLCanvasElement | null): void => {
    local.current = node;
    if (typeof canvasRef === "function") canvasRef(node);
    else if (canvasRef) (canvasRef as { current: HTMLCanvasElement | null }).current = node;
  };

  const attrs = motion
    ? { "data-motion": motion.name, "data-motion-ms": String(motion.ms), "data-state": motion.state }
    : {};

  return (
    <figure className={`plate ${className ?? ""}`} style={style} ref={figureRef} aria-hidden={decorative || undefined} {...attrs}>
      <div className="plate-frame" style={{ aspectRatio: String(ratio) }}>
        <canvas ref={setCanvas} aria-hidden="true" className={hideDrawing ? "plate-hidden" : undefined} />
      </div>
      {noCaption ? null : <figcaption>{caption}</figcaption>}
    </figure>
  );
}
