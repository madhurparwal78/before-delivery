import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useReducedMotion } from "../lib/motion.ts";

const PLOT = 320;
const DEFAULT: Point[] = [
  { x: 30, y: 0 },
  { x: 20, y: 100 },
];

/** A handle in hundredths, so steps never drift: x in 0..100, y in -50..150. */
interface Point {
  x: number;
  y: number;
}

const clampX = (v: number): number => Math.min(100, Math.max(0, v));
const clampY = (v: number): number => Math.min(150, Math.max(-50, v));
const hundredths = (v: number): string => (v / 100).toFixed(2);
const px = (p: Point): { x: number; y: number } => ({ x: (p.x / 100) * PLOT, y: ((1.5 - p.y / 100) / 2) * PLOT });

/** Motion chapter: two draggable handles shape a cubic curve; Replay moves a block along it for one second. */
export function CurveFigure(): ReactNode {
  const reduced = useReducedMotion();
  const [points, setPoints] = useState<Point[]>(DEFAULT);
  const [arrived, setArrived] = useState(false);
  const plot = useRef<HTMLDivElement>(null);
  const block = useRef<HTMLSpanElement>(null);
  const demo = useRef<HTMLDivElement>(null);
  const running = useRef<Animation | null>(null);

  const update = (index: number, next: Point): void => setPoints((current) => current.map((p, i) => (i === index ? next : p)));

  const keys = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const step = event.shiftKey ? 10 : 1;
    const delta: Record<string, Point> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: step }, ArrowDown: { x: 0, y: -step } };
    const move = delta[event.key];
    if (!move) return;
    event.preventDefault();
    const p = points[index];
    update(index, { x: clampX(p.x + move.x), y: clampY(p.y + move.y) });
  };

  const drag = (event: ReactPointerEvent<HTMLButtonElement>, index: number): void => {
    event.preventDefault();
    event.currentTarget.focus();
    const to = (clientX: number, clientY: number): void => {
      const box = plot.current!.getBoundingClientRect();
      update(index, {
        x: clampX(Math.round(((clientX - box.left) / box.width) * 100)),
        y: clampY(Math.round((1.5 - ((clientY - box.top) / box.height) * 2) * 100)),
      });
    };
    const move = (e: PointerEvent): void => to(e.clientX, e.clientY);
    const stop = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  const printed = `cubic-bezier(${hundredths(points[0].x)}, ${hundredths(points[0].y)}, ${hundredths(points[1].x)}, ${hundredths(points[1].y)})`;
  const [a, b] = points.map(px);

  const replay = (): void => {
    running.current?.cancel();
    if (reduced) return setArrived(true);
    setArrived(false);
    const travel = demo.current!.clientWidth - block.current!.offsetWidth;
    const animation = block.current!.animate([{ transform: "translateX(0)" }, { transform: `translateX(${travel}px)` }], { duration: 1000, easing: printed, fill: "forwards" });
    running.current = animation;
    animation.onfinish = () => {
      setArrived(true);
      animation.cancel();
    };
  };

  return (
    <section className="figure-cell cell cell-pad" data-frame aria-labelledby="curve-title">
      <h2 id="curve-title" className="cell-label">
        Easing curve
      </h2>
      <div className="curve-layout">
        <div className="plot" role="group" aria-label="Curve editor" ref={plot}>
          <svg viewBox={`0 0 ${PLOT} ${PLOT}`} width={PLOT} height={PLOT} aria-hidden="true" focusable="false">
            <path d={`M0 ${PLOT * 0.75}H${PLOT}M0 ${PLOT * 0.25}H${PLOT}`} className="plot-guide" />
            <path d={`M0 ${PLOT * 0.75}L${a.x} ${a.y}M${PLOT} ${PLOT * 0.25}L${b.x} ${b.y}`} className="plot-arm" />
            <path d={`M0 ${PLOT * 0.75}C${a.x} ${a.y} ${b.x} ${b.y} ${PLOT} ${PLOT * 0.25}`} className="plot-curve" />
          </svg>
          {points.map((p, i) => {
            const at = px(p);
            return (
              <button
                key={i}
                type="button"
                className="handle"
                style={{ left: at.x, top: at.y }}
                aria-label={`Handle ${i + 1}`}
                aria-describedby={`handle-${i + 1}-value`}
                onKeyDown={(event) => keys(event, i)}
                onPointerDown={(event) => drag(event, i)}
              >
                <span className="handle-dot" />
              </button>
            );
          })}
        </div>
        <div className="curve-side">
          {points.map((p, i) => (
            <p key={i} className="handle-values">
              <span>Handle {i + 1}</span>{" "}
              <span id={`handle-${i + 1}-value`} className="readout">
                x {hundredths(p.x)}, y {hundredths(p.y)}
              </span>
            </p>
          ))}
          <p role="status" aria-label="Printed curve" className="printed">
            {printed}
          </p>
          <div className="row">
            <button type="button" className="btn" onClick={() => (running.current?.cancel(), setArrived(false), setPoints(DEFAULT))}>
              Reset curve
            </button>
            <button type="button" className="btn btn-primary" onClick={replay}>
              Replay
            </button>
          </div>
        </div>
      </div>
      <div className={arrived ? "curve-demo arrived" : "curve-demo"} role="region" aria-label="Curve demo" ref={demo}>
        <span className="demo-block" ref={block} />
      </div>
      <p className="prose muted">
        The standard easing for opening a panel is the curve with control values 0.30, 0.00, 0.20 and 1.00. Each handle moves one hundredth with the arrow keys and one tenth with Shift held, between 0 and 1 across and between minus 0.5 and 1.5 up. Replay slides the block along the printed curve in one second.
      </p>
    </section>
  );
}
