import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Airline, Dimensions, Fit } from "../../shared/api";
import { ApiFail, api } from "../lib/api";
import { EASE, MOTION, reducedNow, useMotionMs } from "../lib/motion";
import { useData } from "../lib/useData";
import { GaugeBagArt } from "./BagArt";

// The bag is drawn at true relative scale beside the airline's cabin frame: 1 cm is 2.4 px in the
// 1280-wide layout (a 710.4 px column) and proportionally less or more at other widths.

const PX_PER_CM_AT_REFERENCE = 2.4;
const REFERENCE_WIDTH = 710.4;
const LEAD_CM = 20;
const FRAME_LEFT_CM = 80;
const BAG_GAP_CM = 3;
const MIN_TARGET = 44;
const DRAG_THRESHOLD_PX = 3;

export interface GaugeBag {
  id: string;
  sku: string;
  label: string;
  colour: string;
  dimensions: Dimensions;
  weight: number;
}

type Phase = "idle" | "dragging" | "settling" | "settled";

interface Props {
  bags: GaugeBag[];
  selectedId: string;
  onSelect?: (id: string) => void;
  airline: string;
  onAirline: (code: string) => void;
}

function decimals(value: number): number {
  return (String(value).split(".")[1] ?? "").length;
}

/** A number that counts to its new value in about four tenths of a second. */
function Counting({ value, unit }: { value: number; unit: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const frame = useRef(0);
  useEffect(() => {
    if (reducedNow() || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / MOTION.gauge);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(origin + (value - origin) * eased);
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame.current = requestAnimationFrame(tick);
    const done = window.setTimeout(() => {
      cancelAnimationFrame(frame.current);
      from.current = value;
      setShown(value);
    }, MOTION.gauge);
    return () => {
      cancelAnimationFrame(frame.current);
      window.clearTimeout(done);
    };
  }, [value]);
  return (
    <>
      {shown.toFixed(decimals(value))} {unit}
    </>
  );
}

export function GateGauge({ bags, selectedId, onSelect, airline, onAirline }: Props) {
  const airlines = useData<Airline[]>("/api/airlines");
  const selected = bags.find((b) => b.id === selectedId) ?? bags[0];
  const frame = airlines.data?.find((a) => a.code === airline) ?? airlines.data?.[0];
  const fit = useData<Fit>(selected ? `/api/fit?sku=${encodeURIComponent(selected.sku)}&airline=${encodeURIComponent(airline)}` : null);
  const motionMs = useMotionMs(MOTION.gauge);
  const root = useRef<HTMLDivElement>(null);
  const bagEl = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const drag = useRef<{ x: number; pos: number; moved: boolean } | null>(null);
  const [width, setWidth] = useState(REFERENCE_WIDTH);
  const [pos, setPos] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [settled, setSettled] = useState<"inside" | "edge" | null>(null);
  const positionRef = useRef(0);
  positionRef.current = pos;
  const fitRef = useRef<Fit | null>(null);
  fitRef.current = fit.data && fit.data.sku === selected?.sku && fit.data.airline === airline ? fit.data : null;

  useLayoutEffect(() => {
    const measure = () => setWidth(root.current?.getBoundingClientRect().width ?? REFERENCE_WIDTH);
    measure();
    const observer = new ResizeObserver(measure);
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const scale = (PX_PER_CM_AT_REFERENCE * width) / REFERENCE_WIDTH;
  const maxPos = LEAD_CM + (frame?.width_cm ?? 0);

  // A different variant or airline puts the bag back at the start.
  useEffect(() => {
    window.clearTimeout(timer.current);
    setPos(0);
    setPhase("idle");
    setSettled(null);
  }, [selected?.id, airline]);

  const move = useCallback(
    (next: number) => {
      window.clearTimeout(timer.current);
      setPos(Math.min(maxPos, Math.max(0, next)));
      setPhase("idle");
      setSettled(null);
    },
    [maxPos],
  );

  const settle = useCallback(async () => {
    if (!selected || !frame) return;
    window.clearTimeout(timer.current);
    setPhase("settling");
    setSettled(null);
    let result = fitRef.current;
    if (!result) {
      try {
        result = await api.get<Fit>(`/api/fit?sku=${encodeURIComponent(selected.sku)}&airline=${encodeURIComponent(airline)}`);
      } catch (failure) {
        if (!(failure instanceof ApiFail)) throw failure;
        return;
      }
    }
    const target = result.fits ? LEAD_CM + (frame.width_cm + selected.dimensions.width) / 2 : LEAD_CM;
    const from = positionRef.current;
    positionRef.current = target;
    setPos(target);
    if (reducedNow()) {
      setPhase("settled");
      setSettled(result.fits ? "inside" : "edge");
      return;
    }
    const distance = (target - from) * scale;
    const overshoot = Math.sign(distance) * Math.min(14, Math.abs(distance) * 0.06);
    bagEl.current?.animate(
      [
        { transform: `translateX(${from * scale}px)` },
        { transform: `translateX(${target * scale + overshoot}px)`, offset: 0.6 },
        { transform: `translateX(${target * scale}px)` },
      ],
      { duration: MOTION.gaugeSettle - 80, easing: EASE },
    );
    timer.current = window.setTimeout(() => {
      setPhase("settled");
      setSettled(result.fits ? "inside" : "edge");
    }, MOTION.gaugeSettle);
  }, [selected, frame, airline, scale]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number | undefined> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };
    const delta = step[event.key];
    if (delta !== undefined) {
      event.preventDefault();
      move(pos + delta);
    } else if (event.key === "Home") {
      event.preventDefault();
      move(0);
    } else if (event.key === "End") {
      event.preventDefault();
      move(maxPos);
    } else if (event.key === "Enter") {
      event.preventDefault();
      void settle();
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    window.clearTimeout(timer.current);
    drag.current = { x: event.clientX, pos, moved: false };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    if (Math.abs(dx) < DRAG_THRESHOLD_PX && !start.moved) return;
    start.moved = true;
    setPhase("dragging");
    setSettled(null);
    setPos(Math.min(maxPos, Math.max(0, start.pos + dx / scale)));
  };
  const onPointerUp = () => {
    const start = drag.current;
    drag.current = null;
    if (start?.moved) void settle();
  };

  if (!selected) return null;

  const frameH = frame?.height_cm ?? 0;
  const tallest = Math.max(frameH, ...bags.map((b) => b.dimensions.height));
  const stageHeight = (tallest + 8) * scale;
  const frameLeft = FRAME_LEFT_CM * scale;
  const over = settled === "edge" && fitRef.current ? fitRef.current.overhang_cm : null;
  const valueText = pos < LEAD_CM - 0.01 ? "Outside the frame" : pos < LEAD_CM + 0.01 ? "Touching the frame" : "Inside the frame";

  // Resting places: bags stand in a row to the left of the frame, the selected one last in line to move.
  let cursor = LEAD_CM;
  const rest = new Map<string, number>();
  for (const bag of [...bags].reverse()) {
    rest.set(bag.id, frameLeft - (cursor + bag.dimensions.width) * scale);
    cursor += bag.dimensions.width + BAG_GAP_CM;
  }

  const verdict = fit.data && fit.data.sku === selected.sku ? fit.data : null;
  const verdictFits = verdict ? verdict.fits : true;

  return (
    <div
      ref={root}
      role="group"
      aria-label="Gate Gauge"
      className="gauge"
      data-motion-ms={motionMs}
      data-state={phase}
      data-settled={phase === "settled" ? (settled ?? undefined) : undefined}
    >
      <div role="radiogroup" aria-label="Airline" className="pills">
        {airlines.data?.map((a) => (
          <label key={a.code} className="pill">
            <input type="radio" name="airline" value={a.code} checked={a.code === airline} onChange={() => onAirline(a.code)} aria-label={a.name} />
            <span>{a.name}</span>
          </label>
        ))}
      </div>
      {onSelect && bags.length > 0 && (
        <div role="radiogroup" aria-label="Bag to fit" className="pills">
          {bags.map((b) => (
            <label key={b.id} className="pill">
              <input type="radio" name="bag-to-fit" value={b.id} checked={b.id === selected.id} onChange={() => onSelect(b.id)} aria-label={b.label} />
              <span>{b.label}</span>
            </label>
          ))}
        </div>
      )}
      {frame && (
        <div className="gauge-stage" style={{ height: stageHeight }}>
          <div className="gauge-frame" style={{ left: frameLeft, width: frame.width_cm * scale, height: frame.height_cm * scale }} />
          {bags.map((bag) => {
            const w = bag.dimensions.width * scale;
            const h = bag.dimensions.height * scale;
            const isSelected = bag.id === selected.id;
            const edges = isSelected ? over : null;
            const art = (
              <>
                <div className="gauge-bag-art" style={{ width: w, height: h }}>
                  <GaugeBagArt colour={bag.colour} />
                  <span className="gauge-handle" />
                  {edges && edges.height > 0 && <span className="over over-top" />}
                  {edges && edges.width > 0 && (
                    <>
                      <span className="over over-left" />
                      <span className="over over-right" />
                    </>
                  )}
                  {edges && edges.depth > 0 && <span className="over over-bottom" />}
                </div>
              </>
            );
            const base = { left: rest.get(bag.id) ?? 0, width: Math.max(MIN_TARGET, w), height: Math.max(MIN_TARGET, h) };
            return isSelected ? (
              <div
                key={bag.id}
                ref={bagEl}
                role="slider"
                tabIndex={0}
                aria-label="Bag position"
                aria-orientation="horizontal"
                aria-valuemin={0}
                aria-valuemax={maxPos}
                aria-valuenow={Math.round(pos * 100) / 100}
                aria-valuetext={valueText}
                className="gauge-bag is-selected"
                style={{ ...base, transform: `translateX(${pos * scale}px)` }}
                onKeyDown={onKeyDown}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              >
                {art}
              </div>
            ) : (
              <div key={bag.id} className="gauge-bag" aria-hidden="true" style={base}>
                {art}
              </div>
            );
          })}
        </div>
      )}
      {frame && (
        <p className="gauge-caption muted">
          {frame.name} cabin frame: {frame.height_cm} × {frame.width_cm} × {frame.depth_cm} cm
        </p>
      )}
      <p role="status" aria-label="Fit verdict" className={`verdict ${verdictFits ? "tone-teal" : "tone-red"}`}>
        {verdict?.verdict ?? ""}
      </p>
      <ul aria-label="Bag dimensions" className="dims">
        <li>
          Height <Counting value={selected.dimensions.height} unit="cm" />
        </li>
        <li>
          Width <Counting value={selected.dimensions.width} unit="cm" />
        </li>
        <li>
          Depth <Counting value={selected.dimensions.depth} unit="cm" />
        </li>
        <li>
          Weight <Counting value={selected.weight} unit="kg" />
        </li>
      </ul>
    </div>
  );
}
