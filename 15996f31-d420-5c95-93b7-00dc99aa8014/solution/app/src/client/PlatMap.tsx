// The plat map (brief: Screens and layout; Visual design → Tier patterns). Blocks keep their listed order and tile
// across up to three rows like parcels; each parcel grows with its acres, so its area follows its acreage.

import { useLayoutEffect, useRef, useState } from "react";
import { NOT_INSPECTED, tierLabel, type Tier } from "../shared/api.js";
import { frames } from "../shared/format.js";
import { Odometer } from "./Odometer.js";
import type { ShownBlock } from "./strength.js";

type Fill = Tier | "uninspected";

const FILLS: Fill[] = ["none", "reduced", "standard", "bonus", "uninspected"];

/** The four tier patterns, defined once for the whole page; each pairs the amber accent with a distinct texture. */
export function PatternDefs() {
  return (
    <svg className="pattern-defs" aria-hidden="true" focusable="false" width="0" height="0">
      <defs>
        <pattern id="tier-none" width="6" height="6" patternUnits="userSpaceOnUse">
          <path d="M0 0L6 6M6 0L0 6" stroke="var(--ink)" strokeWidth="0.9" />
        </pattern>
        <pattern id="tier-reduced" width="14" height="14" patternUnits="userSpaceOnUse">
          <rect width="14" height="14" fill="var(--amber-wash)" />
          <circle cx="7" cy="7" r="2" fill="var(--amber)" />
        </pattern>
        <pattern id="tier-standard" width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill="var(--amber-wash)" />
          <path d="M-2 2L2 -2M0 8L8 0M6 10L10 6" stroke="var(--amber)" strokeWidth="1" />
        </pattern>
        <pattern id="tier-bonus" width="12" height="20.78" patternUnits="userSpaceOnUse">
          <rect width="12" height="20.78" fill="var(--amber-wash)" />
          <path d="M3 0L9 0L12 5.2L9 10.39L3 10.39L0 5.2ZM9 10.39L12 15.59L9 20.78M3 10.39L0 15.59L3 20.78" fill="none" stroke="var(--amber)" strokeWidth="1" />
        </pattern>
      </defs>
    </svg>
  );
}

function fillOf(tier: Tier | null): Fill {
  return tier ?? "uninspected";
}

export function Swatch({ fill }: { fill: Fill }) {
  return (
    <svg className={`swatch swatch-${fill}`} viewBox="0 0 28 20" aria-hidden="true" focusable="false">
      <rect x="0.5" y="0.5" width="27" height="19" fill={fill === "uninspected" ? "var(--paper)" : `url(#tier-${fill})`} />
    </svg>
  );
}

const LEGEND: Record<Fill, string> = {
  none: "Too weak to earn pay",
  reduced: "Earns the reduced rate",
  standard: "Earns the standard rate",
  bonus: "Earns the bonus rate",
  uninspected: "No samples yet",
};

export function Legend() {
  return (
    <ul className="legend" aria-label="Tier legend">
      {FILLS.map((fill) => (
        <li key={fill}>
          <Swatch fill={fill} />
          <span className="legend-label">{fill === "uninspected" ? NOT_INSPECTED : tierLabel(fill)}</span>
          <span className="legend-note">{LEGEND[fill]}</span>
        </li>
      ))}
    </ul>
  );
}

/** Two stacked pattern layers so a tier change cross-fades over 300 ms. */
function TierFill({ tier, reduced }: { tier: Tier | null; reduced: boolean }) {
  const [layers, setLayers] = useState<{ fill: Fill; key: number }[]>([{ fill: fillOf(tier), key: 0 }]);
  const incoming = useRef<SVGSVGElement>(null);
  const outgoing = useRef<SVGSVGElement>(null);

  useLayoutEffect(() => {
    const fill = fillOf(tier);
    setLayers((last) => {
      const top = last[last.length - 1];
      if (top.fill === fill) return last;
      return reduced ? [{ fill, key: top.key + 1 }] : [top, { fill, key: top.key + 1 }];
    });
  }, [tier, reduced]);

  useLayoutEffect(() => {
    if (layers.length < 2) return;
    const timing = { duration: 300, easing: "ease-in-out", fill: "forwards" as const };
    incoming.current?.animate([{ opacity: 0 }, { opacity: 1 }], timing);
    const fading = outgoing.current?.animate([{ opacity: 1 }, { opacity: 0 }], timing);
    const done = () => setLayers((last) => last.slice(-1));
    if (fading) fading.onfinish = done;
    else done();
  }, [layers]);

  return (
    <>
      {layers.map((layer, index) => (
        <svg
          key={layer.key}
          ref={layers.length > 1 ? (index === 0 ? outgoing : incoming) : undefined}
          className="parcel-fill"
          aria-hidden="true"
          focusable="false"
          preserveAspectRatio="none"
        >
          {layer.fill === "uninspected" ? null : <rect width="100%" height="100%" fill={`url(#tier-${layer.fill})`} />}
        </svg>
      ))}
    </>
  );
}

