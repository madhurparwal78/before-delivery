// The Tasks screen: toolbar, the keyboard grid (list or board), the cue-line cascade and the
// task details.

import { memo, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { CREW, CYCLES, DEPARTMENTS, PRIORITY_NAMES, STATUS_NAMES, crewByHandle, departmentByKey, type Freed, type StatusKey, type Task } from "../../../shared/catalog";
import { copy } from "../copy";
import { DURATION, LEAVE, SETTLE, play, reducedMotion } from "../motion";
import { bulkSet, emit, navigate, openDialog, openPalette, shown, state, undoLast, useApp, type Cue } from "../store";
import { formatView, type Grouping, type View } from "../url";
import { useWidth, type Width } from "../width";
import { BlockSlot, Icon, PromptBookMark, StatusChip, Tape } from "./bits";
import { DetailBody } from "./Details";
import { Modal, type ModalHandle } from "./Modal";

interface Group {
  key: string;
  name: string;
  rows: Task[];
}

const RANK = [5, 1, 2, 3, 4];
const byPriority = (a: Task, b: Task): number => RANK[a.priority] - RANK[b.priority] || a.number - b.number;
const BOARD: StatusKey[] = ["backlog", "todo", "in_progress", "done"];
const LIST_STATUSES: StatusKey[] = ["backlog", "todo", "in_progress", "done", "cancelled"];

const groupsFor = (tasks: Task[], view: View): Group[] => {
  const make = (defs: Array<{ key: string; name: string; match: (t: Task) => boolean }>, keepEmpty: boolean): Group[] =>
    defs
      .map((d) => ({ key: d.key, name: d.name, rows: tasks.filter(d.match).sort(byPriority) }))
      .filter((g) => keepEmpty || g.rows.length > 0);
  if (view.view === "board") return make(BOARD.map((s) => ({ key: s, name: STATUS_NAMES[s], match: (t) => t.status === s })), true);
  const defs: Record<Grouping, Array<{ key: string; name: string; match: (t: Task) => boolean }>> = {
    status: LIST_STATUSES.map((s) => ({ key: s, name: STATUS_NAMES[s], match: (t: Task) => t.status === s })),
    cycle: [
      ...CYCLES.map((c) => ({ key: c.key, name: c.name, match: (t: Task) => t.cycle === c.key })),
      { key: "none", name: "No cycle", match: (t: Task) => t.cycle === null },
    ],
    department: DEPARTMENTS.map((d) => ({ key: d.key, name: d.name, match: (t: Task) => t.department === d.key })),
    owner: [
      ...CREW.map((m) => ({ key: m.handle, name: m.name, match: (t: Task) => t.owner === m.handle })),
      { key: "none", name: "No owner", match: (t: Task) => t.owner === null },
    ],
  };
  return make(defs[view.group], false);
};

const neighbour = (before: string[], gone: string, now: string[]): string | null => {
  const at = before.indexOf(gone);
  if (at < 0) return null;
  const after = before.slice(at + 1).find((id) => now.includes(id));
  return after ?? [...before.slice(0, at)].reverse().find((id) => now.includes(id)) ?? null;
};

// Rows marked with x plus the Shift+arrow range, in grid order.
const selectedIds = (order: string[]): string[] => {
  const ids = new Set(state.marked);
  if (state.anchor && state.rangeEnd) {
    const a = order.indexOf(state.anchor);
    const b = order.indexOf(state.rangeEnd);
    if (a >= 0 && b >= 0) for (const id of order.slice(Math.min(a, b), Math.max(a, b) + 1)) ids.add(id);
  }
  return order.filter((id) => ids.has(id));
};

export const commandTargets = (): string[] => {
  const picked = selectedIds(state.order);
  return picked.length ? picked : state.current ? [state.current] : [];
};

const commitRange = (): void => {
  for (const id of selectedIds(state.order)) state.marked.add(id);
  state.anchor = null;
  state.rangeEnd = null;
};

const isTyping = (el: HTMLElement): boolean =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !["checkbox", "radio", "button", "file"].includes(el.type));

