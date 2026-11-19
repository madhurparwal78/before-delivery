import { useRef, useState } from "preact/hooks";
import { api, get } from "../api";
import { useResource } from "../hooks";
import { announce, openModal, toast } from "../store";
import type { Task, Workload, WorkloadCell } from "../types";
import { Dialog, Pill, Status, useBusy } from "../ui";
import { useRoute } from "../router";
import { EmptyState, LoadingBlock } from "./NotFound";
import { SAVE_FAILED } from "../project-data";
import { useMount } from "../hooks";

interface Open { personId: string; date: string }

function ReassignDialog({ taskId, taskName, people, onDone, close }: {
  taskId: string; taskName: string; people: Array<{ id: string; name: string }>; onDone: () => void; close: () => void;
}) {
  const [assignee, setAssignee] = useState("");
  const [busy, run] = useBusy();
  const reassign = (event: Event) => {
    event.preventDefault();
    void run(async () => {
      const done = await reassignTask(taskId, assignee, taskName, people);
      if (done) {
        close();
        onDone();
      }
    });
  };
  return (
    <Dialog label="Reassign task" onClose={close} class="dialog-small">
      <form onSubmit={reassign} noValidate>
        <h2>Reassign task</h2>
        <p class="muted">{taskName}</p>
        <div class="field">
          <label for="reassign-assignee">Assignee</label>
          <select id="reassign-assignee" data-autofocus value={assignee} onChange={(e) => setAssignee((e.target as HTMLSelectElement).value)}>
            <option value="">Choose a person</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div class="dialog-actions">
          <Pill type="submit" busy={busy} onClick={reassign}>Reassign</Pill>
          <Pill kind="outline" onClick={close}>Cancel</Pill>
        </div>
      </form>
    </Dialog>
  );
}

async function reassignTask(taskId: string, personId: string, taskName: string, people: Array<{ id: string; name: string }>): Promise<boolean> {
  if (!personId) return false;
  const current = await get<Task>(`/api/tasks/${taskId}`);
  if (!current.ok) {
    toast(SAVE_FAILED);
    return false;
  }
  const result = await api("PATCH", `/api/tasks/${taskId}`, { version: current.data.version, assigneeId: personId });
  if (!result.ok) {
    toast(SAVE_FAILED);
    return false;
  }
  announce("Workload status", `${taskName} reassigned to ${people.find((p) => p.id === personId)?.name}`);
  return true;
}

