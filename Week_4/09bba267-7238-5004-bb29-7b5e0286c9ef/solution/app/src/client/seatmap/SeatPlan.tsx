// The horseshoe seat plan: stage band, row arcs, the Sightline wedge and one keyboard grid of seats.
import type { JSX } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { LIP_HALF_WIDTH, STAGE_DEPTH, seatById, type SectionCode } from "../../shared/hall.js";
import type { Seat, Tier } from "../../shared/types.js";
import { CANVASES, cellName, lookOf, selectable, type Look } from "./plan.js";
import { Wedge } from "./Sightline.js";

interface Props {
  section: SectionCode;
  seats: Map<string, Seat>;
  tiers: Map<string, Tier>;
  tierChoice: string;
  selection: Set<string>;
  activeId: string;
  wedgeId: string;
  focusTick: number;
  onActivate: (seatId: string, toggle: boolean) => void;
  onHover: (seatId: string | null) => void;
  onKey: (event: KeyboardEvent) => void;
}

export function SeatPlan(props: Props): JSX.Element {
  const { section, seats, tiers, tierChoice, selection, activeId, wedgeId, focusTick, onActivate, onHover, onKey } = props;
  const canvas = CANVASES[section];
  const frame = useRef<HTMLDivElement>(null);
  const cells = useRef(new Map<string, HTMLDivElement>());

  // Keyboard moves focus the new active seat, which scrolls it into view inside the frame.
  useLayoutEffect(() => {
    if (focusTick > 0) cells.current.get(activeId)?.focus();
  }, [focusTick]);

  // On opening a section, the frame pans so the active seat is centred.
  useLayoutEffect(() => {
    const cell = cells.current.get(activeId);
    const box = frame.current;
    if (cell && box) box.scrollLeft = cell.offsetLeft + cell.offsetWidth / 2 - box.clientWidth / 2;
  }, [section]);

  const wedgeSeat = seatById(wedgeId);
  const lookAt = (id: string): Look => lookOf(seats.get(id), selection.has(id));

  return (
    <div class="map-frame" ref={frame}>
      <div class="map-canvas" style={{ width: `calc(${canvas.width} * var(--seat))`, height: `calc(${canvas.height} * var(--seat))` }}
        onMouseLeave={() => onHover(null)}>
        <svg viewBox={`${canvas.minX} ${canvas.minY} ${canvas.width} ${canvas.height}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <defs>
            <pattern id="hatch" patternUnits="userSpaceOnUse" width="0.45" height="0.45" patternTransform="rotate(45)">
              <line class="hatch-stroke" x1="0" y1="0" x2="0" y2="0.45" />
            </pattern>
          </defs>
          <rect class="stage-band" data-stage="" x={-LIP_HALF_WIDTH} y={-STAGE_DEPTH} width={2 * LIP_HALF_WIDTH} height={STAGE_DEPTH} />
          <text class="stage-label" x="0" y={-STAGE_DEPTH / 2 + 0.25} text-anchor="middle">Stage</text>
          {canvas.rows.map((row) => <path key={row.letter} class="row-arc" d={row.arc} />)}
          {canvas.rows.map((row) => (
            <g key={`l${row.letter}`}>
              <text class="row-letter" x={row.left.x} y={row.left.y + 0.18} text-anchor="middle">{row.letter}</text>
              <text class="row-letter" x={row.right.x} y={row.right.y + 0.18} text-anchor="middle">{row.letter}</text>
            </g>
          ))}
          {seats.size > 0 ? <Wedge seat={wedgeSeat} look={lookAt(wedgeId)} /> : null}
        </svg>
        <div role="grid" aria-label="Seat map" class="seat-grid" onKeyDown={onKey}>
          {canvas.rows.map((row) => (
            <div role="row" aria-label={`Row ${row.letter}`} class="seat-row" key={row.letter}>
              {canvas.seats.filter((s) => s.row === row.letter).map((hall) => {
                const seat = seats.get(hall.id);
                const look = lookAt(hall.id);
                const tier = seat?.tierId ? tiers.get(seat.tierId) : undefined;
                const outside = tierChoice !== "all" && seat?.tierId !== tierChoice;
                const enabled = (look === "on_sale" || look === "selected") && !outside;
                return (
                  <div role="gridcell" key={hall.id} id={`seat-${hall.id}`}
                    ref={(el) => { if (el) cells.current.set(hall.id, el); else cells.current.delete(hall.id); }}
                    class="seat" data-look={look === "on_sale" && outside ? "off_tier" : look}
                    tabIndex={hall.id === activeId ? 0 : -1}
                    aria-label={cellName(hall.label, look, tier)}
                    aria-selected={selection.has(hall.id) ? "true" : undefined}
                    aria-disabled={enabled ? undefined : "true"}
                    style={{
                      left: `calc(${hall.x - canvas.minX - 0.5} * var(--seat))`,
                      top: `calc(${hall.y - canvas.minY - 0.5} * var(--seat))`,
                    }}
                    onClick={() => onActivate(hall.id, selectable(seat, tierChoice))}
                    onMouseEnter={() => onHover(hall.id)} />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
