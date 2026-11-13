// Chapter IV: the spring sculpture (brief: Exhibits › Spring; Motion › Spring sculpture).
// The regime comes from the damping discriminant; Pluck plays the damped motion of a unit mass
// with the current stiffness and damping, time-scaled so every setting is at rest within 4 s.

import { useEffect, useRef, useState } from "react";
import { springRegime, type SpringSeed } from "../../shared/exhibits.js";
import { copyFor } from "../../shared/copy.js";

const REST_MS = 4000;
const TIME_SCALE = 1.5;
const LINKS = 11;

/** Displacement (fraction of the pluck) after `t` model seconds, from x(0) = 1, x'(0) = 0. */
function displacement(k: number, c: number, t: number): number {
  const regime = springRegime(k, c);
  if (regime === "underdamped") {
    const wd = Math.sqrt(4 * k - c * c) / 2;
    return Math.exp((-c * t) / 2) * (Math.cos(wd * t) + (c / (2 * wd)) * Math.sin(wd * t));
  }
  if (regime === "critically damped") return Math.exp((-c * t) / 2) * (1 + (c * t) / 2);
  const root = Math.sqrt(c * c - 4 * k);
  const r1 = (-c + root) / 2;
  const r2 = (-c - root) / 2;
  return (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
}

function drawChain(canvas: HTMLCanvasElement, offset: number): void {
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const { width: w, height: h } = canvas;
  ctx.fillStyle = "#0e0f0b";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#2f3327";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w * 0.06, h / 2);
  ctx.lineTo(w * 0.94, h / 2);
  ctx.stroke();
  ctx.fillStyle = "#a8a396";
  for (const x of [w * 0.06, w * 0.94]) ctx.fillRect(x - 3, h / 2 - 22, 6, 44);
  for (let i = 1; i < LINKS; i++) {
    const t = i / LINKS;
    const x = w * (0.06 + 0.88 * t);
    const y = h / 2 - Math.sin(Math.PI * t) * offset * h * 0.36;
    const size = 12 + 10 * Math.sin(Math.PI * t);
    const tilt = Math.cos(Math.PI * t) * offset * 0.9 + i * 0.7;
    ctx.fillStyle = `rgb(236, 228, 210)`;
    ctx.beginPath();
    for (let corner = 0; corner < 3; corner++) {
      const angle = tilt + (corner * 2 * Math.PI) / 3 + (corner === 1 ? 0.35 : 0);
      const px = x + Math.cos(angle) * size;
      const py = y + Math.sin(angle) * size * 0.8;
      if (corner === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
}

export function SpringExhibit({ seed, reducedMotion, onUse }: { seed: SpringSeed; reducedMotion: boolean; onUse: () => void }) {
  const [k, setK] = useState(seed.stiffness.initial);
  const [c, setC] = useState(seed.damping.initial);
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef(0);
  const params = useRef({ k, c });
  params.current = { k, c };

  useEffect(() => {
    drawChain(canvas.current as HTMLCanvasElement, 0);
    return () => cancelAnimationFrame(frame.current);
  }, []);

  const pluck = () => {
    onUse();
    cancelAnimationFrame(frame.current);
    if (reducedMotion) {
      drawChain(canvas.current as HTMLCanvasElement, 0);
      return;
    }
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now;
      const elapsed = now - start;
      if (elapsed >= REST_MS) {
        drawChain(canvas.current as HTMLCanvasElement, 0);
        return;
      }
      drawChain(canvas.current as HTMLCanvasElement, displacement(params.current.k, params.current.c, (elapsed / 1000) * TIME_SCALE));
      frame.current = requestAnimationFrame(step);
    };
    drawChain(canvas.current as HTMLCanvasElement, 1);
    frame.current = requestAnimationFrame(step);
  };

  const regime = springRegime(k, c);
  return (
    <div className="exhibit spring-exhibit">
      <canvas ref={canvas} width={960} height={300} className="spring-canvas" aria-hidden="true" />
      <div className="exhibit-controls">
        <div className="range">
          <label htmlFor="spring-stiffness">Stiffness</label>
          <input
            id="spring-stiffness"
            type="range"
            min={seed.stiffness.min}
            max={seed.stiffness.max}
            step={seed.stiffness.step}
            value={k}
            onChange={(e) => {
              onUse();
              setK(Number(e.currentTarget.value));
            }}
          />
          <output htmlFor="spring-stiffness" className="figure">
            k = {k}
          </output>
        </div>
        <div className="range">
          <label htmlFor="spring-damping">Damping</label>
          <input
            id="spring-damping"
            type="range"
            min={seed.damping.min}
            max={seed.damping.max}
            step={seed.damping.step}
            value={c}
            onChange={(e) => {
              onUse();
              setC(Number(e.currentTarget.value));
            }}
          />
          <output htmlFor="spring-damping" className="figure">
            c = {c}
          </output>
        </div>
        <button type="button" className="button button-primary" onClick={pluck}>
          Pluck
        </button>
      </div>
      <p className="figure discriminant">
        c² − 4k = {c * c - 4 * k}
      </p>
      <div role="status" aria-label="Sculpture state" className="exhibit-status">
        {copyFor.regime(regime)}
      </div>
    </div>
  );
}
