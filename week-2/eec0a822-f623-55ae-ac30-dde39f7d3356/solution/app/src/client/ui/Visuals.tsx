// Drawn media: the sun badge, the hull line drawing and the first-load dots.
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { prefersReducedMotion } from "../lib/hooks";

export function SunBadge() {
  return (
    <svg class="sun-badge" role="img" aria-label="Solar-electric fleet" viewBox="0 0 64 64" width="56" height="56">
      <g class="sun-badge__rock">
        <circle cx="32" cy="27" r="9" fill="none" stroke="currentColor" stroke-width="2" />
        {Array.from({ length: 10 }, (_, i) => {
          const a = (i / 10) * Math.PI * 2;
          return (
            <line
              key={i}
              x1={32 + Math.cos(a) * 13}
              y1={27 + Math.sin(a) * 13}
              x2={32 + Math.cos(a) * 17}
              y2={27 + Math.sin(a) * 17}
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          );
        })}
        <path d="M10 47 q5.5 -4 11 0 t11 0 t11 0 t11 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        <path d="M14 54 q4.5 -3 9 0 t9 0 t9 0 t9 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.6" />
      </g>
    </svg>
  );
}

/**
 * A catamaran in profile drawn from the yacht's own length and beam: the hull length follows the length,
 * the freeboard, cabin height and solar roof follow the beam.
 */
export function HullDrawing({ name, lengthM, beamM, size = "card" }: { name: string; lengthM: number; beamM: number; size?: "card" | "hero" }) {
  const width = 320;
  const height = 132;
  const hull = Math.min(296, Math.max(150, (lengthM / 26) * 296));
  const left = (width - hull) / 2;
  const right = left + hull;
  const water = 100;
  const freeboard = 12 + beamM * 1.6;
  const deck = water - freeboard;
  const cabin = 10 + beamM * 1.3;
  const roof = deck - cabin;
  const cabinLeft = left + hull * 0.24;
  const cabinRight = left + hull * 0.78;
  const solarLeft = left + hull * 0.18;
  const solarRight = left + hull * 0.86;
  const panels = Math.max(4, Math.round(lengthM / 3));
  return (
    <svg class={`hull hull--${size}`} role="img" aria-label={`${name} hull drawing`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
      <g fill="none" stroke="currentColor" stroke-linejoin="round" stroke-linecap="round">
        <path d={`M4 ${water + 4} H ${width - 4}`} stroke-width="1" stroke-dasharray="2 5" opacity="0.55" />
        <path
          d={`M ${left + 6} ${deck} L ${right - 14} ${deck} Q ${right - 2} ${deck + 2} ${right} ${deck + freeboard * 0.35}
              L ${right - 10} ${water} L ${left + 18} ${water} Q ${left + 4} ${water - 2} ${left} ${deck + freeboard * 0.25} Z`}
          stroke-width="2"
        />
        <path d={`M ${left + 14} ${deck + freeboard * 0.55} H ${right - 18}`} stroke-width="1" opacity="0.7" />
        <path
          d={`M ${cabinLeft} ${deck} L ${cabinLeft + 10} ${roof} L ${cabinRight - 6} ${roof} L ${cabinRight} ${deck}`}
          stroke-width="1.75"
        />
        {Array.from({ length: 4 }, (_, i) => {
          const span = (cabinRight - cabinLeft - 28) / 4;
          const x = cabinLeft + 14 + i * span;
          return <rect key={i} x={x} y={roof + cabin * 0.3} width={span - 6} height={cabin * 0.36} rx="2" stroke-width="1.25" />;
        })}
        <path d={`M ${solarLeft} ${roof - 4} H ${solarRight}`} stroke-width="2.5" />
        {Array.from({ length: panels + 1 }, (_, i) => {
          const x = solarLeft + ((solarRight - solarLeft) / panels) * i;
          return <path key={i} d={`M ${x} ${roof - 7} V ${roof - 1}`} stroke-width="1" />;
        })}
        <path d={`M ${solarLeft + 10} ${roof - 4} L ${cabinLeft + 6} ${roof}`} stroke-width="1" />
        <path d={`M ${solarRight - 10} ${roof - 4} L ${cabinRight - 4} ${roof}`} stroke-width="1" />
        <path d={`M ${left + hull * 0.3} ${water + 9} q 8 -4 16 0 t 16 0`} stroke-width="1" opacity="0.5" />
        <path d={`M ${left + hull * 0.62} ${water + 13} q 7 -3 14 0 t 14 0`} stroke-width="1" opacity="0.4" />
      </g>
    </svg>
  );
}

/** Three pulsing dots while a screen's first data loads; they fade out over 720 ms once it has arrived. */
export function Loader({ active }: { active: boolean }) {
  const was = useRef(active);
  const [fading, setFading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const leaving = was.current && !active && !prefersReducedMotion();
  useLayoutEffect(() => {
    if (active) {
      was.current = true;
      return;
    }
    if (!was.current) return;
    was.current = false;
    if (!leaving || !ref.current) return;
    setFading(true);
    const fade = ref.current.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 720, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" });
    fade.finished.then(() => setFading(false), () => undefined);
  }, [active]);
  if (!active && !fading && !leaving) return null;
  return (
    <div class={active ? "loader" : "loader loader--leaving"} ref={ref} aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}
