import { useEffect, useRef, useState } from 'react';
import type { ApiDay, CalendarItem } from '../api/client';
import { dayLabelOf } from './labels';

const SLOT_HEIGHT = 44; // px per half hour, all slots are 44px tall targets
const SLOTS: string[] = [];
for (let h = 7; h <= 20; h++) {
  SLOTS.push(`${String(h).padStart(2, '0')}:00`);
  if (h !== 20) SLOTS.push(`${String(h).padStart(2, '0')}:30`);
}
const SLOT_MINUTES = 7 * 60;

export function CalendarStrip({
  date,
  timeZone,
  items,
  days,
  onPrev,
  onNext,
  showHint,
  drag,
  keyboardSlot,
  onRemoveSession,
  onSessionDragStart,
  onSessionDrop,
  animate,
}: {
  date: string;
  timeZone: string;
  items: CalendarItem[];
  days: ApiDay[];
  onPrev: () => void;
  onNext: () => void;
  showHint: boolean;
  drag: { taskId: string; estimate: number | null; fromDay: string | null; zone: string | null; source: import('../api/client').ApiTask } | null;
  keyboardSlot: string | null;
  onRemoveSession: (item: CalendarItem) => void;
  onSessionDragStart: (item: CalendarItem) => void;
  onSessionDrop: (item: CalendarItem, date: string, time: string) => void;
  animate: boolean;
}): JSX.Element {
  const [hoverSlot, setHoverSlot] = useState<string | null>(null);
  const [heldSession, setHeldSession] = useState<CalendarItem | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);

  const dayItems = items.filter((i) => i.date === date);
  const canPrev = days.length > 0 && date > (days[0]?.date ?? date);
  const canNext = days.length > 0 && date < (days[days.length - 1]?.date ?? date);

  useEffect(() => {
    if (heldSession === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHoverSlot((prev) => nextSlot(prev ?? heldSession.startTime, 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHoverSlot((prev) => nextSlot(prev ?? heldSession.startTime, -1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onSessionDrop(heldSession, date, hoverSlot ?? heldSession.startTime);
        setHeldSession(null);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setHeldSession(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [heldSession, hoverSlot, date, onSessionDrop]);

  const slotIndex = (time: string): number => {
    const [h, m] = time.split(':').map(Number) as [number, number];
    return h * 60 + m - SLOT_MINUTES;
  };

  const blockHeight = (start: string, end: string): number => {
    const minutes = slotIndex(end) - slotIndex(start);
    return Math.max(SLOT_HEIGHT, (Math.max(30, minutes) / 30) * SLOT_HEIGHT);
  };

  return (
    <section className="calendar-strip" aria-label="Calendar">
      <div className="strip-head">
        <button type="button" onClick={onPrev} disabled={!canPrev} aria-label="Previous day">
          <PrevIcon />
        </button>
        <h2>{dayLabelOf(date, timeZone)}</h2>
        <div className="nav-arrows">
          <button type="button" onClick={onNext} disabled={!canNext} aria-label="Next day">
            <NextIcon />
          </button>
        </div>
      </div>
      {showHint ? <p className="hint-line" id="timebox-hint">Drag a card onto a half-hour slot to timebox it.</p> : null}
      <div className="slots" ref={stripRef} style={{ height: `${SLOTS.length * SLOT_HEIGHT + 20}px`, position: 'relative', marginTop: 8 }}>
        {SLOTS.map((time, i) => {
          const isHour = time.endsWith(':00');
          const isTarget = (hoverSlot ?? keyboardSlot) === time;
          return (
            <div
              key={time}
              className={`slot${isHour ? ' hour' : ''}${isTarget ? ' slot-target' : ''}`}
              style={{ top: `${i * SLOT_HEIGHT}px`, height: `${SLOT_HEIGHT}px` }}
              data-slot={time}
              data-drop={`slot:${time}`}
              onPointerEnter={() => setHoverSlot(time)}
              onPointerLeave={() => setHoverSlot((prev) => (prev === time ? null : prev))}
              onPointerUp={(e) => {
                if (drag !== null && drag.zone?.startsWith('slot:')) {
                  // handled by the window listener for cards
                }
                if (heldSession !== null) {
                  onSessionDrop(heldSession, date, time);
                  setHeldSession(null);
                }
              }}
            >
              {isHour ? <span className="time">{time}</span> : null}
            </div>
          );
        })}
        {dayItems
          .filter((i) => i.kind !== 'meeting')
          .map((item) => {
            const height = blockHeight(item.startTime, item.endTime);
            const top = (slotIndex(item.startTime) / 30) * SLOT_HEIGHT;
            if (item.kind === 'routine') {
              return (
                <div
                  key={item.id}
                  className="routine-block"
                  style={{ top: `${top}px`, height: `${height}px` }}
                  aria-hidden="false"
                >
                  <span>{item.title}</span>
                  <span className="times">{item.startTime}–{item.endTime}</span>
                </div>
              );
            }
            const held = heldSession?.id === item.id;
            return (
              <div
                key={item.id}
                className={`session-block${held ? ' dragging' : ''}`}
                style={{ top: `${top}px`, height: `${height}px`, ...(animate ? {} : {}) }}
                tabIndex={-1}
              >
                <button
                  type="button"
                  style={{ all: 'unset', cursor: 'grab', display: 'flex', width: '100%', minHeight: '44px', alignItems: 'center' }}
                  aria-label={`${item.title}, ${item.startTime} to ${item.endTime}`}
                  onPointerDown={() => onSessionDragStart(item)}
                  onKeyDown={(e) => {
                    if (e.key === ' ') {
                      e.preventDefault();
                      setHeldSession(item);
                    }
                  }}
                >
                  <span>{item.title}</span>
                  <span className="times">{item.startTime}–{item.endTime}</span>
                </button>
                <button
                  type="button"
                  className="remove"
                  aria-label={`Remove ${item.title} from calendar`}
                  onClick={() => onRemoveSession(item)}
                >
                  <XIcon />
                </button>
              </div>
            );
          })}
        {dayItems
          .filter((i) => i.kind === 'meeting')
          .map((item) => {
            const height = blockHeight(item.startTime, item.endTime);
            const top = (slotIndex(item.startTime) / 30) * SLOT_HEIGHT;
            return (
              <div key={item.id} className="meeting-block" style={{ top: `${top}px`, height: `${height}px` }}>
                <span>Meeting: {item.title}</span>
                <span className="times">{item.startTime}–{item.endTime}</span>
              </div>
            );
          })}
      </div>
    </section>
  );
}

const nextSlot = (time: string, delta: number): string => {
  const idx = SLOTS.indexOf(time);
  const next = SLOTS[Math.max(0, Math.min(SLOTS.length - 1, idx + delta))];
  return next ?? time;
};

function PrevIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function NextIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function XIcon(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
