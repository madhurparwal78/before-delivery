// The kitchen floor plan inside the ring: five station tiles, the walk-in and the centre readout.
import { useLayoutEffect, useRef } from "preact/hooks";
import type { DialStation } from "../../shared/api";
import type { StationKind } from "../../shared/kitchen";
import { STATE_WORDS, countdown, isFullBlock, stateName, stationStateAt, type StationState } from "./model";

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

/** Tile boxes in plan percent, in station order: two hot lines on the hood wall, the bake deck,
 * then the two cold-prep benches by the door. */
const LAYOUT = [
  { x: 4, y: 4, w: 44, h: 27 },
  { x: 52, y: 4, w: 44, h: 27 },
  { x: 4, y: 36.5, w: 29, h: 27 },
  { x: 4, y: 69, w: 44, h: 27 },
  { x: 52, y: 69, w: 44, h: 27 },
];

interface FloorPlanProps {
  stations: DialStation[];
  minute: number;
  selected: string | null;
  onSelect: (stationId: string) => void;
  reduced: boolean;
  now: number;
  readoutTime: string;
  readoutOpen: number;
  readoutTotal: number;
  direction: number;
}

export function FloorPlan(props: FloorPlanProps) {
  const { stations, minute, selected, onSelect, reduced, now } = props;
  return (
    <div class="plan" role="group" aria-label="Floor plan">
      <PlanDrawing />
      <span class="walkin-label" aria-hidden="true">
        <span class="walkin-plate">
          Walk-in<span class="walkin-use"> · storage</span>
        </span>
      </span>
      {stations.map((station, index) => (
        <Tile
          key={station.id}
          index={index}
          station={station}
          state={stationStateAt(station, minute)}
          selected={selected === station.id}
          onSelect={onSelect}
          reduced={reduced}
          now={now}
        />
      ))}
      <div class="readout" aria-hidden="true">
        <RollText class="readout-time mono" text={props.readoutTime} direction={props.direction} reduced={reduced} />
        <span class="readout-open">
          <RollText class="mono" text={String(props.readoutOpen)} direction={props.direction} reduced={reduced} /> of{" "}
          <span class="mono">{props.readoutTotal}</span> open
        </span>
      </div>
    </div>
  );
}

interface TileProps {
  index: number;
  station: DialStation;
  state: StationState;
  selected: boolean;
  onSelect: (stationId: string) => void;
  reduced: boolean;
  now: number;
}

