// The hoof comparison stage: the axis wipe of the current after photo over the previous one, both visits' stored
// lines, the divider slider, the hoof picker and the angle readout (brief: Motion and effects, Axis wipe;
// Interactions, Divider; Visual design, Lines on the stage).
import { type CSSProperties, type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import type { Comparison, ComparisonSide, Hoof, MarkedLine } from "./api";
import { HOOF_NAMES, degrees } from "./format";
import { GLIDE_MS, QUARTER_MS, SETTLE, SPRING, tween, useReducedMotion } from "./motion";
import { Horseshoe } from "./ui";

const STEP_MS = QUARTER_MS;

const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

interface StageProps {
  comparison: Comparison | null;
  hoof: Hoof;
  /** Changes each time the person picks another hoof or visit pair: the divider glides to 50. */
  glideToken: number;
  loading: boolean;
}

export function ComparisonStage({ comparison, hoof, glideToken, loading }: StageProps) {
  // The divider moves by a CSS transition whose duration is set per move: a key step glides 240 ms, a new pick
  // glides 440 ms, the pointer follows with none; reduced motion removes every transition (styles.css).
  const reduced = useReducedMotion();
  const [divider, setDivider] = useState({ value: 50, ms: 0, ease: SETTLE });
  const value = divider.value;
  const frame = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const firstToken = useRef(glideToken);

  const moveTo = (target: number, ms: number): void => setDivider({ value: target, ms, ease: SETTLE });

  // A new hoof or visit pair glides the divider to the middle, springy, over 440 ms.
  useEffect(() => {
    if (glideToken !== firstToken.current) setDivider({ value: 50, ms: GLIDE_MS, ease: SPRING });
  }, [glideToken]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const steps: Record<string, (current: number) => number> = {
      ArrowLeft: (current) => current - 1,
      ArrowDown: (current) => current - 1,
      ArrowRight: (current) => current + 1,
      ArrowUp: (current) => current + 1,
      PageDown: (current) => current - 10,
      PageUp: (current) => current + 10,
      Home: () => 0,
      End: () => 100,
    };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    moveTo(clamp(step(value)), STEP_MS);
  }

  function fromPointer(event: PointerEvent<HTMLDivElement>): number {
    const box = frame.current?.getBoundingClientRect();
    if (!box || box.width === 0) return value;
    return clamp(((event.clientX - box.left) / box.width) * 100);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (!comparison || event.button > 0) return;
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    moveTo(fromPointer(event), 0);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>): void {
    if (dragging.current) moveTo(fromPointer(event), 0);
  }

  function endDrag(): void {
    dragging.current = false;
  }

  return (
    <>
      <section className="stage-region" role="region" aria-label="Hoof comparison">
        <div
          ref={frame}
          className="stage"
          style={{ "--divider": `${value}%`, "--divider-ms": `${reduced ? 0 : divider.ms}ms`, "--divider-ease": divider.ease } as CSSProperties}
          data-ready={comparison ? "true" : "false"}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {comparison ? (
            <>
              <img
                className="stage-photo"
                src={comparison.previous.photo.url}
                alt={`${HOOF_NAMES[hoof]} after photo, previous visit ${comparison.previous.business_date}`}
                draggable={false}
              />
              <div className="stage-current">
                <img
                  className="stage-photo"
                  src={comparison.current.photo.url}
                  alt={`${HOOF_NAMES[hoof]} after photo, current visit ${comparison.current.business_date}`}
                  draggable={false}
                />
              </div>
              <SideLines side={comparison.previous} kind="previous" />
              <SideLines side={comparison.current} kind="current" />
              <div className="divider-line" aria-hidden="true" />
              <div
                className="divider-handle"
                role="slider"
                tabIndex={0}
                aria-label="Comparison divider"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={value}
                aria-valuetext={`${value}% current`}
                aria-orientation="horizontal"
                onKeyDown={onKeyDown}
              >
                <span className="grip" aria-hidden="true" />
              </div>
              <span className="stage-tag stage-tag-current" aria-hidden="true">
                Current {comparison.current.business_date}
              </span>
              <span className="stage-tag stage-tag-previous" aria-hidden="true">
                Previous {comparison.previous.business_date}
              </span>
            </>
          ) : (
            <div className="stage-empty">
              <Horseshoe />
              <p>{loading ? "Loading the comparison…" : `${HOOF_NAMES[hoof]} needs two marked visits before it can be compared.`}</p>
            </div>
          )}
        </div>
      </section>
      {reduced && comparison ? (
        <div className="choices divider-positions" role="radiogroup" aria-label="Divider position">
          {(
            [
              ["Previous", 0],
              ["Split", 50],
              ["Current", 100],
            ] as const
          ).map(([name, at]) => (
            <label key={name} className="choice">
              <input type="radio" name="divider-position" checked={value === at} onChange={() => moveTo(at, 0)} />
              <span>{name}</span>
            </label>
          ))}
        </div>
      ) : null}
    </>
  );
}

/** One visit's stored lines in its own photo's pixel space, letterboxed like the photo (object-fit: contain). */
function SideLines({ side, kind }: { side: ComparisonSide; kind: "previous" | "current" }) {
  const { width, height } = side.photo;
  const dot = Math.max(width, height) / 220;
  const line = (marked: MarkedLine, name: string) => (
    <g key={name}>
      <line className="outline" x1={marked.x1} y1={marked.y1} x2={marked.x2} y2={marked.y2} />
      <line className="stroke" x1={marked.x1} y1={marked.y1} x2={marked.x2} y2={marked.y2} />
      <circle cx={marked.x1} cy={marked.y1} r={dot} />
      <circle cx={marked.x2} cy={marked.y2} r={dot} />
    </g>
  );
  return (
    <svg className={`stage-lines lines-${kind}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {line(side.hoof_wall, "wall")}
      {line(side.pastern, "pastern")}
    </svg>
  );
}

// ---- Hoof picker ----

/** The 2×2 hoof picker, fore hooves on top and left on the left, each with its thumbnail once one is ready. */
export function HoofPicker({
  hoof,
  onPick,
  name,
  thumbnails = {},
}: {
  hoof: Hoof;
  onPick: (hoof: Hoof) => void;
  name: string;
  thumbnails?: Partial<Record<Hoof, string>>;
}) {
  return (
    <div className="choices hoof-picker" role="radiogroup" aria-label="Hoof">
      {(["LF", "RF", "LH", "RH"] as const).map((code) => (
        <label key={code} className="choice hoof-choice">
          <input type="radio" name={name} value={code} checked={hoof === code} onChange={() => onPick(code)} />
          {thumbnails[code] ? (
            <img className="hoof-thumb" src={thumbnails[code]} alt="" width={48} height={36} loading="lazy" />
          ) : (
            <span className="hoof-thumb hoof-thumb-empty" aria-hidden="true" />
          )}
          <span>{HOOF_NAMES[code]}</span>
        </label>
      ))}
    </div>
  );
}

// ---- Readout ----

/** `<label> <previous> → <current>` with an optional ` (<difference>)`, as the server prints each readout line. */
const READOUT_LINE = /^(.+?) (\S+) \u2192 (\S+)(?: \((\S+)\))?$/;

/** An in-between difference while the numbers count; the landed value is always the server's stored text. */
const inBetweenDifference = (value: number): string =>
  `${value > 0.05 ? "+" : value < -0.05 ? "\u2212" : "±"}${Math.abs(value).toFixed(1)}°`;

const numbersOf = (comparison: Comparison): number[] => [
  comparison.previous.hoof_wall.angle,
  comparison.current.hoof_wall.angle,
  comparison.difference.hoof_wall,
  comparison.previous.pastern.angle,
  comparison.current.pastern.angle,
  comparison.difference.pastern,
];

/**
 * The three readout lines. The status text is the final text from the start; while numbers count, each one shows
 * its in-between value through a generated overlay that is not part of the text.
 */
export function Readout({ comparison }: { comparison: Comparison | null }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState<number[] | null>(null);
  const last = useRef<number[] | null>(null);
  useEffect(() => {
    if (!comparison) return;
    const target = numbersOf(comparison);
    const from = last.current;
    last.current = target;
    if (reduced || !from || from.every((value, index) => value === target[index])) {
      setShown(null);
      return;
    }
    const stop = tween(from, target, GLIDE_MS, setShown, () => setShown(null));
    return stop;
  }, [comparison, reduced]);

  if (!comparison) {
    return (
      <div className="readout" role="status" aria-label="Angle readout">
        <p className="readout-empty">No angles to compare on this hoof yet.</p>
      </div>
    );
  }
  const counting = (index: number, text: (value: number) => string): string | undefined =>
    shown ? text(shown[index] ?? 0) : undefined;
  return (
    <div className="readout" role="status" aria-label="Angle readout">
      {comparison.readout.map((line, index) => {
        // The server's stored line, split only to colour the previous and current sides; its text is unchanged.
        const parts = READOUT_LINE.exec(line);
        if (!parts) return <p key={line} className="readout-line">{line}</p>;
        const [, label, previous, current, difference] = parts;
        const base = index * 3;
        const numeric = index < 2;
        return (
          <p key={line} className="readout-line">
            <span className="readout-label">{label}</span>{" "}
            <span className="n n-previous" data-show={numeric ? counting(base, degrees) : undefined}>
              {previous}
            </span>
            {" → "}
            <span className="n n-current" data-show={numeric ? counting(base + 1, degrees) : undefined}>
              {current}
            </span>
            {difference ? (
              <>
                {" ("}
                <span className="n n-diff" data-show={counting(base + 2, inBetweenDifference)}>
                  {difference}
                </span>
                {")"}
              </>
            ) : null}
          </p>
        );
      })}
      <p className="readout-key" aria-hidden="true">
        <span className="key-previous">Previous {comparison.previous.business_date}</span>
        <span className="key-current">Current {comparison.current.business_date}</span>
      </p>
    </div>
  );
}
