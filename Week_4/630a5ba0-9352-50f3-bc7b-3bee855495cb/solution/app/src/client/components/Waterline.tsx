import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../announce.js";

// The Waterline gauge: the fill's height over the tidemark's height equals planned / threshold,
// capped at 1.2, so the dashed tidemark sits at five-sixths of the gauge.

const CAP = 1.2;
const TIDE = 100 / CAP;
const GHOST_MS = 260;
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

type Props = {
  label: string;
  planned: number;
  threshold: number;
  /** Estimate of a card held over this column, or null. */
  ghost: number | null;
  /** True right after a drop: the ghost turns solid instead of shrinking away. */
  dropped: boolean;
};

export function Waterline({ label, planned, threshold, ghost, dropped }: Props) {
  const fill = Math.min(planned / threshold, CAP) * TIDE;
  const [shown, setShown] = useState<number | null>(ghost);
  const ghostRef = useRef<HTMLDivElement>(null);
  const leaving = useRef<Animation | null>(null);

  useEffect(() => {
    if (ghost !== null) {
      leaving.current?.cancel();
      leaving.current = null;
      setShown(ghost);
      return;
    }
    const element = ghostRef.current;
    if (shown === null) return;
    if (!element || dropped || prefersReducedMotion()) {
      setShown(null);
      return;
    }
    const animation = element.animate([{ height: element.style.height }, { height: "0%" }], { duration: GHOST_MS, easing: EASE, fill: "forwards" });
    leaving.current = animation;
    animation.finished.then(
      () => {
        if (leaving.current === animation) {
          leaving.current = null;
          setShown(null);
        }
      },
      () => undefined,
    );
  }, [ghost, dropped]);

  const visible = ghost ?? shown;
  const ghostHeight = visible === null ? 0 : Math.min((visible / threshold) * TIDE, 100 - fill);
  const entering = useRef<number | null>(null);
  useLayoutEffect(() => {
    const element = ghostRef.current;
    if (!element || ghost === null || entering.current === ghost || prefersReducedMotion()) {
      entering.current = ghost;
      return;
    }
    entering.current = ghost;
    element.animate([{ height: "0%" }, { height: `${ghostHeight}%` }], { duration: GHOST_MS, easing: EASE });
  }, [ghost, ghostHeight]);

  const projected = planned + (ghost ?? 0);
  const top = Math.min(fill + (ghost === null ? 0 : ghostHeight), 100);
  const over = projected - threshold;
  return (
    <div
      className="gauge"
      role="meter"
      aria-label={`Load for ${label}`}
      aria-valuemin={0}
      aria-valuemax={threshold * CAP}
      aria-valuenow={Math.min(planned, threshold * CAP)}
      aria-valuetext={`${planned} of ${threshold} minutes`}
    >
      <div className="gauge-fill" data-part="waterline-fill" style={{ height: `${fill}%` }} />
      {visible !== null && (
        <div ref={ghostRef} className="gauge-ghost" data-part="waterline-ghost" style={{ bottom: `${fill}%`, height: `${ghostHeight}%` }} />
      )}
      {top > TIDE && <div className="gauge-hatch" style={{ bottom: `${TIDE}%`, height: `${top - TIDE}%` }} />}
      <div className="gauge-tidemark" data-part="tidemark" />
      {over > 0 && (
        <span className="over-label" data-part="over-label">
          Over by {over}m
        </span>
      )}
    </div>
  );
}
