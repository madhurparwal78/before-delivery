import { useState } from 'react';
import type { Difficulty, Task, TaskType, Weekday } from '../../shared/types.js';
import { gold2 } from '../../shared/format.js';
import { ApiFailure, api } from '../api.js';
import { GENERIC_ERROR, refreshTasks, showAlert } from '../store.js';
import { Dialog } from './Dialog.js';

const WEEKDAYS: Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DIFFICULTIES: Difficulty[] = ['trivial', 'easy', 'medium', 'hard'];
const TYPE_LABELS: { value: TaskType; label: string }[] = [
  { value: 'habit', label: 'Habit' },
  { value: 'daily', label: 'Daily' },
  { value: 'todo', label: 'To-do' },
  { value: 'reward', label: 'Reward' },
];

export const STALE_MESSAGE = 'This task changed on another device. Close and reopen it to edit.';

interface TaskDialogProps {
  task: Task | null;
  startType: TaskType;
  opener: HTMLElement | null;
  focusHandled: { current: boolean };
  onClose: () => void;
  onCreated: (task: Task) => void;
  onDeleted: () => void;
}

export function TaskDialog({
  task,
  startType,
  opener,
  focusHandled,
  onClose,
  onCreated,
  onDeleted,
}: TaskDialogProps): JSX.Element {
  const editing = task !== null;
  const [type, setType] = useState<TaskType>(task ? task.type : startType);
  const [title, setTitle] = useState(task ? task.title : '');
  const [difficulty, setDifficulty] = useState<Difficulty>(task?.difficulty ?? 'easy');
  const [weekdays, setWeekdays] = useState<Weekday[]>(task?.weekdays ?? [...WEEKDAYS]);
  const [checklist, setChecklist] = useState((task?.checklist ?? []).map((item) => item.text).join('\n'));
  const [price, setPrice] = useState(task?.price !== null && task?.price !== undefined ? gold2(task.price) : '');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [stale, setStale] = useState(false);
  const [saving, setSaving] = useState(false);

  const body = (): Record<string, unknown> => {
    const payload: Record<string, unknown> = { title };
    if (type !== 'reward') payload.difficulty = difficulty;
    if (type === 'daily') payload.weekdays = weekdays;
    if (type === 'todo') {
      const lines = checklist
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
      payload.checklist = editing ? rebuildChecklist(task, lines) : lines;
    }
    if (type === 'reward') payload.price = price;
    return payload;
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setFieldErrors({});
    setStale(false);
    try {
      if (editing && task) {
        await api.editTask(task.id, { ...body(), updatedAt: task.updatedAt });
        await refreshTasks();
        onClose();
      } else {
        const created = await api.createTask({ ...body(), type });
        await refreshTasks();
        onCreated(created);
      }
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 409 && error.name_ === 'stale_task') setStale(true);
      else if (error instanceof ApiFailure && error.status === 422) setFieldErrors(error.fieldErrors);
      else showAlert(GENERIC_ERROR);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!task) return;
    setSaving(true);
    try {
      await api.deleteTask(task.id);
      await refreshTasks();
      onDeleted();
    } catch {
      showAlert(GENERIC_ERROR);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      name={editing ? 'Edit task' : 'New task'}
      onClose={onClose}
      returnFocusTo={() => (focusHandled.current ? null : opener)}
    >
      <h2 className="dialog-title">{editing ? 'Edit task' : 'New task'}</h2>
      {stale ? (
        <p className="field-error" role="alert">
          {STALE_MESSAGE}
        </p>
      ) : null}
      <div className="field">
        <label htmlFor="task-type">Type</label>
        <select
          id="task-type"
          value={type}
          disabled={editing}
          onChange={(event) => setType(event.currentTarget.value as TaskType)}
        >
          {TYPE_LABELS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="task-title">Title</label>
        <input id="task-title" type="text" value={title} onChange={(event) => setTitle(event.currentTarget.value)} />
        {fieldErrors.title ? (
          <p className="field-error" role="alert">
            {fieldErrors.title}
          </p>
        ) : null}
      </div>
      {type !== 'reward' ? (
        <div className="field">
          <label htmlFor="task-difficulty">Difficulty</label>
          <select
            id="task-difficulty"
            value={difficulty}
            onChange={(event) => setDifficulty(event.currentTarget.value as Difficulty)}
          >
            {DIFFICULTIES.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
          {fieldErrors.difficulty ? (
            <p className="field-error" role="alert">
              {fieldErrors.difficulty}
            </p>
          ) : null}
        </div>
      ) : null}
      {type === 'daily' ? (
        <div className="field" role="group" aria-label="Weekdays">
          <span className="group-label">Weekdays</span>
          <div className="weekday-row">
            {WEEKDAYS.map((day) => (
              <label key={day} className="weekday">
                <input
                  type="checkbox"
                  aria-label={day}
                  checked={weekdays.includes(day)}
                  onChange={(event) =>
                    setWeekdays((current) =>
                      event.currentTarget.checked
                        ? WEEKDAYS.filter((entry) => entry === day || current.includes(entry))
                        : current.filter((entry) => entry !== day),
                    )
                  }
                />
                <span>{day}</span>
              </label>
            ))}
          </div>
          {fieldErrors.weekdays ? (
            <p className="field-error" role="alert">
              {fieldErrors.weekdays}
            </p>
          ) : null}
        </div>
      ) : null}
      {type === 'todo' ? (
        <div className="field">
          <label htmlFor="task-checklist">Checklist</label>
          <textarea
            id="task-checklist"
            rows={4}
            value={checklist}
            onChange={(event) => setChecklist(event.currentTarget.value)}
          />
        </div>
      ) : null}
      {type === 'reward' ? (
        <div className="field">
          <label htmlFor="task-price">Price</label>
          <input id="task-price" type="text" value={price} onChange={(event) => setPrice(event.currentTarget.value)} />
          {fieldErrors.price ? (
            <p className="field-error" role="alert">
              {fieldErrors.price}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="dialog-actions">
        <button type="button" className="strong" disabled={saving} onClick={() => void save()}>
          Save task
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        {editing ? (
          <button type="button" className="danger" disabled={saving} onClick={() => void remove()}>
            Delete task
          </button>
        ) : null}
      </div>
    </Dialog>
  );
}

function rebuildChecklist(task: Task | null, lines: string[]): { id?: string; text: string }[] {
  const existing = task?.checklist ?? [];
  return lines.map((text) => {
    const match = existing.find((item) => item.text === text);
    return match ? { id: match.id, text } : { text };
  });
}
