import type { JSX } from "preact";

const base: JSX.SVGAttributes<SVGSVGElement> = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": 1.75,
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "aria-hidden": "true",
  focusable: "false",
};

export const PencilIcon = () => (
  <svg {...base}>
    <path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z" />
    <path d="M14 7l3 3" />
  </svg>
);

export const StarIcon = () => (
  <svg {...base}>
    <path d="M12 3.5l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.9 6.7 19.9l1.2-6L3.4 9.8l6-.7z" />
  </svg>
);

export const MeasureIcon = () => (
  <svg {...base}>
    <circle cx="5.5" cy="18.5" r="2.5" />
    <circle cx="18.5" cy="5.5" r="2.5" />
    <path d="M7.3 16.7l9.4-9.4" />
  </svg>
);

export const UndoIcon = () => (
  <svg {...base}>
    <path d="M9 7L4 12l5 5" />
    <path d="M4 12h10a6 6 0 0 1 0 12" transform="translate(0 -5)" />
  </svg>
);

export const ClearIcon = () => (
  <svg {...base}>
    <path d="M5 7h14" />
    <path d="M9 7V4.5h6V7" />
    <path d="M7 7l1 13h8l1-13" />
  </svg>
);

export const WidthIcon = ({ weight }: { weight: number }) => (
  <svg {...base} stroke-width={weight}>
    <path d="M4 17c4-9 12-9 16 0" />
  </svg>
);

export const RingIcon = () => (
  <svg width="96" height="96" viewBox="0 0 96 96" fill="none" aria-hidden="true" focusable="false">
    <circle cx="48" cy="48" r="44" stroke="currentColor" stroke-width="1.5" opacity=".55" />
    <circle cx="48" cy="48" r="30" stroke="currentColor" stroke-width="1" opacity=".25" />
    <circle cx="62" cy="34" r="3" fill="currentColor" />
    <circle cx="36" cy="58" r="2" fill="currentColor" />
    <circle cx="52" cy="62" r="1.5" fill="currentColor" />
    <path d="M44 48h8M48 44v8" stroke="currentColor" stroke-width="1" />
  </svg>
);
