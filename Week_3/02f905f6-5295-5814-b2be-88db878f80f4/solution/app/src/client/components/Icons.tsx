// Line icons drawn for the app, always beside visible text.
const base = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, focusable: false };

export const CameraIcon = () => (
  <svg {...base}>
    <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);

export const SignOutIcon = () => (
  <svg {...base}>
    <path d="M14 4h5v16h-5" />
    <path d="M10 8l-4 4 4 4M6 12h10" />
  </svg>
);

export const ArrowIcon = ({ turn }: { turn: 0 | 90 | 180 | 270 }) => (
  <svg {...base} style={{ transform: `rotate(${turn}deg)` }}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const RotateIcon = () => (
  <svg {...base}>
    <path d="M20 11a8 8 0 1 1-2.4-5.7" />
    <path d="M20 4v5h-5" />
  </svg>
);
