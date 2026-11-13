import type { Ref } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { PackFacts } from "../../shared/types";
import type { Still } from "../stage/controller";

const wordsFor = (p: number): string => (p < 0.275 ? "Front of the pack" : p < 0.55 ? "Turning to the panel" : p < 0.75 ? "Declaration panel" : "Close on the panel");

/** The pinned stage element. The canvas lives inside it; the controller adds the SVG panel when WebGL is not drawing. */
export function Stage({ stageRef, canvasRef, facts }: { stageRef: Ref<HTMLDivElement>; canvasRef: Ref<HTMLCanvasElement>; facts: PackFacts | null }) {
  return (
    <div class="stage" ref={stageRef}>
      <canvas class="pack-canvas" ref={canvasRef} role="img" aria-label="Pack stage" aria-describedby="stage-sku" />
      <span id="stage-sku" class="sr-only">
        {facts?.skuName ?? ""}
      </span>
    </div>
  );
}

export function TurnSlider({ read, onMove }: { read: () => number; onMove: (value: number) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    let raf = 0;
    let last = -1;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const p = read();
      const node = el.current;
      if (!node || p === last) return;
      last = p;
      const now = Math.round(p * 100);
      node.setAttribute("aria-valuenow", String(now));
      node.setAttribute("aria-valuetext", wordsFor(p));
      node.style.setProperty("--p", String(p));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [read]);

  const fromPointer = (e: PointerEvent) => {
    const box = el.current!.getBoundingClientRect();
    onMove(Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)));
  };
  const now = () => Math.round(read() * 100);
  const keys: Record<string, () => number> = {
    ArrowRight: () => now() + 5,
    ArrowUp: () => now() + 5,
    ArrowLeft: () => now() - 5,
    ArrowDown: () => now() - 5,
    PageUp: () => now() + 25,
    PageDown: () => now() - 25,
    Home: () => 0,
    End: () => 100,
  };
  return (
    <div
      ref={el}
      class="turn"
      role="slider"
      tabIndex={0}
      aria-label="Turn the pack"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={0}
      aria-valuetext="Front of the pack"
      onKeyDown={(e) => {
        const next = keys[e.key];
        if (!next) return;
        e.preventDefault();
        onMove(Math.min(100, Math.max(0, next())) / 100);
      }}
      onPointerDown={(e) => {
        dragging.current = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        fromPointer(e);
      }}
      onPointerMove={(e) => dragging.current && fromPointer(e)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    >
      <div class="turn-track" />
      <div class="turn-thumb" />
    </div>
  );
}

export function Stills({ still, onStill }: { still: Still; onStill: (s: Still) => void }) {
  const names: Array<[Still, string]> = [["front", "Front"], ["back", "Back"], ["sticker", "Sticker"]];
  return (
    <div class="stills">
      {names.map(([id, label]) => (
        <button key={id} type="button" class="rect-button" aria-pressed={still === id ? "true" : "false"} onClick={() => onStill(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}
