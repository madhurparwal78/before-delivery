import { useEffect, useRef } from 'react';
import { ui } from '../../shared/copy.js';
import { loadRequests } from '../actions.js';
import { navigateTo } from '../navigation.js';
import { setState, type State } from '../store.js';
import { triageTasks } from '../view.js';
import { Detail } from './detail.js';
import { Grid, Toolbar } from './grid.js';
import { Num, Tape } from './parts.js';

export function TasksScreen({ state }: { state: State }): JSX.Element {
  return (
    <div className={`tasks ${state.address.task === null ? '' : 'with-detail'}`}>
      <Toolbar state={state} />
      <div className="tasks-body">
        <Grid state={state} />
        <Detail state={state} />
      </div>
    </div>
  );
}

export function TriageScreen({ state }: { state: State }): JSX.Element {
  const rows = triageTasks(state);
  const heading = useRef<HTMLHeadingElement>(null);
  const hadRows = useRef(false);

  useEffect(() => {
    void loadRequests();
  }, [state.status.intake]);

  useEffect(() => {
    if (rows.length === 0 && hadRows.current) heading.current?.focus();
    hadRows.current = rows.length > 0;
  }, [rows.length]);

  useEffect(() => {
    const id = state.current;
    if (id === null) return;
    window.requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(`[data-task-row="${id}"]`);
      if (row !== null && document.activeElement === document.body) row.focus();
    });
  }, [state.current]);

  if (rows.length === 0) {
    return (
      <div className="triage-empty">
        <h2 tabIndex={-1} ref={heading}>
          {ui.triageEmptyHeading}
        </h2>
        <p>{ui.triageEmptyLine}</p>
      </div>
    );
  }

  const requestOf = (id: string | null): { requester: string; department: string | null } | null => {
    if (id === null || state.requests === null) return null;
    const record = state.requests.find((entry) => entry.id === id);
    return record === undefined ? null : { requester: record.requester, department: record.department };
  };

  return (
    <div className="triage" data-keys="triage">
      <div className="grid-body" role="grid" aria-label="Triage">
        <div className="rowgroup" role="rowgroup" aria-label="Triage">
          {rows.map((task) => {
            const record = requestOf(task.request);
            const current = state.current === task.id;
            return (
              <div
                key={task.id}
                className={`row ${current ? 'current' : ''}`}
                role="row"
                data-task-row={task.id}
                aria-current={current ? 'true' : undefined}
                tabIndex={current ? 0 : -1}
                onClick={() => setState({ current: task.id })}
              >
                <span className="cell cell-id num" role="gridcell">
                  {task.id}
                </span>
                <span className="cell cell-title" role="gridcell">
                  {task.title}
                </span>
                <span className="cell cell-owner" role="gridcell">
                  {record?.requester ?? ''}
                </span>
                <span className="cell cell-tape" role="gridcell">
                  {record === null ? null : <Tape department={record.department} />}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <p className="triage-keys">
        Press <kbd>a</kbd> to accept, <kbd>d</kbd> to decline, <kbd>m</kbd> to merge.
      </p>
    </div>
  );
}

export function RequestsScreen({ state }: { state: State }): JSX.Element {
  const requests = state.requests ?? [];
  return (
    <div className="requests">
      <button
        type="button"
        onClick={() => setState({ dialog: { kind: 'file-request' } })}
      >
        File a request
      </button>
      {state.requestsDown ? <p>{ui.requestsIntakeDown}</p> : null}
      {!state.requestsDown && requests.length === 0 ? <p>{ui.requestsEmpty}</p> : null}
      {!state.requestsDown && requests.length > 0 ? (
        <table aria-label="Requests">
          <thead>
            <tr>
              <th scope="col">Request</th>
              <th scope="col">Requester</th>
              <th scope="col">Date filed</th>
              <th scope="col">Outcome</th>
              <th scope="col">Task</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.id}>
                <td>{request.title}</td>
                <td>{request.requester}</td>
                <td>
                  <Num>{request.created.slice(0, 10)}</Num>
                </td>
                <td>{outcomeName(request.status)}</td>
                <td>
                  {request.task === null ? (
                    ui.awaitingTriage
                  ) : (
                    <Num>{request.task}</Num>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

function outcomeName(status: string): string {
  switch (status) {
    case 'accepted':
      return 'Accepted';
    case 'declined':
      return 'Declined';
    case 'merged':
      return 'Merged';
    default:
      return 'Pending';
  }
}

export function NotFound(): JSX.Element {
  return (
    <div className="not-found">
      <h1>{ui.notFoundHeading}</h1>
      <a
        href="/tasks"
        onClick={(event) => {
          event.preventDefault();
          navigateTo('/tasks');
        }}
      >
        {ui.backToTasks}
      </a>
    </div>
  );
}

