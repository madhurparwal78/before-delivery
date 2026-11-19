import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Seat, Tier } from '../../shared/api';
import { SEATS_PER_ROW, SECTION_CODES, sectionByCode, type SectionCode } from '../../shared/hall';
import { formatMoney } from '../../shared/money';
import {
  MAP_WIDTH,
  STAGE_HEIGHT,
  STAGE_LIP_LEFT_X,
  STAGE_LIP_RIGHT_X,
  STAGE_LIP_Y,
  STAGE_TOP,
  STAGE_WIDTH,
  STAGE_X,
  mapHeight,
  seatPoint,
} from '../lib/mapGeometry';
import { useReducedMotion } from '../lib/motion';
import { useWedgeView, type WedgeTarget } from '../lib/wedge';

export type SeatStateWord =
  'On sale' | 'Selected' | 'Held by you' | 'Your ticket' | 'Offered to you' | 'Taken' | 'Not on sale';

const DATA_STATES: Record<SeatStateWord, string> = {
  'On sale': 'on_sale',
  Selected: 'selected',
  'Held by you': 'held_by_you',
  'Your ticket': 'yours',
  'Offered to you': 'offered_to_you',
  Taken: 'taken',
  'Not on sale': 'not_on_sale',
};

export function seatStateWord(seat: Seat, selected: boolean): SeatStateWord {
  if (seat.tierId === null || seat.state === 'not_on_sale') return 'Not on sale';
  if (seat.mine) {
    if (seat.state === 'held') return 'Held by you';
    if (seat.state === 'sold') return 'Your ticket';
    if (seat.state === 'offered') return 'Offered to you';
  }
  if (seat.state !== 'on_sale') return 'Taken';
  return selected ? 'Selected' : 'On sale';
}

export function isChoosable(seat: Seat, tierFilter: string): boolean {
  if (seat.tierId === null || seat.state !== 'on_sale') return false;
  return tierFilter === 'all' || seat.tierId === tierFilter;
}

interface SeatMapProps {
  readonly seats: readonly Seat[];
  readonly tiers: readonly Tier[];
  readonly section: SectionCode;
  readonly tierFilter: string;
  readonly activeSeatId: string;
  readonly selection: ReadonlySet<string>;
  readonly onActivate: (seatId: string) => void;
  readonly onToggle: (seatId: string) => void;
  readonly onSection: (section: SectionCode) => void;
}

