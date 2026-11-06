// The Rails region: one pinned hour ruler and a steel rail per station, each a grid of 96
// quarter-hour cells with its tickets hanging below.

import { type KeyboardEvent, type PointerEvent, type RefObject, memo, useEffect, useRef, useState } from "react";
import type { StationView } from "../../../shared/api.js";
import { MINUTES_PER_DAY, SLOT_MINUTES, formatHHMM } from "../../../shared/kitchenTime.js";
import { EmptySpike } from "../../components/Feedback.js";
import { copy } from "../../copy.js";
import { Ticket, type TicketProps } from "./Ticket.js";

export const CELLS = MINUTES_PER_DAY / SLOT_MINUTES;
const HOLD_TO_SWEEP_MS = 500;
const HOURS = Array.from({ length: 25 }, (_, hour) => hour);

export interface RailHandlers {
  /** A press on an empty point; returns whether a sweep started. */
  press: (stationId: string, minute: number) => boolean;
  drag: (minute: number) => void;
  release: () => void;
  cancel: () => void;
  key: (stationId: string, index: number, event: KeyboardEvent<HTMLElement>) => void;
  focusCell: (stationId: string, index: number) => void;
}

interface RailsProps {
  stations: StationView[];
  tickets: Map<string, TicketProps[]>;
  laneHeights: Map<string, number>;
  activeCells: Record<string, number>;
  notch: { stationId: string; minute: number } | null;
  nowMinute: number | null;
  skipped: { from: number; to: number } | null;
  empty: boolean;
  sweepable: boolean;
  handlers: RailHandlers;
  scroller: RefObject<HTMLDivElement | null>;
}

function minuteAt(grid: HTMLElement, clientX: number): number {
  const rect = grid.getBoundingClientRect();
  const marks = Math.round(((clientX - rect.left) / rect.width) * CELLS);
  return Math.min(Math.max(marks, 0), CELLS) * SLOT_MINUTES;
}

const Cells = memo(function Cells({ station, active, handlers }: { station: StationView; active: number; handlers: RailHandlers }) {
  return (
    <div role="row" className="rail__cells">
      {Array.from({ length: CELLS }, (_, index) => (
        <div
          key={index}
          role="gridcell"
          className={`rail__cell${index % 4 === 0 ? " rail__cell--hour" : ""}`}
          aria-label={`${station.name} ${formatHHMM(index * SLOT_MINUTES)}`}
          tabIndex={index === active ? 0 : -1}
          data-index={index}
          onKeyDown={(event) => handlers.key(station.id, index, event)}
          onFocus={() => handlers.focusCell(station.id, index)}
        />
      ))}
    </div>
  );
});

