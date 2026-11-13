// The gate glyph: a headgate leaf standing in a channel, drawn in code. The cobalt sweep fills it from
// the bed up through `sweepRef`, a clip rect the dwell moves on every frame.
import { useId, type RefObject } from "react";

/** Moves the sweep to `fill` (0..1) of the glyph's height, from the bed up. */
export function paintSweep(rect: SVGRectElement | null, fill: number): void {
  if (!rect) return;
  const top = 92 - 88 * fill;
  rect.setAttribute("y", String(top));
  rect.setAttribute("height", String(92 - top));
}

function Drawing() {
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* channel banks and bed */}
      <path d="M6 40 L18 84 H78 L90 40" strokeWidth="3" />
      {/* water line upstream of the leaf */}
      <path d="M12 58 H30 M66 58 H84" strokeWidth="2" strokeDasharray="4 4" />
      {/* frame posts */}
      <path d="M30 22 V84 M66 22 V84" strokeWidth="3" />
      {/* the leaf, with its ribs */}
      <rect x="34" y="44" width="28" height="38" strokeWidth="3" />
      <path d="M34 57 H62 M34 70 H62" strokeWidth="2" />
      {/* lintel, spindle and handwheel */}
      <path d="M26 22 H70 M48 44 V12" strokeWidth="3" />
      <ellipse cx="48" cy="10" rx="12" ry="4" strokeWidth="3" />
    </g>
  );
}

export function GateGlyph({ sweepRef }: { sweepRef: RefObject<SVGRectElement | null> }) {
  const clip = useId();
  return (
    <svg className="gate-glyph" viewBox="0 0 96 92" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clip}>
          <rect ref={sweepRef} x="0" y="92" width="96" height="0" />
        </clipPath>
      </defs>
      <g className="gate-lines">
        <Drawing />
      </g>
      <g clipPath={`url(#${clip})`}>
        <rect className="gate-sweep" x="0" y="0" width="96" height="92" />
        <g className="gate-lines-over">
          <Drawing />
        </g>
      </g>
    </svg>
  );
}
