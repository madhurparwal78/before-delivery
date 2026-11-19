import { useEffect, useRef, useState } from 'react';
import type { Performance, Seat } from '../shared/api-types';
import { SECTIONS, seatStateWord, seatWedgeState, type SectionCode } from './seat-map-core';

const SEAT_GAP = 1.6;
const ROW_GAP = 2.4;

export type SeatGridProps = {
  section: SectionCode;
  seats: Map<string, Seat>;
  tiers: Performance['tiers'];
  chosenTier: string;
  selection: string[];
  activeSeat: string;
  sightlineSeat: string;
  onSeatActivate: (seatId: string) => void;
  onSeatToggle: (seatId: string) => void;
  onHover: (seatId: string | null) => void;
  onSectionSwitch: (section: SectionCode) => void;
  seatSelectable: (seat: Seat) => boolean;
};

/**
 * The horseshoe seat map: one keyboard grid whose rows are concentric arcs,
 * the stage band across the top, and the Sightline wedge over it.
 */
export function SeatGridSvg(props: SeatGridProps) {
  const { section, seats, chosenTier, selection, activeSeat, sightlineSeat } = props;
  const spec = SECTIONS.find((s) => s.code === section)!;
  const gridRef = useRef<SVGSVGElement>(null);
  const seatRefs = useRef<Map<string, SVGRectElement>>(new Map());

  const layout = useSeatLayout(section);
  const seatBox = layout.seatSize;

  useEffect(() => {
    const el = seatRefs.current.get(activeSeat);
    if (el) {
      el.focus({ preventScroll: false });
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [activeSeat]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      const index = SECTIONS.findIndex((s) => s.code === section);
      if (event.key === 'PageUp') {
        event.preventDefault();
        if (index > 0) props.onSectionSwitch(SECTIONS[index - 1].code);
      } else {
        event.preventDefault();
        if (index < SECTIONS.length - 1) props.onSectionSwitch(SECTIONS[index + 1].code);
      }
      return;
    }
    const [sec, row, numText] = activeSeat.split('-');
    const number = Number(numText);
    const rowIndex = spec.rows.indexOf(row);
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (number > 1) props.onSeatActivate(`${sec}-${row}-${number - 1}`);
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (number < 30) props.onSeatActivate(`${sec}-${row}-${number + 1}`);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (rowIndex > 0) props.onSeatActivate(`${sec}-${spec.rows[rowIndex - 1]}-${number}`);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (rowIndex < spec.rows.length - 1) props.onSeatActivate(`${sec}-${spec.rows[rowIndex + 1]}-${number}`);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      if (event.ctrlKey) {
        props.onSeatActivate(`${sec}-${spec.rows[0]}-1`);
      } else {
        props.onSeatActivate(`${sec}-${row}-1`);
      }
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      if (event.ctrlKey) {
        props.onSeatActivate(`${sec}-${spec.rows[spec.rows.length - 1]}-30`);
      } else {
        props.onSeatActivate(`${sec}-${row}-30`);
      }
      return;
    }
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      const seat = seats.get(activeSeat);
      if (seat && props.seatSelectable(seat)) {
        props.onSeatToggle(activeSeat);
      }
      return;
    }
  };

  const stageBand = layout.stage;
  const activeSeatLayout = layout.positions.get(sightlineSeat) ?? null;

  return (
    <div className="map-scroll" tabIndex={-1}>
      <svg
        ref={gridRef}
        className="seat-svg"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="grid"
        aria-label="Seat map"
        onMouseLeave={() => props.onHover(null)}
        style={{ width: layout.width, height: layout.height, minWidth: layout.width }}
      >
        <rect className="stage-band" data-stage="" x={stageBand.x} y={stageBand.y} width={stageBand.width} height={stageBand.height} rx="4" />
        <defs>
          <pattern id="wedge-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" stroke="var(--fawn)" strokeWidth="3" />
          </pattern>
        </defs>
        <text className="stage-label" x={stageBand.x + stageBand.width / 2} y={stageBand.y + stageBand.height / 2} textAnchor="middle" dominantBaseline="middle">
          Stage
        </text>
        {spec.rows.map((row) => (
          <g key={row} role="row" aria-label={`Row ${row}`}>
            {Array.from({ length: 30 }, (_, i) => i + 1).map((number) => {
              const seatId = `${section}-${row}-${number}`;
              const seat = seats.get(seatId);
              const position = layout.positions.get(seatId);
              if (!seat || !position) return null;
              const selected = selection.includes(seatId);
              const disabled =
                seat.state !== 'on_sale' || !seat.tierId || (chosenTier !== 'all' && seat.tierId !== chosenTier);
              const name =
                seat.tierId
                  ? `${seat.label}, ${tierName(props.tiers, seat.tierId)}, ${formatDollars(props.tiers, seat.tierId)}, ${seatStateWord(seat)}`
                  : `${seat.label}, Not on sale`;
              return (
                <rect
                  key={seatId}
                  ref={(el) => {
                    if (el) seatRefs.current.set(seatId, el);
                  }}
                  role="gridcell"
                  aria-label={name}
                  aria-selected={selected ? 'true' : undefined}
                  aria-disabled={disabled ? 'true' : undefined}
                  tabIndex={activeSeat === seatId ? 0 : -1}
                  onKeyDown={(event) => onKeyDown(event)}
                  data-seat-id={seatId}
                  className={seatClass(seat, selected, disabled, activeSeat === seatId)}
                  x={position.x}
                  y={position.y}
                  width={seatBox}
                  height={seatBox}
                  rx={seatBox / 4}
                  onClick={() => {
                    props.onSeatActivate(seatId);
                    props.onSeatToggle(seatId);
                  }}
                  onMouseEnter={() => props.onHover(seatId)}
                  onFocus={() => props.onHover(seatId)}
                />
              );
            })}
          </g>
        ))}
        {activeSeatLayout && <SightlineWedge layout={layout} seatPosition={activeSeatLayout} seat={seats.get(sightlineSeat) ?? null} selected={selection.includes(sightlineSeat)} />}
      </svg>
    </div>
  );
}

