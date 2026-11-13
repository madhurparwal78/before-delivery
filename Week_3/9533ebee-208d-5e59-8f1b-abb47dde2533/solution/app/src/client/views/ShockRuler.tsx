import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { api } from "../api.ts";
import { useLive } from "../state.tsx";
import { ActionButton, counted, Fig } from "../ui.tsx";
import type { Pool, Position } from "../types.ts";
import { displayPrice, displayShock, priceUnits } from "../../shared/format.ts";

// The shock ruler: a slider from -60% to +60% of the chosen asset's posted price, a handle that glides to each
// step, and a canvas strip with one tick per open position at its server liquidation price. The at-risk count
// and the shocked price are computed here from server prices; nothing else about a position is.

const SPAN = 600; // -60.0% … +60.0%, in tenths of a percent
const THUMB = 44; // the slider's (invisible) thumb, so the handle sits exactly over its value
const HANDLE_MS = 120;
const FILL_MS = 200;
const SETTLE_MS = 400;
const INK = [26, 33, 48] as const;
const SIGNAL = [163, 48, 28] as const;

function sliderValue(s10: number): string {
  const magnitude = Math.abs(s10);
  return `${s10 < 0 ? "-" : ""}${Math.floor(magnitude / 10)}.${magnitude % 10}`;
}

