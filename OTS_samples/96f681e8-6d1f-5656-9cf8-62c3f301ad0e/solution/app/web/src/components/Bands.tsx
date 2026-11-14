/** Huge, faint white court-line strokes that cross the hero band edge to edge. */
export function CourtLines() {
  return (
    <svg className="court-lines" viewBox="0 0 1440 640" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <g stroke="#ffffff" strokeOpacity="0.12" strokeWidth="46" strokeLinecap="butt" fill="none">
        <path d="M-80 700L520 -60" />
        <path d="M260 740L1020 -80" />
        <path d="M760 760L1500 -10" />
        <path d="M-200 360L1640 360" strokeWidth="26" />
      </g>
    </svg>
  );
}

/** Angular, lighter-blue facets on the deeper cobalt step band. */
export function Facets() {
  return (
    <svg className="facets" viewBox="0 0 1440 520" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <g fill="#4a74ff" fillOpacity="0.35">
        <polygon points="0,0 420,0 180,300" />
        <polygon points="520,520 980,160 1100,520" />
        <polygon points="1440,0 1440,300 1130,0" />
      </g>
      <g fill="#6f93ff" fillOpacity="0.22">
        <polygon points="0,520 0,250 260,520" />
        <polygon points="640,0 880,0 760,200" />
        <polygon points="1440,520 1440,380 1250,520" />
      </g>
    </svg>
  );
}
