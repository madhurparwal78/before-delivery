import { useEffect, useRef } from "react";
import { animate, StatusBlock } from "../lib/ui.js";
import { formatHms, slaText, useSecondTick, type ReceivedSla } from "../lib/sla.js";

/** The progressbar for one SLA; its fill grows over 420 ms whenever the server sends a new percent. */
function SlaBar({ entry }: { entry: ReceivedSla }): JSX.Element {
  const fill = useRef<HTMLDivElement>(null);
  const shown = useRef(entry.sla.percent);
  const percent = entry.sla.percent;
  useEffect(() => {
    if (shown.current !== percent) {
      const from = Math.min(shown.current, 100);
      const to = Math.min(percent, 100);
      animate(fill.current, [{ width: `${from}%` }, { width: `${to}%` }], 420);
      shown.current = percent;
    }
  }, [percent]);
  return (
    <div className="sla-bar" role="progressbar" aria-label={entry.sla.definition} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(percent, 100)} aria-valuetext={`${percent} percent`}>
      <div ref={fill} className="sla-fill" style={{ width: `${Math.min(percent, 100)}%` }} />
    </div>
  );
}

/** The SLA region of a record form: one bar, countdown and status per SLA. */
export function SlaPanel({ slas: all }: { slas: ReceivedSla[] }): JSX.Element {
  useSecondTick();
  const slas = all.filter((entry) => entry.sla.stage !== "cancelled");
  return (
    <section className="sla-panel" aria-label="SLA">
      {slas.length === 0 ? <p className="muted">No SLA</p> : null}
      {slas.map((entry) => (
        <div key={entry.sla.id} className="sla-item">
          <div className="sla-head">
            <strong>{entry.sla.definition}</strong>
            {entry.sla.stage === "paused" ? <StatusBlock outlined>Paused</StatusBlock> : null}
            {entry.sla.breached && entry.sla.stage !== "completed" ? <StatusBlock>Breached</StatusBlock> : null}
          </div>
          <SlaBar entry={entry} />
          <p className="sla-line">
            <span className="sla-countdown">{slaText(entry)}</span> <span className="muted">{entry.sla.percent} percent</span>
          </p>
          {entry.sla.stage === "paused" ? <p className="muted">Paused for {formatHms(entry.sla.paused_seconds)}</p> : null}
        </div>
      ))}
    </section>
  );
}

/** The one-line countdown for a row, card or request: the shown SLA's text and percent. */
export function SlaInline({ entry }: { entry: ReceivedSla | null }): JSX.Element {
  useSecondTick();
  return entry ? (
    <span className="sla-inline">
      {slaText(entry)} <span className="muted">{entry.sla.percent} percent</span>
    </span>
  ) : (
    <span className="muted">No SLA</span>
  );
}
