// The light-pool room: a 3D room (or a top-down plan without WebGL) with one button per placed fitting drawn over
// its position, the placement sequence, keyboard and drag placement, and the mirrored light-pools table.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { roomFigures } from "../../../shared/lightpool";
import type { Placement } from "../../../shared/types";
import { RoomPlan } from "../../components/Drawings";
import { useDial } from "../../lib/dial";
import { fittingKind } from "../../lib/format";
import { useCountUp, useReducedMotion } from "../../lib/hooks";
import type { RoomScene } from "../../three/room";
import { phaseAt, progressAt, SEQUENCE_END, type SequenceProgress } from "../../three/sequence";

export interface RoomHandle {
  focusFitting: (id: string) => void;
  focusSlider: () => void;
}

interface RoomProps {
  widthMm: number;
  depthMm: number;
  ceilingMm: number;
  placements: Placement[];
  /** Placement id → `performance.now()` when it was placed, for fittings playing their sequence. */
  sequences: ReadonlyMap<string, number>;
  status: string;
  onCeiling: (ceilingMm: number) => void;
  onMove: (placement: Placement, x: number, y: number, saved: boolean) => void;
  onRemove: (placement: Placement) => void;
}

const STEP_MM = 100;
const SHIFT_STEP_MM = 500;
const snap = (value: number, max: number) => Math.min(max, Math.max(0, Math.round(value / STEP_MM) * STEP_MM));

function Readout({ diameter, lux, fraction }: { diameter: number; lux: number; fraction: number | null }) {
  const countedDiameter = useCountUp(diameter);
  const countedLux = useCountUp(lux);
  const shownDiameter = fraction === null ? countedDiameter : Math.round(diameter * fraction);
  const shownLux = fraction === null ? countedLux : Math.round(lux * fraction);
  return (
    <span className="fitting__readout mono" aria-hidden="true">
      {shownDiameter} mm · {shownLux} lx
    </span>
  );
}

