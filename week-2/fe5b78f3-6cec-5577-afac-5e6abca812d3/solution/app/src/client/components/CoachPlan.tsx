// The sleeper coach plan (brief: Coach plan, Coach plan by keyboard): one procedural SVG per coach, nine bays of eight
// berths, drawn like a builder's drawing. The plan is one Tab stop; arrows move bay by bay, PageUp/PageDown change coach.
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import type { BerthPool, BerthState, BerthType, CoachBerth } from "../../shared/api";
import { POSITION_WORD } from "../../shared/format";

const QUOTA_LABEL: Record<BerthPool, string> = { GN: "General", TQ: "Tatkal", LD: "Ladies", SS: "Senior", RAC: "RAC" };
const STATE_TAG: Record<BerthState, string> = {
  free: "free",
  taken: "taken",
  rac_free: "two RAC places free",
  rac_one_free: "one RAC place free",
  rac_full: "RAC full",
};
const HELD_PLACES: Record<BerthState, number> = { free: 0, taken: 1, rac_free: 0, rac_one_free: 1, rac_full: 2 };

interface BerthMark {
  /** This traveller's passenger is confirmed on the berth. */
  ownCnf?: boolean;
  /** How many of this traveller's passengers hold an RAC place on it. */
  ownRac?: number;
  /** Tags appended to the berth's name, in order (preferences or this booking's passengers). */
  tags?: string[];
  /** Passenger numbers whose preference this berth set. */
  preferredBy?: number[];
}

interface CoachData {
  coach: string;
  berths: CoachBerth[];
}

interface Props {
  coaches: CoachData[];
  vertical: boolean;
  selected: string;
  onSelect(coach: string): void;
  mark?(coach: string, berth: number): BerthMark;
  onActivate?(coach: string, berth: number, type: BerthType): void;
  /** A berth to scroll into the frame when the plan first shows it (this traveller's own). */
  reveal?: { coach: string; berth: number };
}

const CELL = 48;
const STEP = 52;
const BAY_GAP = 14;
const MARGIN = 16;
const HEAD = 40;

/** Where each berth of a bay sits: [column, row] in the bay's own grid. */
function slot(berth: number, vertical: boolean): { x: number; y: number; w: number; h: number } {
  const index = (berth - 1) % 8;
  const bay = Math.ceil(berth / 8) - 1;
  const stack = index < 3 ? 0 : index < 6 ? 1 : 2;
  const level = index < 6 ? index % 3 : index - 6;
  if (!vertical) {
    const x0 = MARGIN + bay * (2 * STEP - 4 + BAY_GAP);
    const top = MARGIN + HEAD;
    if (stack < 2) return { x: x0 + stack * STEP, y: top + (2 - level) * STEP, w: CELL, h: CELL };
    return { x: x0 + level * STEP, y: top + 3 * STEP + 18, w: CELL, h: CELL };
  }
  const left = MARGIN + 28;
  const y0 = MARGIN + HEAD + bay * (2 * STEP - 4 + BAY_GAP);
  if (stack < 2) return { x: left + level * STEP, y: y0 + stack * STEP, w: CELL, h: CELL };
  return { x: left + 3 * STEP + 18, y: y0 + level * STEP, w: CELL, h: CELL };
}

function size(vertical: boolean): { width: number; height: number } {
  const span = 9 * (2 * STEP - 4) + 8 * BAY_GAP;
  return vertical
    ? { width: MARGIN * 2 + 28 + 3 * STEP + 18 + CELL, height: MARGIN * 2 + HEAD + span }
    : { width: MARGIN * 2 + span, height: MARGIN * 2 + HEAD + 3 * STEP + 18 + CELL };
}

function berthName(coach: string, b: CoachBerth, tags: string[] = []): string {
  return [`Berth ${coach} ${b.berth} ${POSITION_WORD[b.type]}`, QUOTA_LABEL[b.quota], STATE_TAG[b.state], ...tags].join(", ");
}

function nextBerth(key: string, berth: number, vertical: boolean): number | undefined {
  const index = (berth - 1) % 8;
  const bay = Math.ceil(berth / 8);
  const sameIndexBay = (target: number): number => (target - 1) * 8 + index + 1;
  const along = { back: index > 0 ? berth - 1 : berth, forward: index < 7 ? berth + 1 : berth };
  const across = { back: bay > 1 ? berth - 8 : berth, forward: bay < 9 ? berth + 8 : berth };
  const [horizontalKeys, verticalKeys] = vertical ? [along, across] : [across, along];
  switch (key) {
    case "ArrowLeft":
      return horizontalKeys.back;
    case "ArrowRight":
      return horizontalKeys.forward;
    case "ArrowUp":
      return verticalKeys.back;
    case "ArrowDown":
      return verticalKeys.forward;
    case "Home":
      return sameIndexBay(1);
    case "End":
      return sameIndexBay(9);
    default:
      return undefined;
  }
}