function tierName(tiers: Performance['tiers'], tierId: string): string {
  return tiers.find((t) => t.id === tierId)?.name ?? tierId;
}

function formatDollars(tiers: Performance['tiers'], tierId: string): string {
  const tier = tiers.find((t) => t.id === tierId);
  if (!tier) return '';
  const cents = tier.faceCents;
  return `$${Math.floor(cents / 100).toLocaleString('en-US')}.${String(cents % 100).padStart(2, '0')}`;
}

function seatClass(seat: Seat, selected: boolean, disabled: boolean, active: boolean): string {
  const classes = ['seat'];
  if (selected) classes.push('seat-selected');
  if (seat.state === 'not_on_sale') classes.push('seat-not-on-sale');
  else if (seat.state !== 'on_sale' && !seat.mine) classes.push('seat-taken');
  else if (seat.state !== 'on_sale') classes.push('seat-mine');
  else classes.push('seat-on-sale');
  if (disabled) classes.push('seat-dimmed');
  if (active) classes.push('seat-active');
  return classes.join(' ');
}

function SightlineWedge({
  layout,
  seatPosition,
  seat,
  selected,
}: {
  layout: SeatLayout;
  seatPosition: { x: number; y: number };
  seat: Seat | null;
  selected: boolean;
}) {
  const [drawn, setDrawn] = useState<{ left: boolean; right: boolean; fill: boolean }>({ left: false, right: false, fill: false });
  const [apex, setApex] = useState(seatPosition);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (reducedMotion) {
      setDrawn({ left: true, right: true, fill: true });
      setApex(seatPosition);
      return;
    }
    const timers: number[] = [];
    timers.push(window.setTimeout(() => setDrawn((d) => ({ ...d, left: true })), 0));
    timers.push(window.setTimeout(() => setDrawn((d) => ({ ...d, right: true })), 170));
    timers.push(window.setTimeout(() => setDrawn((d) => ({ ...d, fill: true })), 340));
    setApex(seatPosition);
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [seatPosition.x, seatPosition.y, reducedMotion]);

  const centreX = apex.x + layout.seatSize / 2;
  const centreY = apex.y + layout.seatSize / 2;
  const leftX = layout.stage.x;
  const rightX = layout.stage.x + layout.stage.width;
  const lipY = layout.stage.y + layout.stage.height;
  const state = seat ? seatWedgeState(seat, selected) : 'not_on_sale';

  return (
    <g className={`sightline-wedge ${state === 'taken' ? 'wedge-taken' : ''} ${state === 'held_by_you' || state === 'yours' || state === 'offered_to_you' ? 'wedge-mine' : ''}`} data-sightline="" data-seat={seat?.id ?? ''} data-angle={seat?.offCentreDeg ?? 0} data-distance={seat?.stageDistanceM ?? 0} data-state={state}>
      {drawn.left && <line data-part="left-edge" x1={centreX} y1={centreY} x2={leftX} y2={lipY} />}
      {drawn.right && <line data-part="right-edge" x1={centreX} y1={centreY} x2={rightX} y2={lipY} />}
      {drawn.fill && <polygon data-part="fill" points={`${centreX},${centreY} ${leftX},${lipY} ${rightX},${lipY}`} />}
    </g>
  );
}

export type SeatLayout = {
  width: number;
  height: number;
  seatSize: number;
  stage: { x: number; y: number; width: number; height: number };
  positions: Map<string, { x: number; y: number }>;
};

function useSeatLayout(section: SectionCode): SeatLayout {
  const [size, setSize] = useState({ width: window.innerWidth });
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const spec = SECTIONS.find((s) => s.code === section)!;
  const isPhone = size.width < 768;
  const seatSize = isPhone ? 46 : 28;
  const stageHeight = 26;
  const stageWidth = seatSize * 30 + SEAT_GAP * 29;
  const top = 8;
  const positions = new Map<string, { x: number; y: number }>();
  spec.rows.forEach((row, rowIndex) => {
    for (let number = 1; number <= 30; number += 1) {
      const x = (number - 1) * (seatSize + SEAT_GAP);
      const y = top + stageHeight + 14 + rowIndex * (seatSize + ROW_GAP);
      positions.set(`${section}-${row}-${number}`, { x, y });
    }
  });
  const height = top + stageHeight + 14 + spec.rows.length * (seatSize + ROW_GAP) + 8;
  return {
    width: stageWidth,
    height,
    seatSize,
    stage: { x: 0, y: top, width: stageWidth, height: stageHeight },
    positions,
  };
}
