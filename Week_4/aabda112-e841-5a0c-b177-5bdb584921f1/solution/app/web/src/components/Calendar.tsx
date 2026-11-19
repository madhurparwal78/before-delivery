import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { clinicInstant } from '../../../shared/clinictime';
import type { Settings } from '../lib/env';
import type { Appointment, Room } from '../lib/types';
import { AppointmentButton, type DropTarget } from './AppointmentButton';

export type Command =
  | { type: 'open'; appointment: Appointment; opener: HTMLElement }
  | { type: 'book'; roomId: string; slot: number; opener: HTMLElement }
  | { type: 'move'; appointment: Appointment; roomDelta: number; slotDelta: number }
  | { type: 'resize'; appointment: Appointment; slotDelta: number }
  | { type: 'check-in'; appointment: Appointment }
  | { type: 'cancel'; appointment: Appointment }
  | { type: 'drop'; appointment: Appointment; target: DropTarget | null };

const pad = (n: number) => String(n).padStart(2, '0');
const slotLabel = (minute: number) => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;

interface Props {
  date: string;
  rooms: Room[];
  appointments: Appointment[];
  settings: Settings;
  canWrite: boolean;
  gridRef: RefObject<HTMLDivElement | null>;
  /** Minute of the clinic day to bring near the top when the day first shows (the server's now, for today). */
  startMinute: number;
  onCommand: (command: Command) => void;
}

/** The slot index of an instant within the clinic day, or -1 when it falls outside the grid. */
export function slotOf(date: string, instant: string, settings: Settings): number {
  const open = clinicInstant(date, Math.floor(settings.openMinute / 60), settings.openMinute % 60)!;
  const index = Math.round((new Date(instant).getTime() - open.getTime()) / 60_000 / settings.slotMinutes);
  return index;
}

/** The `Day calendar` grid: a column per consult room, a gridcell per slot, appointments as buttons in their first slot. */
export function Calendar({ date, rooms, appointments, settings, canWrite, gridRef, startMinute, onCommand }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef<string | null>(null);
  const slotCount = (settings.closeMinute - settings.openMinute) / settings.slotMinutes;
  useLayoutEffect(() => {
    if (scrolledFor.current === date) return;
    scrolledFor.current = date;
    const row = gridRef.current?.querySelector<HTMLElement>('.cal-row');
    if (!row || !scroller.current) return;
    const index = Math.max(0, Math.floor((startMinute - settings.openMinute) / settings.slotMinutes) - 1);
    scroller.current.scrollTop = index * row.getBoundingClientRect().height;
  });
  const slots = useMemo(() => Array.from({ length: slotCount }, (_, i) => i), [slotCount]);
  const [active, setActive] = useState({ room: 0, slot: 0 });
  const slotMs = settings.slotMinutes * 60_000;
  const opensAt = clinicInstant(date, Math.floor(settings.openMinute / 60), settings.openMinute % 60)!.getTime();

  const covering = (roomId: string, slot: number) => {
    const at = opensAt + slot * slotMs;
    return appointments.find((a) => a.roomId === roomId && new Date(a.start).getTime() <= at && at < new Date(a.end).getTime());
  };

  const cellAt = (room: number, slot: number) => gridRef.current?.querySelector<HTMLElement>(`[data-room="${rooms[room]?.id}"][data-slot="${slot}"]`) ?? null;

  const focusCell = (room: number, slot: number) => {
    const r = Math.max(0, Math.min(rooms.length - 1, room));
    const s = Math.max(0, Math.min(slotCount - 1, slot));
    setActive({ room: r, slot: s });
    const cell = cellAt(r, s);
    cell?.focus();
    cell?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  const positionOf = (el: HTMLElement) => {
    const cell = el.closest<HTMLElement>('[role="gridcell"]')!;
    return { room: rooms.findIndex((r) => r.id === cell.dataset.room), slot: Number(cell.dataset.slot), cell };
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, appointmentFromButton?: Appointment) => {
    const target = event.target as HTMLElement;
    const cellHost = target.closest<HTMLElement>('[role="gridcell"]');
    if (!cellHost) return;
    const at = positionOf(cellHost);
    const appointment = appointmentFromButton ?? covering(rooms[at.room]!.id, at.slot);
    const key = event.key;
    const arrow = ({ ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] } as Record<string, [number, number]>)[key];
    if (arrow) {
      event.preventDefault();
      event.stopPropagation();
      if (event.altKey && appointment && canWrite) {
        if (event.shiftKey) {
          if (arrow[1] !== 0) onCommand({ type: 'resize', appointment, slotDelta: arrow[1] });
        } else {
          onCommand({ type: 'move', appointment, roomDelta: arrow[0], slotDelta: arrow[1] });
        }
      } else if (!event.altKey) {
        focusCell(at.room + arrow[0], at.slot + arrow[1]);
      }
      return;
    }
    if (key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (appointment) onCommand({ type: 'open', appointment, opener: target });
      else if (canWrite) onCommand({ type: 'book', roomId: rooms[at.room]!.id, slot: at.slot, opener: cellHost });
      return;
    }
    if (!appointment || !canWrite || event.ctrlKey || event.metaKey || event.altKey) return;
    if (key === 'i' || key === 'I') {
      event.preventDefault();
      event.stopPropagation();
      onCommand({ type: 'check-in', appointment });
    } else if (key === 'Delete') {
      event.preventDefault();
      event.stopPropagation();
      onCommand({ type: 'cancel', appointment });
    }
  };

  return (
    <div className="calendar-scroll" ref={scroller}>
      <div
        ref={gridRef}
        role="grid"
        aria-label="Day calendar"
        aria-rowcount={slotCount + 1}
        className="calendar"
        style={{ '--rooms': rooms.length } as React.CSSProperties}
        onKeyDown={(event) => onKeyDown(event)}
      >
        <div role="row" className="cal-head">
          <div role="columnheader" className="cal-corner" />
          {rooms.map((r) => (
            <div key={r.id} role="columnheader">
              {r.name}
            </div>
          ))}
        </div>
        {slots.map((slot) => {
          const minute = settings.openMinute + slot * settings.slotMinutes;
          return (
            <div key={slot} role="row" className="cal-row">
              <div role="rowheader" className={`cal-time ${minute % 60 === 0 ? 'hour' : ''}`}>
                {slotLabel(minute)}
              </div>
              {rooms.map((room, roomIndex) => {
                const here = covering(room.id, slot);
                const first = here && slotOf(date, here.start, settings) === slot ? here : undefined;
                const isActive = active.room === roomIndex && active.slot === slot;
                return (
                  <div
                    key={room.id}
                    role="gridcell"
                    aria-label={`${room.name}, ${slotLabel(minute)}, ${here ? 'booked' : 'free'}`}
                    tabIndex={isActive ? 0 : -1}
                    data-room={room.id}
                    data-slot={slot}
                    className={`cal-cell ${here ? 'is-booked' : ''}`}
                    onFocus={() => setActive({ room: roomIndex, slot })}
                  >
                    {first && (
                      <AppointmentButton
                        appointment={first}
                        slots={Math.max(1, Math.round((new Date(first.end).getTime() - new Date(first.start).getTime()) / slotMs))}
                        canMove={canWrite}
                        gridRef={gridRef}
                        onOpen={(appointment, opener) => onCommand({ type: 'open', appointment, opener })}
                        onKey={(event, appointment) => onKeyDown(event, appointment)}
                        onDrop={(appointment, dropAt) => onCommand({ type: 'drop', appointment, target: dropAt })}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