function Tile({ index, station, state, selected, onSelect, reduced, now }: TileProps) {
  const face = useRef<HTMLSpanElement>(null);
  const ghosts = useRef<HTMLSpanElement>(null);
  const previous = useRef<{ kind: string; clone: Node | null }>({ kind: state.kind, clone: null });
  const box = LAYOUT[index] ?? LAYOUT[LAYOUT.length - 1];

  useLayoutEffect(() => {
    const host = ghosts.current;
    const current = face.current;
    if (!host || !current) return;
    if (previous.current.kind !== state.kind && !reduced && previous.current.clone) {
      for (const old of [...host.children]) old.remove();
      for (const running of current.getAnimations()) running.cancel();
      const ghost = previous.current.clone as HTMLElement;
      host.append(ghost);
      current.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 330, delay: 50, easing: EASE, fill: "backwards" });
      ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 330, delay: 50, easing: EASE, fill: "forwards" }).onfinish = () =>
        ghost.remove();
    } else if (previous.current.kind !== state.kind) {
      for (const old of [...host.children]) old.remove();
    }
    previous.current = { kind: state.kind, clone: current.cloneNode(true) };
  });

  const label = STATE_WORDS[state.kind];
  const timer =
    state.kind === "held" && isFullBlock(state.block) && state.block.expires_at
      ? countdown(Date.parse(state.block.expires_at) - now)
      : null;

  return (
    <button
      type="button"
      class={`tile tile-${state.kind}${selected ? " tile-selected" : ""}`}
      style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%` }}
      aria-pressed={selected ? "true" : "false"}
      aria-label={`${station.name}, ${stateName(state)}`}
      onClick={() => onSelect(station.id)}
    >
      <span ref={face} class={`face face-${state.kind}`}>
        <EquipmentGlyph kind={station.kind} />
        <span class="tile-plate">
          <span class="tile-head">
            <span class="tile-num mono">{String(index + 1).padStart(2, "0")}</span>
            <span class="tile-name">{station.name}</span>
          </span>
          <span class="tile-label">
            {label}
            {timer && <span class="mono"> {timer}</span>}
          </span>
        </span>
      </span>
      <span ref={ghosts} class="ghosts" />
    </button>
  );
}

interface RollTextProps {
  text: string;
  direction: number;
  reduced: boolean;
  class: string;
}

/** Characters that changed slide out and the new ones slide in (up when turning later). */
function RollText({ text, direction, reduced, class: className }: RollTextProps) {
  const root = useRef<HTMLSpanElement>(null);
  const before = useRef(text);

  useLayoutEffect(() => {
    const previous = before.current;
    before.current = text;
    const host = root.current;
    if (!host || previous === text || reduced) return;
    const cells = [...host.querySelectorAll<HTMLSpanElement>(".roll-cell")];
    const shift = direction >= 0 ? 100 : -100;
    cells.forEach((cell, i) => {
      const old = previous[i];
      if (old === text[i]) return;
      for (const ghost of [...cell.querySelectorAll(".roll-ghost")]) ghost.remove();
      const glyph = cell.querySelector<HTMLSpanElement>(".roll-glyph");
      if (!glyph) return;
      for (const running of glyph.getAnimations()) running.cancel();
      glyph.animate(
        [
          { transform: `translateY(${shift}%)`, opacity: 0 },
          { transform: "translateY(0)", opacity: 1 },
        ],
        { duration: 200, delay: 100, easing: EASE, fill: "backwards" },
      );
      if (old === undefined) return;
      const ghost = document.createElement("span");
      ghost.className = "roll-ghost";
      ghost.textContent = old;
      cell.append(ghost);
      ghost.animate(
        [
          { transform: "translateY(0)", opacity: 1 },
          { transform: `translateY(${-shift}%)`, opacity: 0 },
        ],
        { duration: 200, delay: 100, easing: EASE, fill: "forwards" },
      ).onfinish = () => ghost.remove();
    });
  }, [text, direction, reduced]);

  return (
    <span ref={root} class={`roll ${className}`}>
      {[...text].map((char, i) => (
        <span key={i} class="roll-cell">
          <span class="roll-glyph">{char}</span>
        </span>
      ))}
    </span>
  );
}

/** The station's equipment in hairline strokes over its state pattern: a range under its hood,
 * a deck oven with its rack, or a bench with a sink and a cutting board. */
function EquipmentGlyph({ kind }: { kind: StationKind }) {
  return (
    <svg class="glyph" viewBox="0 0 80 44" preserveAspectRatio="xMaxYMin meet" aria-hidden="true">
      {kind === "hot_line" && (
        <>
          <path d="M 2 1 H 78 L 74 9 H 6 Z" />
          <rect x="6" y="14" width="68" height="29" />
          {[17, 32, 47, 62].map((cx) => (
            <g key={cx}>
              <circle cx={cx} cy="26" r="6" />
              <circle cx={cx} cy="26" r="2" />
            </g>
          ))}
          <line x1="8" y1="37" x2="72" y2="37" />
        </>
      )}
      {kind === "bake_deck" && (
        <>
          <rect x="22" y="1" width="56" height="42" />
          <rect x="27" y="5" width="46" height="13" />
          <rect x="27" y="22" width="46" height="13" />
          <line x1="36" y1="9" x2="64" y2="9" />
          <line x1="36" y1="26" x2="64" y2="26" />
          <line x1="25" y1="39" x2="75" y2="39" />
        </>
      )}
      {kind === "cold_prep" && (
        <>
          <rect x="2" y="8" width="76" height="30" />
          <line x1="2" y1="33" x2="78" y2="33" />
          <rect x="8" y="12" width="22" height="17" rx="2" />
          <circle cx="19" cy="20.5" r="2" />
          <rect x="40" y="13" width="32" height="15" rx="1" />
          <circle cx="67" cy="20.5" r="1.5" />
        </>
      )}
    </svg>
  );
}

/** Walls, hood, aisle, the walk-in with its shelving and doors, drawn in plan percent. */
function PlanDrawing() {
  return (
    <svg class="plan-drawing" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <rect class="floor" x="1" y="1" width="98" height="98" />
      <line class="hood" x1="4" y1="2.4" x2="96" y2="2.4" />
      <line class="aisle" x1="2" y1="33.5" x2="98" y2="33.5" />
      <line class="aisle" x1="2" y1="66.5" x2="98" y2="66.5" />
      <rect class="walkin-fill" x="67" y="36.5" width="29" height="27" />
      {[41, 45.5, 50, 54.5, 59].map((y) => (
        <line key={y} class="shelf" x1="69" y1={y} x2="94" y2={y} />
      ))}
      <path class="walkin-wall" d="M 87 36.5 H 67 V 63.5 H 96 V 36.5 H 93" />
      <path class="door" d="M 93 31 A 6 6 0 0 0 87 36.5" />
      <line class="door-leaf" x1="93" y1="36.5" x2="93" y2="31" />
      <path class="wall" d="M 42 99 H 1 V 1 H 99 V 99 H 58" />
      <path class="door" d="M 42 99 A 8 8 0 0 1 50 91" />
    </svg>
  );
}
