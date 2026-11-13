import { useEffect, useRef, useState } from 'react';
import { api, WEEKDAYS, type Task, type Notice } from './api.js';
import { useStore } from './store.js';

/** Sheets and dialogs: focus trap, Escape, and focus return (DP-02, DP-25). */
function useSheet(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const focusables = () =>
      Array.from(el.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(
        (x) => !x.hasAttribute('disabled')
      );
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const items = focusables();
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [onClose]);
  return ref;
}

type TaskKind = 'habit' | 'daily' | 'todo' | 'reward';

interface TaskDialogProps {
  mode: 'new';
  listType: 'habits' | 'dailies' | 'todos' | 'rewards';
  onClose: () => void;
  onCreated: (t: Task) => void;
}
interface TaskDialogEditProps {
  mode: 'edit';
  task: Task;
  onClose: () => void;
  onDeleted: (t: Task) => void;
}

export function TaskDialog(props: TaskDialogProps | TaskDialogEditProps) {
  const isEdit = props.mode === 'edit';
  const task = isEdit ? (props as TaskDialogEditProps).task : null;
  const listType = isEdit ? null : (props as TaskDialogProps).listType;
  const [type, setType] = useState<TaskKind>(task ? task.type : (listType!.slice(0, -1) as TaskKind));
  const [title, setTitle] = useState(task?.title ?? '');
  const [difficulty, setDifficulty] = useState(task?.difficulty ?? 'easy');
  const [weekdays, setWeekdays] = useState<string[]>(task?.weekdays ?? [...WEEKDAYS]);
  const [checklist, setChecklist] = useState((task?.checklist?.map((c) => c.text) ?? []).join('\n'));
  const [price, setPrice] = useState(task?.price != null ? String(task.price) : '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useSheet(props.onClose);

  const save = async () => {
    setBusy(true);
    setErrors({});
    setStale(false);
    try {
      const body: Record<string, unknown> = { title, difficulty };
      if (type === 'daily') body.weekdays = weekdays;
      if (type === 'todo') body.checklist = checklist.split('\n').map((s) => s.trim()).filter(Boolean);
      if (type === 'reward') body.price = Number(price);
      if (isEdit) {
        body.updatedAt = task!.updatedAt;
        await api.editTask(task!.id, body);
      } else {
        const created = await api.createTask({ type, ...body });
        (props as TaskDialogProps).onCreated(created);
        return;
      }
      props.onClose();
    } catch (err) {
      const failure = err as { status?: number; body?: { error?: string; errors?: Record<string, string> } };
      if (failure.status === 409 && failure.body?.error === 'stale_task') {
        setStale(true);
      } else if (failure.body?.errors) {
        setErrors(failure.body.errors);
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteTask(task!.id);
      (props as TaskDialogEditProps).onDeleted(task!);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop">
      <div className="sheet" ref={ref} role="dialog" aria-label={isEdit ? 'Edit task' : 'New task'}>
        <h2 className="sheet-title">{isEdit ? 'Edit task' : 'New task'}</h2>
        <label htmlFor="task-type">Type</label>
        <select
          id="task-type"
          className="textbox"
          aria-label="Type"
          value={type}
          disabled={isEdit}
          onChange={(e) => setType(e.target.value as TaskKind)}
        >
          <option value="habit">Habit</option>
          <option value="daily">Daily</option>
          <option value="todo">To-do</option>
          <option value="reward">Reward</option>
        </select>
        <label htmlFor="task-title">Title</label>
        <input
          id="task-title"
          className="textbox"
          aria-label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        {errors.title && <p className="field-error" role="alert">{errors.title}</p>}
        <label htmlFor="task-difficulty">Difficulty</label>
        <select
          id="task-difficulty"
          className="textbox"
          aria-label="Difficulty"
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}
        >
          <option value="trivial">trivial</option>
          <option value="easy">easy</option>
          <option value="medium">medium</option>
          <option value="hard">hard</option>
        </select>
        {errors.difficulty && <p className="field-error" role="alert">{errors.difficulty}</p>}
        {type === 'daily' && (
          <fieldset className="weekday-group">
            <legend>Weekdays</legend>
            {WEEKDAYS.map((d) => (
              <label key={d}>
                <input
                  type="checkbox"
                  aria-label={d}
                  checked={weekdays.includes(d)}
                  onChange={(e) => {
                    setWeekdays((prev) => (e.target.checked ? [...prev, d] : prev.filter((x) => x !== d)));
                  }}
                />
                <span>{d}</span>
              </label>
            ))}
          </fieldset>
        )}
        {errors.weekdays && <p className="field-error" role="alert">{errors.weekdays}</p>}
        {type === 'todo' && (
          <>
            <label htmlFor="task-checklist">Checklist</label>
            <textarea
              id="task-checklist"
              className="textbox"
              aria-label="Checklist"
              rows={4}
              value={checklist}
              onChange={(e) => setChecklist(e.target.value)}
              placeholder={'One item per line'}
            />
          </>
        )}
        {type === 'reward' && (
          <>
            <label htmlFor="task-price">Price</label>
            <input
              id="task-price"
              className="textbox"
              aria-label="Price"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
            {errors.price && <p className="field-error" role="alert">{errors.price}</p>}
          </>
        )}
        {stale && (
          <div className="alert-strip" role="alert">
            This task changed on another device. Close and reopen it to edit.
          </div>
        )}
        <div className="sheet-actions">
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void save()}>
            Save task
          </button>
          <button className="btn" type="button" onClick={props.onClose}>Cancel</button>
          {isEdit && (
            <button className="btn btn-danger" type="button" disabled={busy} onClick={() => void remove()}>
              Delete task
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function LevelDialog({ level, onClose }: { level: number; onClose: () => void }) {
  const ref = useSheet(onClose);
  return (
    <div className="dialog-backdrop dialog-centred">
      <div className="dialog panel-dialog" ref={ref} role="dialog" aria-label="Level up">
        <h2 className="sheet-title">Level up</h2>
        <img
          className="level-badge"
          src={badgeDataUri}
          alt={`Level ${level} badge`}
          width={128}
          height={128}
        />
        <p className="dialog-body">You reached level {level}. Your health is full again.</p>
        <div className="sheet-actions">
          <button className="btn btn-primary" type="button" onClick={onClose}>Keep going</button>
        </div>
      </div>
    </div>
  );
}

export function FaintDialog({ level, goldLost, onClose }: { level: number; goldLost: number; onClose: () => void }) {
  const ref = useSheet(onClose);
  return (
    <div className="dialog-backdrop dialog-centred">
      <div className="dialog panel-dialog" ref={ref} role="dialog" aria-label="You fainted">
        <h2 className="sheet-title">You fainted</h2>
        <p className="dialog-body">
          You dropped to level {level} and lost {goldLost.toFixed(2)} gold. Your health is back to 50.0.
        </p>
        <div className="sheet-actions">
          <button className="btn btn-primary" type="button" onClick={onClose}>Get back up</button>
        </div>
      </div>
    </div>
  );
}

const badgeDataUri =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#2a1a2e"/><text x="64" y="64" font-family="Hubot Sans, sans-serif" font-size="34" font-weight="800" fill="#f6dbe6" text-anchor="middle" dominant-baseline="middle">LV</text></svg>`
  );

/** The "Import tasks" dialog (DP-45). */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const ref = useSheet(onClose);
  const store = useStore();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ line: number; message: string }[] | null>(null);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setErrors(null);
    setSuccess('');
    setError('');
    try {
      const result = await api.importFile(file);
      setSuccess(`Imported ${result.taskCount} ${result.taskCount === 1 ? 'task' : 'tasks'}`);
      void store.refreshAll();
    } catch (err) {
      const failure = err as { status?: number; body?: { errors?: { line: number; message: string }[]; error?: string } };
      if (failure.body?.errors && Array.isArray(failure.body.errors)) {
        setErrors(failure.body.errors);
      } else if (failure.status === 413) {
        setError('The file is larger than 100,000 bytes.');
      } else if (failure.status === 415) {
        setError('Choose a .deedlist text file.');
      } else if (failure.status === 503) {
        setError('File storage is unavailable. Nothing was imported.');
      } else {
        setError('Something went wrong. Try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop">
      <div className="sheet" ref={ref} role="dialog" aria-label="Import tasks">
        <h2 className="sheet-title">Import tasks</h2>
        <label htmlFor="import-file">Task list file</label>
        <input
          id="import-file"
          type="file"
          accept=".deedlist"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <div className="sheet-actions">
          <button className="btn btn-primary" type="button" disabled={busy || !file} onClick={() => void run()}>
            {busy ? 'Importing...' : 'Import'}
          </button>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
        </div>
        {errors && errors.length > 0 && (
          <ul className="import-errors" aria-label="Import errors">
            {errors.map((e, i) => (
              <li key={i} className="import-error">{e.message}</li>
            ))}
          </ul>
        )}
        {success && <p className="status-ok" role="status">{success}</p>}
        {error && <div className="alert-strip" role="alert">{error}</div>}
      </div>
    </div>
  );
}

/** Level-up and faint dialogs driven by notices, oldest first (DP-25). */
export function NoticeDialogs() {
  const store = useStore();
  const [queue, setQueue] = useState<Notice[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fresh = (store.player?.notices ?? []).filter((n) => !dismissed.has(n.id) && !queue.some((q) => q.id === n.id));
    if (fresh.length > 0) setQueue((prev) => [...prev, ...fresh]);
  }, [store.player?.notices]);

  const current = queue[0];

  const ack = async () => {
    const notice = current!;
    setQueue((prev) => prev.slice(1));
    setDismissed((prev) => new Set(prev).add(notice.id));
    try {
      await api.ackNotice(notice.id);
    } catch {
      // the notice returns on the next load if the ack failed
    }
  };

  if (!current) return null;
  if (current.kind === 'level_up') {
    return <LevelDialog level={current.level} onClose={() => void ack()} />;
  }
  return (
    <FaintDialog level={current.level} goldLost={current.goldLost ?? 0} onClose={() => void ack()} />
  );
}
