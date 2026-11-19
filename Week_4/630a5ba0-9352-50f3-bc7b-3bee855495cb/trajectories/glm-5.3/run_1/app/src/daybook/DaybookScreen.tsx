import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, isFailure, type ApiDay, type ApiTask, type BoardResponse, type CalendarItem, type ShutdownPreview } from '../api/client';
import { useSession, useAnnouncer } from '../api/session';
import { SubscriptionBanner } from '../shell';
import { Dialog, PendingButton, reasonFor, GENERIC_ERROR, fieldErrors } from '../components';
import { Icon } from '../icons/Icon';
import { CardSlip, type CardCallbacks } from './CardSlip';
import { Backlog, ShutdownDialog } from './Backlog';
import { CalendarStrip } from './CalendarStrip';
import { Waterline, LoadMeter } from './Waterline';
import { copy, localDateNow, prefersReducedMotion, shortDay, useCounter, useLocalToday, usePoll } from './logic';
import { dayLabelOf } from './labels';
import { DAILY_RITUAL_STEPS, ESTIMATE_CHOICES } from '../../src-shared/constants';
import { addDays, dayLabel } from '../../src-shared/domain';

type Step = (typeof DAILY_RITUAL_STEPS)[number];

const SLOTS: string[] = [];
for (let h = 7; h <= 20; h++) {
  SLOTS.push(`${String(h).padStart(2, '0')}:00`);
  if (h !== 20) SLOTS.push(`${String(h).padStart(2, '0')}:30`);
}
const SLOT_MIN = 7 * 60;

