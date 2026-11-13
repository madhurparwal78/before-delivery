import type { ReactNode } from "react";

/** Scroll distance over which the tiers go from closed to fully open. */
const SCRUB_PX = 900;

/** Openness of the stack: a pure function of the scroll position, 0 closed and 1 open. */
export function openness(scrollY: number): number {
  return Math.min(1, Math.max(0, scrollY / SCRUB_PX));
}

const LEFT = 20;
const RIGHT = 340;
const TIERS = [
  { name: "tier-1", top: 430 },
  { name: "tier-2", top: 340 },
  { name: "tier-3", top: 250 },
] as const;
const TIER_HEIGHT = 90;

/** One steel piece: a steel body, a darker right-hand facet and one light highlight band, clipped to the piece's own outline. */
function Piece({ id, outline, top, height, children }: { id: string; outline: ReactNode; top: number; height: number; children?: ReactNode }): ReactNode {
  return (
    <>
      <defs>
        <clipPath id={`tiffin-${id}`}>{outline}</clipPath>
      </defs>
      <g clipPath={`url(#tiffin-${id})`}>
        <rect className="steel steel--mid" x={LEFT} y={top} width={RIGHT - LEFT} height={height} />
        <rect className="steel steel--dark" x="236" y={top} width={RIGHT - 236} height={height} />
        <rect className="steel steel--light" x="62" y={top} width="26" height={height} />
        {children}
      </g>
    </>
  );
}

/** The cut-out steel tiffin: a carry handle over an arch-topped lid, three rimmed tiers held by two side clamp bars, flat vector shapes;
 * the tiers and lid slide apart with `--open` (0 to 1) set on an ancestor while the handle and bars stay put. */
export function Tiffin({ className }: { className?: string }): ReactNode {
  return (
    <svg className={className} viewBox="0 0 360 540" aria-hidden="true" focusable="false">
      <path className="tiffin__handle" d="M15 236 V64 Q15 30 49 30 H311 Q345 30 345 64 V236" />
      <rect className="steel steel--light" x="150" y="22" width="60" height="16" rx="8" />
      {TIERS.map((tier, index) => (
        <g key={tier.name} className={`tiffin__${tier.name}`} style={{ transform: `translateY(calc(var(--open, 0) * ${-30 * index}px))` }}>
          <Piece id={tier.name} top={tier.top} height={TIER_HEIGHT} outline={<rect x={LEFT} y={tier.top} width={RIGHT - LEFT} height={TIER_HEIGHT} rx="10" />}>
            <rect className="steel steel--rim" x={LEFT} y={tier.top} width={RIGHT - LEFT} height="12" />
            <rect className="steel steel--rim" x={LEFT} y={tier.top + TIER_HEIGHT - 6} width={RIGHT - LEFT} height="6" />
          </Piece>
        </g>
      ))}
      <g className="tiffin__lid" style={{ transform: "translateY(calc(var(--open, 0) * -90px))" }}>
        <Piece id="lid" top={100} height={150} outline={<path d="M20 250 A160 150 0 0 1 340 250 Z" />}>
          <rect className="steel steel--rim" x={LEFT} y="236" width={RIGHT - LEFT} height="14" />
        </Piece>
        <rect className="steel steel--dark" x="166" y="86" width="28" height="22" rx="8" />
      </g>
      <g className="tiffin__frame">
        {[8, 338].map((x) => (
          <g key={x}>
            <rect className="steel steel--light" x={x} y="222" width="14" height="306" rx="7" />
            <rect className="steel steel--rim" x={x - 3} y="232" width="20" height="24" rx="6" />
            <rect className="steel steel--rim" x={x - 3} y="496" width="20" height="24" rx="6" />
          </g>
        ))}
      </g>
    </svg>
  );
}
