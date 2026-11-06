import { type ReactNode, useEffect, useRef, useState } from "react";
import { dollars } from "../format";
import type { Quote } from "../types";

// The live quote rail: the counting total, its line items, the tier steps and the hold controls.

const COUNT_MS = 330;
const easeInOut = (p: number): number => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

/** Counts the shown total from its last value to the server's figure, landing exactly on it. */
function useCountingCents(target: number, reduced: boolean, version: number, onLanded: () => void): number {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  const landed = useRef(onLanded);
  landed.current = onLanded;

  useEffect(() => {
    const from = shownRef.current;
    if (reduced || from === target) {
      shownRef.current = target;
      setShown(target);
      landed.current();
      return undefined;
    }
    const started = performance.now();
    let frame = 0;
    const step = (): void => {
      const progress = Math.min(1, (performance.now() - started) / COUNT_MS);
      const value = progress >= 1 ? target : Math.round(from + (target - from) * easeInOut(progress));
      shownRef.current = value;
      setShown(value);
      if (progress < 1) frame = requestAnimationFrame(step);
      else landed.current();
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, reduced, version]);

  return shown;
}

function announcement(quote: Quote | null): string {
  if (!quote) return "Total $0.00 for 0.00 hours.";
  return `Total ${quote.total} for ${quote.hours} hours.${quote.tier_steps_crossed.map((t) => ` Crosses into tier ${t}.`).join("")}`;
}

export interface HoldTiming {
  secondsLeft: number;
  totalSeconds: number;
  expiresLocal: string;
}

export function QuoteRail({
  quote,
  version,
  pricing,
  failed,
  reduced,
  timing,
  sheetOpen,
  onToggleSheet,
  children,
}: {
  quote: Quote | null;
  version: number;
  pricing: boolean;
  failed: boolean;
  reduced: boolean;
  timing: HoldTiming | null;
  sheetOpen: boolean;
  onToggleSheet: () => void;
  children: ReactNode;
}) {
  const [announced, setAnnounced] = useState("");
  const shown = useCountingCents(quote?.total_cents ?? 0, reduced, version, () => setAnnounced(announcement(quote)));
  const lines = quote?.lines ?? [];

  return (
    <aside className="rail" aria-label="Quote" data-open={sheetOpen ? "true" : "false"}>
      <div className="rail-bar">
        <div role="group" aria-label="Quote total" className="quote-total">
          <span className="figure">{dollars(shown)}</span>
          {pricing && <span className="pricing">Pricing…</span>}
          {failed && !pricing && <span className="pricing error-text">Pricing unavailable. Try again.</span>}
        </div>
        <button type="button" className="show-quote" aria-expanded={sheetOpen} onClick={onToggleSheet}>
          {sheetOpen ? "Hide quote" : "Show quote"}
        </button>
      </div>
      <div className="rail-body">
        <p className="rail-sub">
          {quote ? `${quote.hours} h · month so far ${quote.month_hours_before} h` : "Brush cells on the loom to price a run."}
        </p>
        {quote && quote.tier_steps_crossed.length > 0 && (
          <p className="tier-step">{quote.tier_steps_crossed.map((t) => `Steps into tier ${t}`).join(" · ")}</p>
        )}
        <ul aria-label="Quote lines" className="quote-lines">
          {lines.map((line) => (
            <li key={`${line.station_id}-${line.tier}-${line.paid_by}`}>
              <span className="line-station">{line.station}</span>
              <span className="num">tier {line.tier}</span>
              <span className="num">{line.hours} h</span>
              <span className="num amount">{line.paid_by === "pack" ? "pack" : dollars(line.amount_cents)}</span>
            </li>
          ))}
        </ul>
        <div role="status" aria-label="Quote announcement" className="sr-only">
          {announced}
        </div>
        {timing && (
          <div className="hold-timer">
            <div
              role="progressbar"
              aria-label="Hold time left"
              aria-valuemin={0}
              aria-valuemax={timing.totalSeconds}
              aria-valuenow={timing.secondsLeft}
              className="countdown"
            >
              <span style={{ transform: `scaleX(${timing.totalSeconds > 0 ? timing.secondsLeft / timing.totalSeconds : 0})` }} />
            </div>
            <p className="held-until num">held until {timing.expiresLocal}</p>
          </div>
        )}
        {children}
      </div>
    </aside>
  );
}
