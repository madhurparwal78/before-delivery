import { useEffect, useRef, useState } from 'react';
import { ui } from '../../shared/copy.js';
import {
  CREW,
  DEPARTMENTS,
  PRIORITIES,
  PRIORITY_NAMES,
  department as departmentOf,
  type Priority,
} from '../../shared/domain.js';
import { addLink, createTask, decideRequest, fileRequest } from '../actions.js';
import { commandTargets, matchingCommands } from '../commands.js';
import { setState, type State } from '../store.js';
import { closeDialog, Dialog, ErrorSummary, FieldError } from './parts.js';

function Palette({ state }: { state: State }): JSX.Element {
  const [text, setText] = useState(state.palette.text);
  const [active, setActive] = useState(0);
  const commands = matchingCommands(text);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const close = (): void => setState({ palette: { open: false, text: '' } });
  const run = (): void => {
    const command = commands[active];
    if (command === undefined) return;
    close();
    command.run(commandTargets());
  };

  return (
    <Dialog label="Command palette" onClose={close} className="palette">
      <input
        ref={input}
        type="text"
        role="combobox"
        aria-label="Command"
        aria-expanded="true"
        aria-controls="palette-list"
        aria-activedescendant={commands[active] === undefined ? undefined : `command-${active}`}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((current) => Math.min(commands.length - 1, current + 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((current) => Math.max(0, current - 1));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            run();
          }
        }}
      />
      <ul className="palette-list" id="palette-list" role="listbox" aria-label="Commands">
        {commands.map((command, index) => (
          <li
            key={command.label}
            id={`command-${index}`}
            role="option"
            aria-selected={index === active}
            className={index === active ? 'active' : ''}
            onMouseDown={(event) => {
              event.preventDefault();
              setActive(index);
              close();
              command.run(commandTargets());
            }}
          >
            {command.label}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

function NewTaskDialog({ state, parent }: { state: State; parent: string | null }): JSX.Element {
  const parentTask = parent === null ? undefined : state.tasks.get(parent);
  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState(
    parentTask?.department ?? state.address.dept ?? 'carpentry',
  );
  const [priority, setPriority] = useState<Priority>(0);
  const [owner, setOwner] = useState('');

  const submit = (): void => {
    void createTask({
      title,
      department,
      priority,
      owner: owner === '' ? null : owner,
      parent,
    }).then((id) => {
      if (id !== null) closeDialog();
    });
  };

  return (
    <Dialog label="New task" onClose={closeDialog}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <ErrorSummary
          errors={state.formErrors}
          fieldIds={{
            title: 'new-title',
            department: 'new-department',
            priority: 'new-priority',
            owner: 'new-owner',
            parent: 'new-title',
          }}
        />
        <div className="property">
          <label htmlFor="new-title">Title</label>
          <input
            id="new-title"
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <FieldError message={state.formErrors.title} />
        </div>
        <div className="property">
          <label htmlFor="new-department">Department</label>
          <select
            id="new-department"
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
          >
            {DEPARTMENTS.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.name}
              </option>
            ))}
          </select>
          <FieldError message={state.formErrors.department} />
        </div>
        <div className="property">
          <label htmlFor="new-priority">Priority</label>
          <select
            id="new-priority"
            value={String(priority)}
            onChange={(event) => setPriority(Number(event.target.value) as Priority)}
          >
            {PRIORITIES.map((entry) => (
              <option key={entry} value={String(entry)}>
                {PRIORITY_NAMES[entry]}
              </option>
            ))}
          </select>
        </div>
        <div className="property">
          <label htmlFor="new-owner">Owner</label>
          <select id="new-owner" value={owner} onChange={(event) => setOwner(event.target.value)}>
            <option value="">Unassigned</option>
            {CREW.map((member) => (
              <option key={member.handle} value={member.handle}>
                {member.name}
              </option>
            ))}
          </select>
          <FieldError message={state.formErrors.owner} />
        </div>
        <div className="dialog-buttons">
          <button type="submit">Create task</button>
          <button type="button" onClick={closeDialog}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function LinkDialog({ state, task }: { state: State; task: string }): JSX.Element {
  const candidates = [...state.tasks.values()]
    .filter(
      (entry) =>
        entry.id !== task &&
        entry.status !== 'triage' &&
        entry.status !== 'duplicate' &&
        entry.subtasks === null,
    )
    .sort((a, b) => a.number - b.number);
  const [target, setTarget] = useState(candidates[0]?.id ?? '');

  return (
    <Dialog label="Add blocked task" onClose={closeDialog}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void addLink(task, target).then((ok) => {
            if (ok) closeDialog();
          });
        }}
      >
        <div className="property">
          <label htmlFor="link-task">Task</label>
          <select id="link-task" value={target} onChange={(event) => setTarget(event.target.value)}>
            {candidates.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {`${entry.id} ${entry.title}`}
              </option>
            ))}
          </select>
        </div>
        <div className="dialog-buttons">
          <button type="submit">Add link</button>
        </div>
      </form>
    </Dialog>
  );
}

