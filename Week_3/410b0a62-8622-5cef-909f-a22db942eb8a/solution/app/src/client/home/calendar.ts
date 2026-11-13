import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { addDays, dayLabel } from '../../shared/dates.js';
import type { LibraryItem, Workout } from '../../shared/types.js';
import { failureMessage, fieldErrors, patch, post } from '../api.js';
import { useAnnouncer, type Announcer } from '../hooks.js';

export type Subject = { kind: 'move'; workout: Workout } | { kind: 'place'; item: LibraryItem };

const subjectKey = (subject: Subject): string => (subject.kind === 'move' ? `move:${subject.workout.id}` : `place:${subject.item.id}`);
const subjectName = (subject: Subject): string => (subject.kind === 'move' ? subject.workout.title : subject.item.name);

interface Holding {
  key: string;
  subject: Subject;
  cursor: string;
}

export interface Calendar {
  announcer: Announcer;
  /** The day currently highlighted as a drop target, by keyboard or by drag. */
  target: string | null;
  /** The Move button that should take focus once the calendar has redrawn. */
  focusKey: string | null;
  holding: string | null;
  onKeyDown: (event: KeyboardEvent<HTMLElement>, subject: Subject) => void;
  startDrag: (event: ReactPointerEvent<HTMLElement>, workout: Workout) => void;
  dragging: string | null;
  consumeClickAfterDrag: () => boolean;
}

interface Options {
  athleteId: string;
  /** The Monday and Sunday of the centred week. */
  weekDays: readonly string[];
  today: string;
  /** Changes whenever a planned workout appears on another day, so focus can be put back on its Move button. */
  layoutKey: string;
  onChanged: () => void;
}

/** Moving planned workouts and placing library workouts by keyboard pick-up and by drag. */
export function useCalendar({ athleteId, weekDays, today, layoutKey, onChanged }: Options): Calendar {
  const announcer = useAnnouncer();
  const [holding, setHolding] = useState<Holding | null>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    if (!focusKey) return undefined;
    const [kind, id] = focusKey.split(':');
    const selector = `[data-${kind}-id="${id}"]`;
    document.querySelector<HTMLElement>(selector)?.focus();
    const release = (event: FocusEvent): void => {
      if (!(event.target as HTMLElement).matches(selector)) setFocusKey(null);
    };
    document.addEventListener('focusin', release);
    return () => document.removeEventListener('focusin', release);
  }, [focusKey, layoutKey]);

  const commit = useCallback(
    async (subject: Subject, date: string): Promise<void> => {
      const key = subjectKey(subject);
      try {
        if (subject.kind === 'move') {
          if (date !== subject.workout.date) await patch(`/api/workouts/${subject.workout.id}`, { version: subject.workout.version, date });
          announcer.say(`Moved ${subject.workout.title} to ${dayLabel(date)}.`);
        } else {
          await post(`/api/athletes/${athleteId}/workouts`, { date, sport: subject.item.sport, title: subject.item.name, library_id: subject.item.id });
          announcer.say(`Placed ${subject.item.name} on ${dayLabel(date)}.`);
        }
      } catch (failure) {
        announcer.say(fieldErrors(failure)?.['date'] ?? failureMessage(failure));
      }
      setFocusKey(key);
      onChanged();
    },
    [announcer, athleteId, onChanged]
  );

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, subject: Subject): void => {
    const key = subjectKey(subject);
    const active = holding?.key === key;
    if (!active) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      const start = subject.kind === 'move' ? subject.workout.date : weekDays.includes(today) ? today : (weekDays[0] as string);
      setHolding({ key, subject, cursor: start });
      announcer.say(`Picked up ${subjectName(subject)}. Use the arrow keys to choose a day, then press Enter to drop or Escape to cancel.`);
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const index = weekDays.indexOf(holding.cursor);
      const next = weekDays[Math.min(Math.max((index < 0 ? 0 : index) + (event.key === 'ArrowLeft' ? -1 : 1), 0), weekDays.length - 1)] as string;
      setHolding({ ...holding, cursor: next });
      announcer.say(dayLabel(next));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setHolding(null);
      void commit(subject, holding.cursor);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setHolding(null);
      announcer.say(`Move of ${subjectName(subject)} cancelled.`);
    }
  };

  const startDrag = (event: ReactPointerEvent<HTMLElement>, workout: Workout): void => {
    const grip = (event.target as HTMLElement).closest('.item-move') !== null;
    if (event.button !== 0 || ((event.target as HTMLElement).closest('button') && !grip) || (event.pointerType !== 'mouse' && !grip)) return;
    const from = { x: event.clientX, y: event.clientY };
    let active = false;
    const chipAt = (x: number, y: number): string | null => {
      const chip = document.elementsFromPoint(x, y).find((element) => element.matches('.chip[data-date]'));
      return chip?.getAttribute('data-date') ?? null;
    };
    const move = (moved: PointerEvent): void => {
      if (!active && Math.hypot(moved.clientX - from.x, moved.clientY - from.y) < 4) return;
      if (!active) {
        active = true;
        setDragging(workout.id);
      }
      setDragTarget(chipAt(moved.clientX, moved.clientY));
    };
    const finish = (released: PointerEvent): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      setDragTarget(null);
      setDragging(null);
      if (!active) return;
      suppressClick.current = true;
      const date = released.type === 'pointerup' ? chipAt(released.clientX, released.clientY) : null;
      if (date && date !== workout.date) void commit({ kind: 'move', workout }, date);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  return {
    announcer,
    target: holding?.cursor ?? dragTarget,
    focusKey,
    holding: holding?.key ?? null,
    onKeyDown,
    startDrag,
    dragging,
    consumeClickAfterDrag: () => {
      const was = suppressClick.current;
      suppressClick.current = false;
      return was;
    }
  };
}

export const weekDates = (monday: string): string[] => Array.from({ length: 7 }, (_, offset) => addDays(monday, offset));
