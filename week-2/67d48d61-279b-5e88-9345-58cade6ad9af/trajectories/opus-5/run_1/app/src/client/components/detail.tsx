import { useEffect, useRef, useState } from 'react';
import { ui } from '../../shared/copy.js';
import {
  ATTACHMENT_KINDS,
  ATTACHMENT_KIND_NAMES,
  CREW,
  CYCLE_KEYS,
  CYCLE_NAMES,
  department as departmentOf,
  departmentName,
  PRIORITIES,
  PRIORITY_NAMES,
  STATUS_NAMES,
  type CycleKey,
  type Priority,
  type Status,
} from '../../shared/domain.js';
import type { Task } from '../../shared/types.js';
import { editTask, removeLink, uploadPlot } from '../actions.js';
import { go } from '../navigation.js';
import { setState, type State } from '../store.js';
import { Dialog } from './parts.js';

const EDITABLE_STATUSES: Status[] = ['backlog', 'todo', 'in_progress', 'done', 'cancelled'];

function TextField({
  id,
  label,
  value,
  multiline,
  onSave,
}: {
  id: string;
  label: string;
  value: string;
  multiline?: boolean;
  onSave: (next: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const save = (): void => {
    if (draft !== value) onSave(draft);
  };
  const shared = {
    id,
    value: draft,
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    onBlur: save,
  };
  return (
    <div className="property">
      <label htmlFor={id}>{label}</label>
      {multiline === true ? (
        <textarea
          {...shared}
          rows={3}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              save();
            }
          }}
        />
      ) : (
        <input
          type="text"
          {...shared}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              save();
            }
          }}
        />
      )}
    </div>
  );
}

