// The pen stage: the 3D twin, its pin buttons, the Unwrap/Wrap control and the Scene status. Shared by the
// console workspace and the farm manager's report link page.
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { Defect } from "./api";
import { Twin, type Geo, type Snapshot, type ViewState, type WallPoint } from "./engine/twin";
import { isTyping } from "./shell";
import { dialogsOpen, useReducedMotion } from "./ui";

export interface StageHandle {
  unwrap(): void;
  wrap(): void;
  orbit(deg: number): void;
  tilt(deg: number): void;
  zoomStep(step: number): void;
  flyTo(id: string): void;
  panPanels(columns: number, rows: number): void;
  readonly flat: boolean;
}

interface StageProps {
  penName: string;
  geo: Geo | null;
  defects: Defect[];
  selectedId: string | null;
  focusIds: string[];
  diveClock: string | null;
  marking: boolean;
  readOnly: boolean;
  loading: boolean;
  initialView: "cylinder" | "flat";
  onSelect: (id: string) => void;
  onEnter?: (id: string, el: HTMLElement) => void;
  onWall?: (point: WallPoint) => void;
  onMark?: () => void;
  onSettled: (view: "cylinder" | "flat") => void;
}

const FALLBACK: Snapshot = { view: "cylinder", camera: "Camera: 0°", zoom: "Zoom: 1.00×", hasWebGL: true };
const VIEW_LINE: Record<ViewState, string> = { cylinder: "View: Cylinder", unwrapping: "View: Unwrapping", flat: "View: Flat chart", wrapping: "View: Wrapping" };

export const Stage = forwardRef<StageHandle, StageProps>(function Stage(props, ref) {
  const { penName, geo, defects, selectedId, focusIds, diveClock, marking, readOnly, loading, initialView, onSelect, onEnter, onWall, onMark, onSettled } = props;
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const [twin, setTwin] = useState<Twin | null>(null);
  const [snap, setSnap] = useState<Snapshot>(FALLBACK);
  const reduced = useReducedMotion();
  const applied = useRef(false);
  const latest = useRef(props);
  latest.current = props;

  useLayoutEffect(() => {
    if (!host.current || !canvas.current || !overlay.current) return;
    const created = new Twin(host.current, canvas.current, overlay.current, window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    created.applyAddress(latest.current.initialView, null);
    setSnap(created.getSnapshot());
    const off = created.subscribe(() => setSnap(created.getSnapshot()));
    const observer = new ResizeObserver(() => {
      const box = host.current?.getBoundingClientRect();
      if (box) created.resize(box.width, box.height);
    });
    observer.observe(host.current);
    setTwin(created);
    return () => {
      off();
      observer.disconnect();
      created.dispose();
    };
  }, []);

  useEffect(() => { twin?.setReduced(reduced); }, [twin, reduced]);

  useLayoutEffect(() => {
    if (!twin || !geo) return;
    twin.setGeometry(geo);
    twin.setPins(defects.map((d) => ({ id: d.id, chart_x_m: d.chart_x_m, depth_m: d.depth_m })));
    if (!applied.current) {
      applied.current = true;
      twin.applyAddress(latest.current.initialView, selectedId);
    } else {
      twin.setSelected(selectedId, false);
    }
  }, [twin, geo, defects, selectedId]);

  useEffect(() => {
    if (snap.view === "cylinder" || snap.view === "flat") onSettled(snap.view);
  }, [snap.view, onSettled]);

  useImperativeHandle(ref, () => ({
    unwrap: () => twin?.unwrap(),
    wrap: () => twin?.wrapUp(),
    orbit: (deg) => (twin?.settledView === "flat" ? twin.panPanels(deg > 0 ? 1 : -1, 0) : twin?.orbit(deg)),
    tilt: (deg) => (twin?.settledView === "flat" ? twin.panPanels(0, deg > 0 ? -1 : 1) : twin?.tilt(deg)),
    zoomStep: (step) => twin?.zoomStep(step),
    flyTo: (id) => twin?.focusDefect(id, false),
    panPanels: (c, r) => twin?.panPanels(c, r),
    get flat() { return twin?.settledView === "flat"; },
  }), [twin]);

  // pointer input: one finger or the mouse orbits (or pans the chart), two fingers pinch, a still tap marks
  useEffect(() => {
    const el = host.current;
    if (!el || !twin) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let travel = 0;
    let multi = false;
    let pinch = 0;
    let moved: { x: number; t: number } | null = null;
    let velocity = 0;
    const onDown = (event: PointerEvent) => {
      if ((event.target as HTMLElement).closest(".pin")) return;
      el.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) { travel = 0; multi = false; velocity = 0; moved = { x: event.clientX, t: performance.now() }; }
      if (pointers.size === 2) {
        multi = true;
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const onMove = (event: PointerEvent) => {
      const last = pointers.get(event.pointerId);
      if (!last) return;
      const dx = event.clientX - last.x;
      const dy = event.clientY - last.y;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0) twin.zoomBy(distance / pinch);
        pinch = distance;
        return;
      }
      travel += Math.abs(dx) + Math.abs(dy);
      const now = performance.now();
      if (moved && now > moved.t) velocity = (event.clientX - moved.x) / (now - moved.t);
      moved = { x: event.clientX, t: now };
      if (dx || dy) twin.dragBy(dx, dy);
    };
    const onUp = (event: PointerEvent) => {
      if (!pointers.delete(event.pointerId)) return;
      if (pointers.size === 0 && !multi) {
        if (travel < 6) {
          if (latest.current.marking && onWall) {
            const point = twin.pickWall(event.clientX, event.clientY);
            if (point) onWall(point);
          }
        } else {
          twin.glide(velocity);
        }
      }
      if (pointers.size < 2) pinch = 0;
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      twin.zoomBy(Math.exp(-event.deltaY * 0.0015));
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    // a dragged touch is the stage's own gesture: claim it so the browser starts no scroll or fling that would swallow the next tap
    const claim = (event: TouchEvent) => { if (event.cancelable) event.preventDefault(); };
    el.addEventListener("touchmove", claim, { passive: false });
    return () => {
      el.removeEventListener("touchmove", claim);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
    };
  }, [twin, onWall]);

  const label = snap.view === "cylinder" || snap.view === "wrapping" ? "Unwrap" : "Wrap";
  const lines = [
    VIEW_LINE[snap.view], snap.camera, snap.zoom, `Selected: ${selectedId ?? "none"}`,
    `Focus: ${focusIds.length ? focusIds.join(", ") : "none"}`, `Dive clock: ${diveClock ?? "no dive running"}`,
    ...(marking ? ["Marking: tap the net wall"] : []), ...(loading ? ["Loading pen"] : []),
    ...(twin && !snap.hasWebGL ? ["3D view unavailable — showing the flat chart"] : []),
  ];

  return (
    <section className="stage" aria-label="Pen stage">
      <div className="stage-top">
        {twin?.hasWebGL && (
          <button type="button" className="btn stage-button" onClick={() => (label === "Unwrap" ? twin.unwrap() : twin.wrapUp())}>{label}</button>
        )}
        {!readOnly && <button type="button" className="btn stage-button" aria-pressed={marking} onClick={onMark}>Mark defect</button>}
      </div>
      <div ref={host} className={marking ? "stage-viewport marking" : "stage-viewport"}>
        <canvas ref={canvas} role="img" aria-label={`3D twin of ${penName}`} className="stage-canvas" />
        <canvas ref={overlay} aria-hidden="true" className="stage-overlay" />
        <div className="pins">
          {defects.map((d) => (
            <button
              key={d.id}
              type="button"
              ref={(el) => twin?.registerPin(d.id, el)}
              className={selectedId === d.id ? "pin selected" : "pin"}
              aria-label={`Pin ${d.id}`}
              data-defect={d.id}
              aria-pressed={selectedId === d.id}
              onClick={() => onSelect(d.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && onEnter && selectedId === d.id) {
                  event.preventDefault();
                  onEnter(d.id, event.currentTarget);
                }
              }}
            >
              <span className="pin-dot" />
              {selectedId === d.id && <span className="pin-id">{d.id}</span>}
            </button>
          ))}
        </div>
      </div>
      <h2 className="stage-name">{penName}</h2>
      <div role="status" aria-label="Scene status" aria-live="off" className="scene-status">
        {lines.map((line) => <div key={line}>{line}</div>)}
      </div>
    </section>
  );
});

