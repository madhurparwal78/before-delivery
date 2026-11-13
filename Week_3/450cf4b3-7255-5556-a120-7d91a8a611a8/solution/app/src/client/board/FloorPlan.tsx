// The isometric floor: one SVG block per station, generated from station data. Heights, the
// cleanup band and the hatch follow the span through CSS transitions on --h and --b.

import type { JSX } from "preact";
import { useLayoutEffect, useRef, type MutableRef } from "preact/hooks";
import type { StationKind } from "../../shared/api.js";
import { EXTRUSION_PX, type StationState } from "../../shared/metrics.js";
import { faceTransform, planFor, points, raise, ring, type Block, type Plan } from "./geometry.js";
import { MOTION, reducedMotion } from "./motion.js";

export interface StationModel {
  id: string;
  name: string;
  kind: StationKind;
  col: number;
  row: number;
  state: StationState | "taken";
  label: string;
  extrusion: number;
  bandPx: number;
  freeMinutes: number;
}

/** The slab of one claim: one dropped slab per station it would occupy (two for a paired claim). */
export interface SlabDrop {
  stationIds: readonly string[];
  /** Resting while the claim is pending; lifting off when just taken; returning after any other refusal. */
  phase: "resting" | "lifting" | "returning";
  text: string;
  serial: number;
}

interface Props {
  stations: readonly StationModel[];
  width: number;
  heightLimit: number | null;
  target: string | null;
  hover: string | null;
  slab: SlabDrop | null;
  slabHome: MutableRef<HTMLButtonElement | null>;
  onOpen: (id: string, from: SVGGElement) => void;
  onSlabGone: (serial: number) => void;
}

function Equipment({ block, kind }: { block: Block; kind: StationKind }): JSX.Element {
  const { w, d } = block.footprint;
  if (kind === "range") {
    const burners = [[0.27, 0.24], [0.73, 0.24], [0.27, 0.56], [0.73, 0.56]] as const;
    return (
      <g class="equipment">
        {burners.map(([a, b]) => (
          <g key={`${a}${b}`}>
            <path d={ring(block, a * w, b * d, 0.15)} />
            <path d={ring(block, a * w, b * d, 0.07)} />
          </g>
        ))}
        <polyline points={points([block.at(0.06, d - 0.08), block.at(w - 0.06, d - 0.08)])} />
      </g>
    );
  }
  if (kind === "prep_table") {
    return (
      <g class="equipment">
        <polygon class="equipment__board" points={points([block.at(0.12, 0.1), block.at(0.62, 0.1), block.at(0.62, d - 0.1), block.at(0.12, d - 0.1)])} />
        <polyline points={points([block.at(0.75, 0.16), block.at(1.02, 0.16)])} />
        <polyline points={points([block.at(0.75, 0.3), block.at(1.02, 0.3)])} />
      </g>
    );
  }
  if (kind === "mixer") {
    return (
      <g class="equipment">
        <path d={ring(block, w / 2, d / 2, 0.22)} />
        <path class="equipment__bowl" d={ring(block, w / 2, d / 2, 0.13)} />
        <polyline points={points([block.at(w / 2, d / 2), block.at(w * 0.9, d * 0.12)])} />
      </g>
    );
  }
  return (
    <g class="equipment">
      {[0.2, 0.4, 0.6, 0.8].map((k) => <polyline key={k} points={points([block.at(0.05, k * d), block.at(w - 0.05, k * d)])} />)}
    </g>
  );
}

