import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import { SIGNATURE_PAD_ASPECT, STROKE_POINT_LIMIT, TYPED_LIMIT, codePoints, truncateCodePoints } from "../../shared/limits";
import { clamp } from "../../shared/geometry";
import type { Stroke } from "../../shared/types";
import { Dialog } from "./Dialog";

export type Adoption = { typed: string } | { strokes: Stroke[] };

interface AdoptProps {
  kind: "signature" | "initials";
  name: string;
  initials: string;
  close: () => void;
  adopt: (adoption: Adoption) => void;
}

const PAD_W = 660;
const PAD_H = Math.round(PAD_W / SIGNATURE_PAD_ASPECT);

export function Adopt({ kind, name, initials, close, adopt }: AdoptProps) {
  const [tab, setTab] = useState<"type" | "draw">("type");
  const [typed, setTyped] = useState(kind === "signature" ? name : initials);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const noun = kind === "signature" ? "signature" : "initials";
  const ready = tab === "type" ? codePoints(typed.trim()) >= 1 : strokes.length > 0;
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = tab === "type" ? "draw" : "type";
    setTab(next);
    tabs.current[next]?.focus();
  };

  return (
    <Dialog label={`Adopt your ${noun}`} onClose={close} className="adopt">
      <h2>{`Adopt your ${noun}`}</h2>
      <div role="tablist" aria-label="Adoption method" className="tabs small-tabs">
        {(["type", "draw"] as const).map((id) => (
          <button
            key={id}
            ref={(node) => void (tabs.current[id] = node)}
            type="button"
            role="tab"
            id={`adopt-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`adopt-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className="tab"
            onClick={() => setTab(id)}
            onKeyDown={onTabKey}
          >
            {id === "type" ? "Type" : "Draw"}
          </button>
        ))}
      </div>
      {tab === "type" ? (
        <div role="tabpanel" id="adopt-panel-type" aria-labelledby="adopt-tab-type" className="stack">
          <label className="field-label">
            {kind === "signature" ? "Full name" : "Initials"}
            <input type="text" value={typed} data-autofocus onChange={(e) => setTyped(truncateCodePoints(e.target.value, TYPED_LIMIT))} />
          </label>
          <p className={`typed-preview ${kind}`} aria-hidden="true">
            {typed}
          </p>
        </div>
      ) : (
        <div role="tabpanel" id="adopt-panel-draw" aria-labelledby="adopt-tab-draw" className="stack">
          <Pad strokes={strokes} onChange={setStrokes} />
          <div>
            <button type="button" className="btn small" onClick={() => setStrokes([])}>
              Clear
            </button>
          </div>
        </div>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="btn seal"
          disabled={!ready}
          onClick={() => adopt(tab === "type" ? { typed: typed.trim() } : { strokes })}
        >
          Adopt and sign
        </button>
      </div>
    </Dialog>
  );
}

function Pad({ strokes, onChange }: { strokes: Stroke[]; onChange: (next: Stroke[]) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef<Stroke | null>(null);

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, PAD_W, PAD_H);
    ctx.strokeStyle = "#16202E";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of strokes) {
      ctx.beginPath();
      stroke.forEach(([x, y], index) => (index === 0 ? ctx.moveTo(x * PAD_W, y * PAD_H) : ctx.lineTo(x * PAD_W, y * PAD_H)));
      if (stroke.length === 1) ctx.lineTo((stroke[0]?.[0] ?? 0) * PAD_W + 0.1, (stroke[0]?.[1] ?? 0) * PAD_H);
      ctx.stroke();
    }
  }, [strokes]);

  // The pad keeps its touches: no scroll, zoom or fling gesture starts on it, so drawing never moves the
  // page and the next tap elsewhere is an ordinary tap.
  useEffect(() => {
    const pad = canvas.current;
    if (!pad) return;
    const keep = (event: TouchEvent) => event.preventDefault();
    pad.addEventListener("touchstart", keep, { passive: false });
    pad.addEventListener("touchmove", keep, { passive: false });
    return () => {
      pad.removeEventListener("touchstart", keep);
      pad.removeEventListener("touchmove", keep);
    };
  }, []);

  const point = (event: PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [clamp((event.clientX - rect.left) / rect.width, 0, 1), clamp((event.clientY - rect.top) / rect.height, 0, 1)];
  };

  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label="Signature pad"
      width={PAD_W}
      height={PAD_H}
      className="pad"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        live.current = [point(event)];
        onChange([...strokes, live.current]);
      }}
      onPointerMove={(event) => {
        const current = live.current;
        if (!current || strokes.reduce((sum, s) => sum + s.length, 0) >= STROKE_POINT_LIMIT) return;
        current.push(point(event));
        onChange([...strokes.slice(0, -1), [...current]]);
      }}
      onPointerUp={() => void (live.current = null)}
      onPointerCancel={() => void (live.current = null)}
    />
  );
}
