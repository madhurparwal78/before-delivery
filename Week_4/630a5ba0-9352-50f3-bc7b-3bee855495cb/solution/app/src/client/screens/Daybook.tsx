import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { FileUp, CalendarPlus, ChevronDown } from "lucide-react";
import type { Board, CalendarItem, Day, Session, ShutdownPreview, Task } from "../../shared/types.js";
import { addDays, dayBounds, isoInstant, localToInstant, minutesOf, shiftTime, shortDay, todayIn } from "../../shared/time.js";
import { api, ApiFailure, isServerFault, newKey, reason, SERVER_ERROR } from "../api.js";
import { announce } from "../announce.js";
import { applyWrite, columnName, findTask, moveLocal, upsertTask } from "../board.js";
import { AddTask, createFailure } from "../components/AddTask.js";
import { Card, slideFrom } from "../components/Card.js";
import { CalendarStrip, FIRST_SLOT, SLOT_HEIGHT, SLOTS } from "../components/CalendarStrip.js";
import { ImportDialog } from "../components/ImportDialog.js";
import { RitualRail, ShutdownDialog, type Step } from "../components/Panels.js";
import { Waterline } from "../components/Waterline.js";

type Place = { kind: "backlog" } | { kind: "day"; date: string } | { kind: "calendar"; time: string };
type Hold = { taskId: string; via: "pointer" | "keyboard"; over: Place | null };
type Float = { title: string; meta: string; x: number; y: number; dx: number; dy: number; width: number };
type Write = { task: Task; days: Day[] };

const samePlace = (a: Place | null, b: Place | null) => JSON.stringify(a) === JSON.stringify(b);

