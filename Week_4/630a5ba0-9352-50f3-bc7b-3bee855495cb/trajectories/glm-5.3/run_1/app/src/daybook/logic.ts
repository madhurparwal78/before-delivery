import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, isFailure, type ApiTask, type ApiDay, type ApiSession } from '../api/client';
import { useAnnouncer } from '../api/session';
import { ESTIMATE_CHOICES, ESTIMATE_CHOICE_LABEL } from '../../src-shared/constants';

export type DropZone =
  | { kind: 'backlog' }
  | { kind: 'day'; date: string }
  | { kind: 'slot'; date: string; time: string };

export interface DragState {
  readonly taskId: string;
  readonly title: string;
  readonly estimate: number | null;
  readonly fromDay: string | null;
  readonly zone: DropZone | null;
}

export interface DaybookData {
  today: string;
  timeZone: string;
  thresholdMinutes: number;
  days: ApiDay[];
  backlog: ApiTask[];
}

export interface OptimisticTotals {
  [date: string]: number;
}

/** Derived day totals are computed server-side; the client only tracks optimistic deltas. */
export function projectTotal(day: ApiDay, estimate: number | null, addingTo: string): number {
  if (day.date !== addingTo) return day.plannedMinutes;
  return day.plannedMinutes + (estimate ?? 0);
}

export const copy = {
  moved(task: string, column: string, day: ApiDay): string {
    return `Moved ${task} to ${column}. ${day.label} is at ${day.plannedMinutes}m of ${day.overByMinutes + day.plannedMinutes}m.`;
  },
  movedBacklog(task: string): string {
    return `Moved ${task} to Backlog.`;
  },
  couldNotMove(task: string, reason: string, column: string): string {
    return `Couldn't move ${task}: ${reason}. It's back in ${column}.`;
  },
  timeboxed(task: string, start: string): string {
    return `Timeboxed ${task} at ${start}.`;
  },
  couldNotTimebox(task: string, reason: string): string {
    return `Couldn't timebox ${task}: ${reason}.`;
  },
  movedSession(task: string, start: string): string {
    return `Moved ${task} to ${start}.`;
  },
  couldNotMoveSession(task: string, reason: string): string {
    return `Couldn't move ${task}: ${reason}. Showing the latest time.`;
  },
  removedSession(task: string): string {
    return `Removed ${task} from the calendar.`;
  },
  couldNotRemoveSession(task: string, reason: string): string {
    return `Couldn't remove ${task}: ${reason}.`;
  },
  estimateSet(task: string, minutes: number): string {
    return `${task}: ${minutes} minutes.`;
  },
  markedDone(task: string): string {
    return `Marked ${task} done.`;
  },
  reopened(task: string): string {
    return `Reopened ${task}.`;
  },
  addedToBacklog(task: string): string {
    return `Added ${task} to the Backlog.`;
  },
  checkCount(over: number): string {
    return over === 1 ? '1 of 5 days are over your threshold.' : `${over} of 5 days are over your threshold.`;
  },
  pickedUp(task: string): string {
    return `Picked up ${task}. Use arrow keys to choose a place, Enter to drop, Escape to cancel.`;
  },
  overDay(label: string, projected: number, threshold: number): string {
    return `Over ${label}: ${projected}m of ${threshold}m.`;
  },
  overDayExtra(label: string, projected: number, threshold: number, overBy: number): string {
    return `Over ${label}: ${projected}m of ${threshold}m. Over by ${overBy}m.`;
  },
  overBacklog(): string {
    return 'Over Backlog.';
  },
  overSlot(time: string): string {
    return `Calendar slot ${time}.`;
  },
  cancelled(task: string, column: string): string {
    return `Cancelled. ${task} stays in ${column}.`;
  },
  overLabel(overBy: number): string {
    return `Over by ${overBy}m`;
  },
};

/** Counts up a total after a drop, finishing in under half a second. */
export function useCounter(target: number, animate: boolean): number {
  const [value, setValue] = useState(target);
  const raf = useRef<number | null>(null);
  const from = useRef(target);

  useEffect(() => {
    if (!animate || value === target) {
      setValue(target);
      from.current = target;
      return;
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setValue(target);
      from.current = target;
      return;
    }
    const start = performance.now();
    const origin = from.current;
    const duration = 420;
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(origin + (target - origin) * eased);
      setValue(next);
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, animate]);

  return value;
}

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Boards re-read from the server on focus and at least every 60 seconds. */
export function usePoll(callback: () => void, ms = 60_000): void {
  const cb = useRef(callback);
  cb.current = callback;
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') cb.current();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => cb.current(), ms);
    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [ms]);
}

/** The day label for the first column, from the device clock converted to the profile zone. */
export function useLocalToday(timeZone: string): string {
  const [today, setToday] = useState(() => localDateNow(timeZone));
  useEffect(() => {
    const tick = (): void => {
      const next = localDateNow(timeZone);
      setToday((prev) => (prev === next ? prev : next));
    };
    const timer = setInterval(tick, 5_000);
    return () => clearInterval(timer);
  }, [timeZone]);
  return today;
}

export const localDateNow = (timeZone: string): string => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
};

export const shortDay = (date: string): string => {
  const d = new Date(`${date}T12:00:00Z`);
  return `${new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short' }).format(d)} ${new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric' }).format(d)}`;
};