function Rail({ station, tickets, lane, active, notch, sweepable, handlers }: {
  station: StationView;
  tickets: TicketProps[];
  lane: number;
  active: number;
  notch: number | null;
  sweepable: boolean;
  handlers: RailHandlers;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const sweeping = useRef(false);
  const touch = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number; id: number } | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const begin = (event: PointerEvent<HTMLDivElement>, clientX: number): void => {
    if (!grid.current || !handlers.press(station.id, minuteAt(grid.current, clientX))) return;
    sweeping.current = true;
    grid.current.setPointerCapture(event.pointerId);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (!sweepable || event.button !== 0) return;
    if (event.pointerType === "touch") {
      const { clientX, clientY, pointerId } = event;
      const target = event.currentTarget;
      touch.current = {
        x: clientX,
        y: clientY,
        id: pointerId,
        timer: setTimeout(() => {
          touch.current = null;
          if (!handlers.press(station.id, minuteAt(target, clientX))) return;
          sweeping.current = true;
          target.setPointerCapture(pointerId);
        }, HOLD_TO_SWEEP_MS),
      };
      return;
    }
    event.preventDefault();
    begin(event, event.clientX);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (touch.current && Math.hypot(event.clientX - touch.current.x, event.clientY - touch.current.y) > 8) {
      clearTimeout(touch.current.timer);
      touch.current = null;
    }
    if (!grid.current) return;
    const minute = minuteAt(grid.current, event.clientX);
    if (sweeping.current) handlers.drag(minute);
    else if (event.pointerType === "mouse" && sweepable) setHover(Math.min(minute, MINUTES_PER_DAY - SLOT_MINUTES));
  };

  const finish = (released: boolean): void => {
    if (touch.current) {
      clearTimeout(touch.current.timer);
      touch.current = null;
    }
    if (!sweeping.current) return;
    sweeping.current = false;
    if (released) handlers.release();
    else handlers.cancel();
  };

  useEffect(() => {
    const element = grid.current;
    if (!element) return;
    const stopScroll = (event: TouchEvent): void => {
      if (sweeping.current && event.cancelable) event.preventDefault();
    };
    element.addEventListener("touchmove", stopScroll, { passive: false });
    return () => element.removeEventListener("touchmove", stopScroll);
  }, []);

  return (
    <div className="rail-row" style={{ ["--lane" as string]: `${lane}px` }}>
      <div className="rail-row__name station-name" aria-hidden="true">
        {station.name}
      </div>
      <div className="rail-row__track">
        <div
          ref={grid}
          role="grid"
          aria-label={`${station.name} schedule`}
          className="rail"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => finish(true)}
          onPointerCancel={() => finish(false)}
          onPointerLeave={() => setHover(null)}
        >
          <Cells station={station} active={active} handlers={handlers} />
          {hover !== null ? <span className="rail__tick" style={{ left: `${(hover / MINUTES_PER_DAY) * 100}%` }} aria-hidden="true" /> : null}
        </div>
        {notch !== null ? <span className="notch" role="img" aria-label="Conflict notch" style={{ left: `${(notch / MINUTES_PER_DAY) * 100}%` }} /> : null}
        <div className="lane">
          {tickets.map((ticket) => (
            <Ticket key={ticket.bookingId ?? `${ticket.kind}-${ticket.left}-${ticket.right}`} {...ticket} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function Rails({ stations, tickets, laneHeights, activeCells, notch, nowMinute, skipped, empty, sweepable, handlers, scroller }: RailsProps) {
  return (
    <div ref={scroller} className="rails" role="region" aria-label="Rails">
      <div className="rails__inner">
        <div className="ruler" aria-hidden="true">
          <div className="ruler__spacer" />
          <div className="ruler__track">
            {HOURS.map((hour) => (
              <span key={hour} className={`ruler__hour${hour === 24 ? " ruler__hour--end" : ""}`} style={{ left: `${(hour / 24) * 100}%` }}>
                <span className="ruler__label mono">{formatHHMM(hour * 60)}</span>
              </span>
            ))}
            {nowMinute !== null ? <span className="ruler__now" style={{ left: `${(nowMinute / MINUTES_PER_DAY) * 100}%` }} /> : null}
          </div>
        </div>
        {empty ? <EmptySpike text={copy.empty.board} /> : null}
        <div className="rails__body">
          {stations.map((station) => (
            <Rail
              key={station.id}
              station={station}
              tickets={tickets.get(station.id) ?? []}
              lane={laneHeights.get(station.id) ?? 28}
              active={activeCells[station.id] ?? 24}
              notch={notch?.stationId === station.id ? notch.minute : null}
              sweepable={sweepable}
              handlers={handlers}
            />
          ))}
          <div className="rails__overlay" aria-hidden={nowMinute === null && skipped === null ? true : undefined}>
            {skipped ? (
              <span className="skipped" role="img" aria-label="Skipped hour" style={{ left: `${(skipped.from / MINUTES_PER_DAY) * 100}%`, width: `${((skipped.to - skipped.from) / MINUTES_PER_DAY) * 100}%` }} />
            ) : null}
            {nowMinute !== null ? <span className="now-line" role="img" aria-label="Now" style={{ left: `${(nowMinute / MINUTES_PER_DAY) * 100}%` }} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