export function DaybookScreen(): JSX.Element {
  const { me, reload } = useSession();
  const { announce } = useAnnouncer();
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [step, setStep] = useState<Step>('Pull');
  const [drag, setDrag] = useState<{ taskId: string; estimate: number | null; fromDay: string | null; zone: string | null; source: ApiTask } | null>(null);
  const [keyboardDrag, setKeyboardDrag] = useState(false);
  const [keyboardZone, setKeyboardZone] = useState<string>('backlog');
  const [keyboardSlot, setKeyboardSlot] = useState<string>('09:00');
  const [stripDay, setStripDay] = useState<string | null>(null);
  const [calendarItems, setCalendarItems] = useState<CalendarItem[]>([]);
  const [optimistic, setOptimistic] = useState<Record<string, number>>({});
  const [rolledBackIds, setRolledBackIds] = useState<Set<string>>(new Set());
  const [sessionDrag, setSessionDrag] = useState<{ id: string; version: number; title: string; fromDay: string; fromTime: string } | null>(null);
  const [shutdownPreview, setShutdownPreview] = useState<ShutdownPreview | null>(null);
  const [shutdownOpen, setShutdownOpen] = useState(false);
  const [shutdownPending, setShutdownPending] = useState(false);
  const addBoxRef = useRef<HTMLInputElement>(null);
  const shutdownButtonRef = useRef<HTMLButtonElement>(null);

  const today = useLocalToday(me?.member.timeZone ?? 'UTC');
  const animate = !prefersReducedMotion();

  const loadBoard = useCallback(async () => {
    if (me === null) return;
    try {
      const res = await api.get<BoardResponse>('/api/board');
      setBoard(res);
      setOptimistic({});
    } catch {
      /* keep the last board; the next sweep retries */
    }
  }, [me]);

  const loadCalendar = useCallback(async (from: string, to: string) => {
    try {
      const res = await api.get<{ items: CalendarItem[] }>(`/api/calendar?from=${from}&to=${to}`);
      setCalendarItems(res.items);
    } catch {
      /* keep the last items */
    }
  }, []);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  useEffect(() => {
    if (board === null) return;
    const from = board.days[0]?.date ?? today;
    const to = addDays(from, 4);
    void loadCalendar(from, to);
  }, [board, today, loadCalendar]);

  usePoll(() => {
    void loadBoard();
    void reload();
  });

  const days = board?.days ?? [];
  const threshold = board?.thresholdMinutes ?? 360;
  const stripDate = stripDay ?? days[0]?.date ?? today;

  // ---- Announced column totals with optimistic delta while dragging
  const projectedFor = useCallback(
    (date: string): number => {
      const day = days.find((d) => d.date === date);
      if (day === undefined) return 0;
      const base = day.plannedMinutes;
      if (drag === null) return base;
      if (drag.fromDay === date && drag.zone === date) return base;
      if (drag.zone === date && drag.fromDay !== date) return base + (drag.estimate ?? 0);
      return base;
    },
    [days, drag],
  );

  const dropOnBacklog = useCallback(
    async (task: ApiTask) => {
      if (board === null || task.dayDate === null) return;
      const previousColumn = dayLabelOf(task.dayDate, board.timeZone);
      const prevDay = task.dayDate;
      try {
        await api.patch(`/api/tasks/${task.id}`, { version: task.version, dayDate: null });
        setOptimistic({});
        await loadBoard();
        announce(copy.movedBacklog(task.title));
      } catch (e) {
        setRolledBackIds(new Set([task.id]));
        setTimeout(() => setRolledBackIds(new Set()), 600);
        announce(copy.couldNotMove(task.title, reasonFor(e), previousColumn));
        void prevDay;
      }
    },
    [board, announce, loadBoard],
  );

  const dropOnDay = useCallback(
    async (task: ApiTask, date: string) => {
      if (board === null) return;
      if (task.dayDate === date) return;
      const fromColumn = task.dayDate === null ? 'Backlog' : dayLabelOf(task.dayDate, board.timeZone);
      const targetDay = days.find((d) => d.date === date);
      const projected = (targetDay?.plannedMinutes ?? 0) + (task.estimateMinutes ?? 0);
      setOptimistic({ [date]: projected });
      try {
        const res = await api.patch<{ days: ApiDay[] }>(`/api/tasks/${task.id}`, { version: task.version, dayDate: date });
        setOptimistic({});
        await loadBoard();
        const confirmed = res.days.find((d) => d.date === date);
        if (confirmed !== undefined) {
          announce(copy.moved(task.title, confirmed.label, { ...confirmed, overByMinutes: threshold - confirmed.plannedMinutes > 0 ? 0 : threshold - confirmed.plannedMinutes > 0 ? 0 : confirmed.overByMinutes, plannedMinutes: confirmed.plannedMinutes } as ApiDay) || movedCopy(confirmed, threshold, task.title));
        }
      } catch (e) {
        setOptimistic({});
        setRolledBackIds(new Set([task.id]));
        setTimeout(() => setRolledBackIds(new Set()), 600);
        announce(copy.couldNotMove(task.title, reasonFor(e), fromColumn));
      }
    },
    [board, days, announce, loadBoard, threshold],
  );

  const timeboxTask = useCallback(
    async (task: ApiTask, date: string, time: string) => {
      const key = Math.random().toString(36).slice(2, 12);
      try {
        await api.post('/api/sessions', { taskId: task.id, date, startTime: time });
        announce(copy.timeboxed(task.title, time));
        await loadBoard();
      } catch (e) {
        announce(copy.couldNotTimebox(task.title, reasonFor(e)));
      }
      void key;
    },
    [announce, loadBoard],
  );

  const onEstimate = useCallback(
    async (task: ApiTask, minutes: number) => {
      try {
        const res = await api.patch<{ task: ApiTask; days: ApiDay[] }>(`/api/tasks/${task.id}`, { version: task.version, estimateMinutes: minutes });
        announce(copy.estimateSet(task.title, minutes));
        setOptimistic({});
        await loadBoard();
      } catch (e) {
        announce(copy.couldNotMove(task.title, reasonFor(e), task.dayDate === null ? 'Backlog' : 'its column'));
      }
    },
    [announce, loadBoard],
  );

  const onToggleDone = useCallback(
    async (task: ApiTask) => {
      const next = task.status === 'done' ? 'open' : 'done';
      try {
        await api.patch(`/api/tasks/${task.id}`, { version: task.version, status: next });
        announce(next === 'done' ? copy.markedDone(task.title) : copy.reopened(task.title));
        await loadBoard();
      } catch (e) {
        announce(copy.couldNotMove(task.title, reasonFor(e), task.dayDate === null ? 'Backlog' : 'its column'));
      }
    },
    [announce, loadBoard],
  );

  const callbacks: CardCallbacks = {
    onMoveStart: (e, task) => {
      if (e.button !== 0) return;
      setKeyboardDrag(false);
      setDrag({ taskId: task.id, estimate: task.estimateMinutes, fromDay: task.dayDate, zone: null, source: task });
    },
    onKeyboardPick: (task) => {
      setKeyboardDrag(true);
      setDrag({ taskId: task.id, estimate: task.estimateMinutes, fromDay: task.dayDate, zone: 'backlog', source: task });
      setKeyboardZone(task.dayDate === null ? 'backlog' : `day:${task.dayDate}`);
      setKeyboardSlot(task.session?.startTime ?? '09:00');
      announce(copy.pickedUp(task.title));
    },
    onToggleDone,
    onEstimate,
    onDropOnCardZone: () => undefined,
  };

  // Pointer drag following
  useEffect(() => {
    if (drag === null || keyboardDrag) return;
    const onMove = (e: PointerEvent): void => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const zone = el?.closest<HTMLElement>('[data-drop]');
      setDrag((prev) => (prev === null ? prev : { ...prev, zone: zone?.dataset.drop ?? null }));
    };
    const onUp = (e: PointerEvent): void => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const zone = el?.closest<HTMLElement>('[data-drop]');
      const target = zone?.dataset.drop ?? null;
      const current = drag;
      setDrag(null);
      if (current === null) return;
      if (target === null) return;
      if (target === 'backlog') {
        void dropOnBacklog(current.source);
        return;
      }
      if (target.startsWith('day:')) {
        void dropOnDay(current.source, target.slice(4));
        return;
      }
      if (target.startsWith('slot:')) {
        void timeboxTask(current.source, stripDate, target.slice(5));
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, keyboardDrag, dropOnBacklog, dropOnDay, timeboxTask, stripDate]);

  // Keyboard navigation across zones
  useEffect(() => {
    if (drag === null || !keyboardDrag) return;
    const onKey = (e: KeyboardEvent): void => {
      const zones = ['backlog', ...days.map((d) => `day:${d.date}`), 'calendar'];
      const zoneIndex = zones.indexOf(keyboardZone);
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const next = zones[Math.min(zones.length - 1, zoneIndex + 1)] ?? 'calendar';
        setKeyboardZone(next);
        if (next.startsWith('day:')) {
          const date = next.slice(4);
          const projected = projectedFor(date);
          if (projected > threshold) {
            announce(copy.overDayExtra(dayLabel(date, board?.timeZone ?? 'UTC'), projected, threshold, projected - threshold));
          } else {
            announce(copy.overDay(dayLabel(date, board?.timeZone ?? 'UTC'), projected, threshold));
          }
        } else if (next === 'backlog') {
          announce(copy.overBacklog());
        } else {
          announce(copy.overSlot(keyboardSlot));
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const next = zones[Math.max(0, zoneIndex - 1)] ?? 'backlog';
        setKeyboardZone(next);
        if (next.startsWith('day:')) {
          const date = next.slice(4);
          const projected = projectedFor(date);
          if (projected > threshold) {
            announce(copy.overDayExtra(dayLabel(date, board?.timeZone ?? 'UTC'), projected, threshold, projected - threshold));
          } else {
            announce(copy.overDay(dayLabel(date, board?.timeZone ?? 'UTC'), projected, threshold));
          }
        } else if (next === 'backlog') {
          announce(copy.overBacklog());
        } else {
          announce(copy.overSlot(keyboardSlot));
        }
      } else if (e.key === 'ArrowDown' && keyboardZone === 'calendar') {
        e.preventDefault();
        const idx = SLOTS.indexOf(keyboardSlot);
        const next = SLOTS[Math.min(SLOTS.length - 1, idx + 1)] ?? keyboardSlot;
        setKeyboardSlot(next);
        announce(copy.overSlot(next));
      } else if (e.key === 'ArrowUp' && keyboardZone === 'calendar') {
        e.preventDefault();
        const idx = SLOTS.indexOf(keyboardSlot);
        const next = SLOTS[Math.max(0, idx - 1)] ?? keyboardSlot;
        setKeyboardSlot(next);
        announce(copy.overSlot(next));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const current = drag;
        setDrag(null);
        setKeyboardDrag(false);
        if (current === null) return;
        if (keyboardZone === 'backlog') void dropOnBacklog(current.source);
        else if (keyboardZone === 'calendar') void timeboxTask(current.source, stripDate, keyboardSlot);
        else if (keyboardZone.startsWith('day:')) void dropOnDay(current.source, keyboardZone.slice(4));
      } else if (e.key === 'Escape') {
        e.preventDefault();
        const current = drag;
        setDrag(null);
        setKeyboardDrag(false);
        if (current !== null) {
          const column = current.source.dayDate === null ? 'Backlog' : dayLabelOf(current.source.dayDate, board?.timeZone ?? 'UTC');
          announce(copy.cancelled(current.source.title, column));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drag, keyboardDrag, keyboardZone, keyboardSlot, days, threshold, board, announce, dropOnBacklog, dropOnDay, timeboxTask, stripDate, projectedFor]);

  if (me === null || board === null) {
    return <main className="notebook daybook-spread"><p>Loading…</p></main>;
  }

  const stripIndex = days.findIndex((d) => d.date === stripDate);

  return (
    <main>
      <SubscriptionBanner />
      <div className="notebook daybook-spread">
        <RitualRail step={step} setStep={setStep} onShutdown={openShutdown} addBoxRef={addBoxRef} days={days} threshold={threshold} announce={announce} board={board} />
        <section aria-label="Days" className="day-columns" data-drop="days">
          {days.map((day) => (
            <DayColumn
              key={day.date}
              day={day}
              threshold={threshold}
              timeZone={board.timeZone}
              today={today}
              step={step}
              callbacks={callbacks}
              drag={drag}
              projected={projectedFor(day.date)}
              animate={animate}
              heldHere={drag !== null && drag.zone === `day:${day.date}`}
              rolledBackIds={rolledBackIds}
            />
          ))}
        </section>
        <CalendarStrip
          date={stripDate}
          timeZone={board.timeZone}
          items={calendarItems}
          days={days}
          onPrev={() => setStripDay(days[Math.max(0, stripIndex - 1)]?.date ?? stripDate)}
          onNext={() => setStripDay(days[Math.min(days.length - 1, stripIndex + 1)]?.date ?? stripDate)}
          showHint={step === 'Timebox'}
          drag={drag}
          keyboardSlot={keyboardZone === 'calendar' ? keyboardSlot : null}
          onRemoveSession={removeSession}
          onSessionDragStart={startSessionDrag}
          onSessionDrop={moveSession}
          animate={animate}
        />
      </div>
      <Backlog
        board={board}
        step={step}
        showEstimates={step === 'Estimate'}
        callbacks={callbacks}
        drag={drag}
        addBoxRef={addBoxRef}
        announce={announce}
        reload={loadBoard}
        today={today}
      />
      {shutdownOpen && shutdownPreview !== null ? (
        <ShutdownDialog
          preview={shutdownPreview}
          timeZone={board.timeZone}
          pending={shutdownPending}
          onClose={() => setShutdownOpen(false)}
          returnRef={shutdownButtonRef}
          onSend={sendShutdown}
        />
      ) : null}
    </main>
  );

  async function openShutdown(): Promise<void> {
    try {
      const preview = await api.get<ShutdownPreview>('/api/shutdown/preview');
      setShutdownPreview(preview);
      setShutdownOpen(true);
    } catch (e) {
      announce(GENERIC_ERROR);
    }
  }

  async function sendShutdown(): Promise<void> {
    if (shutdownPreview === null) return;
    setShutdownPending(true);
    try {
      const res = await api.post<ShutdownPreview>('/api/shutdown', {});
      setShutdownPreview(res);
      setShutdownOpen(false);
      if (res.digest === 'sent') announce(`Day shut down. Digest sent to ${me?.member.email ?? ''}.`);
      else if (res.digest === 'already_sent') announce('Day shut down. Today\u2019s digest was already sent.');
      else announce('Day shut down. Mail is unreachable, so your digest is queued and will send when it\u2019s back.');
      await loadBoard();
    } catch (e) {
      announce(isFailure(e) ? e.message : GENERIC_ERROR);
    } finally {
      setShutdownPending(false);
    }
  }

  async function removeSession(item: CalendarItem): Promise<void> {
    if (item.version === undefined) return;
    try {
      await api.delete(`/api/sessions/${item.id}?version=${item.version}`);
      announce(copy.removedSession(item.title));
      await loadBoard();
      const from = board?.days[0]?.date ?? today;
      void loadCalendar(from, addDays(from, 4));
    } catch (e) {
      announce(copy.couldNotRemoveSession(item.title, reasonFor(e)));
    }
  }

  function startSessionDrag(item: CalendarItem): void {
    if (item.version === undefined) return;
    setSessionDrag({ id: item.id, version: item.version, title: item.title, fromDay: item.date, fromTime: item.startTime });
  }

  async function moveSession(item: CalendarItem, date: string, time: string): Promise<void> {
    if (item.version === undefined) return;
    try {
      await api.patch(`/api/sessions/${item.id}`, { version: item.version, date, startTime: time });
      announce(copy.movedSession(item.title, time));
      await loadBoard();
      const from = board?.days[0]?.date ?? today;
      void loadCalendar(from, addDays(from, 4));
    } catch (e) {
      announce(copy.couldNotMoveSession(item.title, reasonFor(e)));
    }
  }
}

const movedCopy = (day: ApiDay, threshold: number, title: string): string =>
  `Moved ${title} to ${day.label}. ${day.label} is at ${day.plannedMinutes}m of ${threshold}m.`;

function RitualRail({
  step,
  setStep,
  onShutdown,
  addBoxRef,
  days,
  threshold,
  announce,
  board,
}: {
  step: Step;
  setStep: (s: Step) => void;
  onShutdown: () => void;
  addBoxRef: React.RefObject<HTMLInputElement | null>;
  days: ApiDay[];
  threshold: number;
  announce: (s: string) => void;
  board: BoardResponse | null;
}): JSX.Element {
  const onStep = (s: Step): void => {
    setStep(s);
    if (s === 'Pull') addBoxRef.current?.focus();
    if (s === 'Check') {
      const over = days.filter((d) => d.plannedMinutes > threshold).length;
      announce(copy.checkCount(over));
    }
    if (s === 'Shut down') void onShutdown();
  };
  void board;
  return (
    <nav className="ritual-rail" aria-label="Morning ritual">
      {DAILY_RITUAL_STEPS.map((s, i) => (
        <button
          key={s}
          type="button"
          className="step"
          aria-current={step === s ? 'step' : undefined}
          onClick={() => onStep(s)}
        >
          <span className="num">{i + 1}</span> {s}
        </button>
      ))}
    </nav>
  );
}

function DayColumn({
  day,
  threshold,
  timeZone,
  today,
  step,
  callbacks,
  drag,
  projected,
  animate,
  heldHere,
  rolledBackIds,
}: {
  day: ApiDay;
  threshold: number;
  timeZone: string;
  today: string;
  step: Step;
  callbacks: CardCallbacks;
  drag: { taskId: string; estimate: number | null; fromDay: string | null; zone: string | null; source: ApiTask } | null;
  projected: number;
  animate: boolean;
  heldHere: boolean;
  rolledBackIds: Set<string>;
}): JSX.Element {
  const [showCards, setShowCards] = useState(false);
  const ghost = heldHere && drag !== null && drag.fromDay !== day.date ? drag.estimate : null;
  const shownTotal = useCounter(heldHere && drag !== null && drag.fromDay === day.date ? day.plannedMinutes : projected, animate);

  return (
    <section
      className={`day-column${heldHere ? ' drop-target' : ''}${showCards ? ' show-cards' : ''}`}
      aria-label={day.label}
      data-drop={`day:${day.date}`}
    >
      <header className="full-heading">
        <h2>{day.label}</h2>
        <span className="total">
          <span className="mono">{shownTotal}m</span>
        </span>
      </header>
      <header className="short-heading">
        <h2>{shortDay(day.date)}</h2>
        <span className="total">
          <span className="mono">{shownTotal}m</span>
        </span>
      </header>
      <LoadMeter day={{ ...day, plannedMinutes: shownTotal }} threshold={threshold} />
      <Waterline day={{ ...day, plannedMinutes: shownTotal }} threshold={threshold} ghost={ghost} ghosted={heldHere} animate={animate} />
      <button type="button" className="show-day" onClick={() => setShowCards((v) => !v)} aria-expanded={showCards}>
        Show {day.label}
      </button>
      <ul className="card-list cards-for-day">
        {day.tasks.map((task) => (
          <CardSlip
            key={task.id}
            task={task}
            showEstimates={step === 'Estimate'}
            callbacks={callbacks}
            fromDayLabel={null}
            held={drag !== null && drag.taskId === task.id}
            rolledBack={rolledBackIds.has(task.id)}
          />
        ))}
      </ul>
    </section>
  );
}
