// The hero's lattice figure: the WebGL scene when it can run, otherwise (or with reduced motion) the static SVG.
// The figure's data attributes always report what is being drawn.
import { useEffect, useMemo, useRef, useState } from "react";
import { raisedList, type Filters } from "../state/filters.ts";
import { usePrefersReducedMotion } from "../motion/useReducedMotion.ts";
import type { Programme } from "../types.ts";
import { buildModel } from "./model.ts";
import { LatticeScene } from "./scene.ts";
import { StaticLattice } from "./StaticLattice.tsx";

type Props = { programme: Programme | null; filters: Filters; lit: string[]; seams: [string, string][]; onPick: (key: string) => void };

function webglContext(canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
  try {
    return canvas.getContext("webgl2", { antialias: true, alpha: false });
  } catch {
    return null;
  }
}

export function LatticeFigure({ programme, filters, lit, seams, onPick }: Props) {
  const reduced = usePrefersReducedMotion();
  const figure = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<LatticeScene | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const model = useMemo(() => (programme ? buildModel(programme) : null), [programme]);
  const modelKey = useMemo(() => JSON.stringify(model), [model]);
  const litSet = useMemo(() => new Set(lit), [lit]);
  const raised = raisedList(filters);
  const litList = lit.join(",");
  const seamList = seams.map(([a, b]) => `${a}+${b}`).join(",");

  useEffect(() => {
    if (reduced || !canvas.current || !figure.current) return;
    const context = webglContext(canvas.current);
    if (!context) {
      setWebgl(false);
      return;
    }
    const instance = new LatticeScene(canvas.current, context, figure.current, (key) => pick.current(key));
    scene.current = instance;
    setWebgl(true);
    const box = figure.current;
    const resize = () => instance.setSize(box.clientWidth, box.clientHeight);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(box);
    const hero = box.closest("section") ?? box;
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const r = box.getBoundingClientRect();
      instance.pointer(Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1), Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1));
    };
    const leave = () => instance.pointerLeave();
    const scroll = () => instance.setScroll(window.scrollY);
    hero.addEventListener("pointermove", move);
    hero.addEventListener("pointerleave", leave);
    window.addEventListener("scroll", scroll, { passive: true });
    scroll();
    return () => {
      observer.disconnect();
      hero.removeEventListener("pointermove", move);
      hero.removeEventListener("pointerleave", leave);
      window.removeEventListener("scroll", scroll);
      instance.dispose();
      scene.current = null;
    };
  }, [reduced]);

  useEffect(() => {
    // The scene is rebuilt only when the drawn data changes (modelKey), not on every refresh.
    if (model && scene.current) scene.current.setModel(model);
  }, [modelKey, webgl]);

  useEffect(() => {
    scene.current?.setState({ day: filters.day, venue: filters.venue, discipline: filters.discipline, lit: litSet, seams });
  }, [filters.day, filters.venue, filters.discipline, litSet, seams, webgl, modelKey]);

  const drawStatic = reduced || webgl === false;
  return (
    <figure ref={figure} className="lattice" aria-label="Programme lattice" data-intro={drawStatic ? "done" : undefined}
      data-camera-progress={drawStatic ? "0.00" : undefined} data-camera-day={drawStatic ? "1" : undefined}
      data-yaw={drawStatic ? "0.0" : undefined} data-pitch={drawStatic ? "0.0" : undefined}
      data-raised={raised} data-lit={litList} data-seams={seamList}>
      {drawStatic
        ? <StaticLattice model={model} day={filters.day} venue={filters.venue} discipline={filters.discipline} lit={litSet} seams={seams}
            raised={raised} litList={litList} seamList={seamList} />
        : <canvas ref={canvas} className="lattice__canvas" tabIndex={-1} aria-hidden="true" />}
    </figure>
  );
}
