import { useState } from "react";
import { useOnScreen, useReducedMotion } from "../lib/motion.ts";
import { cssVarsOf } from "../lib/cssVars.ts";

const REPEATS = 4;

/** Validator monograms drift sideways at one monogram every two seconds; the drift pauses on hover and off-screen. */
export function Marquee({ names }: { names: string[] }) {
  const reduced = useReducedMotion();
  const [ref, onScreen] = useOnScreen<HTMLElement>();
  const [hovered, setHovered] = useState(false);
  const motion = reduced ? "off" : hovered || !onScreen ? "paused" : "running";
  const strip = Array.from({ length: REPEATS }, () => names).flat();

  const monograms = (hidden: boolean) => (
    <ul className="marquee__set" aria-hidden={hidden || undefined}>
      {strip.map((name, index) => (
        <li key={index} className="monogram" title={name}>
          <span className={`monogram__disc tone-${(name.charCodeAt(0) * 7) % 5}`}>{name.slice(0, 2)}</span>
          <span className="monogram__name">{name}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <section ref={ref} aria-label="Validators" data-motion={motion} className="marquee"
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div className="marquee__track" style={cssVarsOf({ "--count": strip.length })}>
        {monograms(false)}
        {monograms(true)}
      </div>
    </section>
  );
}
