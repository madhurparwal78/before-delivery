import { useId } from "react";

// The contact-hour seal: a pressed terracotta mark. Wedges are pie sectors drawn as stroked arcs (pathLength 360)
// so a sweep is one stroke-dasharray change; unverified wedges are hatched outlines carrying their module number.

export type SealState = "open" | "pending" | "sealed" | "revoked";

interface SealModule {
  id: string;
  number: number;
  title: string;
  minutes: number;
  verified: boolean;
}

interface SealProps {
  modules: SealModule[];
  totalMinutes: number;
  state: SealState;
  /** The centre numeral, or null when there is no certificate yet. */
  numeral: string | null;
  ringText: { serial: string; issued: string } | null;
  ringFade?: boolean;
  /** Verified wedges that have not landed yet during the Seal press. */
  unlanded?: ReadonlySet<string>;
  /** Verified wedges whose sweep is animating; settled wedges are drawn as filled sectors. */
  sweeping?: ReadonlySet<string>;
  registerWedge?: (moduleId: string, element: SVGCircleElement | null) => void;
}

const C = 120;
const WEDGE_R = 92;
const RING_R = 116;
const GAP = 96;

const point = (degrees: number, r: number): [number, number] => {
  const radians = (degrees * Math.PI) / 180;
  return [C + r * Math.sin(radians), C - r * Math.cos(radians)];
};