function parseSlider(value: string): number {
  const match = /^(-?)(\d+)(?:\.(\d))?/.exec(value);
  if (!match) return 0;
  const tenths = Number.parseInt(match[2] ?? "0", 10) * 10 + Number.parseInt(match[3] ?? "0", 10);
  return Math.max(-SPAN, Math.min(SPAN, match[1] === "-" ? -tenths : tenths));
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Tick {
  id: string;
  liquidation: bigint;
  collateral: string;
  atRisk: boolean;
  drawn: boolean;
  ratio: number;
}

export function ShockRuler({ pool, onPostThisPrice, ownPositionId }: { pool: Pool; onPostThisPrice?: (shocked: bigint) => void; ownPositionId?: string }) {
  const [s10, setS10] = useState(0);
  const [reading, setReading] = useState("");
  const [width, setWidth] = useState(0);
  const dragging = useRef(false);
  const track = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const shown = useRef<number | null>(null);
  const placedWidth = useRef(0);
  const fills = useRef(new Map<string, number>());

  const asset = pool.asset;
  // After any post (manual or oracle) the ruler recentres at 0% on the new price and reloads its positions.
  const posted = `${pool.price}|${pool.price_posted_at}|${pool.oracle_round}`;
  const { data: positions, reload } = useLive(
    () => api<{ positions: Position[] }>("GET", `/api/positions?collateral_asset=${encodeURIComponent(asset)}`).then((b) => b.positions),
    null,
    [asset, posted],
  );
  // Positions reload every 5 seconds while the handle is not being dragged.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!dragging.current) void reload();
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [reload]);
  useEffect(() => setS10(0), [asset, posted]);

  const price = priceUnits(pool.price);
  const shocked = (price * BigInt(1000 + s10)) / 1000n;
  const lo = (price * 400n) / 1000n;
  const hi = (price * 1600n) / 1000n;

  const ticks: Tick[] = useMemo(
    () =>
      (positions ?? [])
        .filter((p) => p.collateral_asset === asset && p.state !== "closed" && p.liquidation_price !== null && p.debt !== "0")
        .map((p) => {
          const liquidation = priceUnits(p.liquidation_price ?? "0");
          const drawn = liquidation >= lo && liquidation <= hi;
          return {
            id: p.position_id,
            liquidation,
            collateral: p.collateral_amount,
            atRisk: shocked < liquidation,
            drawn,
            ratio: drawn && hi > lo ? Number(((liquidation - lo) * 1_000_000n) / (hi - lo)) / 1_000_000 : 0,
          };
        }),
    [positions, asset, shocked, lo, hi],
  );
  const atRisk = ticks.filter((t) => t.atRisk);
  const exposed = atRisk.reduce((sum, t) => sum + BigInt(t.collateral), 0n).toString();

  const xOf = useCallback((ratio: number) => THUMB / 2 + ratio * Math.max(0, width - THUMB), [width]);

  useLayoutEffect(() => {
    const element = track.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  // The visible handle glides to each step over 120 ms, starting quickly and settling softly; under reduced
  // motion it jumps. The tween runs on animation frames, so it follows the page's own clock.
  useLayoutEffect(() => {
    const element = handle.current;
    if (!element || width === 0) return;
    const target = xOf((s10 + SPAN) / (2 * SPAN));
    const from = shown.current;
    const place = (x: number) => {
      shown.current = x;
      element.style.transform = `translateX(${x}px)`;
    };
    const resized = placedWidth.current !== width;
    placedWidth.current = width;
    if (from === null || resized || from === target || reducedMotion()) {
      place(target);
      return;
    }
    const start = performance.now();
    let frame = window.requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - start) / HANDLE_MS);
      place(from + (target - from) * easeOut(t));
      if (t < 1) frame = window.requestAnimationFrame(step);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [s10, width, xOf]);

  // The settled announcement, 400 ms after the handle last moved; only a movement restarts the pause.
  const settled = useRef({ count: 0, first: true });
  settled.current.count = atRisk.length;
  useEffect(() => {
    if (settled.current.first) {
      settled.current.first = false;
      return;
    }
    const timer = window.setTimeout(() => setReading(`${counted(settled.current.count, "position")} at risk at ${displayShock(s10)}% shock.`), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [s10]);

  // The tick canvas: redrawn when the handle, the asset or the positions change, and while a fill is turning.
  useEffect(() => {
    const element = canvas.current;
    if (!element || width === 0) return;
    const context = element.getContext("2d");
    if (!context) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const height = 48;
    element.width = Math.round(width * ratio);
    element.height = Math.round(height * ratio);
    const reduced = reducedMotion();
    const known = fills.current;
    for (const id of [...known.keys()]) if (!ticks.some((t) => t.id === id)) known.delete(id);
    // A tick seen for the first time takes its colour at once, so positions already at risk start red.
    for (const t of ticks) if (!known.has(t.id) || reduced) known.set(t.id, t.atRisk ? 1 : 0);

    const hatch = (() => {
      const tile = document.createElement("canvas");
      tile.width = 8 * ratio;
      tile.height = 8 * ratio;
      const pen = tile.getContext("2d");
      if (!pen) return null;
      pen.strokeStyle = `rgb(${SIGNAL.join(",")})`;
      pen.lineWidth = 1.5 * ratio;
      pen.beginPath();
      pen.moveTo(0, 8 * ratio);
      pen.lineTo(8 * ratio, 0);
      pen.moveTo(-4 * ratio, 4 * ratio);
      pen.lineTo(4 * ratio, -4 * ratio);
      pen.moveTo(4 * ratio, 12 * ratio);
      pen.lineTo(12 * ratio, 4 * ratio);
      pen.stroke();
      return context.createPattern(tile, "repeat");
    })();

    const draw = () => {
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = `rgb(${INK.join(",")})`;
      context.fillRect(THUMB / 2, height - 9, width - THUMB, 1);
      for (const t of ticks) {
        if (!t.drawn) continue;
        const mix = easeOut(known.get(t.id) ?? 0);
        const rgb = INK.map((c, i) => Math.round(c + ((SIGNAL[i] ?? c) - c) * mix));
        const x = Math.round(xOf(t.ratio)) - 1;
        const tall = t.id === ownPositionId;
        const top = tall ? 2 : 12;
        if (reduced && t.atRisk && hatch) {
          context.fillStyle = hatch;
          context.fillRect(x - 5, top, 12, height - 9 - top);
        }
        context.fillStyle = `rgb(${rgb.join(",")})`;
        context.fillRect(x, top, tall ? 3 : 2, height - 9 - top);
      }
    };

    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = now - last;
      last = now;
      let moving = false;
      for (const t of ticks) {
        const current = known.get(t.id) ?? 0;
        const goal = t.atRisk ? 1 : 0;
        if (current === goal) continue;
        const next = goal > current ? Math.min(goal, current + dt / FILL_MS) : Math.max(goal, current - dt / FILL_MS);
        known.set(t.id, next);
        moving = moving || next !== goal;
      }
      draw();
      if (moving) frame = window.requestAnimationFrame(step);
    };
    draw();
    if (ticks.some((t) => (known.get(t.id) ?? 0) !== (t.atRisk ? 1 : 0))) frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [ticks, width, xOf, ownPositionId]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!event.shiftKey) return;
    const delta = { ArrowLeft: -50, ArrowDown: -50, ArrowRight: 50, ArrowUp: 50 }[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    setS10((current) => Math.max(-SPAN, Math.min(SPAN, current + delta)));
  }

  const listed = ticks.filter((t) => t.drawn || t.atRisk);
  const scale = width < 520 ? [-60, -30, 0, 30, 60] : [-60, -45, -30, -15, 0, 15, 30, 45, 60];
  return (
    <section aria-label="Shock ruler" className="ruler">
      <header className="ruler-head">
        <h2>Shock ruler · {asset}</h2>
        <div className="ruler-counters">
          <p className="counter">
            <span className="counter-label">Positions at risk</span> <span className={`counter-value mono${atRisk.length > 0 ? " signal-figure" : ""}`}>{atRisk.length}</span>
          </p>
          <p className="counter">
            <span className="counter-label">Collateral exposed</span> <Fig minor={exposed} decimals={pool.decimals} asset={asset} className="counter-value" />
          </p>
          <p className="counter">
            <span className="counter-label">Shocked price</span> <span className="counter-value mono">{displayPrice(shocked)}</span>
          </p>
        </div>
      </header>
      <div className="ruler-track" ref={track}>
        <svg className="ruler-scale" aria-hidden="true" width="100%" height="44">
          {width > 0
            ? Array.from({ length: 25 }, (_, i) => {
                const pct = -60 + i * 5;
                const x = xOf(i / 24);
                const major = pct % 15 === 0;
                return <line key={pct} x1={x} x2={x} y1={pct === 0 ? 16 : major ? 18 : 26} y2="42" className={pct === 0 ? "scale-zero" : "scale-tick"} />;
              })
            : null}
          {width > 0
            ? scale.map((pct) => (
                <text key={pct} x={xOf((pct + 60) / 120)} y="13" textAnchor={pct === -60 ? "start" : pct === 60 ? "end" : "middle"} className="scale-label">
                  {pct > 0 ? `+${pct}%` : `${pct}%`}
                </text>
              ))
            : null}
        </svg>
        <input
          type="range"
          className="ruler-slider"
          aria-label="Price shock"
          min={-60}
          max={60}
          step={0.5}
          value={sliderValue(s10)}
          aria-valuetext={`${displayShock(s10)}% · ${displayPrice(shocked)}`}
          onChange={(event) => setS10(parseSlider(event.target.value))}
          onKeyDown={onKeyDown}
          onPointerDown={() => {
            dragging.current = true;
          }}
          onPointerUp={() => {
            dragging.current = false;
          }}
          onPointerCancel={() => {
            dragging.current = false;
          }}
        />
        <div role="img" aria-label="Shock handle" className="ruler-handle" ref={handle}>
          <svg viewBox="0 0 24 60" width="24" height="60" aria-hidden="true">
            <line x1="12" x2="12" y1="18" y2="44" />
            <path d="M12 60 L4 46 H20 Z" />
          </svg>
        </div>
      </div>
      <canvas ref={canvas} role="img" aria-label="Liquidation prices of open positions" className="ruler-canvas" />
      <ul aria-label="Position ticks" className="sr-only">
        {listed.map((t) => (
          <li key={t.id}>{`${t.id}: ${displayPrice(t.liquidation)}, ${t.atRisk ? "at risk" : "clear"}`}</li>
        ))}
      </ul>
      <div role="status" aria-label="Shock reading" className="ruler-reading">
        {reading}
      </div>
      <p className="ruler-legend">
        <span className="legend-ink">Ink tick: clear at this shock.</span> <span className="legend-signal">Red tick: below its liquidation price.</span>
        {` Posted price ${displayPrice(pool.price)}.`}
      </p>
      {onPostThisPrice ? (
        <div className="actions">
          <ActionButton onClick={() => onPostThisPrice(shocked)}>Post this price</ActionButton>
        </div>
      ) : null}
    </section>
  );
}