export const Room = forwardRef<RoomHandle, RoomProps>(function Room(
  { widthMm, depthMm, ceilingMm, placements, sequences, status, onCeiling, onMove, onRemove },
  handle,
) {
  const reducedMotion = useReducedMotion();
  const { light } = useDial();
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<RoomScene | null>(null);
  const slider = useRef<HTMLInputElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const drag = useRef<{ id: string; moved: boolean } | null>(null);
  const [view, setView] = useState<"loading" | "3d" | "plan">("loading");
  const [, setLayout] = useState(0);
  const [now, setNow] = useState(() => performance.now());

  useImperativeHandle(handle, () => ({
    focusFitting: (id) => buttons.current.get(id)?.focus(),
    focusSlider: () => slider.current?.focus(),
  }));

  // The scene is created once; it reports layout changes so the fitting buttons follow the canvas.
  useEffect(() => {
    let cancelled = false;
    void Promise.all([import("../../three/room"), import("../../three/fittings")]).then(([{ RoomScene }, { webglContext }]) => {
      const element = canvas.current;
      if (cancelled || !element) return;
      const context = webglContext(element);
      if (!context) {
        setView("plan");
        return;
      }
      scene.current = new RoomScene(
        element,
        context,
        { width: widthMm, depth: depthMm, ceiling: ceilingMm },
        light,
        reducedMotion,
        () => setLayout((n) => n + 1),
      );
      setView("3d");
    });
    return () => {
      cancelled = true;
      scene.current?.dispose();
      scene.current = null;
    };
    // The room is built once per project page; size and light changes are applied below.
  }, []);

  // While any fitting is playing its sequence, re-render every frame so phases, pools and counts advance.
  const active = [...sequences.values()].some((started) => now - started < SEQUENCE_END);
  useEffect(() => {
    if (!sequences.size) return;
    let frame = requestAnimationFrame(function step(time) {
      setNow(time);
      if ([...sequences.values()].some((started) => time - started < SEQUENCE_END)) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [sequences]);

  const progress = new Map<string, SequenceProgress>();
  let newest: number | null = null;
  for (const [id, started] of sequences) {
    if (now - started < SEQUENCE_END) progress.set(id, progressAt(now - started));
    if (newest === null || started > newest) newest = started;
  }
  const phase = newest !== null && active ? phaseAt(now - newest) : "settled";

  const figures = roomFigures(placements, ceilingMm);

  useEffect(() => {
    scene.current?.setSize({ width: widthMm, depth: depthMm, ceiling: ceilingMm });
  }, [widthMm, depthMm, ceilingMm, view]);

  useEffect(() => {
    scene.current?.setLight(light);
  }, [light, view]);

  useEffect(() => {
    scene.current?.sync(
      placements.map((p) => ({
        id: p.id,
        x: p.x_mm,
        y: p.y_mm,
        beam: p.beam_deg,
        cct: p.cct_k,
        kind: fittingKind(p.variant_code),
        finish: p.variant_code.split("-")[1] ?? "WH",
      })),
      progress,
    );
  });

  const position = (p: Placement): { left: string; top: string } => {
    if (view === "3d" && scene.current) {
      const { left, top } = scene.current.project(p.x_mm, p.y_mm);
      return { left: `${left}px`, top: `${top}px` };
    }
    return { left: `${(p.x_mm / widthMm) * 100}%`, top: `${(p.y_mm / depthMm) * 100}%` };
  };

  const planPoint = (event: PointerEvent<HTMLButtonElement>, layer: HTMLElement): { x: number; y: number } | null => {
    if (view === "3d" && scene.current) return scene.current.planAt(event.clientX, event.clientY);
    const rect = layer.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * widthMm, y: ((event.clientY - rect.top) / rect.height) * depthMm };
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, placement: Placement) => {
    const step = event.shiftKey ? SHIFT_STEP_MM : STEP_MM;
    const moves: Record<string, [number, number]> = {
      ArrowRight: [step, 0],
      ArrowLeft: [-step, 0],
      ArrowDown: [0, step],
      ArrowUp: [0, -step],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      const x = Math.min(widthMm, Math.max(0, placement.x_mm + move[0]));
      const y = Math.min(depthMm, Math.max(0, placement.y_mm + move[1]));
      if (x !== placement.x_mm || y !== placement.y_mm) onMove(placement, x, y, true);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onRemove(placement);
    } else if (event.key === "Escape") {
      event.preventDefault();
      slider.current?.focus();
    }
  };

  return (
    <>
      <section aria-label="Light-pool room" className="room" data-phase={reducedMotion ? "settled" : phase}>
        <div className="room__toolbar">
          <div className="room__ceiling">
            <label htmlFor="room-ceiling">Ceiling height</label>
            <input
              ref={slider}
              id="room-ceiling"
              type="range"
              min={2400}
              max={4000}
              step={100}
              value={ceilingMm}
              aria-valuetext={`${(ceilingMm / 1000).toFixed(1)} m`}
              onChange={(event) => onCeiling(Number(event.target.value))}
            />
            <output htmlFor="room-ceiling" className="mono">
              {(ceilingMm / 1000).toFixed(1)} m
            </output>
          </div>
          <p className="room__size mono">
            {widthMm} × {depthMm} mm
          </p>
        </div>
        <div className={`room__stage room__stage--${view}`}>
          {view === "plan" ? (
            <div className="room__plan" style={{ aspectRatio: `${widthMm} / ${depthMm}` }}>
              <RoomPlan widthMm={widthMm} depthMm={depthMm} ceilingMm={ceilingMm} placements={placements} label="Room plan" />
            </div>
          ) : (
            <canvas
              ref={canvas}
              className="room__canvas"
              role={view === "3d" ? "img" : undefined}
              aria-label={view === "3d" ? "Room 3D view" : undefined}
            />
          )}
          <div className={`room__fittings ${view === "plan" ? "room__fittings--plan" : ""}`}>
            {figures.map((placement) => {
              const sequence = progress.get(placement.id);
              const fraction = sequence ? sequence.count : null;
              return (
                <div key={placement.id} className="fitting" style={position(placement)}>
                  <button
                    ref={(element) => {
                      if (element) buttons.current.set(placement.id, element);
                      else buttons.current.delete(placement.id);
                    }}
                    type="button"
                    className={`fitting__button fitting__button--${placement.cct_k}`}
                    aria-label={`${placement.variant_code} #${placement.ordinal} at ${placement.x_mm} mm, ${placement.y_mm} mm`}
                    onKeyDown={(event) => onKeyDown(event, placement)}
                    onPointerDown={(event) => {
                      event.currentTarget.setPointerCapture(event.pointerId);
                      drag.current = { id: placement.id, moved: false };
                    }}
                    onPointerMove={(event) => {
                      if (drag.current?.id !== placement.id) return;
                      const layer = event.currentTarget.closest<HTMLElement>(".room__fittings");
                      const point = layer ? planPoint(event, layer) : null;
                      if (!point) return;
                      const x = snap(point.x, widthMm);
                      const y = snap(point.y, depthMm);
                      if (x === placement.x_mm && y === placement.y_mm) return;
                      drag.current.moved = true;
                      onMove(placement, x, y, false);
                    }}
                    onPointerUp={() => {
                      if (drag.current?.moved) onMove(placement, placement.x_mm, placement.y_mm, true);
                      drag.current = null;
                    }}
                  >
                    <span aria-hidden="true">{placement.ordinal}</span>
                  </button>
                  {(!sequence || sequence.count > 0) && (
                    <Readout diameter={placement.pool_diameter_mm} lux={placement.centre_lux} fraction={fraction} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <p role="status" aria-label="Room updates" className="form-status room__status">
          {status}
        </p>
      </section>
      <table aria-label="Light pools" className="data-table pools-table">
        <thead>
          <tr>
            <th scope="col">Code</th>
            <th scope="col" className="numeric">X (mm)</th>
            <th scope="col" className="numeric">Y (mm)</th>
            <th scope="col" className="numeric">Beam</th>
            <th scope="col" className="numeric">Pool diameter (mm)</th>
            <th scope="col" className="numeric">Centre lux</th>
          </tr>
        </thead>
        <tbody>
          {figures.map((placement) => (
            <tr key={placement.id}>
              <td className="mono">{placement.variant_code}</td>
              <td className="numeric mono">{placement.x_mm}</td>
              <td className="numeric mono">{placement.y_mm}</td>
              <td className="numeric mono">{placement.beam_deg}°</td>
              <td className="numeric mono">{placement.pool_diameter_mm}</td>
              <td className="numeric mono">{placement.centre_lux}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {figures.length === 0 && <p className="empty-note">No fittings placed yet. Choose Place on an unplaced fitting.</p>}
    </>
  );
});
