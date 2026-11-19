import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "../lib/hooks";

const TILES = ["Postgres", "CRM Cloud", "Ad Network", "Ticket Desk"];
const INCOMING = [
  "M120 40 C 220 40, 240 110, 330 110",
  "M120 95 C 215 95, 245 110, 330 110",
  "M120 150 C 215 150, 245 115, 330 115",
  "M120 205 C 220 205, 240 125, 330 125",
];
const OUTGOING = ["M430 100 C 500 100, 510 55, 580 55", "M430 130 C 500 130, 510 175, 580 175"];
const PATH_LENGTH = 420;

/** The architecture lines draw with the scroll, in exact proportion to it. */
export function Architecture(): JSX.Element {
  const frame = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) {
      setProgress(1);
      return;
    }
    const measure = () => {
      const node = frame.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const start = window.innerHeight;
      const end = window.innerHeight / 2 - rect.height / 2;
      const span = start - end;
      setProgress(Math.min(1, Math.max(0, (start - rect.top) / (span || 1))));
    };
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [reduced]);

  const drawn = progress;
  const outgoingDrawn = Math.max(0, (progress - 0.8) / 0.2);
  const pulsing = !reduced && progress >= 1;

  return (
    <div className="band" ref={frame}>
      <p className="eyebrow">Architecture</p>
      <h2>Every system, one moving layer</h2>
      <svg viewBox="0 0 680 250" className="flow-diagram" role="img" aria-label="Connectors sending data through the Wayline hub to AI agents and warehouses">
        <g aria-hidden="true">
          {TILES.map((tile, index) => (
            <g key={tile} opacity={0.25 + 0.75 * Math.min(1, drawn * 2)}>
              <rect x="10" y={22 + index * 55} width="110" height="36" rx="10" fill="var(--panel)" stroke="var(--hairline)" />
              <text x="65" y={45 + index * 55} textAnchor="middle" fontSize="12" fill="var(--body)" fontFamily="var(--typewriter)">
                {tile}
              </text>
            </g>
          ))}
          {INCOMING.map((path, index) => (
            <g key={path}>
              <path
                d={path}
                stroke="var(--lavender)"
                strokeWidth="2"
                fill="none"
                strokeDasharray={PATH_LENGTH}
                strokeDashoffset={PATH_LENGTH * (1 - drawn)}
              />
              {pulsing ? (
                <circle r="3.5" fill="var(--glow)" className="flow-pulse" style={{ offsetPath: `path("${path}")`, animationDelay: `${index * 0.4}s` }} />
              ) : null}
            </g>
          ))}
          <g className={pulsing ? "flow-hub" : undefined} style={{ transformOrigin: "380px 115px" }}>
            <rect x="330" y="80" width="100" height="70" rx="16" fill="url(#hub)" />
            <text x="380" y="120" textAnchor="middle" fontSize="12" fill="#ffffff" fontFamily="var(--typewriter)">
              WAYLINE
            </text>
          </g>
          {OUTGOING.map((path) => (
            <path
              key={path}
              d={path}
              stroke="var(--violet)"
              strokeWidth="2"
              fill="none"
              strokeDasharray={PATH_LENGTH}
              strokeDashoffset={PATH_LENGTH * (1 - outgoingDrawn)}
            />
          ))}
          <rect x="580" y="36" width="90" height="38" rx="10" fill="var(--panel)" stroke="var(--hairline)" />
          <text x="625" y="60" textAnchor="middle" fontSize="12" fill="var(--body)" fontFamily="var(--typewriter)">
            AI agents
          </text>
          <rect x="580" y="156" width="90" height="38" rx="10" fill="var(--panel)" stroke="var(--hairline)" />
          <text x="625" y="180" textAnchor="middle" fontSize="12" fill="var(--body)" fontFamily="var(--typewriter)">
            Warehouses
          </text>
          <defs>
            <linearGradient id="hub" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--indigo-top)" />
              <stop offset="100%" stopColor="var(--indigo-bottom)" />
            </linearGradient>
          </defs>
        </g>
      </svg>
    </div>
  );
}
