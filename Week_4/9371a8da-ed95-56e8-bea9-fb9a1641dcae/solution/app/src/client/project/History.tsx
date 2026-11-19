import type { JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Entry, Label } from "../../shared/api.ts";
import { get, post } from "../api.ts";
import { Dialog, Field } from "../dialog.tsx";
import { actions } from "../latest.ts";
import { formatWhen, looksUnstorable } from "../text.ts";
import { SOMETHING_WRONG, UNSTORABLE_FIELD, type ViewContext } from "./model.ts";

export function HistoryDialog(props: { context: ViewContext; onClose: () => void }): JSX.Element {
  const { context } = props;
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState<Label | null>(null);
  const [restoring, setRestoring] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const table = useRef<HTMLTableElement>(null);
  /** The revision whose row header takes focus once the ledger shows it (after a restore). */
  const focusRevision = useRef<number | null>(null);
  const focusHistory = useRef(false);
  const closeConfirm = () => {
    setConfirm(null);
    focusHistory.current = true;
  };
  const owner = context.role === "owner";

  /** The ledger refreshes in place; an answer sent before the answer to the owner's latest History action is discarded. */
  const load = async () => {
    const sent = actions.now();
    try {
      const [history, named] = await Promise.all([
        get<{ entries: Entry[] }>(`${context.base}/history`),
        get<{ labels: Label[] }>(`${context.base}/labels`),
      ]);
      if (!actions.current(sent)) return;
      if (history.ok) setEntries(history.data.entries);
      if (named.ok) setLabels(named.data.labels);
    } catch {
      /* keep what is shown */
    }
  };
  useLayoutEffect(() => {
    void load();
  }, [context.projectRevision]);
  useLayoutEffect(() => {
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, []);

  useLayoutEffect(() => {
    if (focusHistory.current) {
      focusHistory.current = false;
      const history = table.current?.closest<HTMLElement>('[role="dialog"]');
      if (history && !history.contains(document.activeElement)) history.focus();
    }
    const revision = focusRevision.current;
    const header = revision === null ? null : table.current?.querySelector<HTMLElement>(`th[data-revision="${revision}"]`);
    if (header) {
      focusRevision.current = null;
      header.focus();
    }
  });

  const label = async (event: Event) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    context.say("Labelling…");
    // The label lands on the newest revision the owner sees at the top of the ledger.
    const newest = entries?.[0]?.projectRevision;
    const body = newest === undefined ? { name } : { name, projectRevision: newest };
    const answer = await context.act(() => post<{ label: Label }>(`${context.base}/labels`, body));
    setPending(false);
    if (!answer) return context.say(SOMETHING_WRONG);
    if (answer.ok) {
      setError(null);
      setName("");
      field.current?.focus();
      context.say(`Labelled r${answer.data.label.projectRevision} as ${answer.data.label.name}`);
      void load();
      return;
    }
    if (answer.status === 409) setError("That label is already used in this project.");
    else if (answer.status === 422) setError(looksUnstorable(name) ? UNSTORABLE_FIELD : "Enter a label of 1 to 60 characters.");
    else {
      if (answer.status >= 500) context.say(SOMETHING_WRONG);
      return;
    }
    context.say("");
    field.current?.focus();
  };

  const restore = async (chosen: Label) => {
    if (restoring) return;
    setRestoring(true);
    context.say(`Restoring ${chosen.name}…`);
    const answer = await context.act(() => post<{ projectRevision: number; entry: Entry }>(`${context.base}/labels/${chosen.id}/restore`));
    setRestoring(false);
    if (!answer) return context.say(SOMETHING_WRONG);
    if (answer.ok) {
      setConfirm(null);
      context.say(`Restored ${chosen.name} as r${answer.data.projectRevision}`);
      focusRevision.current = answer.data.projectRevision;
      await load();
      return;
    }
    if (answer.status === 403) return;
    if (answer.status >= 500) context.say(SOMETHING_WRONG);
  };

  const labelsAt = (revision: number) => labels.filter((item) => item.projectRevision === revision);

  return (
    <Dialog title="History" onClose={props.onClose} wide tall initial={owner ? "#label-name" : "table"}>
      {owner ? (
        <form class="label-form" onSubmit={label} noValidate>
          <Field id="label-name" label="Label name" error={error}>
            {(described) => (
              <input ref={field} id="label-name" type="text" value={name} aria-describedby={described}
                aria-invalid={error ? "true" : undefined} onInput={(e) => setName(e.currentTarget.value)} />
            )}
          </Field>
          <button type="submit" class="primary" disabled={pending} aria-busy={pending ? "true" : undefined}>
            Label current revision
          </button>
        </form>
      ) : null}
      <div class="ledger-wrap">
        <table ref={table} class="ledger" aria-label="Revisions" tabIndex={-1}>
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
            {(entries ?? []).map((entry) => (
              <tr key={entry.projectRevision}>
                <th scope="row" class="mono rev" tabIndex={-1} data-revision={entry.projectRevision}>r{entry.projectRevision}</th>{" "}
                <td><time dateTime={entry.at}>{formatWhen(entry.at)}</time></td>{" "}
                <td>{entry.actor.displayName}</td>{" "}
                <td>{entry.summary}</td>{" "}
                <td>
                  {labelsAt(entry.projectRevision).map((item) => (
                    <span class="label-chip" key={item.id}>
                      <span class="label-name">{item.name}</span>
                      {owner ? (
                        <button type="button" class="small" onClick={() => setConfirm(item)}>
                          Restore <span class="visually-hidden">{item.name}</span>
                        </button>
                      ) : null}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries === null ? <p class="muted">Loading the ledger…</p> : null}
      </div>
      {confirm ? (
        <Dialog title={`Restore ${confirm.name}?`} role="alertdialog" initial="#restore-cancel"
          onClose={closeConfirm}>
          <p>This adds a new revision whose files match {confirm.name} exactly. Nothing in the ledger is erased.</p>
          <div class="dialog-actions">
            <button id="restore-cancel" type="button" onClick={closeConfirm}>
              Cancel
            </button>
            <button type="button" class="primary" disabled={restoring} aria-busy={restoring ? "true" : undefined}
              onClick={() => void restore(confirm)}>
              Restore
            </button>
          </div>
        </Dialog>
      ) : null}
    </Dialog>
  );
}
