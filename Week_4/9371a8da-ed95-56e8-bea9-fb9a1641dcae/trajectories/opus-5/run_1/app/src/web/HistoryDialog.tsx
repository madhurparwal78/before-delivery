import { useEffect, useRef, useState } from 'react';
import { api, ApiFailure } from './api.js';
import { Dialog } from './components/Dialog.js';
import { copy } from './copy.js';
import { DialogContext } from './ProjectDialogs.js';
import { Entry, Label, ProjectRole } from './types.js';

interface Props {
  context: DialogContext;
  role: ProjectRole;
  onClose: () => void;
  returnFocusTo: () => HTMLElement | null;
}

export function HistoryDialog(props: Props): JSX.Element {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Label | null>(null);
  const [pending, setPending] = useState(false);
  const labelField = useRef<HTMLInputElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const actions = useRef(0);
  const focusRevision = useRef<number | null>(null);
  const restoreButtons = useRef<Record<string, HTMLButtonElement | null>>({});
  const isOwner = props.role === 'owner';

  const load = async (): Promise<void> => {
    const at = actions.current;
    const [history, labelled] = await Promise.all([
      api<{ entries: Entry[] }>(`/api/projects/${props.context.projectId}/history`),
      api<{ labels: Label[] }>(`/api/projects/${props.context.projectId}/labels`),
    ]);
    if (actions.current !== at) return;
    setEntries(history.entries);
    setLabels(labelled.labels);
  };

  useEffect(() => {
    void load().catch(() => undefined);
    const timer = window.setInterval(() => void load().catch(() => undefined), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const revision = focusRevision.current;
    if (revision === null) return;
    const host = hostRef.current;
    if (host === null) return;
    const cell = host.querySelector<HTMLElement>(`[data-revision="${revision}"]`);
    if (cell !== null) {
      focusRevision.current = null;
      cell.focus();
    }
  }, [entries]);

  const labelsFor = (revision: number): Label[] =>
    labels.filter((label) => label.projectRevision === revision);

  const addLabel = async (): Promise<void> => {
    const newest = entries[0]?.projectRevision;
    if (newest === undefined) return;
    setPending(true);
    setError(null);
    props.context.notify(copy.labelling);
    try {
      const answer = await api<{ label: Label }>(
        `/api/projects/${props.context.projectId}/labels`,
        { method: 'POST', body: { name, projectRevision: newest } },
      );
      actions.current += 1;
      props.context.notify(copy.labelled(answer.label.projectRevision, answer.label.name));
      setName('');
      labelField.current?.focus();
      await load();
      props.context.afterAction();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'label_taken') {
        setError(copy.fields.labelTaken);
      } else if (failure instanceof ApiFailure && failure.status === 403) {
        props.context.forbidden();
        props.onClose();
        return;
      } else if (failure instanceof ApiFailure && failure.field('name') !== null) {
        setError(
          failure.field('name') === copy.fields.unstorable
            ? copy.fields.unstorable
            : copy.fields.label,
        );
      } else {
        props.context.notify(copy.somethingWrong);
      }
      labelField.current?.focus();
    } finally {
      setPending(false);
    }
  };

  const restore = async (label: Label): Promise<void> => {
    props.context.notify(copy.restoring(label.name));
    try {
      const answer = await api<{ projectRevision: number }>(
        `/api/projects/${props.context.projectId}/labels/${label.id}/restore`,
        { method: 'POST', body: {} },
      );
      actions.current += 1;
      props.context.notify(copy.restored(label.name, answer.projectRevision));
      focusRevision.current = answer.projectRevision;
      setConfirm(null);
      await load();
      props.context.afterAction();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 403) {
        setConfirm(null);
        props.context.forbidden();
        props.onClose();
        return;
      }
      props.context.notify(copy.somethingWrong);
      setConfirm(null);
    }
  };

  return (
    <Dialog
      name="History"
      onClose={props.onClose}
      returnFocusTo={props.returnFocusTo}
      className="dialog-tall"
      firstFocus={isOwner ? 'input' : '[data-table="revisions"]'}
    >
      <div ref={hostRef}>
        <h2>History</h2>
        {isOwner ? (
          <div className="history-label">
            <label>
              <span className="field-label">Label name</span>
              <input
                ref={labelField}
                value={name}
                aria-describedby={error === null ? undefined : 'label-error'}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void addLabel();
                  }
                }}
              />
            </label>
            {error === null ? null : (
              <p className="field-error" id="label-error">
                {error}
              </p>
            )}
            <button
              type="button"
              disabled={pending}
              aria-busy={pending ? true : undefined}
              onClick={() => void addLabel()}
            >
              Label current revision
            </button>
          </div>
        ) : null}
        <table className="ledger" aria-label="Revisions" data-table="revisions" tabIndex={-1}>
          <thead>
            <tr>
              <th scope="col">Revision</th>
              <th scope="col">When</th>
              <th scope="col">Who</th>
              <th scope="col">What</th>
              <th scope="col">Labels</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.projectRevision}>
                <th scope="row" tabIndex={-1} data-revision={entry.projectRevision} className="revision">
                  r{entry.projectRevision}
                </th>
                <td>{new Date(entry.at).toLocaleString()}</td>
                <td>{entry.actor.displayName}</td>
                <td>{entry.summary}</td>
                <td>
                  {labelsFor(entry.projectRevision).map((label) => (
                    <span key={label.id} className="label-chip">
                      {label.name}
                      {isOwner ? (
                        <button
                          type="button"
                          ref={(element) => {
                            restoreButtons.current[label.id] = element;
                          }}
                          onClick={() => setConfirm(label)}
                        >
                          Restore {label.name}
                        </button>
                      ) : null}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {confirm === null ? null : (
        <Dialog
          name={`Restore ${confirm.name}?`}
          kind="alertdialog"
          onClose={() => setConfirm(null)}
          returnFocusTo={() => restoreButtons.current[confirm.id] ?? null}
        >
          <h2>Restore {confirm.name}?</h2>
          <p>{copy.restoreConfirmBody(confirm.name)}</p>
          <button type="button" onClick={() => setConfirm(null)}>
            Cancel
          </button>
          <button type="button" onClick={() => void restore(confirm)}>
            Restore
          </button>
        </Dialog>
      )}
    </Dialog>
  );
}