interface KeyActions {
  stage: RefObject<StageHandle | null>;
  step: (direction: 1 | -1) => void;
  edit?: () => void;
  mark?: () => void;
}

/** The workspace shortcuts: ignored while typing, while a dialog is open and, for arrows, Home and End, on a tab. */
export function useStageKeys({ stage, step, edit, mark }: KeyActions): void {
  const latest = useRef({ step, edit, mark });
  latest.current = { step, edit, mark };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || dialogsOpen() || isTyping(document.activeElement)) return;
      const onTab = document.activeElement?.getAttribute("role") === "tab";
      const handle = stage.current;
      const key = event.key;
      const move = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(key);
      if (move && onTab) return;
      let handled = true;
      if (key === "ArrowLeft") handle?.orbit(-15);
      else if (key === "ArrowRight") handle?.orbit(15);
      else if (key === "ArrowUp") handle?.tilt(10);
      else if (key === "ArrowDown") handle?.tilt(-10);
      else if (key === "+" || key === "=") handle?.zoomStep(0.25);
      else if (key === "-") handle?.zoomStep(-0.25);
      else if (key === "u" || key === "U") handle?.unwrap();
      else if (key === "w" || key === "W") handle?.wrap();
      else if (key === "n" || key === "N") latest.current.step(1);
      else if (key === "p" || key === "P") latest.current.step(-1);
      else if ((key === "e" || key === "E") && latest.current.edit) latest.current.edit();
      else if ((key === "m" || key === "M") && latest.current.mark) latest.current.mark();
      else handled = false;
      if (handled) event.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [stage]);
}