function Station({ block, model, targeted, hovered, onOpen }: { block: Block; model: StationModel; targeted: boolean; hovered: boolean; onOpen: Props["onOpen"] }): JSX.Element {
  const { back, right, front, left } = block;
  const full = EXTRUSION_PX;
  const outline = (grow: number): string => {
    const cx = (back.x + front.x) / 2;
    const cy = (back.y + front.y) / 2;
    return points([back, right, front, left].map((p) => ({ x: cx + (p.x - cx) * grow, y: cy + (p.y - cy) * grow })));
  };
  const { cell } = block;
  return (
    <g class="station" role="button" tabindex={0} aria-label={`${model.name}, ${model.label}`}
      data-station-id={model.id} data-state={model.state} data-extrusion={String(model.extrusion)}
      data-drop-target={targeted ? "true" : undefined}
      data-hover={hovered ? "true" : undefined}
      style={`--h:${model.extrusion};--b:${model.bandPx}`}
      onClick={(e) => onOpen(model.id, e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(model.id, e.currentTarget);
        }
      }}>
      <rect class="station__hit" x={cell.x} y={cell.y} width={cell.width} height={cell.height} />
      <rect class="station__ring" x={cell.x + 1} y={cell.y + 1} width={cell.width - 2} height={cell.height - 2} />
      <polygon class="station__pad" points={outline(1.08)} />
      <polygon class="station__target" points={outline(1.16)} />
      <rect class="face face--left" width="1" height="1" style={`transform:${faceTransform(left, front, "0px", "var(--h)")}`} />
      <rect class="face face--right" width="1" height="1" style={`transform:${faceTransform(front, right, "0px", "var(--h)")}`} />
      <rect class="band" width="1" height="1" style={`transform:${faceTransform(left, front, "(var(--h) - var(--b)) * 1px", "var(--b)")}`} />
      <rect class="band" width="1" height="1" style={`transform:${faceTransform(front, right, "(var(--h) - var(--b)) * 1px", "var(--b)")}`} />
      <g class="hatch" aria-hidden="true">
        <polygon points={points([left, front, raise(front, full), raise(left, full)])} />
        <polygon points={points([front, right, raise(right, full), raise(front, full)])} />
        <polygon points={points([back, right, front, left].map((p) => raise(p, full)))} />
      </g>
      <g class="top">
        <polygon class="top__face" points={points([back, right, front, left])} />
        <Equipment block={block} kind={model.kind} />
        <polygon class="top__hatch" points={points([back, right, front, left])} />
      </g>
    </g>
  );
}

/** The tomato slab resting on (or lifting off) a block, built from that block's footprint. */
function Slab({ block, drop, height, home, onGone }: { block: Block; drop: SlabDrop; height: number; home: Props["slabHome"]; onGone: (serial: number) => void }): JSX.Element {
  const ref = useRef<SVGGElement>(null);
  const thick = 9;
  const shrink = (p: { x: number; y: number }): { x: number; y: number } => {
    const cx = (block.back.x + block.front.x) / 2;
    const cy = (block.back.y + block.front.y) / 2;
    return { x: cx + (p.x - cx) * 0.84, y: cy + (p.y - cy) * 0.84 - height };
  };
  const b = shrink(block.back);
  const r = shrink(block.right);
  const f = shrink(block.front);
  const l = shrink(block.left);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (drop.phase === "resting") {
      if (!reducedMotion()) el.animate([{ transform: "translateY(-120px)" }, { transform: "translateY(0)" }], { duration: MOTION.slow, easing: MOTION.easing });
      return;
    }
    if (reducedMotion()) {
      onGone(drop.serial);
      return;
    }
    const from = el.getBoundingClientRect();
    const to = home.current?.getBoundingClientRect();
    const away = drop.phase === "lifting" || !to
      ? "translateY(-120px)"
      : `translate(${to.x + to.width / 2 - from.x - from.width / 2}px, ${to.y + to.height / 2 - from.y - from.height / 2}px)`;
    const leaving = el.animate([{ transform: "translate(0, 0)", opacity: 1 }, { transform: away, opacity: 0 }],
      { duration: MOTION.mid, easing: MOTION.easing, fill: "forwards" });
    leaving.finished.then(() => onGone(drop.serial), () => onGone(drop.serial));
  }, [drop.phase, drop.serial]);
  return (
    <g class="slab-drop" ref={ref} aria-hidden="true">
      <polygon class="slab-drop__side" points={points([l, f, raise(f, thick), raise(l, thick)])} />
      <polygon class="slab-drop__side slab-drop__side--dark" points={points([f, r, raise(r, thick), raise(f, thick)])} />
      <polygon class="slab-drop__top" points={points([b, r, f, l].map((p) => raise(p, thick)))} />
    </g>
  );
}