interface RowProps {
  task: Task;
  current: boolean;
  selected: boolean;
  busy: boolean;
  freed: Freed | undefined;
  onPick: (id: string, e: MouseEvent<HTMLDivElement>) => void;
}

const Row = memo(function Row({ task, current, selected, busy, freed, onPick }: RowProps) {
  return (
    <div
      role="row"
      className={`row${current ? " is-current" : ""}${selected ? " is-selected" : ""}`}
      aria-label={`${task.id} ${task.title}`}
      aria-current={current ? "true" : undefined}
      aria-selected={selected ? "true" : "false"}
      aria-busy={busy ? "true" : undefined}
      data-task-id={task.id}
      data-freed-order={freed && !task.blocked ? freed.order : undefined}
      data-freed-depth={freed && !task.blocked ? freed.depth : undefined}
      tabIndex={current ? 0 : -1}
      onClick={(e) => onPick(task.id, e)}
    >
      <span role="gridcell" className="cell-id num">
        {task.id}
      </span>
      <span role="gridcell" className="cell-dept">
        <Tape dept={task.department} />
      </span>
      <span role="gridcell" className="cell-title">
        {task.title}
      </span>
      <span role="gridcell" className="cell-state">
        <StatusChip status={task.status} />
        <BlockSlot blocked={task.blocked} freedBy={freed ? freed.freed_by : null} />
      </span>
      <span role="gridcell" className="cell-priority">
        <span className={`priority priority-${task.priority}`}>{PRIORITY_NAMES[task.priority]}</span>
      </span>
      <span role="gridcell" className="cell-owner">
        {crewByHandle(task.owner)?.name ?? ""}
      </span>
    </div>
  );
});