interface MapBlock {
  id: string;
  name: string;
  acres: number;
}

function rowsOf<T>(items: T[]): T[][] {
  const count = items.length <= 2 ? 1 : items.length <= 6 ? 2 : 3;
  const rows: T[][] = [];
  let start = 0;
  for (let row = 0; row < count; row += 1) {
    const size = Math.ceil((items.length - start) / (count - row));
    rows.push(items.slice(start, start + size));
    start += size;
  }
  return rows.filter((row) => row.length > 0);
}

const TICKS = Array.from({ length: 15 }, (_, index) => `${((index + 1) * 100) / 16}%`);

/** Survey ticks along the inner rule: sixteen divisions on every side. */
function Ticks() {
  return (
    <>
      {(["top", "bottom", "left", "right"] as const).map((side) => (
        <svg key={side} className={`plat-ticks plat-ticks-${side}`} aria-hidden="true" focusable="false">
          {TICKS.map((at) =>
            side === "top" || side === "bottom" ? <line key={at} x1={at} x2={at} y1="0" y2="100%" /> : <line key={at} x1="0" x2="100%" y1={at} y2={at} />,
          )}
        </svg>
      ))}
    </>
  );
}

function NorthArrow() {
  return (
    <svg className="north" viewBox="0 0 24 32" aria-hidden="true" focusable="false">
      <path d="M12 2L18 22L12 18L6 22Z" fill="none" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
      <path d="M12 2L12 18L6 22Z" fill="currentColor" />
      <text x="12" y="31" textAnchor="middle">
        N
      </text>
    </svg>
  );
}

/** A survey scale bar: hairline with end ticks and alternating ink and paper segments. */
function ScaleBar() {
  return (
    <svg className="scale-bar" viewBox="0 0 96 22" aria-hidden="true" focusable="false">
      {[0, 1, 2, 3].map((segment) => (
        <rect key={segment} x={4 + segment * 22} y="4" width="22" height="4" fill={segment % 2 === 0 ? "currentColor" : "var(--paper)"} stroke="currentColor" strokeWidth="0.75" />
      ))}
      <path d="M4 2V10M92 2V10" stroke="currentColor" strokeWidth="0.75" />
      <text x="4" y="19">
        0
      </text>
      <text x="92" y="19" textAnchor="end">
        10 ac
      </text>
    </svg>
  );
}

function acreage(blocks: MapBlock[]): string {
  const total = blocks.reduce((sum, block) => sum + block.acres, 0);
  return `Parcels drawn to acreage · ${Number.isInteger(total) ? total : total.toFixed(1)} ac`;
}

/** Holds the plat map's exact box while its order loads: the same rows and foot, nothing drawn in them. */
export function PlatPlaceholder({ blocks }: { blocks: MapBlock[] }) {
  return (
    <div className="plat" aria-hidden="true">
      <div className="plat-frame">
        <div className="plat-map is-placeholder">
          {rowsOf(blocks).map((row, rowIndex) => (
            <div className="plat-row" key={rowIndex} style={{ flexGrow: row.reduce((sum, block) => sum + block.acres, 0) }} />
          ))}
        </div>
        <div className="plat-foot">
          <NorthArrow />
          <ScaleBar />
          <span className="scale-note">{blocks.length > 0 ? acreage(blocks) : " "}</span>
        </div>
      </div>
    </div>
  );
}

