/**
 * The span ribbon. Horizontal position maps linearly and monotonically from
 * chainage 0 at the left edge to the corridor length at the right.
 */

import { useCallback, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { chainageWhole, countOf } from "../../shared/format.js";
import { NO_FLIGHT_COVERAGE } from "../../shared/copy.js";
import { nextTowerChainage, previousTowerChainage } from "../lib/centreline.js";
import { ChevronLeft, ChevronRight } from "./icons.jsx";
import type { CoverageRange, Tower } from "../lib/types.js";

export interface RibbonProps {
  towers: Tower[];
  lengthM: number;
  coverage: CoverageRange[];
  chainageM: number;
  nearCount: number;
  spanLabelParts: { from: number; to: number };
  reducedMotion: boolean;
  onScrub: (chainageM: number, mode: "step" | "drag") => void;
  onRelease: (chainageM: number) => void;
}

function uncoveredRanges(coverage: CoverageRange[], lengthM: number): CoverageRange[] {
  const gaps: CoverageRange[] = [];
  let cursor = 0;
  for (const range of coverage) {
    if (range.from_m > cursor) gaps.push({ from_m: cursor, to_m: range.from_m });
    cursor = Math.max(cursor, range.to_m);
  }
  if (cursor < lengthM) gaps.push({ from_m: cursor, to_m: lengthM });
  return gaps;
}

export function valueText(chainageM: number, from: number, to: number, nearCount: number): string {
  const nearby =
    nearCount === 0 ? "no findings nearby" : `${countOf(nearCount, "finding")} nearby`;
  return `Chainage ${chainageWhole(chainageM)} metres, span ${from} to ${to}, ${nearby}`;
}

export function Ribbon(props: RibbonProps): ReactNode {
  const { towers, lengthM, coverage, chainageM, nearCount, spanLabelParts } = props;
  const track = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  const fraction = lengthM === 0 ? 0 : chainageM / lengthM;

  const chainageFromEvent = useCallback(
    (clientX: number): number => {
      const rect = track.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return 0;
      const ratio = (clientX - rect.left) / rect.width;
      return Math.min(lengthM, Math.max(0, ratio * lengthM));
    },
    [lengthM],
  );

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    props.onScrub(chainageFromEvent(event.clientX), "step");
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return;
    props.onScrub(chainageFromEvent(event.clientX), "drag");
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return;
    dragging.current = false;
    props.onRelease(chainageFromEvent(event.clientX));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 100 : 10;
    let next: number | null = null;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowDown":
        next = chainageM - step;
        break;
      case "ArrowRight":
      case "ArrowUp":
        next = chainageM + step;
        break;
      case "PageUp":
        next = previousTowerChainage(towers, chainageM);
        break;
      case "PageDown":
        next = nextTowerChainage(towers, chainageM, lengthM);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = lengthM;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    props.onScrub(Math.min(lengthM, Math.max(0, next)), "step");
  };

  const rules: number[] = [];
  for (let metres = 0; metres <= lengthM; metres += 100) rules.push(metres);
  const gaps = uncoveredRanges(coverage, lengthM);

  return (
    <section className="ribbon" aria-label="Span ribbon">
      <button
        type="button"
        className="ribbon__step"
        aria-label="Previous span"
        onClick={() => props.onScrub(previousTowerChainage(towers, chainageM), "step")}
      >
        <ChevronLeft />
      </button>
      <div
        className="ribbon__slider"
        role="slider"
        tabIndex={0}
        aria-label="Corridor chainage"
        aria-valuemin={0}
        aria-valuemax={lengthM}
        aria-valuenow={Number(chainageM.toFixed(1))}
        aria-valuetext={valueText(chainageM, spanLabelParts.from, spanLabelParts.to, nearCount)}
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        ref={track}
      >
        <div className="ribbon__rules" aria-hidden="true">
          {rules.map((metres) => (
            <span
              key={metres}
              className={metres % 500 === 0 ? "rule rule--major" : "rule"}
              style={{ left: `${(metres / lengthM) * 100}%` }}
            >
              {metres % 500 === 0 ? <i className="rule__label">{metres}</i> : null}
            </span>
          ))}
        </div>
        {gaps.map((gap) => (
          <div
            key={`${gap.from_m}-${gap.to_m}`}
            className="ribbon__gap"
            style={{
              left: `${(gap.from_m / lengthM) * 100}%`,
              width: `${((gap.to_m - gap.from_m) / lengthM) * 100}%`,
            }}
          >
            <span className="ribbon__gap-label">{NO_FLIGHT_COVERAGE}</span>
          </div>
        ))}
        <div className="ribbon__towers" aria-hidden="true">
          {towers.map((tower) => (
            <span
              key={tower.number}
              className="tick"
              style={{ left: `${(tower.chainage_m / lengthM) * 100}%` }}
            >
              <i className="tick__label">{tower.label}</i>
            </span>
          ))}
        </div>
        <div
          className={props.reducedMotion ? "playhead playhead--instant" : "playhead"}
          style={{ left: `${fraction * 100}%` }}
          aria-hidden="true"
        />
      </div>
      <button
        type="button"
        className="ribbon__step"
        aria-label="Next span"
        onClick={() => props.onScrub(nextTowerChainage(towers, chainageM, lengthM), "step")}
      >
        <ChevronRight />
      </button>
    </section>
  );
}