// The cue-line: a 2 px stage-green line drawn along the margin rule from the changed row to each
// freed row (or back again on undo), then faded.
const drawCue = (grid: HTMLElement, layer: HTMLElement, cue: Cue): void => {
  const top = grid.getBoundingClientRect().top;
  const middle = (id: string): number | null => {
    const el = grid.querySelector<HTMLElement>(`[role="row"][data-task-id="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.top - top + r.height / 2;
  };
  const ends = cue.targets.map((t) => middle(t.id)).filter((y): y is number => y !== null);
  if (!ends.length) return;
  const start = (cue.from ? middle(cue.from) : null) ?? 0;
  const low = Math.min(start, ...ends);
  const high = Math.max(start, ...ends);
  const far = ends.reduce((a, b) => (Math.abs(b - start) > Math.abs(a - start) ? b : a));
  const line = document.createElement("div");
  line.className = "cue-line";
  line.style.top = `${low}px`;
  line.style.height = `${Math.max(2, high - low)}px`;
  line.style.transformOrigin = `50% ${(cue.reverse ? far : start) - low}px`;
  layer.appendChild(line);
  const draw = Math.max(DURATION.chip, cue.span);
  line.animate([{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], { duration: draw, easing: "linear", fill: "forwards" });
  const fade = line.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DURATION.lineFade, delay: draw + 100, easing: "ease-in", fill: "forwards" });
  void fade.finished.then(
    () => line.remove(),
    () => line.remove(),
  );
};

interface GridProps {
  groups: Group[];
  board: boolean;
  current: string | null;
  selected: Set<string>;
  onKeys: (e: KeyboardEvent<HTMLElement>) => void;
  onPick: (id: string, e: MouseEvent<HTMLDivElement>) => void;
}

const Grid = ({ groups, board, current, selected, onKeys, onPick }: GridProps) => {
  const app = useApp();
  const grid = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const drawn = useRef(app.cue?.serial ?? 0);
  useLayoutEffect(() => {
    const cue = app.cue;
    if (!cue || cue.serial === drawn.current || !grid.current || !layer.current) return;
    drawn.current = cue.serial;
    if (!reducedMotion()) drawCue(grid.current, layer.current, cue);
  });
  return (
    <div ref={grid} role="grid" aria-label="Tasks" aria-multiselectable="true" className={board ? "grid board" : "grid list"} onKeyDown={onKeys}>
      {groups.map((g) => (
        <div role="rowgroup" key={g.key} aria-label={`${g.name} ${g.rows.length}`} className="group">
          <div className="group-head" aria-hidden="true">
            <span className="group-name">{g.name}</span>
            <span className="num group-count">{g.rows.length}</span>
          </div>
          {g.rows.map((t) => (
            <Row
              key={t.id}
              task={t}
              current={t.id === current}
              selected={selected.has(t.id)}
              busy={app.busy.has(t.id)}
              freed={app.freed.get(t.id)}
              onPick={onPick}
            />
          ))}
        </div>
      ))}
      <div ref={layer} className="cue-layer" aria-hidden="true" />
    </div>
  );
};

const Toolbar = ({ view, picked, onKeys }: { view: View; picked: number; onKeys: (e: KeyboardEvent<HTMLElement>) => void }) => {
  const app = useApp();
  return (
    <div className="toolbar" role="toolbar" aria-label="Task tools" onKeyDown={onKeys}>
      <div className="segmented">
        <button type="button" className="button" aria-pressed={view.view === "list"} onClick={() => navigate("/tasks", { view: "list" })}>
          <Icon.list />
          List view
        </button>
        <button type="button" className="button" aria-pressed={view.view === "board"} onClick={() => navigate("/tasks", { view: "board" })}>
          <Icon.board />
          Board view
        </button>
      </div>
      {view.view === "list" ? (
        <label className="field-inline">
          <span>Group by</span>
          <select value={view.group} onChange={(e) => navigate("/tasks", { group: e.target.value as Grouping })}>
            <option value="status">Status</option>
            <option value="cycle">Cycle</option>
            <option value="department">Department</option>
            <option value="owner">Owner</option>
          </select>
        </label>
      ) : null}
      <label className="check">
        <input type="checkbox" checked={view.blocked} onChange={(e) => navigate("/tasks", { blocked: e.target.checked })} />
        <span>Blocked only</span>
      </label>
      <label className="field-inline">
        <span>Cycle</span>
        <select value={view.cycle ?? ""} onChange={(e) => navigate("/tasks", { cycle: e.target.value || null })}>
          <option value="">All cycles</option>
          {CYCLES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <div className="toolbar-actions">
        <button type="button" className="button primary" onClick={(e) => openDialog({ kind: "new-task", parent: null, opener: e.currentTarget })}>
          <Icon.plus />
          New task
        </button>
        <button type="button" className="button" onClick={() => void undoLast()}>
          <Icon.undo />
          Undo
        </button>
        <button type="button" className="button" onClick={(e) => openPalette("", e.currentTarget)}>
          <Icon.command />
          Commands
        </button>
      </div>
      <p className="toolbar-status" aria-live="off">
        {picked ? <span className="num selected-count">{`${picked} selected`}</span> : null}
        {app.saving ? <span className="saving">Saving</span> : null}
      </p>
    </div>
  );
};

// The docked or overlay pane (768 pixels and wider), which slides in and out.
const Pane = ({ id, onClose }: { id: string | null; onClose: () => void }) => {
  const [shownId, setShownId] = useState(id);
  const ref = useRef<HTMLElement>(null);
  const entered = useRef<string | null>(null);
  const leaving = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (id) {
      leaving.current?.cancel();
      leaving.current = null;
      if (el) {
        delete el.dataset.gone;
        delete el.dataset.leaving;
      }
      setShownId(id);
      return;
    }
    if (!el) return;
    for (const running of el.getAnimations()) running.finish();
    const exit = play(el, [{ transform: "none", opacity: 1 }, { transform: "translateX(40px)", opacity: 0 }], {
      duration: DURATION.paneOut,
      easing: LEAVE,
      fill: "forwards",
    });
    leaving.current = exit;
    el.dataset.leaving = "true";
    const done = (): void => {
      if (state.view.task || leaving.current !== exit) return;
      el.dataset.gone = "true";
      setTimeout(() => {
        if (!state.view.task) setShownId(null);
      }, 0);
    };
    if (exit) void exit.finished.then(done, done);
    else setShownId(null);
  }, [id]);
  useLayoutEffect(() => {
    if (!shownId || entered.current) {
      entered.current = shownId;
      return;
    }
    entered.current = shownId;
    play(ref.current, [{ transform: "translateX(40px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: DURATION.paneIn, easing: SETTLE });
  }, [shownId]);
  if (!shownId) return null;
  return (
    <aside ref={ref} className="pane" aria-label="Task details">
      <DetailBody id={shownId} onClose={onClose} focusOnOpen />
    </aside>
  );
};

// The full-screen sheet below 768 pixels.
const Sheet = ({ id, onClose }: { id: string | null; onClose: () => void }) => {
  const [shown, setShown] = useState<{ id: string; generation: number } | null>(id ? { id, generation: 0 } : null);
  const modal = useRef<ModalHandle>(null);
  const generation = useRef(0);
  useLayoutEffect(() => {
    if (!id) {
      modal.current?.close();
      return;
    }
    if (shown?.id === id) return;
    generation.current += 1;
    setShown({ id, generation: generation.current });
  }, [id, shown?.id]);
  if (!shown) return null;
  return (
    <Modal
      key={shown.generation}
      ref={modal}
      label="Task details"
      variant="sheet"
      opener={document.querySelector(`[role="row"][data-task-id="${shown.id}"]`)}
      onClosed={() => {
        setShown((now) => (now?.generation === shown.generation ? null : now));
        if (state.view.task === shown.id) onClose();
      }}
    >
      <DetailBody id={shown.id} onClose={() => modal.current?.close()} focusOnOpen={false} />
    </Modal>
  );
};

export const TasksScreen = () => {
  const app = useApp();
  const width: Width = useWidth();
  const view = app.view;
  const tasks = [...app.tasks.keys()]
    .map((id) => shown(id) as Task)
    .filter(
      (t) =>
        t.status !== "triage" &&
        t.status !== "duplicate" &&
        (!view.dept || t.department === view.dept) &&
        (!view.cycle || t.cycle === view.cycle) &&
        (!view.blocked || t.blocked),
    );
  const groups = groupsFor(tasks, view);
  const order = groups.flatMap((g) => g.rows.map((r) => r.id));
  const current = view.row && order.includes(view.row) ? view.row : (order[0] ?? null);
  const selected = new Set(selectedIds(order));
  const previous = useRef<string[]>([]);
  const focusNext = useRef<string | null>(null);
  const revealNext = useRef<string | null>(view.row);

  useLayoutEffect(() => {
    state.order = order;
    state.current = current;
    if (!app.loaded) return;
    const fixes: Partial<View> = {};
    if (view.row && !order.includes(view.row)) fixes.row = neighbour(previous.current, view.row, order);
    if (view.task && !order.includes(view.task)) fixes.task = null;
    previous.current = order;
    if (Object.keys(fixes).length) {
      if (fixes.row && document.activeElement?.closest('[role="row"]')) focusNext.current = fixes.row;
      navigate("/tasks", fixes, true);
      return;
    }
    if (location.search !== formatView(view)) history.replaceState(null, "", `/tasks${formatView(view)}`);
    const reveal = revealNext.current;
    revealNext.current = null;
    if (reveal) document.querySelector(`[role="row"][data-task-id="${reveal}"]`)?.scrollIntoView({ block: "nearest" });
    const focusId = focusNext.current;
    focusNext.current = null;
    if (focusId) document.querySelector<HTMLElement>(`[role="row"][data-task-id="${focusId}"]`)?.focus();
  });

  const openDetails = (id: string): void => navigate("/tasks", { row: id, task: id });
  const closeDetails = (): void => {
    focusNext.current = view.task;
    navigate("/tasks", { task: null });
  };

  const onPick = (id: string, e: MouseEvent<HTMLDivElement>): void => {
    if (e.ctrlKey || e.metaKey) {
      commitRange();
      if (state.marked.has(id)) state.marked.delete(id);
      else state.marked.add(id);
      navigate("/tasks", { row: id }, true);
      return;
    }
    openDetails(id);
  };

  const onKeys = (e: KeyboardEvent<HTMLElement>): void => {
    const target = e.target as HTMLElement;
    if (isTyping(target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const fromGrid = Boolean(target.closest('[role="grid"]'));
    const onSelect = target.tagName === "SELECT";
    const at = current ? order.indexOf(current) : -1;
    const moveTo = (index: number, extend: boolean): void => {
      if (!order.length) return;
      const next = order[Math.max(0, Math.min(order.length - 1, index))];
      if (extend) {
        state.anchor = state.anchor ?? current;
        state.rangeEnd = next;
      } else {
        commitRange();
      }
      if (fromGrid) focusNext.current = next;
      revealNext.current = next;
      navigate("/tasks", { row: next }, true);
    };
    const key = e.key;
    if ((key === "ArrowDown" || key === "ArrowUp" || key === "ArrowLeft" || key === "ArrowRight") && onSelect) return;
    if (key === "j" || key === "ArrowDown") moveTo(at + 1, e.shiftKey && key === "ArrowDown");
    else if (key === "k" || key === "ArrowUp") moveTo(at - 1, e.shiftKey && key === "ArrowUp");
    else if (key === "Home") moveTo(0, false);
    else if (key === "End") moveTo(order.length - 1, false);
    else if ((key === "ArrowLeft" || key === "ArrowRight") && view.view === "board" && width === "wide" && current) {
      const column = groups.findIndex((g) => g.rows.some((r) => r.id === current));
      const position = groups[column].rows.findIndex((r) => r.id === current);
      const step = key === "ArrowLeft" ? -1 : 1;
      let next = column + step;
      while (next >= 0 && next < groups.length && !groups[next].rows.length) next += step;
      if (next < 0 || next >= groups.length) return;
      const rows = groups[next].rows;
      moveTo(order.indexOf(rows[Math.min(position, rows.length - 1)].id), false);
    } else if (key === "x" && current) {
      commitRange();
      if (state.marked.has(current)) state.marked.delete(current);
      else state.marked.add(current);
      emit();
    } else if (/^[0-4]$/.test(key)) {
      const targets = commandTargets();
      if (targets.length) void bulkSet(targets, { priority: Number(key) });
    } else if (key === "Enter" && fromGrid && current) openDetails(current);
    else if (key === "Escape") {
      if (view.task) closeDetails();
      else {
        state.marked.clear();
        state.anchor = null;
        state.rangeEnd = null;
        emit();
      }
    } else if (key === "a" || key === "s" || key === "p") {
      openPalette({ a: "Assign to ", s: "Move to ", p: "Set priority: " }[key], document.activeElement);
    } else if (key === "c") openDialog({ kind: "new-task", parent: null, opener: document.activeElement });
    else return;
    e.preventDefault();
  };

  const empty = view.view === "list" && order.length === 0;
  return (
    <div className="tasks-layout">
      <section className="tasks-main" aria-labelledby="tasks-heading">
        <h2 id="tasks-heading" className="screen-title">
          {departmentByKey(view.dept)?.name ?? "All tasks"}
          {view.blocked ? <span className="screen-filter"> · blocked only</span> : null}
        </h2>
        <Toolbar view={view} picked={selected.size} onKeys={onKeys} />
        {empty ? (
          <div className="empty">
            <PromptBookMark />
            <h2 tabIndex={-1}>{copy.noTasks}</h2>
          </div>
        ) : (
          <Grid groups={groups} board={view.view === "board"} current={current} selected={selected} onKeys={onKeys} onPick={onPick} />
        )}
      </section>
      {width === "phone" ? <Sheet id={view.task} onClose={() => navigate("/tasks", { task: null })} /> : <Pane id={view.task} onClose={closeDetails} />}
    </div>
  );
};
