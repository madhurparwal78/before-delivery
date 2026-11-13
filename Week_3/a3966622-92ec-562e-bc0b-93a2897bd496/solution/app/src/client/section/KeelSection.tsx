// The pinned planning region: drawing, time handle, planning day, open windows, Pinch, Gate,
// Formula and (for dispatchers) Commit window. Every value comes from the painted plan.
import { useEffect, useRef, useState } from "react";
import { draughtMetres, signedMetres } from "../../shared/numerals";
import { minuteOfDay } from "../../shared/portTime";
import type { PortInfo } from "../../shared/types";
import type { Planner } from "./planner";
import { prefersReducedMotion } from "./planner";
import { Drawing } from "./Drawing";
import { TimeHandle } from "./TimeHandle";

function GateRibbon({ state }: { state: "open" | "closed" | null }) {
  const previous = useRef(state);
  const [leaf, setLeaf] = useState<{ from: "open" | "closed"; seq: number } | null>(null);
  useEffect(() => {
    if (previous.current && state && previous.current !== state && !prefersReducedMotion()) {
      setLeaf((l) => ({ from: previous.current ?? "open", seq: (l?.seq ?? 0) + 1 }));
    }
    previous.current = state;
  }, [state]);
  return (
    <p className="gate" data-testid="gate-ribbon" data-state={state ?? "closed"}>
      {leaf ? <span key={leaf.seq} className={`gate-leaf from-${leaf.from}`} aria-hidden="true" onAnimationEnd={() => setLeaf(null)} /> : null}
      <span className="gate-text">{state === "open" ? "Gate open" : state === "closed" ? "Gate closed" : "Gate"}</span>
    </p>
  );
}

interface KeelSectionProps {
  planner: Planner;
  port: PortInfo | null;
  canCommit: boolean;
}

export function KeelSection({ planner, port, canCommit }: KeelSectionProps) {
  const { move, painted } = planner;
  const [dayText, setDayText] = useState(planner.day);
  useEffect(() => setDayText(planner.day), [planner.day]);
  const pinch = painted?.waypoints.find((w) => w.id === painted.pinch.waypoint_id);

  return (
    <section className="keel" aria-label="Keel Section">
      {move && port ? (
        <>
          <div className="keel-bar">
            <p className="keel-move">
              <span className="keel-ref">{move.ref}</span> {move.vessel.name}{" "}
              <span className="num">{draughtMetres(move.draught_mm)} m</span>
            </p>
            <p className="item item-pinch">
              <span className="item-word">Pinch</span>{" "}
              {pinch && painted ? (
                <span className={painted.pinch.margin_mm < 0 ? "num short" : "num"}>
                  {pinch.name} {signedMetres(painted.pinch.margin_mm)} m
                </span>
              ) : (
                <span className="muted">reading plan</span>
              )}
            </p>
            <GateRibbon state={painted?.window_state ?? null} />
          </div>
          <div className="keel-figure">
            <Drawing waypoints={port.waypoints} berthNm={port.berth_nm} plan={painted} hull={planner.hull} />
          </div>
          <p className="item item-formula">
            <span className="item-word">Formula</span> Clearance = sounded depth + tide at arrival - draught - squat
          </p>
          <TimeHandle minutes={planner.minutes} windows={planner.windows} onKey={planner.moveHandle} onPoint={planner.setMinutes} />
          <div className="keel-foot">
            <div className="day">
              <label htmlFor="planning-day">Planning day</label>
              <input
                id="planning-day"
                type="text"
                inputMode="numeric"
                className="num"
                value={dayText}
                onChange={(event) => {
                  setDayText(event.target.value);
                  planner.setDay(event.target.value.trim());
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") planner.setDay(dayText.trim());
                }}
                aria-describedby="day-format"
              />
              <span id="day-format" className="sr-only">
                Date as YYYY-MM-DD
              </span>
            </div>
            <div className="windows" role="group" aria-label="Open windows">
              {planner.windows === null ? null : planner.windows.length === 0 ? (
                <p className="muted">No open window on this day</p>
              ) : (
                planner.windows.map((w) => (
                  <button key={w.from} type="button" className="window" onClick={() => planner.setMinutes(minuteOfDay(w.from) ?? 0)}>
                    <span className="wide-inline">Open window </span>
                    <span className="num">
                      {w.from}
                      <span className="wide-inline"> to </span>
                      <span className="narrow-dash" aria-hidden="true">
                        –
                      </span>
                      {w.to}
                    </span>
                  </button>
                ))
              )}
            </div>
            {canCommit ? (
              <button
                type="button"
                className="primary commit"
                disabled={painted?.window_state !== "open" || !move.actions.includes("commit")}
                aria-busy={planner.committing || undefined}
                onClick={planner.commit}
              >
                Commit<span className="wide-inline"> window</span>
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <p className="keel-empty">Select a move to plan</p>
      )}
    </section>
  );
}
