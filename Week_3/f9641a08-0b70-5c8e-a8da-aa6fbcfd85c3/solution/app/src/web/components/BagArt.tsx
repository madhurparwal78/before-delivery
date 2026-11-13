// Vector bag studies. The masthead draws them in greys; the Gate Gauge draws the bag in the variant's colour.

type StudyKind = "suitcase" | "backpack" | "tote" | "duffel";

interface Study {
  kind: StudyKind;
  ground: string;
  ink: string;
  mid: string;
}

export function MastheadStudy({ kind, ground, ink, mid }: Study) {
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" width="100%" height="100%" aria-hidden="true" focusable="false">
      <rect width="100" height="100" fill={ground} />
      {kind === "suitcase" && (
        <g>
          <rect x="30" y="16" width="40" height="64" fill={mid} stroke={ink} strokeWidth="2" />
          {[38, 46, 54, 62].map((x) => (
            <rect key={x} x={x} y="20" width="3" height="56" fill={ink} opacity="0.55" />
          ))}
          <rect x="41" y="8" width="18" height="8" fill="none" stroke={ink} strokeWidth="2.5" />
          <rect x="34" y="80" width="6" height="5" fill={ink} />
          <rect x="60" y="80" width="6" height="5" fill={ink} />
        </g>
      )}
      {kind === "backpack" && (
        <g>
          <rect x="30" y="20" width="40" height="62" fill={mid} stroke={ink} strokeWidth="2" />
          <rect x="30" y="20" width="40" height="18" fill={ink} opacity="0.5" />
          <rect x="37" y="52" width="26" height="22" fill="none" stroke={ink} strokeWidth="2" />
          <rect x="43" y="10" width="14" height="10" fill="none" stroke={ink} strokeWidth="2.5" />
          <rect x="24" y="30" width="6" height="40" fill={ink} />
          <rect x="70" y="30" width="6" height="40" fill={ink} />
        </g>
      )}
      {kind === "tote" && (
        <g>
          <polygon points="26,34 74,34 70,82 30,82" fill={mid} stroke={ink} strokeWidth="2" />
          <path d="M36 34 L36 16 L64 16 L64 34" fill="none" stroke={ink} strokeWidth="3" />
          <rect x="40" y="48" width="20" height="14" fill={ink} opacity="0.45" />
        </g>
      )}
      {kind === "duffel" && (
        <g>
          <rect x="16" y="38" width="68" height="36" fill={mid} stroke={ink} strokeWidth="2" />
          <rect x="16" y="38" width="68" height="8" fill={ink} opacity="0.5" />
          <path d="M34 38 L40 22 L60 22 L66 38" fill="none" stroke={ink} strokeWidth="3" />
          <rect x="45" y="50" width="10" height="16" fill={ink} opacity="0.55" />
        </g>
      )}
    </svg>
  );
}

/** The Gate Gauge bag body: stretched to its true height and width, in the variant colour. */
export function GaugeBagArt({ colour }: { colour: string }) {
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true" focusable="false">
      <rect x="0" y="0" width="100" height="100" fill={colour} />
      {[22, 38, 54, 70].map((x) => (
        <rect key={x} x={x} y="14" width="3" height="76" fill="#000" opacity="0.18" />
      ))}
      <rect x="0" y="94" width="100" height="6" fill="#000" opacity="0.35" />
    </svg>
  );
}
