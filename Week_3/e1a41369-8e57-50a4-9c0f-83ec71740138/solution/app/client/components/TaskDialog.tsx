import { Trash2 } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { DIFFICULTIES, LIST_KEY, WEEKDAYS, type Difficulty, type Task, type TaskType, type Weekday } from "../../shared/api";
import { ApiError, GENERIC_FAILURE, api, fieldErrors } from "../api";
import { useStore } from "../store";
import { Sheet, useSheetClose } from "./Sheet";

const STALE_COPY = "This task changed on another device. Close and reopen it to edit.";
const TYPE_LABEL: Record<TaskType, string> = { habit: "Habit", daily: "Daily", todo: "To-do", reward: "Reward" };

export type DialogTarget = { mode: "new"; type: TaskType; returnTo: string } | { mode: "edit"; task: Task };

/** Match each line of the checklist box to the item it came from, so ticked items keep their state. */
function checklistFrom(text: string, existing: Task["checklist"]): { id?: string; text: string }[] {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const unused = [...(existing ?? [])];
  const take = (found: number): string => unused.splice(found, 1)[0]!.id;
  return lines.map((line, index) => {
    const same = unused.findIndex((item) => item.text === line);
    if (same >= 0) return { id: take(same), text: line };
    const sameSlot = (existing ?? [])[index];
    const slot = sameSlot && !lines.includes(sameSlot.text) ? unused.findIndex((item) => item.id === sameSlot.id) : -1;
    return slot >= 0 ? { id: take(slot), text: line } : { text: line };
  });
}

function Form({ target, finish }: { target: DialogTarget; finish: (focus: string) => void }) {
  const close = useSheetClose();
  const editing = target.mode === "edit" ? target.task : null;
  const live = useStore((state) => (editing && state.tasks ? Object.values(state.tasks).flat().find((task) => task.id === editing.id) : undefined));
  const [type, setType] = useState<TaskType>(target.mode === "edit" ? target.task.type : target.type);
  const [title, setTitle] = useState(editing?.title ?? "");
  const [difficulty, setDifficulty] = useState<Difficulty>(editing?.difficulty ?? "easy");
  const [weekdays, setWeekdays] = useState<Weekday[]>(editing?.weekdays ?? [...WEEKDAYS]);
  const [checklist, setChecklist] = useState((editing?.checklist ?? []).map((item) => item.text).join("\n"));
  const [price, setPrice] = useState(editing?.price === null || editing?.price === undefined ? "" : String(editing.price));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [staleSeen, setStaleSeen] = useState(false);
  const [pending, setPending] = useState(false);
  const stale = staleSeen || (editing !== null && live?.updatedAt !== editing.updatedAt);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setErrors({});
    setFailure(null);
    const fields = {
      title,
      difficulty: type === "reward" ? undefined : difficulty,
      weekdays: type === "daily" ? weekdays : undefined,
      checklist: type === "todo" ? (editing ? checklistFrom(checklist, editing.checklist) : checklist.split("\n")) : undefined,
      price: type === "reward" ? (price.trim() !== "" && !Number.isNaN(Number(price)) ? Number(price) : price) : undefined,
    };
    try {
      const saved = editing
        ? await api<Task>("PATCH", `/api/tasks/${editing.id}`, { updatedAt: editing.updatedAt, ...fields })
        : await api<Task>("POST", "/api/tasks", { type, ...fields });
      finish(`[data-task-id="${saved.id}"]`);
      close();
    } catch (error) {
      const invalid = fieldErrors(error);
      if (error instanceof ApiError && error.status === 409) setStaleSeen(true);
      else if (invalid) setErrors(invalid);
      else setFailure(GENERIC_FAILURE);
    } finally {
      setPending(false);
    }
  };

  const remove = async (): Promise<void> => {
    setPending(true);
    const next = neighbourSelector(editing!);
    try {
      await api("DELETE", `/api/tasks/${editing!.id}`);
      finish(next);
      close();
    } catch {
      setFailure(GENERIC_FAILURE);
    } finally {
      setPending(false);
    }
  };

  const message = (field: string) => errors[field] && <p className="field-error" role="alert">{errors[field]}</p>;

  return (
    <form
      className="form"
      onSubmit={(event) => void submit(event)}
      onReset={close}
    >
      {stale && <p className="field-error stale" role="alert">{STALE_COPY}</p>}
      <label className="field-label" htmlFor="task-type">Type</label>
      <select id="task-type" value={type} disabled={editing !== null} onChange={(event) => setType(event.target.value as TaskType)}>
        {(Object.keys(TYPE_LABEL) as TaskType[]).map((option) => (
          <option key={option} value={option}>{TYPE_LABEL[option]}</option>
        ))}
      </select>
      {message("type")}
      <label className="field-label" htmlFor="task-title">Title</label>
      <input id="task-title" type="text" value={title} onChange={(event) => setTitle(event.target.value)} />
      {message("title")}
      {type !== "reward" && (
        <>
          <label className="field-label" htmlFor="task-difficulty">Difficulty</label>
          <select id="task-difficulty" value={difficulty} onChange={(event) => setDifficulty(event.target.value as Difficulty)}>
            {DIFFICULTIES.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          {message("difficulty")}
        </>
      )}
      {type === "daily" && (
        <fieldset className="weekdays">
          <legend className="field-label">Weekdays</legend>
          {WEEKDAYS.map((day) => (
            <label className="day" key={day}>
              <input type="checkbox" checked={weekdays.includes(day)} onChange={(event) => setWeekdays(event.target.checked ? WEEKDAYS.filter((d) => d === day || weekdays.includes(d)) : weekdays.filter((d) => d !== day))} />
              <span>{day}</span>
            </label>
          ))}
          {message("weekdays")}
        </fieldset>
      )}
      {type === "todo" && (
        <>
          <label className="field-label" htmlFor="task-checklist">Checklist</label>
          <textarea id="task-checklist" rows={4} value={checklist} onChange={(event) => setChecklist(event.target.value)} />
          <p className="hint">One item per line.</p>
        </>
      )}
      {type === "reward" && (
        <>
          <label className="field-label" htmlFor="task-price">Price</label>
          <input id="task-price" type="text" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
          {message("price")}
        </>
      )}
      {failure && <p className="field-error" role="alert">{failure}</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-solid" disabled={pending || stale}>Save task</button>
        <button type="reset" className="btn">Cancel</button>
        {editing && (
          <button type="button" className="btn btn-delete" disabled={pending} onClick={() => void remove()}><Trash2 aria-hidden="true" size={18} /> Delete task</button>
        )}
      </div>
    </form>
  );
}

/** After a delete: the row that takes its place, else the list itself. */
function neighbourSelector(task: Task): string {
  const list = LIST_KEY[task.type];
  const rows = [...document.querySelectorAll<HTMLElement>(`[data-list="${list}"] [data-task-id]`)];
  const at = rows.findIndex((row) => row.dataset.taskId === task.id);
  const next = rows[at + 1] ?? rows[at - 1];
  return next ? `[data-task-id="${next.dataset.taskId}"]` : `[data-list="${list}"]`;
}

export function TaskDialog({ target, onClose }: { target: DialogTarget; onClose: (focus: string) => void }) {
  const focus = useRef(target.mode === "edit" ? `[data-task-id="${target.task.id}"]` : target.returnTo);
  const heading = target.mode === "new" ? "New task" : "Edit task";
  return (
    <Sheet title={heading} onClose={() => onClose(focus.current)}>
      <Form
        target={target}
        finish={(selector) => {
          focus.current = selector;
        }}
      />
    </Sheet>
  );
}
