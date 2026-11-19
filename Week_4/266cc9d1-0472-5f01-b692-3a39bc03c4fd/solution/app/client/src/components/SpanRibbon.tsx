// The span ribbon: the corridor as a straight strip from chainage 0 at the left to its length at
// the right, with a tick per tower, hairline rules every 100 m (labelled every 500 m), hatched
// uncovered ranges and the playhead. The strip is the Corridor chainage slider.
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import type { Coverage } from "../api";
import { isStepKey, spanOf, steppedChainage, uncoveredRanges, type CorridorShape } from "../corridorMath";
import { sliderValueText } from "../format";
import { spanLabel } from "../../../shared/text";
import type { InputKind } from "../view";

const INSET_PX = 18;

interface SpanRibbonProps {
  shape: CorridorShape;
  coverage: Coverage[];
  chainageM: number;
  glide: boolean;
  nearCount: number;
  onScrub: (chainageM: number, kind: InputKind) => void;
  onRelease: () => void;
}

export function SpanRibbon({ shape, coverage, chainageM, glide, nearCount, onScrub, onRelease }: SpanRibbonProps) {
  const strip = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const dragging = useRef(false);

  useLayoutEffect(() => {
    const element = strip.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  const usable = Math.max(1, width - INSET_PX * 2);
  const x = (c: number) => INSET_PX + (c / shape.lengthM) * usable;
  const chainageAt = (clientX: number) => {
    const left = strip.current?.getBoundingClientRect().left ?? 0;
    return ((clientX - left - INSET_PX) / usable) * shape.lengthM;
  };
  const span = spanOf(shape, chainageM);

  const press = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    onScrub(chainageAt(event.clientX), "press");
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) onScrub(chainageAt(event.clientX), "drag");
  };
  const lift = () => {
    if (!dragging.current) return;
    dragging.current = false;
    onRelease();
  };

  const rules = [];
  for (let c = 0; c <= shape.lengthM + 1e-6; c += 100) rules.push(c);
  const step = (key: "PageUp" | "PageDown") => onScrub(steppedChainage(shape, chainageM, key, false), "step");

  return (
    <section className="ribbon" aria-label="Span ribbon">
      <button type="button" className="button step prev" aria-label="Previous span" onClick={() => step("PageUp")}>
        <ChevronLeft size={18} aria-hidden="true" />
      </button>
      <div
        ref={strip}
        id="span-ribbon-slider"
        className="strip"
        role="slider"
        tabIndex={0}
        aria-label="Corridor chainage"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={shape.lengthM}
        aria-valuenow={chainageM}
        aria-valuetext={sliderValueText(chainageM, span.from, span.to, nearCount)}
        onPointerDown={press}
        onPointerMove={move}
        onPointerUp={lift}
        onPointerCancel={lift}
        onKeyDown={(event) => {
          if (!isStepKey(event.key)) return;
          event.preventDefault();
          onScrub(steppedChainage(shape, chainageM, event.key, event.shiftKey), "step");
        }}
      >
        <div className="strip-track" />
        {width > 0 &&
          rules.map((c) => (
            <span key={`r${c}`}>
              <span className={`rule-line${c % 500 === 0 ? " major" : ""}`} style={{ left: x(c) }} />
              {c % 500 === 0 && (
                <span className="rule-label" style={{ left: x(c) }}>
                  {c} m
                </span>
              )}
            </span>
          ))}
        {width > 0 &&
          uncoveredRanges(shape, coverage).map((gap) => (
            <span key={`g${gap.from_m}`} className="gap" style={{ left: x(gap.from_m), width: x(gap.to_m) - x(gap.from_m) }}>
              <span className="gap-label">No flight coverage</span>
            </span>
          ))}
        {width > 0 &&
          shape.towers.map((t) => (
            <span key={`t${t.number}`}>
              <span className="tower-tick" style={{ left: x(t.chainage_m) }} />
              <span className="tower-label" style={{ left: x(t.chainage_m) }}>
                {t.label}
              </span>
            </span>
          ))}
        <span className={`playhead${glide && !dragging.current ? " glide" : ""}`} style={{ transform: `translateX(${x(chainageM)}px)` }} />
      </div>
      <p className="span-caption mono" aria-hidden="true">
        {spanLabel(span.from, span.to)}
      </p>
      <button type="button" className="button step next" aria-label="Next span" onClick={() => step("PageDown")}>
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </section>
  );
}
