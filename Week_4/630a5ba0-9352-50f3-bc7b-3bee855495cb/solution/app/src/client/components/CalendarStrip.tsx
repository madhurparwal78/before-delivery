import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { CalendarItem, Session, Task } from "../../shared/types.js";
import { dayLabel, minutesOf, shiftTime, wallOf } from "../../shared/time.js";
import { announce } from "../announce.js";

export const SLOT_HEIGHT = 44;
export const FIRST_SLOT = 7 * 60;
const LAST_END = 20 * 60;
export const SLOTS = Array.from({ length: (LAST_END - FIRST_SLOT) / 30 }, (_, i) => shiftTime("07:00", i * 30));

type Planned = { task: Task; session: Session };

type Props = {
  date: string;
  zone: string;
  dates: string[];
  sessions: Planned[];
  items: CalendarItem[];
  cardSlot: string | null;
  hint: boolean;
  onShowDate: (date: string) => void;
  onMoveSession: (task: Task, date: string, time: string) => void;
  onRemoveSession: (task: Task) => void;
};

type BlockHold = { id: string; via: "pointer" | "keyboard"; date: string; time: string };

/** Local minutes of an instant on a date: 0 before the day, 1440 after it. */
function minuteOn(iso: string, date: string, zone: string): number {
  const wall = wallOf(Date.parse(iso), zone);
  if (wall.date < date) return 0;
  if (wall.date > date) return 24 * 60;
  return minutesOf(wall.time);
}

function placement(start: number, end: number): { top: number; height: number } | null {
  const top = Math.max(start, FIRST_SLOT);
  const bottom = Math.min(end, LAST_END);
  if (bottom <= top) return null;
  return { top: ((top - FIRST_SLOT) / 30) * SLOT_HEIGHT, height: ((bottom - top) / 30) * SLOT_HEIGHT };
}

const clampTime = (minutes: number, length: number) =>
  Math.min(Math.max(minutes, FIRST_SLOT), Math.max(FIRST_SLOT, LAST_END - Math.max(length, 30)));

