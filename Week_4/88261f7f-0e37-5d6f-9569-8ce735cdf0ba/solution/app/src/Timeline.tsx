import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import type { RoomStatus, Timeline as TimelineData, TimelineBlock } from "../shared/api";
import { addDays, type IsoDate } from "../shared/dates";
import { statusWords } from "../shared/notices";
import { holdsNights, isFinal } from "../shared/stayStatus";
import { SHIFT_NIGHTS, roomIndex, spanOf, stayAt, visibleSpan, windowDates, type Cell } from "./timelineModel";
import { Chip, KeyTag } from "./ui";

export interface PickUp {
  stayId: string;
  guestName: string;
  status: TimelineBlock["status"];
  version: number;
  origin: Cell;
  roomId: string;
  shift: number;
}

export interface TimelineActions {
  shiftWindow: (days: number) => void;
  openStay: (stayId: string, opener: HTMLElement | null) => void;
  newStay: (cell: Cell) => void;
  openRoom: (roomId: string) => void;
  pickUp: (cell: Cell) => void;
  place: (roomOffset: number, dayOffset: number) => void;
  placeAt: (cell: Cell) => void;
  drop: () => void;
  cancelPickUp: () => void;
  checkIn: (cell: Cell) => void;
  checkOut: (cell: Cell) => void;
}

interface Props {
  data: TimelineData;
  start: IsoDate;
  businessDate: IsoDate;
  cell: Cell;
  setCell: (cell: Cell) => void;
  pickup: PickUp | null;
  blocked: string[];
  /** Cells whose stamp is withheld until the sweep reaches them: date plus the room ids not yet stamped. */
  withheld: { date: IsoDate; roomIds: Set<string> } | null;
  sliding: boolean;
  actions: TimelineActions;
}

const weekdayName = (date: IsoDate): string => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });

export function TimelineGrid({ data, start, businessDate, cell, setCell, pickup, blocked, withheld, sliding, actions }: Props) {
  const grid = useRef<HTMLDivElement>(null);
  const focusNext = useRef(false);
  const dragging = useRef<{ x: number; y: number; moved: boolean; stayId: string } | null>(null);
  const suppressClick = useRef(false);
  const latest = useRef(actions);
  latest.current = actions;
  const dates = windowDates(start);
  const stamps = new Map(data.stamps.map((stamp) => [`${stamp.date}/${stamp.roomId}`, stamp.stamp]));
  const seam = blocked.length > 0 ? Math.min(...blocked.map((id) => roomIndex(data.rooms, id))) : -1;

  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    grid.current?.querySelector<HTMLElement>(`[role="gridcell"][data-room-id="${cell.roomId}"][data-date="${cell.date}"]`)?.focus();
  });

  const moveCell = (roomOffset: number, dayOffset: number): void => {
    const at = Math.min(data.rooms.length - 1, Math.max(0, roomIndex(data.rooms, cell.roomId) + roomOffset));
    const date = addDays(cell.date, dayOffset);
    const first = dates[0] ?? start;
    const last = dates[dates.length - 1] ?? start;
    if (date < first) actions.shiftWindow(-SHIFT_NIGHTS);
    if (date > last) actions.shiftWindow(SHIFT_NIGHTS);
    focusNext.current = true;
    setCell({ roomId: data.rooms[at]?.id ?? cell.roomId, date });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const arrow = arrows[event.key];
    const onCell = (event.target as HTMLElement).getAttribute("role") === "gridcell";
    if (arrow) {
      event.preventDefault();
      if (pickup) actions.place(arrow[0], arrow[1]);
      else moveCell(arrow[0], arrow[1]);
      return;
    }
    switch (event.key.toLowerCase()) {
      case "n": event.preventDefault(); actions.newStay(cell); break;
      case "m": event.preventDefault(); if (!pickup) actions.pickUp(cell); break;
      case "i": event.preventDefault(); actions.checkIn(cell); break;
      case "o": event.preventDefault(); actions.checkOut(cell); break;
      case "escape":
        if (pickup) {
          event.preventDefault();
          actions.cancelPickUp();
        }
        break;
      case "enter":
        if (pickup) {
          event.preventDefault();
          actions.drop();
        } else if (onCell) {
          event.preventDefault();
          const held = stayAt(data.blocks, cell);
          if (held) actions.openStay(held.stayId, event.target as HTMLElement);
          else actions.newStay(cell);
        }
        break;
      default:
    }
  };

  const startDrag = (event: PointerEvent<HTMLButtonElement>, block: TimelineBlock): void => {
    if (event.button !== 0 || event.pointerType === "touch" || isFinal(block.status)) return;
    dragging.current = { x: event.clientX, y: event.clientY, moved: false, stayId: block.stayId };
    const move = (moved: globalThis.PointerEvent): void => {
      const drag = dragging.current;
      if (!drag) return;
      if (!drag.moved && Math.hypot(moved.clientX - drag.x, moved.clientY - drag.y) < 6) return;
      if (!drag.moved) {
        drag.moved = true;
        latest.current.pickUp({ roomId: block.roomId, date: cell.roomId === block.roomId && stayAt(data.blocks, cell)?.stayId === block.stayId ? cell.date : block.firstNight });
      }
      const under = document.elementFromPoint(moved.clientX, moved.clientY)?.closest<HTMLElement>('[role="gridcell"]');
      const roomId = under?.dataset.roomId;
      const date = under?.dataset.date;
      if (roomId && date) latest.current.placeAt({ roomId, date });
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (dragging.current?.moved) {
        suppressClick.current = true;
        latest.current.drop();
      }
      dragging.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const placement = pickup ? { room: pickup.roomId, date: addDays(pickup.origin.date, pickup.shift) } : null;
  const pickedBlock = pickup ? data.blocks.find((block) => block.stayId === pickup.stayId) : undefined;

  return (
    <div className="timeline-frame" style={{ "--seam": seam } as React.CSSProperties}>
      <div ref={grid} role="grid" aria-label="Reservation timeline" className="grid" onKeyDown={onKeyDown}>
        <div role="row" className="grid-row head-row">
          <div role="columnheader" className="rack-cell rack-head">
            <button type="button" aria-label="Previous nights" onClick={() => actions.shiftWindow(-SHIFT_NIGHTS)}>‹</button>
            <button type="button" aria-label="Next nights" onClick={() => actions.shiftWindow(SHIFT_NIGHTS)}>›</button>
          </div>
          <div className={`track ${sliding ? "sliding" : ""}`}>
            {dates.map((date) => (
              <div
                key={date}
                role="columnheader"
                aria-label={date}
                data-date={date}
                data-business-date={date === businessDate ? "true" : undefined}
                className={`night-head ${date === businessDate ? "bd" : ""}`}
              >
                <span className="weekday">{weekdayName(date)}</span>
                <span className="day-number">{date.slice(8)}</span>
              </div>
            ))}
          </div>
        </div>
        {data.rooms.map((room, index) => (
          <div
            key={room.id}
            role="row"
            data-room-id={room.id}
            data-room-type={room.type}
            data-blocked={blocked.includes(room.id) ? "true" : undefined}
            className="grid-row room-row"
          >
            <div role="rowheader" aria-label={`Room ${room.number}`} tabIndex={-1} className={`rack-cell ${seam >= 0 && index <= seam ? "seam" : ""}`}>
              <KeyTag />
              <span className="room-number">{room.number}</span>
              <button type="button" className="chip-button" aria-label={`Room ${room.number} status: ${statusWords(room.status)}`} onClick={() => actions.openRoom(room.id)}>
                <Chip status={room.status as RoomStatus} />
              </button>
            </div>
            <div className={`track ${sliding ? "sliding" : ""}`}>
              {dates.map((date) => {
                const here = cell.roomId === room.id && cell.date === date;
                const stamp = stamps.get(`${date}/${room.id}`);
                const hidden = withheld?.date === date && withheld.roomIds.has(room.id);
                const shown = hidden ? undefined : stamp;
                return (
                  <div
                    key={date}
                    role="gridcell"
                    data-date={date}
                    data-room-id={room.id}
                    data-stamp={shown}
                    tabIndex={here ? 0 : -1}
                    className={`night-cell ${date === businessDate ? "bd" : ""}`}
                    onClick={() => {
                      setCell({ roomId: room.id, date });
                      focusNext.current = true;
                    }}
                    onDoubleClick={() => actions.newStay({ roomId: room.id, date })}
                  >
                    {shown ? <span className={shown === "tick" ? "stamp tick" : "stamp"}>{shown === "tick" ? "" : shown}</span> : null}
                    {data.blocks.filter((block) => block.roomId === room.id).map((block) => {
                      const seen = visibleSpan(block, start);
                      if (!seen || addDays(start, seen.offset) !== date) return null;
                      const span = spanOf(data.blocks, block.stayId);
                      const thin = !holdsNights(block.status);
                      return (
                        <button
                          key={`${block.stayId}-${block.firstNight}`}
                          type="button"
                          tabIndex={-1}
                          className={`stay-block ${thin ? "thin" : ""}`}
                          style={{ "--span": seen.span } as React.CSSProperties}
                          aria-label={`Stay ${block.guestName}, room ${room.number}, ${span.arrival} to ${span.departure}`}
                          data-stay-id={block.stayId}
                          data-room-id={block.roomId}
                          data-first-night={block.firstNight}
                          data-nights={block.nights}
                          data-status={block.status}
                          data-picked-up={pickup?.stayId === block.stayId ? "true" : undefined}
                          data-checked-in-online={block.checkedInOnline ? "true" : undefined}
                          onPointerDown={(event) => startDrag(event, block)}
                          onClick={(event) => {
                            if (suppressClick.current) {
                              suppressClick.current = false;
                              return;
                            }
                            event.currentTarget.focus();
                            setCell({ roomId: room.id, date: block.firstNight < start ? start : block.firstNight });
                            actions.openStay(block.stayId, event.currentTarget);
                          }}
                        >
                          <span className="block-name">{block.guestName}</span>
                          {block.checkedInOnline ? <span className="block-mark" aria-hidden="true">✓</span> : null}
                        </button>
                      );
                    })}
                    {placement && placement.room === room.id && placement.date === date && pickedBlock ? (
                      <span className="ghost" style={{ "--span": pickedBlock.nights } as React.CSSProperties} aria-hidden="true" />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

