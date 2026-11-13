// The long section, drawn to scale: distance along the route across, depth up and down. The seabed
// steps at each controlling depth, the water line stands at each waypoint's height when the hull
// arrives, and the hull floats at draught plus squat.
import { useEffect, useRef, useState } from "react";
import { signedMetres } from "../../shared/numerals";
import type { Plan, Waypoint } from "../../shared/types";

const TOP_MM = 11_200;
const BOTTOM_MM = -7_000;
const LABEL_BAND = 30;
const FREEBOARD_MM = 1_600;

function useSize<T extends Element>(): [React.RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

interface DrawingProps {
  waypoints: readonly Waypoint[];
  berthNm: number;
  plan: Plan | null;
  hull: number;
}

export function Drawing({ waypoints, berthNm, plan, hull }: DrawingProps) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const padX = 10;
  const plotH = Math.max(10, h - LABEL_BAND - 2);
  const x = (nm: number): number => padX + (nm / berthNm) * (w - 2 * padX);
  const y = (mm: number): number => LABEL_BAND + ((TOP_MM - mm) / (TOP_MM - BOTTOM_MM)) * plotH;
  const narrow = w < 640;

  const points = waypoints.map((wp, i) => {
    const planned = plan?.waypoints[i];
    return { wp, planned, cx: x(wp.distance_nm), tide: planned?.tide_mm ?? 0 };
  });
  const mids = points.map((p, i) => {
    const next = points[i + 1];
    return next ? (p.wp.distance_nm + next.wp.distance_nm) / 2 : berthNm;
  });
  const seabed = points.flatMap((p, i) => {
    const from = i === 0 ? 0 : (mids[i - 1] ?? 0);
    const to = mids[i] ?? berthNm;
    const depth = y(-p.wp.sounded_depth_mm);
    return [`${x(from)},${depth}`, `${x(to)},${depth}`];
  });
  const bottom = LABEL_BAND + plotH + 2;
  const surface = plan
    ? [`${x(0)},${y(points[0]?.tide ?? 0)}`, ...points.map((p) => `${p.cx},${y(p.tide)}`), `${x(berthNm)},${y(points[points.length - 1]?.tide ?? 0)}`]
    : [];
  const heights = plan ? plan.waypoints.map((wp) => wp.sounded_depth_mm + wp.tide_mm).join(",") : "";

  // The hull: at its progress along the route, floating on the water line between waypoints.
  const hullNm = (hull / 100) * berthNm;
  const after = points.findIndex((p) => p.wp.distance_nm >= hullNm);
  const a = points[Math.max(0, after - 1)];
  const b = points[Math.max(0, after)] ?? points[points.length - 1];
  const span = a && b && b.wp.distance_nm !== a.wp.distance_nm ? (hullNm - a.wp.distance_nm) / (b.wp.distance_nm - a.wp.distance_nm) : 0;
  const waterAtHull = a && b ? a.tide + (b.tide - a.tide) * Math.min(1, Math.max(0, span)) : 0;
  const nearest = (hullNm - (a?.wp.distance_nm ?? 0) < (b?.wp.distance_nm ?? 0) - hullNm ? a : b)?.planned;
  const keel = waterAtHull - (plan?.draught_mm ?? 0) - (nearest?.squat_mm ?? 0);
  // The hull is drawn to scale vertically (keel at draught plus squat); its length is a legible marker.
  const hullPx = Math.min(64, Math.max(44, w * 0.045));
  const hx = Math.min(Math.max(x(hullNm), padX + hullPx / 2), w - padX - hullPx / 2);
  const deck = y(waterAtHull + FREEBOARD_MM);
  const keelY = y(keel);
  const stern = hx - hullPx / 2;
  const bow = hx + hullPx / 2;
  const depth = keelY - deck;
  // Transom stern aft (toward the boarding ground), raked bow forward (toward the berth).
  const hullShape = [
    `M${stern},${deck}`,
    `L${bow + hullPx * 0.08},${deck}`,
    `L${bow - hullPx * 0.06},${keelY - depth * 0.35}`,
    `Q${bow - hullPx * 0.1},${keelY} ${bow - hullPx * 0.22},${keelY}`,
    `L${stern + hullPx * 0.08},${keelY}`,
    `L${stern},${keelY - depth * 0.25}`,
    "Z",
  ].join(" ");
  const tier = Math.max(5, depth * 0.2);
  const bridge = [
    `M${stern + hullPx * 0.04},${deck}`,
    `V${deck - tier}`,
    `H${stern + hullPx * 0.12}`,
    `V${deck - 2 * tier}`,
    `H${stern + hullPx * 0.26}`,
    `V${deck - tier}`,
    `H${stern + hullPx * 0.32}`,
    `V${deck}`,
    "Z",
  ].join(" ");
  const keelLine = plan ? points.map((p) => `${p.cx},${y(p.tide - plan.draught_mm - (p.planned?.squat_mm ?? 0))}`) : [];
  const lastKeelY = Number(keelLine[keelLine.length - 1]?.split(",")[1] ?? 0);
  const berthWaypoint = plan?.waypoints[plan.waypoints.length - 1];
  const keelAground = (berthWaypoint?.clearance_mm ?? 0) < 0;
  // Aground, the label sits on the seabed line above the coral bar; afloat, just above the keel line.
  const keelLabelY = Math.min(Math.max((keelAground ? y(-(berthWaypoint?.sounded_depth_mm ?? 0)) : lastKeelY) - 4, LABEL_BAND + 12), h - 4);
  const pinch = points.find((p) => p.planned?.pinch);

  return (
    <div ref={ref} className="drawing">
      {w > 0 && h > 0 ? (
        <svg width={w} height={h} role="img" aria-label="Long section from the boarding ground to the berth">
          <defs>
            <pattern id="sediment" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" className="hatch-ground" />
              <line x1="0" y1="0" x2="0" y2="6" className="hatch" />
            </pattern>
            <clipPath id="below-water">
              <polygon points={[...surface, `${x(berthNm)},${bottom}`, `${x(0)},${bottom}`].join(" ")} />
            </clipPath>
          </defs>
          <line x1={x(0)} x2={x(berthNm)} y1={y(0)} y2={y(0)} className="datum" />
          <text x={x(0) + 2} y={y(0) - 3} className="datum-label">
            CD
          </text>
          {plan ? <polygon className="water" points={[...surface, ...[...seabed].reverse()].join(" ")} /> : null}
          <polygon className="seabed" points={[...seabed, `${x(berthNm)},${bottom}`, `${x(0)},${bottom}`].join(" ")} />
          <polyline className="seabed-line" points={seabed.join(" ")} />
          {points.map((p) => {
            // Each bar is the waypoint's water column, water line to seabed (its water depth to scale);
            // the cap marks the keel at draught plus squat, so the bar below the cap is the clearance.
            const clearance = p.planned?.clearance_mm ?? 0;
            const keelAt = y(-p.wp.sounded_depth_mm + clearance);
            const bed = y(-p.wp.sounded_depth_mm);
            const surfaceAt = y(p.tide);
            return (
              <g key={p.wp.id} data-testid={`bar-${p.wp.id}`} className={clearance < 0 ? "bar short" : "bar"}>
                <rect x={p.cx - 5} width="10" y={Math.min(surfaceAt, bed)} height={Math.max(1, Math.abs(bed - surfaceAt))} />
                <line className="bar-cap" x1={p.cx - 5} x2={p.cx + 5} y1={keelAt} y2={keelAt} />
              </g>
            );
          })}
          <g className="hull" data-testid="hull" data-progress={String(hull)}>
            {plan ? (
              <>
                <path d={hullShape} />
                <path className="bridge" d={bridge} />
                <line className="deck-line" x1={stern} x2={bow + hullPx * 0.08} y1={deck} y2={deck} />
              </>
            ) : null}
          </g>
          {plan ? (
            <g clipPath="url(#below-water)">
              <rect x="0" y="0" width={w} height={bottom} className="water-veil" />
            </g>
          ) : null}
          {plan ? (
            <>
              <polyline className="keel-line" points={keelLine.join(" ")} />
              <text x={w - 4} y={keelLabelY} textAnchor="end" className="keel-label">
                {keelAground ? "Keel below seabed" : "Keel at draught + squat"}
              </text>
            </>
          ) : null}
          {plan ? <polyline className="water-line" data-testid="water-line" data-heights-mm={heights} points={surface.join(" ")} /> : null}
          {pinch ? (
            <g className="pinch-marker" style={{ transform: `translateX(${pinch.cx}px)` }}>
              <line x1="0" x2="0" y1={LABEL_BAND - 2} y2={bottom} />
              <polygon points={`-5,${LABEL_BAND - 2} 5,${LABEL_BAND - 2} 0,${LABEL_BAND + 5}`} />
            </g>
          ) : null}
          {points.map((p, i) => {
            const prior = i === 0 ? 0 : (points[i - 1]?.wp.distance_nm ?? 0);
            const name = narrow ? (p.wp.name.split(" ")[0] ?? p.wp.name) : p.wp.name;
            const half = (name.length * 6.6) / 2 + 2;
            const labelX = Math.min(Math.max(p.cx, half), w - half);
            const anchor = "middle";
            const row = narrow && i % 2 === 1 ? 2 : 1;
            return (
              <g key={`label-${p.wp.id}`}>
                <text x={labelX} y={row === 1 ? 11 : 23} textAnchor={anchor} className="wp-name">
                  {name}
                </text>
                {p.planned && !narrow ? (
                  <text x={labelX} y={23} textAnchor={anchor} className={p.planned.margin_mm < 0 ? "wp-margin short" : "wp-margin"}>
                    {signedMetres(p.planned.margin_mm)} m
                  </text>
                ) : null}
                {p.wp.speed_limit_kn !== null ? (
                  <text x={(x(prior) + p.cx) / 2} y={(plan ? y(Math.max(p.tide, points[i - 1]?.tide ?? 0)) : y(0)) - 4} textAnchor="middle" className="speed-limit">
                    {p.wp.speed_limit_kn} kn
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      ) : null}
    </div>
  );
}
