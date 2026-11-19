import { useReducedMotion } from "../lib/hooks";

const SOURCE_TO_HUB = "M70 60 C 130 60, 150 60, 210 60";
const HUB_TO_WAREHOUSE = "M310 60 C 370 60, 390 60, 450 60";

/** The flow diagram moves while a job runs and is still when idle or under reduced motion. */
export function FlowDiagram({
  sourceName,
  destinationName,
  running,
  justFinished,
}: {
  sourceName: string;
  destinationName: string;
  running: boolean;
  justFinished: boolean;
}): JSX.Element {
  const reduced = useReducedMotion();
  const moving = running && !reduced;
  return (
    <svg
      viewBox="0 0 520 120"
      className="flow-diagram"
      role="img"
      aria-label={`Data flow from ${sourceName} to ${destinationName}`}
    >
      <g aria-hidden="true">
        <rect x="6" y="40" width="64" height="40" rx="10" fill="var(--panel)" stroke="var(--hairline)" />
        <text x="38" y="64" textAnchor="middle" fontSize="10" fill="var(--body)" fontFamily="var(--typewriter)">
          SOURCE
        </text>
        <path
          d={SOURCE_TO_HUB}
          stroke="var(--lavender)"
          strokeWidth="2"
          fill="none"
          strokeDasharray="6 6"
          className={moving ? "flow-dash" : undefined}
        />
        <g className={moving ? "flow-hub" : undefined} style={{ transformOrigin: "260px 60px" }}>
          <rect x="210" y="34" width="100" height="52" rx="14" fill="url(#flow-hub)" />
          <text x="260" y="64" textAnchor="middle" fontSize="10" fill="#ffffff" fontFamily="var(--typewriter)">
            WAYLINE
          </text>
        </g>
        <path
          d={HUB_TO_WAREHOUSE}
          stroke="var(--violet)"
          strokeWidth="2"
          fill="none"
          strokeDasharray="6 6"
          className={moving ? "flow-dash" : undefined}
        />
        <rect x="450" y="40" width="64" height="40" rx="10" fill="var(--panel)" stroke="var(--hairline)" />
        <text x="482" y="64" textAnchor="middle" fontSize="10" fill="var(--body)" fontFamily="var(--typewriter)">
          TABLES
        </text>
        {moving ? (
          <>
            <circle r="4" fill="var(--glow)" className="flow-pulse" style={{ offsetPath: `path("${SOURCE_TO_HUB}")` }} />
            <circle
              r="4"
              fill="var(--glow)"
              className="flow-pulse"
              style={{ offsetPath: `path("${HUB_TO_WAREHOUSE}")`, animationDelay: "1.2s" }}
            />
          </>
        ) : null}
        {justFinished && !reduced ? (
          <circle cx="482" cy="60" r="10" fill="none" stroke="var(--violet)" strokeWidth="2" className="finish-ring" />
        ) : null}
        <defs>
          <linearGradient id="flow-hub" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--indigo-top)" />
            <stop offset="100%" stopColor="var(--indigo-bottom)" />
          </linearGradient>
        </defs>
      </g>
    </svg>
  );
}
