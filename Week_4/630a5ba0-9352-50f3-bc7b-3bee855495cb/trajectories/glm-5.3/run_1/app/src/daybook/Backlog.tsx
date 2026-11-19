import { useEffect, useRef, useState } from 'react';
import { api, isFailure, type ApiTask, type BoardResponse, type ImportCalendarSummary, type ImportTaskSummary, type ShutdownPreview } from '../api/client';
import { useAnnouncer } from '../api/session';
import { Dialog, PendingButton, GENERIC_ERROR, reasonFor } from '../components';
import { Icon } from '../icons/Icon';
import { copy } from './logic';
import { dayLabelOf } from './labels';
import { CardSlip, type CardCallbacks } from './CardSlip';

interface Suggestion {
  id: string;
  title: string;
  estimateMinutes: number | null;
}

export function Backlog({
  board,
  step,
  showEstimates,
  callbacks,
  drag,
  addBoxRef,
  announce,
  reload,
  today,
}: {
  board: BoardResponse;
  step: string;
  showEstimates: boolean;
  callbacks: CardCallbacks;
  drag: { taskId: string; estimate: number | null; fromDay: string | null; zone: string | null; source: ApiTask } | null;
  addBoxRef: React.RefObject<HTMLInputElement>;
  announce: (s: string) => void;
  reload: () => Promise<void>;
  today: string;
}): JSX.Element {
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [openList, setOpenList] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [calDialogOpen, setCalDialogOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskImportRef = useRef<HTMLButtonElement | null>(null);
  const calImportRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (text.trim().length === 0) {
      setSuggestions([]);
      setOpenList(false);
      return;
    }
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void api
        .get<{ suggestions: Suggestion[] }>(`/api/tasks/suggest?q=${encodeURIComponent(text.trim())}`)
        .then((res) => {
          setSuggestions(res.suggestions);
          setOpenList(res.suggestions.length > 0);
          setHighlight(-1);
        })
        .catch(() => setSuggestions([]));
    }, 250);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [text]);

  const addTask = async (): Promise<void> => {
    const title = text.trim();
    if (title.length === 0) return;
    try {
      await api.post('/api/tasks', { title });
      setText('');
      setSuggestions([]);
      setOpenList(false);
      announce(copy.addedToBacklog(title));
      await reload();
    } catch (e) {
      announce(isFailure(e) ? e.message : GENERIC_ERROR);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(suggestions.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(-1, h - 1));
    } else if (e.key === 'Escape') {
      setOpenList(false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = highlight >= 0 ? suggestions[highlight] : undefined;
      if (pick !== undefined) {
        setOpenList(false);
        const card = document.querySelector<HTMLElement>(`[data-card="${pick.id}"] button`);
        card?.focus();
      } else {
        void addTask();
      }
    }
  };

  return (
    <section className="backlog${collapsed ? ' collapsed' : ''}${''}" aria-label="Backlog" data-drop="backlog" id="backlog-region">
      <div className="add-task">
        <label htmlFor="add-task" className="visually-hidden">Add a task</label>
        <input
          id="add-task"
          ref={addBoxRef}
          role="combobox"
          aria-expanded={openList}
          aria-controls="suggestion-list"
          aria-autocomplete="list"
          placeholder="Add a task"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {openList ? (
          <ul id="suggestion-list" className="suggestions" role="listbox" aria-label="Suggestions">
            {suggestions.map((s, i) => (
              <li key={s.id} role="option" aria-selected={i === highlight}>
                <button
                  type="button"
                  onClick={() => {
                    setOpenList(false);
                    const card = document.querySelector<HTMLElement>(`[data-card="${s.id}"] button`);
                    card?.focus();
                  }}
                >
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="import-buttons">
        <button type="button" ref={taskImportRef} onClick={() => setTaskDialogOpen(true)}>
          <Icon name="upload" /> Import tasks
        </button>
        <button type="button" ref={calImportRef} onClick={() => setCalDialogOpen(true)}>
          <Icon name="calendar" /> Import calendar
        </button>
      </div>
      <ul className="card-list">
        {board.backlog.map((task) => (
          <li key={task.id} data-card={task.id}>
            <CardSlip
              task={task}
              showEstimates={showEstimates}
              callbacks={callbacks}
              fromDayLabel={task.dayDate !== null && task.dayDate < today ? dayLabelOf(task.dayDate, board.timeZone) : null}
              held={drag !== null && drag.taskId === task.id}
              rolledBack={false}
            />
          </li>
        ))}
      </ul>
      {taskDialogOpen ? (
        <ImportTasksDialog
          onClose={() => setTaskDialogOpen(false)}
          returnRef={taskImportRef}
          announce={announce}
          reload={reload}
        />
      ) : null}
      {calDialogOpen ? (
        <ImportCalendarDialog
          onClose={() => setCalDialogOpen(false)}
          returnRef={calImportRef}
          announce={announce}
          reload={reload}
        />
      ) : null}
    </section>
  );
}

export function ImportTasksDialog({
  onClose,
  returnRef,
  announce,
  reload,
}: {
  onClose: () => void;
  returnRef: React.RefObject<HTMLButtonElement | null>;
  announce: (s: string) => void;
  reload: () => Promise<void>;
}): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  const run = async (): Promise<void> => {
    if (file === null) return;
    setPending(true);
    try {
      const text = await file.text();
      if (text.length > 1_000_000) {
        announce('That file is larger than 1,000,000 bytes.');
        setSummary('That file is larger than 1,000,000 bytes.');
        return;
      }
      const res = await api.postRaw<ImportTaskSummary>('/api/imports/tasks', text, 'text/csv');
      let line = `Imported: ${res.created} new, ${res.updated} updated, ${res.unchanged} unchanged.`;
      if (res.merged > 0) line += ` ${res.merged} merged.`;
      if (res.rejected.length > 0) line += ` ${res.rejected.length} rows skipped.`;
      if (res.orphaned.length > 0) line += ` ${res.orphaned.length} not in this file.`;
      announce(line);
      setSummary(line);
      await reload();
    } catch (e) {
      const message = isFailure(e)
        ? e.code === 'too_many_rows'
          ? 'That file has more than 2,000 rows.'
          : e.code === 'not_a_task_export'
            ? "That file isn't a task export with external_id and title columns."
            : e.code === 'payload_too_large'
              ? 'That file is larger than 1,000,000 bytes.'
              : e.message
        : GENERIC_ERROR;
      announce(message);
      setSummary(message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog label="Import tasks" onClose={onClose} returnFocusRef={returnRef}>
      <h2>Import tasks</h2>
      <div>
        <label htmlFor="csv-file">CSV export</label>
        <input id="csv-file" type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      {summary !== null ? <p>{summary}</p> : null}
      <div className="dialog-actions">
        <PendingButton type="button" pending={pending} pendingLabel="Importing…" onClick={() => { void run(); }} className="primary">Import</PendingButton>
        <button type="button" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}

export function ImportCalendarDialog({
  onClose,
  returnRef,
  announce,
  reload,
}: {
  onClose: () => void;
  returnRef: React.RefObject<HTMLButtonElement | null>;
  announce: (s: string) => void;
  reload: () => Promise<void>;
}): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  const run = async (): Promise<void> => {
    if (file === null) return;
    setPending(true);
    try {
      const text = await file.text();
      if (text.length > 1_000_000) {
        announce('That file is larger than 1,000,000 bytes.');
        setSummary('That file is larger than 1,000,000 bytes.');
        return;
      }
      const res = await api.postRaw<ImportCalendarSummary>('/api/imports/calendar', text, 'text/calendar');
      const line = `Calendar imported: ${res.created} new, ${res.updated} updated, ${res.unchanged} unchanged, ${res.skipped} skipped.`;
      announce(line);
      setSummary(line);
      await reload();
    } catch (e) {
      const message = isFailure(e)
        ? e.code === 'not_a_calendar'
          ? "That file isn't an iCalendar file."
          : e.code === 'payload_too_large'
            ? 'That file is larger than 1,000,000 bytes.'
            : e.message
        : GENERIC_ERROR;
      announce(message);
      setSummary(message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog label="Import calendar" onClose={onClose} returnFocusRef={returnRef}>
      <h2>Import calendar</h2>
      <div>
        <label htmlFor="ics-file">Calendar file (.ics)</label>
        <input id="ics-file" type="file" accept=".ics,text/calendar" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      {summary !== null ? <p>{summary}</p> : null}
      <div className="dialog-actions">
        <PendingButton type="button" pending={pending} pendingLabel="Importing…" onClick={() => { void run(); }} className="primary">Import</PendingButton>
        <button type="button" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}

export function ShutdownDialog({
  preview,
  timeZone,
  pending,
  onClose,
  returnRef,
  onSend,
}: {
  preview: ShutdownPreview;
  timeZone: string;
  pending: boolean;
  onClose: () => void;
  returnRef: React.RefObject<HTMLButtonElement | null>;
  onSend: () => void;
}): JSX.Element {
  const tomorrow = preview.carriedOver.length >= 0 ? nextLabel(preview.date, timeZone) : preview.date;
  return (
    <Dialog label="Shut down" onClose={onClose} returnFocusRef={returnRef}>
      <h2>Shut down</h2>
      <div className="preview-lists">
        <div>
          <h3>Done</h3>
          <ul>
            {preview.done.map((t) => (
              <li key={t.id}>{t.title}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Carry over to {tomorrow}</h3>
          <ul>
            {preview.carriedOver.map((t) => (
              <li key={t.id}>{t.title}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Tomorrow starts with</h3>
          {preview.tomorrowFirst === null ? <p>Nothing scheduled</p> : <p>{preview.tomorrowFirst.title} at {preview.tomorrowFirst.startTime}</p>}
        </div>
      </div>
      <div className="dialog-actions">
        <PendingButton type="button" pending={pending} pendingLabel="Shutting down…" onClick={onSend} className="primary">Send shutdown</PendingButton>
        <button type="button" onClick={onClose}>Not yet</button>
      </div>
    </Dialog>
  );
}

const nextLabel = (date: string, timeZone: string): string => {
  const next = new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000);
  return new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long', day: 'numeric', month: 'long' }).format(next);
};
