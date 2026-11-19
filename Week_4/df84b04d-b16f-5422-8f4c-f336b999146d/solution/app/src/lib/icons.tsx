import type { SVGProps } from "react";

const base: SVGProps<SVGSVGElement> = {
  width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5,
  strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: false,
};

const make = (paths: string[], extra: SVGProps<SVGSVGElement> = {}) => (props: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...extra} {...props}>{paths.map((d) => <path key={d} d={d} />)}</svg>
);

export const IconBack = make(["M14.5 6 8.5 12l6 6"]);
export const IconForward = make(["M9.5 6l6 6-6 6"]);
export const IconHome = make(["M4 11.5 12 5l8 6.5", "M6 10.5V19h12v-8.5", "M10 19v-5h4v5"]);
export const IconSearch = make(["M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z", "m15.5 15.5 4 4"]);
export const IconUndo = make(["M9 8 5 12l4 4", "M5 12h9a5 5 0 0 1 0 10h-3"], { viewBox: "0 0 24 26" });
export const IconRedo = make(["m15 8 4 4-4 4", "M19 12h-9a5 5 0 0 0 0 10h3"], { viewBox: "0 0 24 26" });
export const IconDownload = make(["M12 4v11", "m7.5 11 4.5 4.5 4.5-4.5", "M5 19h14"]);
export const IconShare = make(["M12 15V4", "m7.5 8 4.5-4.5L16.5 8", "M6 12v7h12v-7"]);
export const IconBoard = make(["M4 5h4.5v14H4z", "M9.75 5h4.5v9h-4.5z", "M15.5 5H20v12h-4.5z"]);
export const IconList = make(["M9 7h11", "M9 12h11", "M9 17h11", "M4.5 7h.01", "M4.5 12h.01", "M4.5 17h.01"]);
export const IconMenu = make(["M4 7h16", "M4 12h16", "M4 17h16"]);
export const IconClose = make(["m6 6 12 12", "M18 6 6 18"]);
export const IconAt = make(["M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z", "M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1"]);
export const IconIndent = make(["M4 6h16", "M11 12h9", "M11 18h9", "M4 10l3 2-3 2"]);
export const IconOutdent = make(["M4 6h16", "M11 12h9", "M11 18h9", "M7 10l-3 2 3 2"]);
export const IconUp = make(["M12 19V6", "m6.5 11.5 5.5-5.5 5.5 5.5"]);
export const IconDown = make(["M12 5v13", "m6.5 12.5 5.5 5.5 5.5-5.5"]);
export const IconCollapse = make(["m7 9 5 5 5-5"]);
export const IconCheck = make(["m5 12.5 4.5 4.5L19 7.5"]);
export const IconZoomIn = make(["M14 4h6v6", "m20 4-7 7", "M10 20H4v-6", "m4 20 7-7"]);
export const IconZoomOut = make(["M20 10h-6V4", "m14 10 7-7", "M4 14h6v6", "m10 14-7 7"]);
export const IconMirror = make(["M8 8h11v11H8z", "M5 16V5h11"]);
export const IconTrash = make(["M5 7h14", "M9 7V5h6v2", "m7 7 1 12h8l1-12", "M10 11v5", "M14 11v5"]);
export const IconNext = make(["M5 12h14", "m13 6 6 6-6 6"], { width: 22, height: 22 });

export function Brand({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none">
        <path d="M16 27V14M16 14 9.5 8M16 19l6.5-6M16 23l-5-4.5" />
      </g>
      <g fill="currentColor">
        <circle cx="9" cy="7.5" r="2.2" />
        <circle cx="23" cy="12.5" r="2.2" />
        <circle cx="10" cy="18.5" r="2.2" />
        <circle cx="16" cy="6" r="2.2" />
      </g>
    </svg>
  );
}

export function Twig({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false" fill="none">
      <g stroke="#9aa2a6" strokeWidth="3" strokeLinecap="round">
        <path d="M32 58V30M32 30 17 15M32 42l15-14M32 50l-10-9" />
      </g>
      <g fill="#9aa2a6">
        <circle cx="16" cy="14" r="4" /><circle cx="48" cy="26" r="4" /><circle cx="21" cy="39" r="4" /><circle cx="32" cy="10" r="4" />
      </g>
    </svg>
  );
}