export function WorkloadPage({ teamId }: { teamId: string }) {
  const route = useRoute();
  const from = route.query.get("from");
  const workload = useResource<Workload | "missing">(async () => {
    const result = await get<Workload>(`/api/teams/${teamId}/workload${from ? `?from=${from}` : ""}`);
    return result.status === 404 ? "missing" : result.ok ? result.data : undefined;
  }, [teamId, from], (e) => e.team === teamId && ["tasks", "workload", "structure"].includes(e.t));
  const [open, setOpen] = useState<Open | null>(null);
  const [current, setCurrent] = useState<Open | null>(null);
  const [drag, setDrag] = useState<{ taskId: string; name: string; x: number; y: number } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const press = useRef<{ taskId: string; name: string; x: number; y: number } | null>(null);
  const suppress = useRef(false);
  const opener = useRef<HTMLElement | null>(null);

  useMount(() => {
    if (open) grid.current?.parentElement?.querySelector<HTMLElement>(".cell-popover .chip-task, .cell-popover .popover-close")?.focus();
  }, [open?.personId, open?.date]);

  if (workload.data === "missing") return <div class="page narrow"><EmptyState level={1} title="Team not found" /></div>;
  if (!workload.data) return <div class="page"><h1>Workload</h1><LoadingBlock reload={workload.reload} /></div>;
  const w = workload.data;
  const people = w.people.map((p) => ({ id: p.id, name: p.name }));
  const cellAt = (o: Open): WorkloadCell | undefined => w.people.find((p) => p.id === o.personId)?.cells.find((c) => c.date === o.date);
  const personName = (id: string) => w.people.find((p) => p.id === id)?.name ?? "";
  const first = current ?? { personId: w.people[0]?.id ?? "", date: w.days[0] };

  const focusCell = (personId: string, date: string) =>
    grid.current?.querySelector<HTMLElement>(`[data-person="${personId}"][data-date="${date}"]`)?.focus();

  const keydown = (event: KeyboardEvent) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-person]");
    if (!cell || event.target !== cell) return;
    const personAt = w.people.findIndex((p) => p.id === cell.dataset.person);
    const dayAt = w.days.indexOf(cell.dataset.date!);
    const target = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }[event.key];
    if (target) {
      event.preventDefault();
      const p = Math.max(0, Math.min(w.people.length - 1, personAt + target[0]));
      const d = Math.max(0, Math.min(w.days.length - 1, dayAt + target[1]));
      focusCell(w.people[p].id, w.days[d]);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      opener.current = cell;
      setOpen({ personId: cell.dataset.person!, date: cell.dataset.date! });
    }
  };

  const closePopover = () => {
    const cell = open;
    setOpen(null);
    if (cell) queueMicrotask(() => focusCell(cell.personId, cell.date));
  };

  const chipKey = (event: KeyboardEvent, task: { id: string; name: string }) => {
    if (event.key === "r" || event.key === "R") {
      event.preventDefault();
      openModal((close) => (
        <ReassignDialog taskId={task.id} taskName={task.name} people={people} close={close} onDone={() => workload.reload()} />
      ));
    }
  };

  const chipHandlers = (task: { id: string; name: string }) => ({
    onPointerDown: (e: PointerEvent) => {
      suppress.current = false;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      press.current = { taskId: task.id, name: task.name, x: e.clientX, y: e.clientY };
    },
    onPointerMove: (e: PointerEvent) => {
      const start = press.current;
      if (!start) return;
      if (!drag && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 8) return;
      if (!drag) (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      setDrag({ taskId: task.id, name: task.name, x: e.clientX, y: e.clientY });
    },
    onPointerUp: (e: PointerEvent) => {
      const dragging = drag;
      press.current = null;
      if (!dragging) return;
      suppress.current = true;
      setDrag(null);
      const row = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-person]");
      if (row?.dataset.person && row.dataset.person !== open?.personId) {
        void reassignTask(task.id, row.dataset.person, task.name, people).then((done) => done && workload.reload());
      }
    },
    onPointerCancel: () => { press.current = null; setDrag(null); },
    onClick: () => { suppress.current = false; },
    onKeyDown: (e: KeyboardEvent) => chipKey(e, task),
  });

  const cell = open ? cellAt(open) : undefined;
  return (
    <div class="page workload-page">
      <h1>{`${w.teamName} workload`}</h1>
      <Status name="Workload status" />
      <div class="grid-scroll" tabIndex={0} role="region" aria-label="Workload scroll area">
        <div role="grid" aria-label="Workload" ref={grid} class="workload-grid" style={{ "--days": w.days.length }} onKeyDown={keydown}>
          <div role="row" class="w-row w-head">
            <div role="columnheader" class="w-name">Person</div>
            {w.days.map((day) => <div role="columnheader" key={day} class="w-day num">{day.slice(5)}</div>)}
          </div>
          {w.people.map((person) => (
            <div role="row" key={person.id} class="w-row">
              <div role="rowheader" class="w-name">{person.name}</div>
              {person.cells.map((c) => {
                const isCurrent = (first.personId === person.id && first.date === c.date);
                return (
                  <div role="gridcell" key={c.date} class={`w-cell${c.over ? " is-over" : ""}${drag ? " is-target" : ""}`} data-person={person.id} data-date={c.date}
                    data-total={c.total.toFixed(2)} data-over={String(c.over)} tabIndex={isCurrent ? 0 : -1}
                    onFocus={() => setCurrent({ personId: person.id, date: c.date })}>
                    <span class="num">{c.text}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {open && cell && (
        <Dialog modal={false} label={`Tasks for ${personName(open.personId)} on ${open.date}`} onClose={closePopover} class="cell-popover"
          returnTo={() => grid.current?.querySelector<HTMLElement>(`[data-person="${open.personId}"][data-date="${open.date}"]`) ?? null}>
          <h2>{`${personName(open.personId)}, ${open.date}`}</h2>
          <p class="muted num">{cell.text}</p>
          <div class="chip-list">
            {cell.tasks.map((task) => (
              <button type="button" key={task.id} class="chip chip-task" data-task-chip={task.id} {...chipHandlers(task)}>{task.name}</button>
            ))}
            {cell.tasks.length === 0 && <p class="muted">No tasks on this day.</p>}
          </div>
          <p class="muted">Press R on a task to reassign it, or drag it onto another person.</p>
          <Pill kind="outline" class="popover-close" onClick={closePopover}>Close</Pill>
        </Dialog>
      )}
      {drag && <div class="chip chip-task drag-ghost" aria-hidden="true" style={{ left: `${drag.x}px`, top: `${drag.y}px` }}>{drag.name}</div>}
    </div>
  );
}
