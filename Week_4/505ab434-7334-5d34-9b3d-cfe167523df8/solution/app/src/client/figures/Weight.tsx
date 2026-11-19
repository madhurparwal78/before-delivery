import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { bootstrap } from "../lib/bootstrap.ts";

const MIN = 250;
const MAX = 900;
const PAGE = 50;

/** Typography chapter: a native range for display weight, the specimen at that weight, and a delayed announcement. */
export function WeightFigure(): ReactNode {
  const [weight, setWeight] = useState(400);
  const [announced, setAnnounced] = useState("");
  const changed = useRef(false);

  useEffect(() => {
    if (!changed.current) return;
    const timer = window.setTimeout(() => setAnnounced(`Weight ${weight}`), bootstrap.weightAnnounceDelayMs);
    return () => window.clearTimeout(timer);
  }, [weight]);

  const set = (next: number): void => {
    changed.current = true;
    setWeight(Math.min(MAX, Math.max(MIN, next)));
  };
  const keys = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      set(weight + (event.key === "PageUp" ? PAGE : -PAGE));
    }
  };

  return (
    <section className="figure-cell cell cell-pad" data-frame aria-labelledby="weight-title">
      <h2 id="weight-title" className="cell-label">
        Weight
      </h2>
      <div className="weight-controls">
        <label htmlFor="weight-slider">Weight</label>
        <input id="weight-slider" type="range" min={MIN} max={MAX} step={1} value={weight} onChange={(e) => set(Number(e.target.value))} onKeyDown={keys} />
        <span className="readout">Weight {weight}</span>
      </div>
      <figure className="specimen-figure" aria-label="Weight specimen">
        <p className="specimen" style={{ fontWeight: weight }}>
          Quenby &amp; Co. sets every letter by rule.
        </p>
      </figure>
      <p role="status" aria-label="Weight announcement" className="muted announcement">
        {announced}
      </p>
      <p className="prose muted">
        Display type may take any weight from 250 to 900, and running text stays at 400. The slider moves one step at a time with the arrow keys, fifty with Page Up and Page Down, and jumps to either end with Home and End.
      </p>
    </section>
  );
}