export function FloorPlan({ stations, width, heightLimit, target, hover, slab, slabHome, onOpen, onSlabGone }: Props): JSX.Element {
  const plan: Plan = planFor(stations, width, heightLimit);
  const byId = new Map(plan.blocks.map((b) => [b.id, b]));
  const cooler = plan.cooler;
  const tile = Math.max(14, Math.round((plan.blocks[0]?.u ?? 40) * 0.36));
  return (
    <div class="floor" style={`height:${Math.round(plan.height)}px`} data-labels={plan.labelsBelow ? "below" : "right"}>
      <svg class="floor__svg" width={plan.width} height={plan.height} viewBox={`0 0 ${plan.width} ${plan.height}`} role="group" aria-label="Stations">
        <defs>
          <pattern id="floor-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" class="hatch-line" />
          </pattern>
          <pattern id="floor-tiles" patternUnits="userSpaceOnUse" width={tile * 2} height={tile}>
            <path d={`M0 ${tile / 2}L${tile} 0L${tile * 2} ${tile / 2}L${tile} ${tile}Z`} class="tile-line" />
          </pattern>
        </defs>
        <rect class="floor__ground" x="4" y="4" width={Math.max(0, plan.width - 8)} height={Math.max(0, plan.height - 8)} rx="2" />
        {cooler ? (
          <g class="cooler" aria-hidden="true">
            <rect class="cooler__wall" x={cooler.x} y={cooler.y} width={cooler.width} height={cooler.height} rx="3" />
            <g class="cooler__door">
              <line x1={cooler.x + cooler.width} x2={cooler.x + cooler.width} y1={cooler.y + cooler.height * 0.3} y2={cooler.y + cooler.height * 0.3 + 34} class="cooler__gap" />
              <path d={`M${cooler.x + cooler.width} ${cooler.y + cooler.height * 0.3}a34 34 0 0 1 -34 34`} />
            </g>
          </g>
        ) : null}
        {plan.blocks.map((block) => {
          const model = stations.find((s) => s.id === block.id);
          return model ? <Station key={block.id} block={block} model={model} targeted={target === block.id} hovered={hover === block.id} onOpen={onOpen} /> : null;
        })}
        {slab ? slab.stationIds.map((id) => {
          const block = byId.get(id);
          const model = stations.find((s) => s.id === id);
          return block && model ? <Slab key={`${slab.serial}-${id}`} block={block} drop={slab} height={model.extrusion} home={slabHome} onGone={onSlabGone} /> : null;
        }) : null}
      </svg>
      {cooler ? (
        <p class="cooler__tag" aria-hidden="true" style={`left:${cooler.x + 10}px;top:${cooler.y - 9}px`}>Walk-in cooler</p>
      ) : null}
      {plan.blocks.map((block) => {
        const model = stations.find((s) => s.id === block.id);
        if (!model) return null;
        return (
          <div key={block.id} class="station-label" aria-hidden="true" data-state={model.state}
            style={`left:${block.label.x}px;top:${block.label.y}px;width:${block.label.width}px`}>
            <span class="station-label__name">{model.name.replace(/ (\d)/g, "\u00a0$1")}</span>
            <span class="station-label__free"><span class="numeral" style={`--free:${model.freeMinutes}`} /><span class="numeral__unit">min</span></span>
            <span class="station-label__text">{model.label.replace(/(\d) /g, "$1\u00a0")}</span>
          </div>
        );
      })}
    </div>
  );
}
