import type { Award, Cut } from "./api";

// Lucide icon paths (ISC), inlined as SVG, and the status markers: always a glyph plus a text label
// (brief: Icons; Status markers).

const PATHS = {
  triangle: ["M13.73 4a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"],
  star: ["M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"],
  circle: ["M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20"],
  x: ["M18 6 6 18", "m6 6 12 12"],
  "arrow-up": ["m5 12 7-7 7 7", "M12 19V5"],
  "arrow-down": ["M12 5v14", "m19 12-7 7-7-7"],
  upload: ["M12 3v12", "m17 8-5-5-5 5", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"],
  "trash-2": ["M10 11v6", "M14 11v6", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", "M3 6h18", "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"],
  "log-out": ["m16 17 5-5-5-5", "M21 12H9", "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"],
} as const;

type IconName = keyof typeof PATHS;

export function Icon({ name, filled = false }: { name: IconName; filled?: boolean }) {
  return (
    <svg class={`icon${filled ? " icon--filled" : ""}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {PATHS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

/** The SVG markup of an icon, for rows the standings ledger builds outside Preact. */
export function iconMarkup(name: IconName, filled = false): string {
  return `<svg class="icon${filled ? " icon--filled" : ""}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${
    PATHS[name].map((d) => `<path d="${d}"/>`).join("")}</svg>`;
}

const CUT_MARKERS: Record<Cut, { icon: IconName; filled: boolean; label: string }> = {
  above: { icon: "triangle", filled: true, label: "Above cut" },
  below: { icon: "triangle", filled: false, label: "Below cut" },
};

const AWARD_MARKERS: Record<Award, { icon: IconName; filled: boolean; label: string }> = {
  winner: { icon: "star", filled: true, label: "Winner" },
  finalist: { icon: "star", filled: false, label: "Finalist" },
  honourable_mention: { icon: "circle", filled: false, label: "Honourable mention" },
};

export const AWARD_LABEL: Record<Award, string> = {
  winner: "Winner", finalist: "Finalist", honourable_mention: "Honourable mention",
};

export function markerMarkup(kind: Cut | Award): string {
  const marker = kind === "above" || kind === "below" ? CUT_MARKERS[kind] : AWARD_MARKERS[kind];
  return `<span class="marker marker--${kind}">${iconMarkup(marker.icon, marker.filled)}<span>${marker.label}</span></span>`;
}

export function Marker({ kind }: { kind: Cut | Award }) {
  const marker = kind === "above" || kind === "below" ? CUT_MARKERS[kind] : AWARD_MARKERS[kind];
  return <span class={`marker marker--${kind}`}><Icon name={marker.icon} filled={marker.filled} /><span>{marker.label}</span></span>;
}
