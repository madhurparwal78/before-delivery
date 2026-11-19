import { useEffect, useRef, type ReactNode } from "react";
import { EmptyDrawing } from "./Icons.tsx";
import { drawStrands, type StrandVariant } from "../lib/strands.ts";

/** Strand art drawn once into its box, and again when the box is resized. */
export function StrandCanvas({ seed, variant, className = "" }: { seed: number; variant: StrandVariant; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current as HTMLCanvasElement;
    drawStrands(canvas, seed, variant);
    const observer = new ResizeObserver(() => drawStrands(canvas, seed, variant));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [seed, variant]);
  return <canvas ref={ref} className={`strands ${className}`.trim()} aria-hidden="true" />;
}

/** The faint strand canvas that stands in for a loading data panel. */
export function Loading({ label, page = false }: { label: string; page?: boolean }) {
  return (
    <div className={page ? "panel loading loading--page" : "panel loading"} aria-busy="true" aria-label={label} role="group">
      <StrandCanvas seed={7} variant="faint" />
    </div>
  );
}

/** The whole-page stand-in while the session or workspace loads. */
export function Boot() {
  return (
    <div className="boot" aria-busy="true">
      <StrandCanvas seed={7} variant="faint" />
    </div>
  );
}

export function Empty({ sentence, children }: { sentence: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <EmptyDrawing />
      <p className="empty__sentence">{sentence}</p>
      {children}
    </div>
  );
}