/** The orchard's parcels in outline before any order exists: drawn, not interactive. */
export function PlatOutline({ blocks, note }: { blocks: MapBlock[]; note: string }) {
  return (
    <div className="plat plat-outline" aria-hidden="true">
      <div className="plat-frame">
        <div className="plat-map">
          <Ticks />
          {rowsOf(blocks).map((row, rowIndex) => (
            <div className="plat-row" key={rowIndex} style={{ flexGrow: row.reduce((sum, block) => sum + block.acres, 0) }}>
              <span className="plat-section">{rowIndex + 1}</span>
              {row.map((block) => (
                <div key={block.id} className="parcel is-outline" style={{ flexGrow: block.acres }}>
                  <div className="plate">
                    <span className="plate-name">{block.name}</span>
                    <span className="plate-acres">{block.acres} ac</span>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="plat-foot">
          <span className="plat-outline-note">{note}</span>
          <NorthArrow />
          <ScaleBar />
          <span className="scale-note">{acreage(blocks)}</span>
        </div>
      </div>
    </div>
  );
}

function blockName(block: MapBlock, shown: ShownBlock | undefined): string {
  const settled = shown?.settled;
  return settled && settled.average !== null ? `${block.name}, ${tierLabel(settled.tier)}, ${frames(settled.average)} frames` : `${block.name}, ${NOT_INSPECTED}`;
}

interface PlatMapProps {
  orchardName: string;
  blocks: MapBlock[];
  shown: Record<string, ShownBlock>;
  selectedId: string | null;
  onSelect?: (blockId: string) => void;
  compact?: boolean;
  reduced: boolean;
  id?: string;
}

export function PlatMap({ orchardName, blocks, shown, selectedId, onSelect, compact = false, reduced, id }: PlatMapProps) {
  const rows = rowsOf(blocks);
  return (
    <div className={`plat${compact ? " plat-compact" : ""}`}>
      <div className="plat-frame">
        <div className="plat-map" role="group" aria-label={`Plat map, ${orchardName}`} tabIndex={-1} id={id}>
          <Ticks />
          {rows.map((row, rowIndex) => (
            <div className="plat-row" key={rowIndex} style={{ flexGrow: row.reduce((sum, block) => sum + block.acres, 0) }}>
              <span className="plat-section" aria-hidden="true">
                {rowIndex + 1}
              </span>
              {row.map((block) => {
                const state = shown[block.id];
                const settled = state?.settled ?? { average: null, tier: null };
                const meter = state?.meter ?? { average: null, tier: null };
                const selected = block.id === selectedId;
                return (
                  <div
                    key={block.id}
                    className={`parcel${selected ? " is-selected" : ""}${settled.average === null ? " is-uninspected" : ""}`}
                    style={{ flexGrow: block.acres }}
                  >
                    <button
                      type="button"
                      className="parcel-hit"
                      aria-label={blockName(block, state)}
                      aria-pressed={selected}
                      onClick={() => onSelect?.(block.id)}
                    >
                      <TierFill tier={settled.average === null ? null : settled.tier} reduced={reduced} />
                      <span className="sr-only">
                        {block.name} {settled.average === null ? NOT_INSPECTED : tierLabel(settled.tier)}
                      </span>
                    </button>
                    <div className="plate">
                      <span className="plate-name" aria-hidden="true">
                        {block.name}
                      </span>
                      <div
                        className="plate-readout"
                        role="meter"
                        aria-label={`Average frames, ${block.name}`}
                        aria-valuemin={0}
                        aria-valuemax={20}
                        aria-valuenow={meter.average === null ? 0 : meter.average / 10}
                        aria-valuetext={meter.average === null ? NOT_INSPECTED : `${frames(meter.average)} frames, ${tierLabel(meter.tier)}`}
                      >
                        <Odometer kind="frames" value={state?.readout ?? null} dim={state?.dim} budget={state?.rollBudget} reduced={reduced} />
                      </div>
                      <span className={`chip chip-${fillOf(settled.average === null ? null : settled.tier)}`} aria-hidden="true">
                        {settled.average === null ? NOT_INSPECTED : tierLabel(settled.tier)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="plat-foot" aria-hidden="true">
          <NorthArrow />
          <ScaleBar />
          <span className="scale-note">{acreage(blocks)}</span>
        </div>
      </div>
    </div>
  );
}