export function SeatMap({
  seats,
  tiers,
  section,
  tierFilter,
  activeSeatId,
  selection,
  onActivate,
  onToggle,
  onSection,
}: SeatMapProps): ReactNode {
  const reducedMotion = useReducedMotion();
  const [hoveredSeatId, setHoveredSeatId] = useState<string | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const cells = useRef(new Map<string, SVGGElement>());
  const keyboardMove = useRef(false);

  const rows = sectionByCode(section).rows;
  const seatsById = useMemo(() => new Map(seats.map((seat) => [seat.id, seat])), [seats]);
  const tierNames = useMemo(() => new Map(tiers.map((tier) => [tier.id, tier])), [tiers]);
  const height = mapHeight(section);

  const shownSeat = seatsById.get(hoveredSeatId ?? activeSeatId);

  const target = useMemo<WedgeTarget | null>(() => {
    if (shownSeat === undefined) return null;
    const point = seatPoint(rows.indexOf(shownSeat.row), shownSeat.number);
    return {
      seatId: shownSeat.id,
      x: point.x,
      y: point.y,
      angle: shownSeat.offCentreDeg,
      distance: shownSeat.stageDistanceM,
    };
  }, [shownSeat, rows]);
  const wedge = useWedgeView(target, reducedMotion);

  useEffect(() => {
    const cell = cells.current.get(activeSeatId);
    const box = frame.current;
    if (cell === undefined || box === null) return;
    if (keyboardMove.current) {
      keyboardMove.current = false;
      cell.focus();
    }
    const outer = box.getBoundingClientRect();
    const inner = cell.getBoundingClientRect();
    const margin = 12;
    if (inner.left < outer.left + margin || inner.right > outer.right - margin) {
      box.scrollLeft += inner.left + inner.width / 2 - (outer.left + outer.width / 2);
    }
    if (inner.top < outer.top + margin || inner.bottom > outer.bottom - margin) {
      box.scrollTop += inner.top + inner.height / 2 - (outer.top + outer.height / 2);
    }
  }, [activeSeatId, section, seats.length]);

  const moveTo = (row: string, number: number): void => {
    keyboardMove.current = true;
    onActivate(`${section}-${row}-${number}`);
  };

  const activeSeat = seatsById.get(activeSeatId);
  const activeRowIndex = activeSeat === undefined ? 0 : rows.indexOf(activeSeat.row);
  const activeNumber = activeSeat?.number ?? 15;

  const onKeyDown = (event: React.KeyboardEvent<SVGGElement>): void => {
    const lastRow = rows.length - 1;
    const sectionIndex = SECTION_CODES.indexOf(section);
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        moveTo(rows[activeRowIndex] ?? 'A', Math.max(1, activeNumber - 1));
        return;
      case 'ArrowRight':
        event.preventDefault();
        moveTo(rows[activeRowIndex] ?? 'A', Math.min(SEATS_PER_ROW, activeNumber + 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        moveTo(rows[Math.max(0, activeRowIndex - 1)] ?? 'A', activeNumber);
        return;
      case 'ArrowDown':
        event.preventDefault();
        moveTo(rows[Math.min(lastRow, activeRowIndex + 1)] ?? 'A', activeNumber);
        return;
      case 'Home':
        event.preventDefault();
        if (event.ctrlKey) moveTo(rows[0] ?? 'A', 1);
        else moveTo(rows[activeRowIndex] ?? 'A', 1);
        return;
      case 'End':
        event.preventDefault();
        if (event.ctrlKey) moveTo(rows[lastRow] ?? 'A', SEATS_PER_ROW);
        else moveTo(rows[activeRowIndex] ?? 'A', SEATS_PER_ROW);
        return;
      case 'PageUp': {
        event.preventDefault();
        const previous = SECTION_CODES[sectionIndex - 1];
        if (previous !== undefined) {
          keyboardMove.current = true;
          onSection(previous);
        }
        return;
      }
      case 'PageDown': {
        event.preventDefault();
        const next = SECTION_CODES[sectionIndex + 1];
        if (next !== undefined) {
          keyboardMove.current = true;
          onSection(next);
        }
        return;
      }
      case ' ':
      case 'Enter':
        event.preventDefault();
        if (activeSeat !== undefined && isChoosable(activeSeat, tierFilter)) onToggle(activeSeat.id);
        return;
      default:
        return;
    }
  };

  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const panned = useRef(false);

  const wedgeState =
    shownSeat === undefined ? 'not_on_sale' : DATA_STATES[seatStateWord(shownSeat, selection.has(shownSeat.id))];
  const wedgeWord = shownSeat === undefined ? 'Not on sale' : seatStateWord(shownSeat, selection.has(shownSeat.id));

  return (
    <>
      <div
        className="map-frame"
        ref={frame}
        onPointerDown={(event) => {
          const box = frame.current;
          if (box === null) return;
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            left: box.scrollLeft,
            top: box.scrollTop,
            moved: false,
          };
        }}
        onPointerMove={(event) => {
          const box = frame.current;
          const start = drag.current;
          if (box === null || start === null) return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (!start.moved && Math.abs(dx) + Math.abs(dy) < 8) return;
          start.moved = true;
          box.scrollLeft = start.left - dx;
          box.scrollTop = start.top - dy;
        }}
        onPointerUp={() => {
          panned.current = drag.current?.moved === true;
          drag.current = null;
        }}
        onPointerLeave={() => {
          drag.current = null;
          setHoveredSeatId(null);
        }}
      >
        <svg className="map" viewBox={`0 0 ${MAP_WIDTH} ${height}`}>
          <defs>
            <pattern
              id="sightline-hatch"
              width="8"
              height="8"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line x1="0" y1="0" x2="0" y2="8" className="hatch-line" />
            </pattern>
          </defs>
          <rect
            data-stage="true"
            className="stage-band"
            x={STAGE_X}
            y={STAGE_TOP}
            width={STAGE_WIDTH}
            height={STAGE_HEIGHT}
          />
          <text className="stage-label" x={MAP_WIDTH / 2} y={STAGE_TOP + STAGE_HEIGHT / 2 + 6} textAnchor="middle">
            Stage
          </text>

          {wedge !== null && target !== null ? (
            <g
              data-sightline="true"
              data-seat={target.seatId}
              data-angle={String(target.angle)}
              data-distance={target.distance.toFixed(1)}
              data-state={wedgeState}
              className={`wedge wedge--${wedgeState}`}
            >
              <polygon
                data-part="fill"
                className="wedge-fill"
                opacity={wedge.fillShown}
                points={`${wedge.apexX},${wedge.apexY} ${STAGE_LIP_LEFT_X},${STAGE_LIP_Y} ${STAGE_LIP_RIGHT_X},${STAGE_LIP_Y}`}
              />
              <line
                data-part="left-edge"
                className="wedge-edge"
                x1={wedge.apexX}
                y1={wedge.apexY}
                x2={wedge.apexX + (STAGE_LIP_LEFT_X - wedge.apexX) * wedge.leftDrawn}
                y2={wedge.apexY + (STAGE_LIP_Y - wedge.apexY) * wedge.leftDrawn}
              />
              <line
                data-part="right-edge"
                className="wedge-edge"
                x1={wedge.apexX}
                y1={wedge.apexY}
                x2={wedge.apexX + (STAGE_LIP_RIGHT_X - wedge.apexX) * wedge.rightDrawn}
                y2={wedge.apexY + (STAGE_LIP_Y - wedge.apexY) * wedge.rightDrawn}
              />
            </g>
          ) : null}

          <g role="grid" aria-label="Seat map" onKeyDown={onKeyDown}>
            {rows.map((row, rowIndex) => (
              <g role="row" aria-label={`Row ${row}`} key={row}>
                {Array.from({ length: SEATS_PER_ROW }, (_, index) => index + 1).map((number) => {
                  const seat = seatsById.get(`${section}-${row}-${number}`);
                  if (seat === undefined) return null;
                  const selected = selection.has(seat.id);
                  const word = seatStateWord(seat, selected);
                  const tier = seat.tierId === null ? undefined : tierNames.get(seat.tierId);
                  const outsideTier = tierFilter !== 'all' && seat.tierId !== tierFilter;
                  const name =
                    tier === undefined
                      ? `${seat.label}, Not on sale`
                      : `${seat.label}, ${tier.name}, ${formatMoney(tier.faceCents)}, ${word}`;
                  const point = seatPoint(rowIndex, number);
                  const disabled = (word !== 'On sale' && word !== 'Selected') || outsideTier;
                  return (
                    <g
                      key={seat.id}
                      role="gridcell"
                      aria-label={name}
                      aria-selected={selected}
                      aria-disabled={disabled ? true : undefined}
                      tabIndex={seat.id === activeSeatId ? 0 : -1}
                      data-seat={seat.id}
                      data-state={DATA_STATES[word]}
                      className={`seat seat--${DATA_STATES[word]}${outsideTier ? ' seat--dimmed' : ''}`}
                      ref={(element) => {
                        if (element === null) cells.current.delete(seat.id);
                        else cells.current.set(seat.id, element);
                      }}
                      onPointerEnter={() => setHoveredSeatId(seat.id)}
                      onClick={() => {
                        if (panned.current) {
                          panned.current = false;
                          return;
                        }
                        onActivate(seat.id);
                        if (isChoosable(seat, tierFilter)) onToggle(seat.id);
                      }}
                    >
                      <rect
                        className="seat-hit"
                        x={point.x - point.pitch / 2}
                        y={point.y - point.pitch / 2}
                        width={point.pitch}
                        height={point.pitch}
                      />
                      <circle className="seat-dot" cx={point.x} cy={point.y} r={10} />
                      {word === 'Taken' ? (
                        <line
                          className="seat-strike"
                          x1={point.x - 7}
                          y1={point.y + 7}
                          x2={point.x + 7}
                          y2={point.y - 7}
                        />
                      ) : null}
                    </g>
                  );
                })}
              </g>
            ))}
          </g>
        </svg>
      </div>

      <div className="sightline" role="group" aria-label="Sightline">
        <p className="figures">{`${wedge?.shownAngle ?? target?.angle ?? 0}° off centre`}</p>
        <p className="figures">{`${(wedge?.shownDistance ?? target?.distance ?? 0).toFixed(1)} m to stage`}</p>
        {wedgeWord === 'On sale' || wedgeWord === 'Selected' ? null : <p>{wedgeWord}</p>}
      </div>
    </>
  );
}
