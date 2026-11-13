import type { CSSProperties } from "react";
import type { Booking, RotationEntry } from "../../shared/api";
import { Weave, useCountedCoverage } from "../components/Weave";
import { timeOf } from "../lib/format";

function planLine(entry: RotationEntry, position: number, turnCount: number): string {
  const span = `${timeOf(entry.start)}–${timeOf(entry.end)}`;
  return entry.kind === "turn"
    ? `Turn ${position} of ${turnCount}: ${entry.holder_name ?? ""}, ${span}`
    : `Gap: ${entry.label ?? ""}, ${span}`;
}

/** The full-width time bar: the weave, the counted coverage figure, the coverage text and the announced plan list. */
export function RotationPanel({ booking }: { booking: Booking }) {
  const { rotation, coverage } = booking;
  const { figureRef, shownText } = useCountedCoverage(coverage.percent, rotation.coverage_text);
  const turnCount = rotation.turns.filter((entry) => entry.kind === "turn").length;
  let turnPosition = 0;
  return (
    <section className="timebar" aria-labelledby="rotation-heading">
      <div className="timebar-head">
        <h3 id="rotation-heading" className="section-label">
          Rotation
        </h3>
        <p role="status" aria-label="Coverage" className="coverage-text mono">
          <span ref={figureRef} className="figure" aria-hidden="true" style={{ "--pct": coverage.percent } as CSSProperties} />
          <span>{shownText}</span>
        </p>
      </div>
      <Weave booking={booking} />
      <ul aria-label="Rotation plan" className="plan-list mono">
        {rotation.turns.map((entry) => {
          if (entry.kind === "turn") turnPosition += 1;
          return <li key={entry.index}>{planLine(entry, turnPosition, turnCount)}</li>;
        })}
      </ul>
    </section>
  );
}