function Select({
  id,
  label,
  value,
  options,
  onChoose,
}: {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChoose: (next: string) => void;
}): JSX.Element {
  return (
    <div className="property">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => onChoose(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Properties({ task, state }: { task: Task; state: State }): JSX.Element {
  const labels = departmentOf(task.department)?.labels ?? [];
  const cycleOptions = CYCLE_KEYS.filter((key) => {
    const current = state.snapshot?.cycles.find((cycle) => cycle.current)?.key ?? 'rehearsal-1';
    return (
      CYCLE_KEYS.indexOf(key) >= CYCLE_KEYS.indexOf(current) || key === task.cycle
    );
  });

  return (
    <div className="properties">
      <TextField
        id="detail-title"
        label="Title"
        value={task.title}
        onSave={(title) => void editTask(task.id, { title })}
      />
      <TextField
        id="detail-details"
        label="Details"
        value={task.details}
        multiline
        onSave={(details) => void editTask(task.id, { details })}
      />
      <Select
        id="detail-status"
        label="Status"
        value={task.status}
        options={EDITABLE_STATUSES.map((status) => ({
          value: status,
          label: STATUS_NAMES[status],
        }))}
        onChoose={(status) => void editTask(task.id, { status: status as Status })}
      />
      <Select
        id="detail-priority"
        label="Priority"
        value={String(task.priority)}
        options={PRIORITIES.map((priority) => ({
          value: String(priority),
          label: PRIORITY_NAMES[priority],
        }))}
        onChoose={(priority) =>
          void editTask(task.id, { priority: Number(priority) as Priority })
        }
      />
      <Select
        id="detail-owner"
        label="Owner"
        value={task.owner ?? ''}
        options={[
          { value: '', label: 'Unassigned' },
          ...CREW.map((member) => ({ value: member.handle, label: member.name })),
        ]}
        onChoose={(owner) => void editTask(task.id, { owner: owner === '' ? null : owner })}
      />
      <Select
        id="detail-label"
        label="Label"
        value={task.label ?? ''}
        options={[
          { value: '', label: 'No label' },
          ...labels.map((label) => ({ value: label.key, label: label.name })),
        ]}
        onChoose={(label) => void editTask(task.id, { label: label === '' ? null : label })}
      />
      <Select
        id="detail-cycle"
        label="Cycle"
        value={task.cycle ?? ''}
        options={[
          ...(task.cycle === null ? [{ value: '', label: 'No cycle' }] : []),
          ...cycleOptions.map((cycle) => ({ value: cycle, label: CYCLE_NAMES[cycle] })),
        ]}
        onChoose={(cycle) => {
          if (cycle !== '') void editTask(task.id, { cycle: cycle as CycleKey });
        }}
      />
      <div className="property">
        <span className="property-name">Department</span>
        <span className={`tape tape-${task.department ?? ''}`}>
          {departmentName(task.department)}
        </span>
      </div>
      <div className="property">
        <span className="property-name">Parent</span>
        <span className="num">{task.parent ?? '—'}</span>
      </div>
      <div className="property">
        <span className="property-name">Blocked by</span>
        <ul className="link-list" aria-label="Blocked by">
          {task.blocked_by.map((id) => (
            <li key={id}>
              <span className="num">{id}</span>
              <button type="button" onClick={() => void removeLink(id, task.id)}>
                {`Remove link to ${id}`}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="property">
        <span className="property-name">Blocks</span>
        <ul className="link-list" aria-label="Blocks">
          {task.blocks.map((id) => (
            <li key={id}>
              <span className="num">{id}</span>
              <button type="button" onClick={() => void removeLink(task.id, id)}>
                {`Remove link to ${id}`}
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setState({ dialog: { kind: 'link', task: task.id } })}
        >
          Add blocked task
        </button>
      </div>
      <div className="property">
        <span className="property-name">Sub-tasks</span>
        <ul className="link-list" aria-label="Sub-tasks">
          {[...state.tasks.values()]
            .filter((child) => child.parent === task.id)
            .sort((a, b) => a.number - b.number)
            .map((child) => (
              <li key={child.id}>
                <span className="num">{child.id}</span>
                <span>{child.title}</span>
                <span className="chip chip-status">{STATUS_NAMES[child.status]}</span>
              </li>
            ))}
        </ul>
        {task.subtasks !== null ? (
          <p className="rollup">{ui.rollUp(task.subtasks.done, task.subtasks.total)}</p>
        ) : null}
        <button
          type="button"
          onClick={() => setState({ dialog: { kind: 'new-task', parent: task.id } })}
        >
          Add sub-task
        </button>
      </div>
      <Attachments task={task} state={state} />
    </div>
  );
}

function Attachments({ task, state }: { task: Task; state: State }): JSX.Element {
  const [kind, setKind] = useState<string>('plot');
  return (
    <div className="property attachments">
      <span className="property-name">Attachments</span>
      {state.attachments.length === 0 && state.uploading === null ? (
        <p>{ui.attachmentsEmpty}</p>
      ) : null}
      <ul className="link-list" aria-label="Attachments">
        {state.attachments.map((attachment) => (
          <li key={attachment.id}>
            <a href={`/api/attachments/${attachment.id}/download`}>{attachment.file_name}</a>
            <span>{ATTACHMENT_KIND_NAMES[attachment.kind]}</span>
            {attachment.current ? <span className="chip chip-status">Current</span> : null}
          </li>
        ))}
      </ul>
      {state.uploading !== null ? (
        <div className="uploading">
          <p>{ui.uploading(state.uploading.name)}</p>
          <div
            className="progress"
            role="progressbar"
            aria-label="Upload progress"
            aria-valuenow={state.uploading.percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span className="progress-fill" style={{ width: `${state.uploading.percent}%` }} />
          </div>
        </div>
      ) : null}
      <label htmlFor="detail-kind" className="property-name">
        Attachment kind
      </label>
      <select id="detail-kind" value={kind} onChange={(event) => setKind(event.target.value)}>
        {ATTACHMENT_KINDS.map((option) => (
          <option key={option} value={option}>
            {ATTACHMENT_KIND_NAMES[option]}
          </option>
        ))}
      </select>
      <input
        type="file"
        aria-label="Attach file"
        accept="application/pdf,image/png,image/jpeg"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void uploadPlot(task.id, file, kind);
        }}
      />
    </div>
  );
}

function Activity({ state }: { state: State }): JSX.Element {
  return (
    <div className="activity">
      <ul className="activity-list" aria-label="Activity">
        {state.activity.map((entry) => (
          <li key={entry.id}>
            <span className="actor">{entry.actor === null ? 'Promptside' : entry.actor.name}</span>
            <span className="num at">{entry.at.slice(11, 16)}</span>
            <span className="what">
              {entry.kind === 'undo' ? 'undo' : entry.kind.replace('_', ' ')}
              {Object.entries(entry.changes).map(([field, change]) => (
                <span key={field} className="change">
                  {` ${field} ${String(change.from ?? '—')} → ${String(change.to ?? '—')}`}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Detail({ state }: { state: State }): JSX.Element | null {
  const id = state.address.task;
  const task = id === null ? undefined : state.tasks.get(id);
  const heading = useRef<HTMLHeadingElement>(null);
  const phone = state.width < 768;

  useEffect(() => {
    if (task !== undefined && !phone) heading.current?.focus();
  }, [task?.id, phone]);

  if (task === undefined) return null;

  const close = (): void => {
    const row = document.querySelector<HTMLElement>(`[data-task-row="${task.id}"]`);
    row?.focus();
    go({ task: null });
    if (row === null) {
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-task-row="${task.id}"]`)?.focus();
      });
    }
  };

  const inner = (
    <>
      <div className="detail-head">
        <h2 tabIndex={-1} ref={heading}>
          <span className="num">{task.id}</span> {task.title}
        </h2>
        <button type="button" onClick={close}>
          Close details
        </button>
      </div>
      <Properties task={task} state={state} />
      <Activity state={state} />
    </>
  );

  if (phone) {
    return (
      <Dialog label="Task details" onClose={close} className="sheet">
        {inner}
      </Dialog>
    );
  }

  return (
    <aside
      className="detail"
      aria-label="Task details"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
        }
      }}
    >
      {inner}
    </aside>
  );
}