export function Daybook({ zone, email }: { zone: string; email: string }) {
  const [board, setBoardState] = useState<Board | null>(null);
  const boardRef = useRef<Board | null>(null);
  const [failed, setFailed] = useState(false);
  const [calendar, setCalendar] = useState<CalendarItem[]>([]);
  const [step, setStep] = useState<Step>("Pull");
  const [stripDate, setStripDate] = useState<string | null>(null);
  const [hold, setHoldState] = useState<Hold | null>(null);
  const holdRef = useRef<Hold | null>(null);
  const [float, setFloat] = useState<Float | null>(null);
  const [focusTask, setFocusTask] = useState<string | null>(null);
  const [dropped, setDropped] = useState<string | null>(null);
  const [shownDay, setShownDay] = useState<string | null>(null);
  const [backlogOpen, setBacklogOpen] = useState(true);
  const [importing, setImporting] = useState<"tasks" | "calendar" | null>(null);
  const [shutdown, setShutdown] = useState<{ open: boolean; preview: ShutdownPreview | null; pending: boolean }>({ open: false, preview: null, pending: false });
  const addBox = useRef<HTMLInputElement>(null);
  const writes = useRef(0);
  const generation = useRef(0);
  const chains = useRef(new Map<string, Promise<void>>());
  const startRef = useRef<string>(todayIn(zone, Date.now()));

  const setBoard = useCallback((change: (b: Board) => Board) => {
    if (!boardRef.current) return;
    boardRef.current = change(boardRef.current);
    setBoardState(boardRef.current);
  }, []);

  const setHold = (next: Hold | null) => {
    holdRef.current = next;
    setHoldState(next);
  };

  // Reads: the first column is today in the profile zone, from the device clock.
  const load = useCallback(async () => {
    const started = generation.current;
    const start = todayIn(zone, Date.now());
    try {
      const [fresh, items] = await Promise.all([
        api<Board>("GET", `/api/board?start=${start}`),
        api<{ items: CalendarItem[] }>("GET", `/api/calendar?from=${start}&to=${addDays(start, 4)}`),
      ]);
      if (writes.current > 0 || generation.current !== started || holdRef.current) return;
      startRef.current = start;
      boardRef.current = fresh;
      setBoardState(fresh);
      setCalendar(items.items);
      setFailed(false);
      setStripDate((current) => (current && fresh.days.some((d) => d.date === current) ? current : fresh.days[0].date));
    } catch {
      if (!boardRef.current) setFailed(true);
    }
  }, [zone]);

  useEffect(() => {
    void load();
    const refresh = setInterval(() => void load(), 60_000);
    const rollover = setInterval(() => {
      if (todayIn(zone, Date.now()) !== startRef.current) void load();
    }, 15_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(refresh);
      clearInterval(rollover);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, zone]);

  /** Runs writes for one task in order, so each carries the version the previous one confirmed. */
  const queue = (taskId: string, run: () => Promise<void>) => {
    writes.current++;
    generation.current++;
    const previous = chains.current.get(taskId) ?? Promise.resolve();
    const next = previous.then(run).finally(() => {
      writes.current--;
      generation.current++;
      if (chains.current.get(taskId) === next) chains.current.delete(taskId);
    });
    chains.current.set(taskId, next);
  };

  const latest = (task: Task): Task => (boardRef.current && findTask(boardRef.current, task.id)) || task;

  const rememberSlot = (taskId: string) => {
    const element = document.querySelector<HTMLElement>(`[data-task="${taskId}"]:not([hidden])`);
    if (element && element.offsetParent) slideFrom.set(taskId, element.getBoundingClientRect());
  };

  const restore = (original: Task, optimistic: Task, current: Task | Session | null) => {
    rememberSlot(original.id);
    setBoard((b) => {
      let next = upsertTask(moveLocal(b, optimistic, original.dayDate, original.session), original);
      if (current && "position" in current) next = upsertTask(next, current);
      if (current && !("position" in current)) next = upsertTask(next, { ...latest(original), session: current, dayDate: current.date });
      return next;
    });
  };

  // Card moves between columns (null = Backlog): optimistic, then confirmed or rolled back.
  const moveCard = (task: Task, dayDate: string | null) => {
    if (task.dayDate === dayDate || !boardRef.current) return;
    if (dayDate === null && task.dayDate !== null && task.dayDate < boardRef.current.today) return;
    const optimistic: Task = { ...task, dayDate, session: null };
    setBoard((b) => moveLocal(b, task, dayDate));
    setDropped(dayDate);
    queue(task.id, async () => {
      try {
        const result = await api<Write>("PATCH", `/api/tasks/${task.id}`, { body: { version: latest(task).version, dayDate } });
        setBoard((b) => applyWrite(b, result.task, result.days));
        const day = result.days.find((d) => d.date === dayDate);
        const threshold = boardRef.current?.thresholdMinutes ?? 0;
        announce(
          day ? `Moved ${task.title} to ${day.label}. ${day.label} is at ${day.plannedMinutes}m of ${threshold}m.` : `Moved ${task.title} to Backlog.`,
        );
      } catch (error) {
        restore(task, optimistic, error instanceof ApiFailure ? error.current : null);
        announce(`Couldn't move ${task.title}: ${reason(error)}. It's back in ${columnName(boardRef.current as Board, task.dayDate)}.`);
        void load();
      }
    });
  };

  const sessionAt = (task: Task, date: string, time: string, id: string, version: number): Session => {
    const start = localToInstant(date, time, zone);
    const length = task.estimateMinutes ?? 30;
    return {
      id,
      taskId: task.id,
      title: task.title,
      date,
      startTime: time,
      endTime: shiftTime(time, length),
      start: isoInstant(start),
      end: isoInstant(start + length * 60_000),
      version,
    };
  };

  const moveSession = (task: Task, date: string, time: string) => {
    const session = task.session;
    if (!session) return;
    const moved = sessionAt(task, date, time, session.id, session.version);
    const optimistic: Task = { ...task, dayDate: date, session: moved };
    setBoard((b) => (task.dayDate === date ? upsertTask(b, optimistic) : moveLocal(b, task, date, moved)));
    queue(task.id, async () => {
      try {
        const current = latest(task).session ?? session;
        const result = await api<Write>("PATCH", `/api/sessions/${session.id}`, { body: { version: current.version, date, startTime: time } });
        setBoard((b) => applyWrite(b, result.task, result.days));
        announce(`Moved ${task.title} to ${time}.`);
      } catch (error) {
        restore(task, optimistic, error instanceof ApiFailure ? error.current : null);
        announce(`Couldn't move ${task.title}: ${reason(error)}. Showing the latest time.`);
        void load();
      }
    });
  };

  const timebox = (task: Task, date: string, time: string) => {
    if (task.session) {
      moveSession(task, date, time);
      return;
    }
    const pendingSession = task.estimateMinutes === null ? null : sessionAt(task, date, time, `pending-${task.id}`, 0);
    const optimistic: Task = { ...task, dayDate: date, session: pendingSession };
    setBoard((b) => (task.dayDate === date ? upsertTask(b, optimistic) : moveLocal(b, task, date, pendingSession)));
    setDropped(date);
    const key = newKey();
    queue(task.id, async () => {
      try {
        const result = await api<Write>("POST", "/api/sessions", { body: { taskId: task.id, date, startTime: time }, headers: { "Idempotency-Key": key } });
        setBoard((b) => applyWrite(b, result.task, result.days));
        announce(`Timeboxed ${task.title} at ${time}.`);
      } catch (error) {
        restore(task, optimistic, null);
        announce(`Couldn't timebox ${task.title}: ${reason(error)}.`);
        void load();
      }
    });
  };

  const removeSession = (task: Task) => {
    const session = task.session;
    if (!session) return;
    setBoard((b) => upsertTask(b, { ...task, session: null }));
    queue(task.id, async () => {
      try {
        await api("DELETE", `/api/sessions/${session.id}?version=${(latest(task).session ?? session).version}`);
        announce(`Removed ${task.title} from the calendar.`);
        void load();
      } catch (error) {
        setBoard((b) => upsertTask(b, task));
        announce(`Couldn't remove ${task.title}: ${reason(error)}.`);
        void load();
      }
    });
  };

  const setEstimate = (task: Task, minutes: number) => {
    queue(task.id, async () => {
      try {
        const result = await api<Write>("PATCH", `/api/tasks/${task.id}`, { body: { version: latest(task).version, estimateMinutes: minutes } });
        setBoard((b) => applyWrite(b, result.task, result.days));
        announce(`${task.title}: ${minutes} minutes.`);
      } catch (error) {
        if (error instanceof ApiFailure && error.current && "position" in error.current) {
          const current = error.current;
          setBoard((b) => upsertTask(b, current));
        }
        announce(`Couldn't move ${task.title}: ${reason(error)}. It's back in ${columnName(boardRef.current as Board, task.dayDate)}.`);
      }
    });
  };

  const setDone = (task: Task, done: boolean) => {
    const optimistic: Task = { ...task, status: done ? "done" : "open" };
    setBoard((b) => upsertTask(b, optimistic));
    queue(task.id, async () => {
      try {
        const result = await api<Write>("PATCH", `/api/tasks/${task.id}`, { body: { version: latest(task).version, status: optimistic.status } });
        setBoard((b) => applyWrite(b, result.task, result.days));
        announce(done ? `Marked ${task.title} done.` : `Reopened ${task.title}.`);
      } catch (error) {
        setBoard((b) => upsertTask(b, error instanceof ApiFailure && error.current && "position" in error.current ? error.current : task));
        announce(`Couldn't move ${task.title}: ${reason(error)}. It's back in ${columnName(boardRef.current as Board, task.dayDate)}.`);
      }
    });
  };

  const createTask = async (title: string): Promise<string | null> => {
    writes.current++;
    generation.current++;
    try {
      const result = await api<Write>("POST", "/api/tasks", { body: { title } });
      setBoard((b) => applyWrite(b, result.task, result.days));
      announce(`Added ${title} to the Backlog.`);
      return null;
    } catch (error) {
      return createFailure(error);
    } finally {
      writes.current--;
      generation.current++;
    }
  };

  // Holding a card: pointer, touch or keyboard all share the same targets and ghost.
  const placeOf = (task: Task): Place =>
    task.dayDate && boardRef.current?.days.some((d) => d.date === task.dayDate) ? { kind: "day", date: task.dayDate } : { kind: "backlog" };

  const drop = (task: Task, place: Place | null, via: "pointer" | "keyboard") => {
    setHold(null);
    setFloat(null);
    if (via === "keyboard") setFocusTask(task.id);
    if (!place) return;
    if (place.kind === "backlog") moveCard(task, null);
    else if (place.kind === "day") moveCard(task, place.date);
    else if (stripDate) timebox(task, stripDate, place.time);
  };

  const describe = (task: Task, place: Place): string => {
    const b = boardRef.current as Board;
    if (place.kind === "backlog") return "Over Backlog.";
    if (place.kind === "calendar") return `Calendar slot ${place.time}.`;
    const day = b.days.find((d) => d.date === place.date) as Day;
    const projected = day.plannedMinutes + (task.dayDate === place.date ? 0 : (task.estimateMinutes ?? 0));
    const over = projected - b.thresholdMinutes;
    return `Over ${day.label}: ${projected}m of ${b.thresholdMinutes}m.${over > 0 ? ` Over by ${over}m.` : ""}`;
  };

  const sequence = (): Place[] => [
    { kind: "backlog" },
    ...(boardRef.current?.days ?? []).map((d): Place => ({ kind: "day", date: d.date })),
    { kind: "calendar", time: "09:00" },
  ];

  const onMoveKey = (task: Task, event: KeyboardEvent<HTMLButtonElement>) => {
    const current = holdRef.current;
    if (!current || current.taskId !== task.id) {
      if (event.key === " ") {
        event.preventDefault();
        setDropped(null);
        setHold({ taskId: task.id, via: "keyboard", over: placeOf(task) });
        announce(`Picked up ${task.title}. Use arrow keys to choose a place, Enter to drop, Escape to cancel.`);
      }
      return;
    }
    const over = current.over ?? placeOf(task);
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const places = sequence();
      const index = places.findIndex((p) => p.kind === over.kind && (p.kind !== "day" || (over.kind === "day" && p.date === over.date)));
      const next = places[Math.min(Math.max(index + (event.key === "ArrowLeft" ? -1 : 1), 0), places.length - 1)];
      const target: Place =
        next.kind === "calendar"
          ? { kind: "calendar", time: over.kind === "calendar" ? over.time : task.session && task.session.date === stripDate ? task.session.startTime : "09:00" }
          : next;
      if (!samePlace(target, over)) {
        setHold({ ...current, over: target });
        announce(describe(task, target));
      }
    } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && over.kind === "calendar") {
      event.preventDefault();
      const minutes = Math.min(Math.max(minutesOf(over.time) + (event.key === "ArrowUp" ? -30 : 30), FIRST_SLOT), minutesOf(SLOTS[SLOTS.length - 1]));
      const target: Place = { kind: "calendar", time: shiftTime("00:00", minutes) };
      setHold({ ...current, over: target });
      announce(describe(task, target));
    } else if (event.key === "Enter") {
      event.preventDefault();
      drop(task, samePlace(over, placeOf(task)) ? null : over, "keyboard");
    } else if (event.key === "Escape") {
      event.preventDefault();
      setHold(null);
      announce(`Cancelled. ${task.title} stays in ${columnName(boardRef.current as Board, placeOf(task).kind === "day" ? task.dayDate : null)}.`);
    } else if (event.key === " " || event.key.startsWith("Arrow")) event.preventDefault();
  };

  const onBlurMove = (task: Task) => {
    if (holdRef.current?.via === "keyboard" && holdRef.current.taskId === task.id) setHold(null);
  };

  const placeAt = (x: number, y: number): Place | null => {
    const target = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]");
    const value = target?.dataset.drop;
    if (!value) return null;
    if (value === "backlog") return { kind: "backlog" };
    if (value.startsWith("day:")) return { kind: "day", date: value.slice(4) };
    const slots = document.querySelector<HTMLElement>("[data-slots]")?.getBoundingClientRect();
    if (!slots || y < slots.top || y > slots.bottom || x < slots.left || x > slots.right) return null;
    const index = Math.min(Math.max(Math.floor((y - slots.top) / SLOT_HEIGHT), 0), SLOTS.length - 1);
    return { kind: "calendar", time: SLOTS[index] };
  };

  const onPointerDown = (task: Task, event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const slip = event.currentTarget.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY };
    const touch = event.pointerType === "touch";
    let lifted = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const lift = (x: number, y: number) => {
      lifted = true;
      setDropped(null);
      document.body.classList.add("is-dragging");
      setHold({ taskId: task.id, via: "pointer", over: null });
      setFloat({ title: task.title, meta: task.estimateMinutes === null ? "No estimate" : `${task.estimateMinutes}m`, x, y, dx: start.x - slip.left, dy: start.y - slip.top, width: slip.width });
    };
    const blockScroll = (e: TouchEvent) => {
      if (lifted) e.preventDefault();
    };
    const finish = () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("touchmove", blockScroll);
      document.body.classList.remove("is-dragging");
    };
    const move = (e: globalThis.PointerEvent) => {
      const distance = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (!lifted) {
        if (touch) {
          if (distance > 8) finish();
          return;
        }
        if (distance < 4) return;
        lift(e.clientX, e.clientY);
      }
      setFloat((f) => (f ? { ...f, x: e.clientX, y: e.clientY } : f));
      const over = placeAt(e.clientX, e.clientY);
      const held = holdRef.current;
      if (held && !samePlace(held.over, over)) setHold({ ...held, over });
    };
    const up = (e: globalThis.PointerEvent) => {
      finish();
      if (!lifted) return;
      const over = placeAt(e.clientX, e.clientY) ?? holdRef.current?.over ?? null;
      drop(latest(task), over, "pointer");
    };
    const cancel = () => {
      finish();
      setHold(null);
      setFloat(null);
    };
    if (touch) timer = setTimeout(() => lift(start.x, start.y), 330);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("touchmove", blockScroll, { passive: false });
  };

  const onStep = async (next: Step) => {
    setStep(next);
    const b = boardRef.current;
    if (next === "Pull") {
      setBacklogOpen(true);
      addBox.current?.focus();
    } else if (next === "Check" && b) {
      announce(`${b.days.filter((d) => d.overByMinutes > 0).length} of 5 days are over your threshold.`);
    } else if (next === "Shut down") {
      setShutdown({ open: true, preview: null, pending: false });
      try {
        const preview = await api<ShutdownPreview>("GET", "/api/shutdown/preview");
        setShutdown((s) => (s.open ? { ...s, preview } : s));
      } catch {
        announce(SERVER_ERROR);
      }
    }
  };

  const sendShutdown = async () => {
    setShutdown((s) => ({ ...s, pending: true }));
    try {
      const result = await api<ShutdownPreview & { digest: "sent" | "queued" | "already_sent" }>("POST", "/api/shutdown", { body: {} });
      announce(
        result.digest === "sent"
          ? `Day shut down. Digest sent to ${email}.`
          : result.digest === "queued"
            ? "Day shut down. Mail is unreachable, so your digest is queued and will send when it's back."
            : "Day shut down. Today's digest was already sent.",
      );
      setShutdown({ open: false, preview: null, pending: false });
      void load();
    } catch (error) {
      setShutdown((s) => ({ ...s, pending: false }));
      announce(isServerFault(error) ? SERVER_ERROR : `Couldn't shut down the day: ${reason(error)}.`);
    }
  };

  const chooseSuggestion = (taskId: string) => {
    setBacklogOpen(true);
    const task = boardRef.current && findTask(boardRef.current, taskId);
    if (task?.dayDate && boardRef.current?.days.some((d) => d.date === task.dayDate)) setShownDay(task.dayDate);
    setFocusTask(taskId);
  };

  const clearFocus = useCallback(() => setFocusTask(null), []);

  if (!board) {
    return (
      // Keyed apart from the loaded board: React must not reuse these skeleton nodes, or the loaded
      // gutter pushes them aside and the page records a layout shift.
      <div key="loading" className="daybook is-loading" aria-busy="true">
        {failed ? <p className="load-error">The Daybook couldn't load. It will try again shortly.</p> : null}
        <div className="columns" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="column column-skeleton">
              <div className="skeleton-line" />
              <div className="gauge gauge-skeleton" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const heldTask = hold ? findTask(board, hold.taskId) : undefined;
  const date = stripDate ?? board.days[0].date;
  const dates = board.days.map((d) => d.date);
  const bounds = dayBounds(date, board.timeZone);
  const stripItems = calendar.filter(
    (item) => item.kind !== "session" && Date.parse(item.start) < bounds.end && Date.parse(item.end) > bounds.start,
  );
  const planned = board.days.flatMap((d) => d.tasks).flatMap((task) => (task.session ? [{ task, session: task.session }] : []));
  const cardProps = (task: Task) => ({
    task,
    today: board.today,
    estimating: step === "Estimate",
    held: hold?.taskId === task.id,
    focus: focusTask === task.id,
    onFocused: clearFocus,
    onPointerDown,
    onMoveKey,
    onBlurMove,
    onDone: setDone,
    onEstimate: setEstimate,
  });
  const ghostFor = (day: Day) =>
    hold && heldTask && hold.over?.kind === "day" && hold.over.date === day.date && heldTask.dayDate !== day.date ? (heldTask.estimateMinutes ?? 0) : null;
  const shown = board.days.find((d) => d.date === shownDay);

  return (
    <div key="board" className="daybook">
      <div className="gutter">
        <RitualRail current={step} onStep={(s) => void onStep(s)} />
        <section className={`backlog${hold?.over?.kind === "backlog" ? " is-target" : ""}`} aria-label="Backlog" data-drop="backlog">
          <div className="backlog-head">
            <h2 className="section-title">Backlog</h2>
            <span className="mono backlog-count">{board.backlog.length}</span>
          </div>
          <AddTask ref={addBox} onCreate={createTask} onChoose={chooseSuggestion} />
          <div className="backlog-actions">
            <button type="button" className="button button-quiet" onClick={() => setImporting("tasks")}>
              <FileUp aria-hidden="true" size={18} /> Import tasks
            </button>
            <button type="button" className="button button-quiet" onClick={() => setImporting("calendar")}>
              <CalendarPlus aria-hidden="true" size={18} /> Import calendar
            </button>
          </div>
          <button type="button" className="backlog-toggle" aria-expanded={backlogOpen} onClick={() => setBacklogOpen((o) => !o)}>
            <ChevronDown aria-hidden="true" size={18} /> {backlogOpen ? "Hide Backlog cards" : `Show Backlog cards (${board.backlog.length})`}
          </button>
          <div className={`backlog-cards${backlogOpen ? "" : " is-collapsed"}`}>
            {board.backlog.length ? (
              <ul className="cards">{board.backlog.map((task) => <Card key={task.id} {...cardProps(task)} />)}</ul>
            ) : (
              <p className="empty">Nothing in the Backlog. Add a task above or import a CSV export.</p>
            )}
          </div>
        </section>
      </div>

      <div className="columns">
        {board.days.map((day) => {
          const ghost = ghostFor(day);
          const target = hold?.over?.kind === "day" && hold.over.date === day.date;
          return (
            <section key={day.date} className={`column${target ? " is-target" : ""}`} aria-label={day.label} data-drop={`day:${day.date}`}>
              <header className="column-head">
                <h2 className="day-heading" aria-label={day.label}>
                  <span className="day-long">
                    <span className="day-weekday">{day.label.split(" ")[0]}</span> <span className="day-date">{day.label.split(" ").slice(1).join(" ")}</span>
                  </span>
                  <span className="day-short">{shortDay(day.date)}</span>
                </h2>
                <span className="total-row">
                  <span className="total mono" style={{ "--num": day.plannedMinutes } as CSSProperties}>
                    <span className="sr-only">{day.plannedMinutes}m</span>
                  </span>
                  <span className="total-of" aria-hidden="true">
                    of {board.thresholdMinutes}
                  </span>
                </span>
              </header>
              <Waterline label={day.label} planned={day.plannedMinutes} threshold={board.thresholdMinutes} ghost={ghost} dropped={dropped === day.date} />
              <button
                type="button"
                className="show-day"
                aria-label={`Show ${day.label}`}
                aria-pressed={shownDay === day.date}
                onClick={() => setShownDay(day.date)}
              >
                Show
              </button>
              <div className="column-cards">
                {day.tasks.length ? (
                  <ul className="cards">{day.tasks.map((task) => <Card key={task.id} {...cardProps(task)} />)}</ul>
                ) : (
                  <p className="empty">No tasks yet</p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {shown && (
        <section className="day-detail" aria-label={`Cards for ${shown.label}`}>
          <h2 className="section-title">{shown.label}</h2>
          {shown.tasks.length ? (
            <ul className="cards">{shown.tasks.map((task) => <Card key={task.id} {...cardProps(task)} />)}</ul>
          ) : (
            <p className="empty">Nothing planned</p>
          )}
        </section>
      )}

      <CalendarStrip
        date={date}
        zone={board.timeZone}
        dates={dates}
        sessions={planned}
        items={stripItems}
        cardSlot={hold?.over?.kind === "calendar" ? hold.over.time : null}
        hint={step === "Timebox"}
        onShowDate={setStripDate}
        onMoveSession={moveSession}
        onRemoveSession={removeSession}
      />

      {float && (
        <div className="slip slip-float" aria-hidden="true" style={{ left: float.x - float.dx, top: float.y - float.dy, width: float.width }}>
          <span className="slip-title">{float.title}</span>
          <span className="slip-meta mono">{float.meta}</span>
        </div>
      )}

      <ImportDialog kind="tasks" open={importing === "tasks"} onClose={() => setImporting(null)} onImported={() => void load()} />
      <ImportDialog kind="calendar" open={importing === "calendar"} onClose={() => setImporting(null)} onImported={() => void load()} />
      <ShutdownDialog
        open={shutdown.open}
        preview={shutdown.preview}
        pending={shutdown.pending}
        onSend={() => void sendShutdown()}
        onClose={() => setShutdown({ open: false, preview: null, pending: false })}
      />
    </div>
  );
}
