// The true-scale shelf seen from above: one SVG unit is one inch. Round shelf, three posts, a faint
// half-inch grid with a stronger line every 5 in, placed footprints and the lifted one.
import { useId, useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import type { PlacedFootprint } from "../../shared/api";
import type { Footprint, Refusal, Shelf } from "../../shared/rules";
import { halvesOf } from "../format";
import { DURATION, tween } from "../motion";

const MARGIN = 0.6;

function Shape({ footprint, className }: { footprint: Footprint; className: string }) {
  const x = footprint.x / 2;
  const y = footprint.y / 2;
  const w = footprint.w / 2;
  const d = footprint.d / 2;
  return footprint.shape === "rectangular" ? (
    <rect className={className} x={x} y={y} width={w} height={d} rx={0.08} />
  ) : (
    <circle className={className} cx={x + w / 2} cy={y + w / 2} r={w / 2} />
  );
}

function ring(footprint: Footprint, grow: number): Footprint {
  return { ...footprint, x: footprint.x - grow * 2, y: footprint.y - grow * 2, w: footprint.w + grow * 4, d: footprint.d + grow * 4 };
}

const centreOf = (f: Footprint) => ({ cx: f.x / 2 + f.w / 4, cy: f.y / 2 + f.d / 4 });

function scaleAbout(element: SVGGElement, f: Footprint, scale: number) {
  const { cx, cy } = centreOf(f);
  element.setAttribute("transform", `translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})`);
}

export function placedFootprint(p: PlacedFootprint): Footprint {
  return { shape: p.shape, x: halvesOf(p.x), y: halvesOf(p.y), w: halvesOf(p.width_in), d: halvesOf(p.depth_in) };
}

function Placed({
  placement,
  fontSize,
  settleTick,
  open,
  onOpen,
}: {
  placement: PlacedFootprint;
  fontSize: number;
  settleTick: number | null;
  open: boolean;
  onOpen: (number: string, element: SVGGElement) => void;
}) {
  const ref = useRef<SVGGElement>(null);
  const shadow = useRef<SVGGElement>(null);
  const footprint = placedFootprint(placement);
  useLayoutEffect(() => {
    const element = ref.current;
    const shade = shadow.current;
    if (settleTick === null || !element || !shade) return;
    return tween(DURATION.place, (p) => {
      scaleAbout(element, footprint, 1.04 - 0.04 * p);
      shade.style.opacity = String(0.35 * (1 - p));
    });
  }, [settleTick]);
  const { cx, cy } = centreOf(footprint);
  const activate = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen(placement.piece_number, event.currentTarget);
    }
  };
  return (
    <>
      <g ref={shadow} className="fp-shadow" style={{ opacity: 0 }} aria-hidden="true">
        <Shape footprint={{ ...footprint, x: footprint.x + 0.5, y: footprint.y + 0.7 }} className="shadow-shape" />
      </g>
      <g
        ref={ref}
        className={`fp${open ? " is-open" : ""}`}
        role="button"
        tabIndex={0}
        aria-label={`Placed Piece ${placement.piece_number}`}
        data-piece={placement.piece_number}
        onClick={(event) => onOpen(placement.piece_number, event.currentTarget)}
        onKeyDown={activate}
      >
        <Shape footprint={ring(footprint, 0.2)} className="fp-ring" />
        <Shape footprint={ring(footprint, 0.09)} className="fp-gap" />
        <Shape footprint={footprint} className="fp-body" />
        <text x={cx} y={cy} className="fp-label" fontSize={fontSize} dominantBaseline="central" textAnchor="middle">
          {placement.piece_number}
        </text>
      </g>
    </>
  );
}

interface LiftedView {
  number: string;
  footprint: Footprint;
  refusal: Refusal | null;
}

function Lifted({
  lifted,
  fontSize,
  pxPerInch,
  onDrag,
}: {
  lifted: LiftedView;
  fontSize: number;
  pxPerInch: number;
  onDrag: (x: number, y: number) => void;
}) {
  const move = useRef<SVGGElement>(null);
  const lift = useRef<SVGGElement>(null);
  const shown = useRef({ x: lifted.footprint.x, y: lifted.footprint.y });
  const drag = useRef<{ id: number; startX: number; startY: number; x: number; y: number } | null>(null);
  const { footprint } = lifted;

  useLayoutEffect(() => {
    const element = lift.current;
    if (!element) return;
    return tween(DURATION.lift, (p) => {
      scaleAbout(element, { ...footprint, x: 0, y: 0 }, 1 + 0.04 * p);
      element.style.setProperty("--shadow", String(0.35 * p));
    });
  }, [lifted.number]);

  useLayoutEffect(() => {
    const element = move.current;
    if (!element) return;
    const from = { ...shown.current };
    const to = { x: footprint.x, y: footprint.y };
    if (from.x === to.x && from.y === to.y) {
      element.setAttribute("transform", `translate(${to.x / 2} ${to.y / 2})`);
      return;
    }
    return tween(DURATION.step, (p) => {
      shown.current = { x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p };
      element.setAttribute("transform", `translate(${shown.current.x / 2} ${shown.current.y / 2})`);
    });
  }, [footprint.x, footprint.y]);

  const local = { ...footprint, x: 0, y: 0 };
  const { cx, cy } = centreOf(local);
  const refused = lifted.refusal !== null;

  const down = (event: PointerEvent<SVGGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x: footprint.x, y: footprint.y };
    event.stopPropagation();
  };
  const moveDrag = (event: PointerEvent<SVGGElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    const dx = Math.round(((event.clientX - state.startX) / pxPerInch) * 2);
    const dy = Math.round(((event.clientY - state.startY) / pxPerInch) * 2);
    onDrag(state.x + dx, state.y + dy);
  };
  const up = (event: PointerEvent<SVGGElement>) => {
    if (drag.current?.id === event.pointerId) drag.current = null;
  };

  return (
    <g ref={move} className={`lifted${refused ? " refused" : ""}`} aria-hidden="true" transform={`translate(${shown.current.x / 2} ${shown.current.y / 2})`}>
      <g ref={lift} onPointerDown={down} onPointerMove={moveDrag} onPointerUp={up} onPointerCancel={up} className="lifted-body">
        <g className="lift-shadow">
          <Shape footprint={{ ...local, x: 0.5, y: 0.8 }} className="shadow-shape" />
        </g>
        <Shape footprint={local} className={refused ? "lifted-shape hatched" : "lifted-shape"} />
        <text x={cx} y={cy} className="fp-label" fontSize={fontSize} dominantBaseline="central" textAnchor="middle">
          {lifted.number}
        </text>
      </g>
    </g>
  );
}