function Berth({ coach, b, vertical, mark, hatch, active, onFocus, register, onActivate }: {
  coach: string;
  b: CoachBerth;
  vertical: boolean;
  mark: BerthMark;
  hatch: string;
  active: boolean;
  onFocus(): void;
  register(el: SVGGElement | null): void;
  onActivate?: Props["onActivate"];
}) {
  const box = slot(b.berth, vertical);
  const rac = b.quota === "RAC";
  const held = HELD_PLACES[b.state];
  const own = Math.min(mark.ownRac ?? 0, rac ? 2 : 0);
  const halves = [0, 1].map((i) => (i < own ? "own" : i < Math.max(held, own) ? (own > 0 ? "co" : "held") : "free"));
  const ownCnf = mark.ownCnf === true;
  const state = ownCnf ? "own-cnf" : rac ? "rac" : b.state;
  const activate = (): void => onActivate?.(coach, b.berth, b.type);
  const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  // The visible number, kind and stamp sit beside the button, not inside it, so the button's accessible name
  // (the brief's "Berth <coach> <number> <position word>, <tags>") never has to repeat abbreviations like "LB".
  const labels = (
    <g aria-hidden="true" className={`berth-labels berth ${state}`} pointerEvents="none">
      <text className="num" x={centre.x} y={centre.y - (rac ? 2 : 4)} textAnchor="middle">
        {b.berth}
      </text>
      <text className={ownCnf ? "stamp-text" : "kind"} x={centre.x} y={centre.y + (rac ? 12 : 13)} textAnchor="middle">
        {ownCnf ? "CNF" : b.type}
      </text>
      {mark.preferredBy?.length ? (
        <text className="pref-tag" x={box.x + box.w - 5} y={box.y + 13} textAnchor="end">
          {mark.preferredBy.map((n) => `P${n}`).join(" ")}
        </text>
      ) : null}
    </g>
  );
  return (
    <>
    <g
      ref={register}
      role="button"
      tabIndex={active ? 0 : -1}
      aria-label={berthName(coach, b, mark.tags)}
      data-berth={b.berth}
      className={`berth ${state}`}
      onFocus={onFocus}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      }}
    >
      {rac ? (
        halves.map((kind, i) => {
          const half = vertical
            ? { x: box.x + i * (box.w / 2), y: box.y, width: box.w / 2, height: box.h }
            : { x: box.x, y: box.y + i * (box.h / 2), width: box.w, height: box.h / 2 };
          return (
            <rect key={i} className={`half ${kind}`} {...half} style={kind === "held" ? { fill: `url(#${hatch})` } : undefined} />
          );
        })
      ) : (
        <rect className="cell" x={box.x} y={box.y} width={box.w} height={box.h} style={b.state === "taken" && !ownCnf ? { fill: `url(#${hatch})` } : undefined} />
      )}
      {mark.preferredBy?.length ? (
        <rect className="pref" x={box.x + 3} y={box.y + 3} width={box.w - 6} height={box.h - 6} />
      ) : null}
      <rect className="ring" x={box.x - 3} y={box.y - 3} width={box.w + 6} height={box.h + 6} />
    </g>
    {labels}
    </>
  );
}

