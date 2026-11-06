// The mission header: name, status and the four server-decided groups; a changed value swaps in place.
import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { Mission } from "../api";
import { reducedMotion } from "../hooks";

function Group({ label, value }: { label: string; value: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const before = useRef(value);
  useLayoutEffect(() => {
    if (before.current === value) return;
    before.current = value;
    if (!reducedMotion()) {
      ref.current?.animate([{ backgroundColor: "rgb(30 77 120 / 18%)" }, { backgroundColor: "rgb(30 77 120 / 0%)" }], { duration: 180, easing: "ease-out" });
    }
  }, [value]);
  return (
    <div role="group" aria-label={label}>
      <span className="caption">{label}</span>
      <span ref={ref} className="value">{value}</span>
    </div>
  );
}

function agreementText(m: Mission): string {
  const a = m.crossline_agreement;
  return a.compared ? `${a.pct}% of ${a.compared}` : "—";
}

export function MissionHeader({ mission, children, headingLevel = 1 }: { mission: Mission; children?: ReactNode; headingLevel?: 1 | 2 }) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <section className="mission-head" aria-label="Mission header">
      <div className="title">
        <Heading>{mission.name}</Heading>
        <span className="status-word">{mission.status}</span>
        <span className="muted">{mission.client_name}</span>
      </div>
      <div className="groups">
        <Group label="Coverage" value={`${mission.counters.coverage_pct}%`} />
        <Group label="Open holidays" value={String(mission.counters.open_holidays)} />
        <Group label="Lines remaining" value={String(mission.counters.lines_remaining)} />
        <Group label="Crossline agreement" value={agreementText(mission)} />
      </div>
      {mission.hold && <p className="hold-line">On hold: {mission.hold.reason}</p>}
      <div className="row">
        <a className="button" href={`/api/missions/${mission.id}/coverage.csv`} download>Download coverage CSV</a>
        {children}
      </div>
    </section>
  );
}
