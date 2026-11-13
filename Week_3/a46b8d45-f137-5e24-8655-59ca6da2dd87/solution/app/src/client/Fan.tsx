import { useId, useState } from "preact/hooks";
import { ownerText, partLine } from "../shared/copy";
import type { Axis, Lang, PartStatus } from "../shared/types";
import { useReducedMotion, useWide } from "./hooks";
import { Outline } from "./Outline";

interface FanPart {
  booklet_number: number;
  part_number: string;
  name: string;
  status: PartStatus;
  longest_side_mm: number;
}

interface FanModel {
  slug: string;
  axis: Axis | null;
  parts: FanPart[];
}

interface FanProps {
  model: FanModel;
  lang: Lang;
  selected: number | null;
  /** Omitted where the owner cannot change the selection (the share page). */
  onSelect?: (booklet: number) => void;
  /** Start fully separated because a part is already selected. */
  startOpen: boolean;
}

const KEY_STEPS: Record<string, number> = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, PageUp: 25, PageDown: -25 };

/** All rounding in the fan is half up on the exact decimal value; value is a whole number 0 to 100. */
const halfUp = (numerator: number, denominator: number): number => Math.floor((2 * numerator + denominator) / (2 * denominator));

const offsetOf = (value: number, k: number, gap: number): number => halfUp(value * k * gap, 100);

/** 1 − 0.25 × s as exactly three decimals, rounded half up on the exact decimal value. */
function scaleText(value: number): string {
  const thousandths = halfUp((400 - value) * 5, 2);
  return `${Math.floor(thousandths / 1000)}.${String(thousandths % 1000).padStart(3, "0")}`;
}

function axisVector(axis: Axis, distance: number): [number, number] {
  if (axis === "x") return [distance, 0];
  if (axis === "y") return [0, distance];
  return [distance * Math.cos(Math.PI / 6), -distance * Math.sin(Math.PI / 6)];
}

/** The fitting fan: parts stacked end-on at 0, fanning out along the model's axis as the slider rises. */
export function Fan({ model, lang, selected, onSelect, startOpen }: FanProps) {
  const reduced = useReducedMotion();
  const wide = useWide();
  const sliderId = useId();
  const [value, setValue] = useState(reduced || startOpen ? 100 : 0);
  const { axis, parts } = model;
  const gap = wide ? 48 : 28;
  const active = parts.filter((part) => part.status === "active");

  const choose = (part: FanPart): void => {
    if (onSelect && part.status === "active") onSelect(part.booklet_number);
  };

  /** ] selects the next active part and [ the previous one; at either end nothing happens. */
  const stepSelection = (event: KeyboardEvent): void => {
    if (!onSelect || (event.key !== "]" && event.key !== "[")) return;
    const at = active.findIndex((part) => part.booklet_number === selected);
    const target = event.key === "]" ? (at === -1 ? active[0] : active[at + 1]) : at === -1 ? active[active.length - 1] : active[at - 1];
    if (target) onSelect(target.booklet_number);
  };

  const label = (key: "fanRegion" | "fanSlider" | "fanUnavailable" | "fanList"): string => ownerText(key, lang);
  const activePart = selected === null ? "none" : String(selected);

  if (axis === null) {
    return (
      <section class="fan fan-list-body" role="region" aria-label={label("fanRegion")} data-active-part={activePart} onKeyDown={stepSelection}>
        <h2>{label("fanUnavailable")}</h2>
        <ol class="fan-list" role="list" aria-label={label("fanList")} data-active-part={activePart}>
          {parts.map((part) => (
            <li key={part.booklet_number}>
              <button
                type="button"
                aria-label={partLine(part.booklet_number, part.name, lang)}
                aria-pressed={selected === part.booklet_number}
                aria-disabled={part.status === "withdrawn" ? "true" : undefined}
                onClick={() => choose(part)}
              >
                <span class="part-no">{part.booklet_number}</span>
                <span>{part.name}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  const scale = Number(scaleText(value));
  const last = axisVector(axis, offsetOf(value, parts.length - 1, gap));

  return (
    <section
      class={`fan${onSelect ? "" : " fan-readonly"}`}
      role="region"
      aria-label={label("fanRegion")}
      data-fan-separation={offsetOf(value, parts.length - 1, gap)}
      data-fan-scale={scaleText(value)}
      data-fan-axis={axis}
      data-active-part={activePart}
      onKeyDown={stepSelection}
    >
      <div class="fan-toolbar">
        <label for={sliderId}>{label("fanSlider")}</label>
        <input
          id={sliderId}
          class="fan-slider"
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          onInput={(event) => setValue(Number((event.currentTarget as HTMLInputElement).value))}
          onKeyDown={(event) => {
            const step = KEY_STEPS[event.key];
            if (step !== undefined) setValue(Math.min(100, Math.max(0, value + step)));
            else if (event.key === "Home") setValue(0);
            else if (event.key === "End") setValue(100);
            else return;
            event.preventDefault();
          }}
        />
      </div>
      <div class="fan-stage">
        <div class="fan-group" style={{ transform: `translate(${(-scale * last[0]) / 2}px, ${(-scale * last[1]) / 2}px) scale(${scale})` }}>
          {parts.map((part, k) => {
            const offset = offsetOf(value, k, gap);
            const [dx, dy] = axisVector(axis, offset);
            return (
              <button
                key={part.booklet_number}
                type="button"
                class="fan-part"
                aria-label={partLine(part.booklet_number, part.name, lang)}
                aria-pressed={selected === part.booklet_number}
                aria-disabled={part.status === "withdrawn" ? "true" : undefined}
                data-part-offset={offset}
                style={{ transform: `translate(${dx}px, ${dy}px)` }}
                onClick={() => choose(part)}
              >
                <Outline name={part.name} longestSideMm={part.longest_side_mm} bookletNumber={part.booklet_number} index={k} />
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** The drawing that stands in for the fan before a model is chosen: stacked part outlines on the grid. */
export function FanPlaceholder({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <div class={`fan fan-empty${compact ? " fan-plate" : ""}`}>
      <div>
        <svg width="160" height="96" viewBox="0 0 160 96" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <rect x="24" y="52" width="72" height="26" rx="1" />
          <rect x="40" y="38" width="72" height="26" rx="1" />
          <rect x="56" y="24" width="72" height="26" rx="1" />
          <path d="M128 24 L146 10" stroke-width="1" />
        </svg>
        {text ? <p>{text}</p> : null}
      </div>
    </div>
  );
}