export function CalendarStrip({ date, zone, dates, sessions, items, cardSlot, hint, onShowDate, onMoveSession, onRemoveSession }: Props) {
  const [hold, setHold] = useState<BlockHold | null>(null);
  const holdRef = useRef<BlockHold | null>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const index = dates.indexOf(date);

  const setHolding = (next: BlockHold | null) => {
    holdRef.current = next;
    setHold(next);
  };

  useEffect(() => {
    targetRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [cardSlot, hold?.time]);

  const blockKey = (planned: Planned, event: KeyboardEvent<HTMLButtonElement>) => {
    const { task, session } = planned;
    const current = holdRef.current;
    const length = task.estimateMinutes ?? 30;
    if (!current || current.id !== session.id) {
      if (event.key === " ") {
        event.preventDefault();
        setHolding({ id: session.id, via: "keyboard", date: session.date, time: session.startTime });
        announce(`Picked up ${task.title}. Use arrow keys to choose a place, Enter to drop, Escape to cancel.`);
      }
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const time = shiftTime("00:00", clampTime(minutesOf(current.time) + (event.key === "ArrowUp" ? -30 : 30), length));
      setHolding({ ...current, time });
      announce(`Calendar slot ${time}.`);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const next = dates[dates.indexOf(current.date) + (event.key === "ArrowLeft" ? -1 : 1)];
      if (!next) return;
      setHolding({ ...current, date: next });
      onShowDate(next);
      announce(`${dayLabel(next)}, calendar slot ${current.time}.`);
    } else if (event.key === "Enter") {
      event.preventDefault();
      setHolding(null);
      if (current.date !== session.date || current.time !== session.startTime) onMoveSession(task, current.date, current.time);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setHolding(null);
      onShowDate(session.date);
      announce(`Cancelled. ${task.title} stays in ${dayLabel(session.date)}.`);
    } else if (event.key === " ") event.preventDefault();
  };

  const blockPointer = (planned: Planned, event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const { task, session } = planned;
    const startY = event.clientY;
    const startX = event.clientX;
    const length = task.estimateMinutes ?? 30;
    let lifted = false;
    const move = (e: globalThis.PointerEvent) => {
      if (!lifted && Math.hypot(e.clientX - startX, e.clientY - startY) < 5) return;
      lifted = true;
      const slots = Math.round((e.clientY - startY) / SLOT_HEIGHT);
      const time = shiftTime("00:00", clampTime(minutesOf(session.startTime) + slots * 30, length));
      if (holdRef.current?.time !== time || !holdRef.current) setHolding({ id: session.id, via: "pointer", date: session.date, time });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      const held = holdRef.current;
      setHolding(null);
      if (lifted && held && held.time !== session.startTime) onMoveSession(task, held.date, held.time);
    };
    const cancel = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      setHolding(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  const shown = sessions.filter((p) => (hold?.id === p.session.id ? hold.date : p.session.date) === date);

  return (
    <section className="strip" aria-label="Calendar" data-drop="calendar">
      <div className="strip-head">
        <h2 className="strip-title" aria-label={dayLabel(date)}>
          {dayLabel(date)}
        </h2>
        <div className="strip-nav">
          <button type="button" className="button button-quiet" disabled={index <= 0} onClick={() => onShowDate(dates[index - 1])}>
            <ChevronLeft aria-hidden="true" size={18} /> Previous day
          </button>
          <button type="button" className="button button-quiet" disabled={index >= dates.length - 1} onClick={() => onShowDate(dates[index + 1])}>
            Next day <ChevronRight aria-hidden="true" size={18} />
          </button>
        </div>
      </div>
      {hint && <p className="strip-hint">Drop a card on a half-hour slot, or hold it with Space and use the arrow keys, to give it a time.</p>}
      <div className="strip-scroll" role="group" aria-label="Half-hour slots" tabIndex={0}>
        <div className="slots" data-slots="" style={{ height: SLOTS.length * SLOT_HEIGHT }}>
          {SLOTS.map((time) => (
            <div key={time} className={`slot${time.endsWith(":00") ? " slot-hour" : ""}`} data-slot={time}>
              {time.endsWith(":00") && <span className="slot-label mono">{time}</span>}
            </div>
          ))}
          {cardSlot && (
            <div ref={targetRef} className="slot-target" style={{ top: ((minutesOf(cardSlot) - FIRST_SLOT) / 30) * SLOT_HEIGHT }} aria-hidden="true" />
          )}
          {items.map((item) => {
            const box = placement(minuteOn(item.start, date, zone), minuteOn(item.end, date, zone));
            if (!box) return null;
            const name = item.kind === "meeting" ? `Meeting: ${item.title}, ${item.startTime} to ${item.endTime}` : `${item.title}, ${item.startTime} to ${item.endTime}`;
            return (
              <div key={`${item.kind}-${item.id}`} className={`block block-${item.kind}`} role="img" aria-label={name} style={box}>
                <span className="block-title">{item.title}</span>
                <span className="block-time mono">
                  {item.startTime}–{item.endTime}
                </span>
              </div>
            );
          })}
          {shown.map((planned) => {
            const { task, session } = planned;
            const held = hold?.id === session.id ? hold : null;
            const startTime = held ? held.time : session.startTime;
            const start = minutesOf(startTime);
            const length = Math.round((Date.parse(session.end) - Date.parse(session.start)) / 60_000);
            const box = placement(start, start + length);
            if (!box) return null;
            const endTime = shiftTime(startTime, length);
            return (
              <div key={session.id} ref={held ? targetRef : undefined} className={`block block-session${held ? " is-held" : ""}`} style={box}>
                <button
                  type="button"
                  className="block-move"
                  aria-label={`${task.title}, ${startTime} to ${endTime}`}
                  onKeyDown={(event) => blockKey(planned, event)}
                  onPointerDown={(event) => blockPointer(planned, event)}
                  onBlur={() => {
                    if (holdRef.current?.via === "keyboard" && holdRef.current.id === session.id) setHolding(null);
                  }}
                >
                  <span className="block-title">{task.title}</span>
                  <span className="block-time mono">
                    {startTime}–{endTime}
                  </span>
                </button>
                <button type="button" className="block-remove" aria-label={`Remove ${task.title} from calendar`} onClick={() => onRemoveSession(task)}>
                  <X aria-hidden="true" size={16} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