function sector(start: number, end: number, r: number): string {
  const [x1, y1] = point(start, r);
  const [x2, y2] = point(end, r);
  return `M ${C} ${C} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${end - start > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
}

function arc(from: number, to: number, r: number, clockwise: boolean): string {
  const [x1, y1] = point(from, r);
  const [x2, y2] = point(to, r);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 ${clockwise ? 1 : 0} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/** A wedge's final sweep: its minutes over the course's total minutes, times 360 degrees. */
export const wedgeSweep = (minutes: number, totalMinutes: number): number => (totalMinutes === 0 ? 0 : (minutes * 360) / totalMinutes);

export function Seal({ modules, totalMinutes, state, numeral, ringText, ringFade = false, unlanded, sweeping, registerWedge }: SealProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const hatch = `hatch-${uid}`;
  const mask = `gap-${uid}`;
  const top = `top-${uid}`;
  const bottom = `bottom-${uid}`;
  let start = 0;
  const wedges = modules.map((m) => {
    const sweep = wedgeSweep(m.minutes, totalMinutes);
    const wedge = { ...m, start, sweep };
    start += sweep;
    return wedge;
  });
  const half = state === "pending" ? GAP / 2 : 0;
  const numeralSize = numeral === null ? 0 : numeral.length <= 4 ? 36 : numeral.length === 5 ? 30 : 25;

  return (
    <svg className="seal-svg" viewBox="0 0 240 240" shapeRendering="geometricPrecision" role="img" aria-label="Contact-hour seal" data-seal-state={state}>
      <defs>
        <pattern id={hatch} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" fill="var(--ground)" />
          <line x1="0" y1="0" x2="0" y2="5" stroke="var(--terracotta)" strokeWidth="1.2" />
        </pattern>
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="240" height="240">
          <rect width="240" height="240" fill="white" />
          <circle
            className="gap-mask"
            cx={C}
            cy={C}
            r="61"
            fill="none"
            stroke="black"
            strokeWidth="124"
            pathLength={360}
            transform={`rotate(-90 ${C} ${C})`}
            style={{ strokeDasharray: `${half} ${360 - 2 * half} ${half} 0` }}
          />
        </mask>
        <path id={top} d={arc(-80, 80, 101, true)} />
        <path id={bottom} d={arc(-100, 100, 108, false)} />
      </defs>

      <g mask={state === "pending" || ringFade ? `url(#${mask})` : undefined} opacity={state === "revoked" ? 0.4 : 1}>
        <circle cx={C} cy={C} r={RING_R} fill="none" stroke="var(--terracotta)" strokeWidth="1.5" />
        {wedges.map((w) =>
          w.verified ? (
            <g key={w.id} data-module-id={w.id} data-state="verified" data-sweep={w.sweep.toFixed(1)}>
              <title>{`${w.number}. ${w.title}: verified`}</title>
              {unlanded?.has(w.id) || sweeping?.has(w.id) ? (
              <circle
                ref={(el) => registerWedge?.(w.id, el)}
                cx={C}
                cy={C}
                r={WEDGE_R / 2}
                fill="none"
                stroke="var(--terracotta)"
                strokeWidth={WEDGE_R}
                pathLength={360}
                strokeDasharray={unlanded?.has(w.id) ? "0 360" : `${w.sweep} 360`}
                transform={`rotate(${w.start - 90} ${C} ${C})`}
              />
              ) : w.sweep >= 359.95 ? (
                <circle cx={C} cy={C} r={WEDGE_R} fill="var(--terracotta)" />
              ) : (
                <path d={sector(w.start, w.start + w.sweep, WEDGE_R)} fill="var(--terracotta)" />
              )}
            </g>
          ) : (
            <g key={w.id} data-module-id={w.id} data-state="unverified" data-sweep={w.sweep.toFixed(1)}>
              <title>{`${w.number}. ${w.title}: not yet verified`}</title>
              <path d={sector(w.start, w.start + w.sweep, WEDGE_R)} fill={`url(#${hatch})`} stroke="var(--terracotta)" strokeWidth="1.2" strokeLinejoin="round" />
            </g>
          ),
        )}
        {wedges.length > 1 &&
          wedges.map((w, i) => {
            // A boundary touching a hatched wedge keeps a crisp terracotta edge inside a paper gap.
            const previous = wedges[(i + wedges.length - 1) % wedges.length];
            const outlined = !w.verified || (previous !== undefined && !previous.verified);
            const [x1, y1] = point(w.start, 44);
            const [x2, y2] = point(w.start, WEDGE_R);
            const ends = { x1: x1.toFixed(2), y1: y1.toFixed(2), x2: x2.toFixed(2), y2: y2.toFixed(2) };
            return (
              <g key={`sep-${w.id}`} aria-hidden="true">
                <line {...ends} stroke="var(--ground)" strokeWidth={outlined ? 3.5 : 1.5} />
                {outlined && <line {...ends} stroke="var(--terracotta)" strokeWidth="1.2" />}
              </g>
            );
          })}
        {wedges
          .filter((w) => !w.verified)
          .map((w) => {
            const [x, y] = point(w.start + w.sweep / 2, 68);
            return (
              <g key={`label-${w.id}`} aria-hidden="true">
                <circle cx={x.toFixed(2)} cy={y.toFixed(2)} r="9" fill="var(--ground)" stroke="var(--terracotta)" strokeWidth="1" />
                <text className="wedge-label" x={x.toFixed(2)} y={(y + 4).toFixed(2)} textAnchor="middle">
                  {w.number}
                </text>
              </g>
            );
          })}
      </g>

      <circle cx={C} cy={C} r="44" fill="var(--ground)" stroke="var(--terracotta)" strokeWidth="0.8" />
      {numeral === null ? (
        <text className="numeral-caption" x={C} y={C + 4} textAnchor="middle">
          OPEN SEAL
        </text>
      ) : (
        <>
          <text className="numeral" x={C} y={C + 8} textAnchor="middle" fontSize={numeralSize} data-seal-numeral="">
            {numeral}
          </text>
          <text className="numeral-caption" x={C} y={C + 26} textAnchor="middle">
            {state === "revoked" ? "REVOKED" : "HOURS"}
          </text>
        </>
      )}
      {state === "revoked" && <line x1="62" y1="178" x2="178" y2="62" stroke="var(--terra-deep)" strokeWidth="2" />}

      {state === "pending" && (
        <text className="pending-label">
          <textPath href={`#${top}`} startOffset="50%" textAnchor="middle">
            Certificate PDF pending
          </textPath>
        </text>
      )}
      {ringText && (
        <g data-seal-ring="" className={ringFade ? "ring-fade" : undefined}>
          <text className="ring-text">
            <textPath href={`#${top}`} startOffset="50%" textAnchor="middle">
              {ringText.serial}
            </textPath>
          </text>
          <text className="ring-text">
            <textPath href={`#${bottom}`} startOffset="50%" textAnchor="middle">
              {`Issued ${ringText.issued}`}
            </textPath>
          </text>
        </g>
      )}
    </svg>
  );
}