function AcceptDialog({ state, task }: { state: State; task: string }): JSX.Element {
  const row = state.tasks.get(task);
  const [department, setDepartment] = useState(row?.department ?? 'carpentry');
  const [priority, setPriority] = useState<Priority>(0);
  const [owner, setOwner] = useState('');
  const [label, setLabel] = useState('');
  const labels = departmentOf(department)?.labels ?? [];

  return (
    <Dialog label="Accept request" onClose={closeDialog}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void decideRequest(task, {
            decision: 'accept',
            department,
            priority,
            owner: owner === '' ? null : owner,
            label: label === '' ? null : label,
          }).then((ok) => {
            if (ok) closeDialog();
          });
        }}
      >
        <ErrorSummary
          errors={state.formErrors}
          fieldIds={{
            department: 'accept-department',
            priority: 'accept-priority',
            owner: 'accept-owner',
            label: 'accept-label',
          }}
        />
        <div className="property">
          <label htmlFor="accept-department">Department</label>
          <select
            id="accept-department"
            value={department}
            onChange={(event) => {
              setDepartment(event.target.value);
              setLabel('');
            }}
          >
            {DEPARTMENTS.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.name}
              </option>
            ))}
          </select>
        </div>
        <div className="property">
          <label htmlFor="accept-priority">Priority</label>
          <select
            id="accept-priority"
            value={String(priority)}
            onChange={(event) => setPriority(Number(event.target.value) as Priority)}
          >
            {PRIORITIES.map((entry) => (
              <option key={entry} value={String(entry)}>
                {PRIORITY_NAMES[entry]}
              </option>
            ))}
          </select>
        </div>
        <div className="property">
          <label htmlFor="accept-owner">Owner</label>
          <select
            id="accept-owner"
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
          >
            <option value="">Unassigned</option>
            {CREW.map((member) => (
              <option key={member.handle} value={member.handle}>
                {member.name}
              </option>
            ))}
          </select>
        </div>
        <div className="property">
          <label htmlFor="accept-label">Label</label>
          <select
            id="accept-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          >
            <option value="">No label</option>
            {labels.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.name}
              </option>
            ))}
          </select>
        </div>
        <div className="dialog-buttons">
          <button type="submit" disabled={state.saving}>
            {state.saving ? ui.sendingToIntake : 'Accept'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function DeclineDialog({ state, task }: { state: State; task: string }): JSX.Element {
  const [reason, setReason] = useState('');
  return (
    <Dialog label="Decline request" onClose={closeDialog}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void decideRequest(task, { decision: 'decline', reason }).then((ok) => {
            if (ok) closeDialog();
          });
        }}
      >
        <ErrorSummary errors={state.formErrors} fieldIds={{ reason: 'decline-reason' }} />
        <div className="property">
          <label htmlFor="decline-reason">Reason</label>
          <textarea
            id="decline-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void decideRequest(task, { decision: 'decline', reason }).then((ok) => {
                  if (ok) closeDialog();
                });
              }
            }}
          />
          <FieldError message={state.formErrors.reason} />
        </div>
        <div className="dialog-buttons">
          <button type="submit" disabled={state.saving}>
            {state.saving ? ui.sendingToIntake : 'Decline'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function MergeDialog({ state, task }: { state: State; task: string }): JSX.Element {
  const candidates = [...state.tasks.values()]
    .filter((entry) => ['backlog', 'todo', 'in_progress', 'done'].includes(entry.status))
    .sort((a, b) => a.number - b.number);
  const [target, setTarget] = useState(candidates[0]?.id ?? '');
  return (
    <Dialog label="Merge request" onClose={closeDialog}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void decideRequest(task, { decision: 'merge', duplicate_of: target }).then((ok) => {
            if (ok) closeDialog();
          });
        }}
      >
        <ErrorSummary errors={state.formErrors} fieldIds={{ duplicate_of: 'merge-target' }} />
        <div className="property">
          <label htmlFor="merge-target">Duplicate of</label>
          <select
            id="merge-target"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            {candidates.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {`${entry.id} ${entry.title}`}
              </option>
            ))}
          </select>
          <FieldError message={state.formErrors.duplicate_of} />
        </div>
        <div className="dialog-buttons">
          <button type="submit" disabled={state.saving}>
            {state.saving ? ui.sendingToIntake : 'Merge'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function FileRequestDialog({ state }: { state: State }): JSX.Element {
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [requester, setRequester] = useState('');
  const [department, setDepartment] = useState('');
  return (
    <Dialog label="File a request" onClose={closeDialog}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void fileRequest({
            title,
            details,
            requester,
            department: department === '' ? null : department,
          }).then((ok) => {
            if (ok) closeDialog();
          });
        }}
      >
        <ErrorSummary
          errors={state.formErrors}
          fieldIds={{
            title: 'request-title',
            details: 'request-details',
            requester: 'request-requester',
            department: 'request-department',
          }}
        />
        <div className="property">
          <label htmlFor="request-title">Request</label>
          <input
            id="request-title"
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <FieldError message={state.formErrors.title} />
        </div>
        <div className="property">
          <label htmlFor="request-details">Details</label>
          <textarea
            id="request-details"
            rows={3}
            value={details}
            onChange={(event) => setDetails(event.target.value)}
          />
        </div>
        <div className="property">
          <label htmlFor="request-requester">Your name</label>
          <input
            id="request-requester"
            type="text"
            value={requester}
            onChange={(event) => setRequester(event.target.value)}
          />
          <FieldError message={state.formErrors.requester} />
        </div>
        <div className="property">
          <label htmlFor="request-department">Department</label>
          <select
            id="request-department"
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
          >
            <option value="">No department</option>
            {DEPARTMENTS.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.name}
              </option>
            ))}
          </select>
        </div>
        <div className="dialog-buttons">
          <button type="submit" disabled={state.saving}>
            {state.saving ? ui.filing : 'File request'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function Dialogs({ state }: { state: State }): JSX.Element | null {
  return (
    <>
      {state.palette.open ? <Palette state={state} /> : null}
      {state.dialog.kind === 'new-task' ? (
        <NewTaskDialog state={state} parent={state.dialog.parent} />
      ) : null}
      {state.dialog.kind === 'link' ? <LinkDialog state={state} task={state.dialog.task} /> : null}
      {state.dialog.kind === 'accept' ? (
        <AcceptDialog state={state} task={state.dialog.task} />
      ) : null}
      {state.dialog.kind === 'decline' ? (
        <DeclineDialog state={state} task={state.dialog.task} />
      ) : null}
      {state.dialog.kind === 'merge' ? (
        <MergeDialog state={state} task={state.dialog.task} />
      ) : null}
      {state.dialog.kind === 'file-request' ? <FileRequestDialog state={state} /> : null}
    </>
  );
}