function Callout({ lifted, fontSize, diameter }: { lifted: LiftedView; fontSize: number; diameter: number }) {
  const f = lifted.footprint;
  const text = lifted.refusal ? lifted.refusal.message : "Position clear";
  const width = text.length * fontSize * 0.62 + fontSize;
  const height = fontSize * 1.7;
  const size = diameter / 2;
  const above = f.y / 2 - height - 0.25;
  const y = above >= -MARGIN ? above : Math.min(f.y / 2 + f.d / 2 + 0.25, size + MARGIN - height);
  const x = Math.max(-MARGIN, Math.min(f.x / 2 + f.w / 4 - width / 2, size + MARGIN - width));
  return (
    <g className={`callout${lifted.refusal ? " refused" : ""}`} aria-hidden="true">
      <rect x={x} y={y} width={width} height={height} rx={0.15} />
      <text x={x + width / 2} y={y + height / 2} fontSize={fontSize} dominantBaseline="central" textAnchor="middle">
        {text}
      </text>
    </g>
  );
}

export function ShelfDrawing({
  shelf,
  placements,
  lifted,
  openNumber,
  settle,
  pxPerInch,
  onOpenPlaced,
  onDrag,
}: {
  shelf: Shelf;
  placements: PlacedFootprint[];
  lifted: LiftedView | null;
  openNumber: string | null;
  settle: { number: string; tick: number } | null;
  pxPerInch: number;
  onOpenPlaced: (number: string, element: SVGGElement) => void;
  onDrag: (x: number, y: number) => void;
}) {
  const size = shelf.diameter / 2;
  const r = size / 2;
  const fontSize = Math.max(12.5 / Math.max(pxPerInch, 1), 0.42);
  const lines = Array.from({ length: shelf.diameter + 1 }, (_unused, i) => i / 2);
  const box = `${-MARGIN} ${-MARGIN} ${size + MARGIN * 2} ${size + MARGIN * 2}`;
  const clip = useId().replace(/:/g, "");
  return (
    <svg className="shelf-svg" viewBox={box} preserveAspectRatio="xMidYMid meet">
      <defs>
        <clipPath id={clip}>
          <circle cx={r} cy={r} r={r} />
        </clipPath>
        <pattern id={`${clip}-hatch`} patternUnits="userSpaceOnUse" width="0.5" height="0.5" patternTransform="rotate(45)">
          <rect width="0.5" height="0.5" className="hatch-ground" />
          <line x1="0" y1="0" x2="0" y2="0.5" className="hatch-line" />
        </pattern>
        <filter id={`${clip}-blur`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="0.35" />
        </filter>
      </defs>
      <style>{`.hatched{fill:url(#${clip}-hatch)}.shadow-shape{filter:url(#${clip}-blur)}`}</style>
      <circle className="shelf-face" cx={r} cy={r} r={r} />
      <g className="grid" clipPath={`url(#${clip})`}>
        {lines.map((at) => (
          <line key={`v${at}`} className={at % 5 === 0 ? "grid-strong" : "grid-line"} x1={at} y1={0} x2={at} y2={size} />
        ))}
        {lines.map((at) => (
          <line key={`h${at}`} className={at % 5 === 0 ? "grid-strong" : "grid-line"} x1={0} y1={at} x2={size} y2={at} />
        ))}
      </g>
      <circle className="shelf-rim" cx={r} cy={r} r={r} />
      {shelf.posts.map((post) => (
        <rect key={`${post.x}-${post.y}`} className="post" x={post.x / 2} y={post.y / 2} width={post.size / 2} height={post.size / 2} />
      ))}
      {placements.map((placement) => (
        <Placed
          key={placement.piece_number}
          placement={placement}
          fontSize={fontSize}
          settleTick={settle?.number === placement.piece_number ? settle.tick : null}
          open={openNumber === placement.piece_number}
          onOpen={onOpenPlaced}
        />
      ))}
      {lifted ? <Lifted lifted={lifted} fontSize={fontSize} pxPerInch={pxPerInch} onDrag={onDrag} /> : null}
      {lifted ? <Callout lifted={lifted} fontSize={fontSize} diameter={shelf.diameter} /> : null}
    </svg>
  );
}
