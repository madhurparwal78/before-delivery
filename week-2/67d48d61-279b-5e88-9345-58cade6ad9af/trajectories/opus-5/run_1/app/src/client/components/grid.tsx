import { memo, useEffect, useRef } from 'react';
import { ui } from '../../shared/copy.js';
import {
  CYCLE_KEYS,
  CYCLE_NAMES,
  crewName,
  PRIORITY_NAMES,
  STATUS_NAMES,
} from '../../shared/domain.js';
import type { Task } from '../../shared/types.js';
import { undoLast } from '../actions.js';
import { go, setCurrentRow } from '../navigation.js';
import { setState, type FreedMark, type State } from '../store.js';
import { groupsFor, type Group } from '../view.js';
import { Chip, Num, Tape } from './parts.js';

export function Toolbar({ state }: { state: State }): JSX.Element {
  return (
    <div className="toolbar" role="toolbar" aria-label="Task tools" data-keys="tasks">
      <button
        type="button"
        aria-pressed={state.address.view === 'list'}
        onClick={() => go({ view: 'list' })}
      >
        List view
      </button>
      <button
        type="button"
        aria-pressed={state.address.view === 'board'}
        onClick={() => go({ view: 'board' })}
      >
        Board view
      </button>
      {state.address.view === 'list' ? (
        <label className="field">
          Group by
          <select
            value={state.address.group}
            onChange={(event) => go({ group: event.target.value as never })}
          >
            <option value="status">Status</option>
            <option value="cycle">Cycle</option>
            <option value="department">Department</option>
            <option value="owner">Owner</option>
          </select>
        </label>
      ) : null}
      <label className="field check">
        <input
          type="checkbox"
          checked={state.address.blocked}
          onChange={(event) => go({ blocked: event.target.checked })}
        />
        Blocked only
      </label>
      <label className="field">
        Cycle
        <select
          value={state.address.cycle ?? 'all'}
          onChange={(event) =>
            go({ cycle: event.target.value === 'all' ? null : (event.target.value as never) })
          }
        >
          <option value="all">All cycles</option>
          {CYCLE_KEYS.map((cycle) => (
            <option key={cycle} value={cycle}>
              {CYCLE_NAMES[cycle]}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={() => setState({ dialog: { kind: 'new-task', parent: null } })}>
        New task
      </button>
      <button type="button" onClick={() => void undoLast()}>
        Undo
      </button>
      <button type="button" onClick={() => setState({ palette: { open: true, text: '' } })}>
        Commands
      </button>
      {state.selection.length > 0 ? (
        <span className="selection-count">
          <Num>{state.selection.length}</Num> selected
        </span>
      ) : null}
      {state.saving || state.busy.length > 0 ? <span className="saving">{ui.saving}</span> : null}
    </div>
  );
}

interface RowProps {
  task: Task;
  current: boolean;
  selected: boolean;
  busy: boolean;
  highlighted: boolean;
  freed: FreedMark | undefined;
}

const Row = memo(function Row({
  task,
  current,
  selected,
  busy,
  highlighted,
  freed,
}: RowProps): JSX.Element {
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (current && highlighted && holder.current !== null) {
      holder.current.scrollIntoView({ block: 'nearest' });
    }
  }, [current, highlighted]);

  return (
    <div
      className={`row ${current ? 'current' : ''} ${selected ? 'selected' : ''}`}
      role="row"
      ref={holder}
      data-task-row={task.id}
      data-freed-order={freed?.order}
      data-freed-depth={freed?.depth}
      aria-selected={selected}
      aria-current={current ? 'true' : undefined}
      aria-busy={busy ? 'true' : undefined}
      tabIndex={current ? 0 : -1}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey) {
          setState((inner) => ({
            current: task.id,
            selection: inner.selection.includes(task.id)
              ? inner.selection.filter((id) => id !== task.id)
              : [...inner.selection, task.id],
          }));
          return;
        }
        setCurrentRow(task.id);
        go({ task: task.id });
      }}
    >
      <span className="cell cell-id num" role="gridcell">
        {task.id}
      </span>
      <span className="cell cell-tape" role="gridcell">
        <Tape department={task.department} />
      </span>
      <span className="cell cell-title" role="gridcell">
        {task.title}
      </span>
      <span className="cell cell-status" role="gridcell">
        <Chip label={STATUS_NAMES[task.status]} tone="status" />
      </span>
      <span className="cell cell-blocked" role="gridcell">
        {task.blocked ? <Chip label={ui.blockedChip} tone="blocked" /> : null}
        {freed !== undefined ? <span className="badge">{ui.freedBadge(freed.by)}</span> : null}
      </span>
      <span className="cell cell-priority" role="gridcell">
        {PRIORITY_NAMES[task.priority]}
      </span>
      <span className="cell cell-owner" role="gridcell">
        {task.owner === null ? '' : crewName(task.owner)}
      </span>
    </div>
  );
});

function GroupRows({ group, state }: { group: Group; state: State }): JSX.Element {
  return (
    <div className="rowgroup" role="rowgroup" aria-label={group.name} data-column={group.key}>
      <div className="group-header">
        <span>{group.name}</span>
        <Num>{group.tasks.length}</Num>
      </div>
      {group.tasks.map((task) => (
        <Row
          key={task.id}
          task={task}
          current={state.current === task.id}
          selected={state.selection.includes(task.id)}
          busy={state.busy.includes(task.id)}
          highlighted={state.address.row === task.id}
          freed={state.freed.get(task.id)}
        />
      ))}
    </div>
  );
}

export function Grid({ state }: { state: State }): JSX.Element {
  const groups = groupsFor(state);
  const empty = groups.every((group) => group.tasks.length === 0);
  const heading = useRef<HTMLHeadingElement>(null);
  const hadRows = useRef(false);

  useEffect(() => {
    if (empty && hadRows.current) heading.current?.focus();
    hadRows.current = !empty;
  }, [empty]);

  // A row that leaves the view takes focus with it, so the new current row takes it back.
  useEffect(() => {
    if (state.current === null || document.activeElement !== document.body) return;
    document.querySelector<HTMLElement>(`[data-task-row="${state.current}"]`)?.focus();
  }, [state.current, state.tasks]);

  if (empty) {
    return (
      <div className="grid-empty">
        <h2 tabIndex={-1} ref={heading}>
          {ui.tasksEmptyHeading}
        </h2>
      </div>
    );
  }

  const board = state.address.view === 'board';
  return (
    <div className={`grid ${board ? 'board' : 'list'}`} data-keys="tasks">
      <div className="grid-body" data-grid-body role="grid" aria-label="Tasks">
        <span className="cue-line" data-cue-line aria-hidden="true" />
        {groups.map((group) => (
          <GroupRows key={group.key} group={group} state={state} />
        ))}
      </div>
    </div>
  );
}
