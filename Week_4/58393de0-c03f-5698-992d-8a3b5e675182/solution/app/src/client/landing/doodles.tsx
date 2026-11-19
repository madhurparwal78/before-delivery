import type { ReactNode } from "react";

/** Original outline doodles for the two blue bands: white strokes, round caps, cropped by the band's edges. */

const LINE = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function Corner({ side, children }: { side: "left" | "right"; children: ReactNode }) {
  return (
    <svg className={`band-doodles band-doodles--${side}`} viewBox="0 0 300 300" preserveAspectRatio={side === "left" ? "xMinYMin meet" : "xMaxYMax meet"} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

function Cylinder({ x, y, rx, ry, height }: { x: number; y: number; rx: number; ry: number; height: number }) {
  return (
    <g {...LINE}>
      <ellipse cx={x} cy={y} rx={rx} ry={ry} />
      <path d={`M${x - rx} ${y}v${height}a${rx} ${ry} 0 0 0 ${rx * 2} 0V${y}`} />
      <path d={`M${x - rx / 2} ${y + height * 0.45}h${rx}`} strokeDasharray="2 8" />
    </g>
  );
}

/** The classroom stats band: a cylinder, a squiggly U-loop and dashed lines in each corner, cropped at the band's edges. */
export function StatsDoodles() {
  return (
    <>
      <Corner side="left">
        <Cylinder x={26} y={74} rx={46} ry={16} height={104} />
        <g {...LINE}>
          <path d="M80 18H300" strokeDasharray="12 14" />
          <path d="M70 312c-6-60 8-92 52-92s58 32 52 92" />
          <path d="M70 262q10 14 24 4t28-4 28 4" />
        </g>
      </Corner>
      <Corner side="right">
        <Cylinder x={274} y={196} rx={52} ry={18} height={110} />
        <g {...LINE}>
          <path d="M-20 282H206" strokeDasharray="12 14" />
          <path d="M214 -12c8 54-6 84-48 84s-58-30-52-84" />
          <path d="M126 24q10-14 24-4t28 4" />
        </g>
      </Corner>
    </>
  );
}

/** The closing band: a dotted row, a dashed line ending in a rounded square, and a paper plane. */
export function ClosingDoodles() {
  return (
    <>
      <Corner side="left">
        <g fill="currentColor">
          {Array.from({ length: 8 }, (_, index) => <circle key={index} cx={34 + index * 22} cy={50} r={3} />)}
        </g>
        <g {...LINE}>
          <path d="M40 232l112-52-30 104-28-46zM94 238l58-58" />
          <path d="M-10 170q60-60 110-16" strokeDasharray="1 10" />
        </g>
      </Corner>
      <Corner side="right">
        <g {...LINE}>
          <path d="M244 -10V196" strokeDasharray="14 16" />
          <rect x="232" y="206" width="24" height="24" rx="6" />
        </g>
      </Corner>
    </>
  );
}