export function CoachPlan({ coaches, vertical, selected, onSelect, mark, onActivate, reveal }: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, "");
  const [lastFocused, setLastFocused] = useState<Record<string, number>>({});
  const berthRefs = useRef(new Map<number, SVGGElement>());
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<number | null>(null);
  const shown = coaches.find((c) => c.coach === selected) ?? coaches[0];
  const activeBerth = (shown && lastFocused[shown.coach]) || 1;
  const { width, height } = size(vertical);

  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    berthRefs.current.get(target)?.focus();
  }, [selected]);

  const revealKey = reveal && shown?.coach === reveal.coach ? reveal.berth : 0;
  useEffect(() => {
    const el = revealKey ? berthRefs.current.get(revealKey) : undefined;
    if (!el || !frame.current || vertical) return;
    const box = el.getBoundingClientRect();
    const view = frame.current.getBoundingClientRect();
    frame.current.scrollLeft += box.left - view.left - view.width / 2 + box.width / 2;
  }, [revealKey, vertical]);

  if (!shown) return null;
  const order = coaches.map((c) => c.coach);
  const position = order.indexOf(shown.coach);

  const onPlanKey = (event: KeyboardEvent<SVGSVGElement>): void => {
    const berth = Number((event.target as Element).getAttribute("data-berth"));
    if (!berth) return;
    if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      const next = order[position + (event.key === "PageUp" ? -1 : 1)];
      if (!next) return;
      setLastFocused((m) => ({ ...m, [next]: berth }));
      pendingFocus.current = berth;
      onSelect(next);
      return;
    }
    const target = nextBerth(event.key, berth, vertical);
    if (target === undefined) return;
    event.preventDefault();
    setLastFocused((m) => ({ ...m, [shown.coach]: target }));
    berthRefs.current.get(target)?.focus();
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    const next = order[index + delta];
    if (!delta || !next) return;
    event.preventDefault();
    onSelect(next);
    tabRefs.current.get(next)?.focus();
  };

  return (
    <div className="plan">
      <div className="tabs" role="tablist" aria-label="Coaches">
        {order.map((coach, i) => (
          <button
            key={coach}
            ref={(el) => {
              if (el) tabRefs.current.set(coach, el);
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${coach}`}
            aria-selected={coach === shown.coach}
            aria-controls={`${id}-panel`}
            tabIndex={coach === shown.coach ? 0 : -1}
            className="tab"
            onClick={() => onSelect(coach)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {coach}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${shown.coach}`} className={`plan-frame${vertical ? " vertical" : ""}`} ref={frame}>
        <svg
          role="group"
          aria-label={`Coach plan ${shown.coach}`}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          onKeyDown={onPlanKey}
        >
          <defs>
            <pattern id={`${id}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#fbf7ef" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(35,28,20,0.32)" strokeWidth="2" />
            </pattern>
          </defs>
          <g aria-hidden="true">
            <rect className="plan-body" x={6} y={MARGIN + 26} width={width - 12} height={height - MARGIN - 32} />
            <text className="plan-print" x={MARGIN} y={MARGIN + 2}>
              {`COACH ${shown.coach}`}
            </text>
            {Array.from({ length: 9 }, (_, bay) => {
              const first = slot(bay * 8 + 1, vertical);
              return vertical ? (
                <g key={bay}>
                  <text className="plan-print muted" x={MARGIN + 4} y={first.y + 56}>
                    {bay + 1}
                  </text>
                  {bay > 0 ? <line className="plan-partition" x1={12} x2={width - 12} y1={first.y - BAY_GAP / 2} y2={first.y - BAY_GAP / 2} /> : null}
                </g>
              ) : (
                <g key={bay}>
                  <text className="plan-print muted" x={first.x + STEP - 2} y={MARGIN + 20} textAnchor="middle">
                    {bay + 1}
                  </text>
                  {bay > 0 ? <line className="plan-partition" x1={first.x - BAY_GAP / 2} x2={first.x - BAY_GAP / 2} y1={MARGIN + 32} y2={height - 12} /> : null}
                </g>
              );
            })}
            {vertical ? (
              <line className="plan-aisle" x1={MARGIN + 28 + 3 * STEP + 7} x2={MARGIN + 28 + 3 * STEP + 7} y1={MARGIN + HEAD} y2={height - MARGIN} />
            ) : (
              <line className="plan-aisle" x1={MARGIN} x2={width - MARGIN} y1={MARGIN + HEAD + 3 * STEP + 7} y2={MARGIN + HEAD + 3 * STEP + 7} />
            )}
          </g>
          {shown.berths.map((b) => (
            <Berth
              key={`${shown.coach}-${b.berth}`}
              coach={shown.coach}
              b={b}
              vertical={vertical}
              mark={mark?.(shown.coach, b.berth) ?? {}}
              hatch={`${id}-hatch`}
              active={b.berth === activeBerth}
              onFocus={() => setLastFocused((m) => (m[shown.coach] === b.berth ? m : { ...m, [shown.coach]: b.berth }))}
              register={(el) => {
                if (el) berthRefs.current.set(b.berth, el);
                else berthRefs.current.delete(b.berth);
              }}
              onActivate={onActivate}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
