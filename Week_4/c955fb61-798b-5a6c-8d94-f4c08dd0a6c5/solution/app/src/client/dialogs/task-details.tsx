import { useEffect, useMemo, useState } from "react";
import { mondayOf } from "../../shared/calendar";
import { formatHours } from "../../shared/format";
import type { Comment, Item } from "../../shared/types";
import { call } from "../api";
import { Combobox } from "../components/combobox";
import { Dialog } from "../components/dialog";
import { moveSentence, percentSentence, resizeSentence, savedSentence } from "../messages";
import type { PatchResult, ProjectSession, SessionState } from "../store";

interface Props {
  session: ProjectSession;
  state: SessionState;
  itemId: string;
  returnTo: () => HTMLElement | null;
  onClose: (focusItemId?: string) => void;
}

const wholeOrNull = (text: string): number | null => (text.trim() === "" ? null : Number(text));

/** The item as the person last saw it: pushed changes redraw the chart behind this dialog but never touch these fields. */
export function TaskDetails({ session, state, itemId, returnTo, onClose }: Props) {
  const opened = useMemo(() => state.project?.items.find((candidate) => candidate.id === itemId), []);
  const [item, setItem] = useState<Item | undefined>(opened);
  const [name, setName] = useState(opened?.name ?? "");
  const [start, setStart] = useState(opened?.chosenStart ?? "");
  const [duration, setDuration] = useState(String(opened?.duration ?? ""));
  const [percent, setPercent] = useState(String(opened?.percent ?? ""));
  const [version, setVersion] = useState(opened?.version ?? 0);
  const [assignees, setAssignees] = useState(opened?.assignees ?? []);
  const [alertText, setAlertText] = useState("");
  const [invalid, setInvalid] = useState("");
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState("");
  const [people, setPeople] = useState<{ userId: string; name: string }[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [hours, setHours] = useState("8");
  const [busy, setBusy] = useState(false);
  const readOnly = session.readOnly;

  useEffect(() => {
    void call<{ comments: Comment[] }>("GET", `/api/items/${itemId}/comments`).then((result) => {
      setComments((known) => [...result.body.comments, ...known.filter((entry) => !result.body.comments.some((listed) => listed.id === entry.id))]);
    });
    return session.onComment((commentItemId, comment) => {
      if (commentItemId === itemId) setComments((known) => (known.some((entry) => entry.id === comment.id) ? known : [...known, comment]));
    });
  }, [itemId]);

  useEffect(() => {
    if (!item || item.kind !== "task" || readOnly || !state.workspaceId) return;
    call<{ people: { userId: string; name: string }[] }>("GET", `/api/workspaces/${state.workspaceId}/workload?from=${mondayOf(session.config.today)}`)
      .then((result) => setPeople(result.body.people.map((person) => ({ userId: person.userId, name: person.name }))))
      .catch(() => setPeople([]));
  }, [state.workspaceId]);

  if (!item) return null;

  const adopt = (current: Item) => {
    setItem(current);
    setName(current.name);
    setStart(current.chosenStart ?? "");
    setDuration(String(current.duration));
    setPercent(String(current.percent));
    setVersion(current.version);
    setAssignees(current.assignees);
  };

  const sentenceFor = (result: PatchResult): string => {
    const startChanged = start !== (opened?.chosenStart ?? "");
    const durationChanged = duration !== String(opened?.duration);
    if (startChanged && result.constraint) return moveSentence(result, result.constraint.predecessor);
    if (durationChanged && result.item.kind === "task") return resizeSentence(result);
    if (startChanged || durationChanged) return moveSentence(result, null);
    if (percent !== String(opened?.percent)) return percentSentence(result.item);
    return savedSentence(result.item);
  };

  const save = async () => {
    setBusy(true);
    setAlertText("");
    setInvalid("");
    const fields = item.kind === "group" ? { name } : { name, start, duration: wholeOrNull(duration), percent: wholeOrNull(percent) };
    const outcome = await session.saveDetails(item, version, fields, sentenceFor);
    setBusy(false);
    if (outcome.ok) return onClose();
    setAlertText(milestonePercent(outcome, item, percent) ?? outcome.message);
    if (outcome.failure.status === 409) adopt((outcome.failure.body as { item: Item }).item);
    else setInvalid(String(outcome.failure.body.field ?? ""));
  };

  const remove = async () => {
    const order = state.project?.items.filter((candidate) => candidate.kind !== "group") ?? [];
    const at = order.findIndex((candidate) => candidate.id === item.id);
    const neighbour = order[at + 1] ?? order[at - 1];
    setBusy(true);
    const outcome = await session.deleteItem(item);
    setBusy(false);
    if (outcome.ok) onClose(neighbour?.id);
    else setAlertText(outcome.message);
  };

  const assign = async () => {
    const person = people.find((candidate) => candidate.userId === chosen);
    if (!person) return;
    setBusy(true);
    setAlertText("");
    const outcome = await session.assign(item, person, hoursNumber(hours));
    setBusy(false);
    if (outcome.ok) {
      setVersion(outcome.value.item.version);
      setAssignees(outcome.value.item.assignees);
      setChosen(null);
    } else setAlertText(outcome.message);
  };

  const unassign = async (assignee: { userId: string; name: string }) => {
    setBusy(true);
    const outcome = await session.unassign(item, assignee);
    setBusy(false);
    if (outcome.ok) {
      setVersion(outcome.value.item.version);
      setAssignees(outcome.value.item.assignees);
    } else setAlertText(outcome.message);
  };

  const post = async () => {
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    const outcome = await session.postComment(item, text);
    setBusy(false);
    if (outcome.ok) {
      setDraft("");
      setComments((known) => (known.some((entry) => entry.id === outcome.value.comment.id) ? known : [...known, outcome.value.comment]));
    } else setAlertText(outcome.message);
  };

  const isGroup = item.kind === "group";
  const candidates = people.filter((person) => !assignees.some((assignee) => assignee.userId === person.userId));

  return (
    <Dialog label="Task details" className="details" onClose={() => onClose()} returnTo={returnTo}>
      <h2>Task details</h2>
      <div className="fields">
        <label>
          <span>Name</span>
          <input type="text" value={name} readOnly={readOnly} aria-invalid={invalid === "name" ? "true" : undefined} data-autofocus="" onChange={(event) => setName(event.target.value)} />
        </label>
        {isGroup ? null : (
          <>
            <label>
              <span>Start</span>
              <input type="text" value={start} readOnly={readOnly} aria-invalid={invalid === "start" ? "true" : undefined} onChange={(event) => setStart(event.target.value)} />
            </label>
            <label>
              <span>Duration</span>
              <input type="number" value={duration} readOnly={readOnly} aria-invalid={invalid === "duration" ? "true" : undefined} onChange={(event) => setDuration(event.target.value)} />
            </label>
            <label>
              <span>Percent complete</span>
              <input type="number" value={percent} readOnly={readOnly} aria-invalid={invalid === "percent" ? "true" : undefined} onChange={(event) => setPercent(event.target.value)} />
            </label>
          </>
        )}
      </div>
      {item.kind === "task" ? (
        <section aria-label="Assignees" className="panel">
          <h3>Assignees</h3>
          <ul aria-label="Assignees">
            {assignees.map((assignee) => (
              <li key={assignee.userId}>
                <span>
                  {assignee.name}, {formatHours(assignee.hours)} hours a day
                </span>
                {readOnly ? null : (
                  <button type="button" aria-label={`Remove ${assignee.name}`} disabled={busy} onClick={() => void unassign(assignee)}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          {readOnly ? null : (
            <div className="assign-row">
              <Combobox label="Add person" choices={candidates.map((person) => ({ value: person.userId, label: person.name }))} selected={chosen} onSelect={setChosen} />
              <label>
                <span>Hours a day</span>
                <input type="number" step="0.5" value={hours} onChange={(event) => setHours(event.target.value)} />
              </label>
              <button type="button" disabled={busy} onClick={() => void assign()}>
                Assign
              </button>
            </div>
          )}
        </section>
      ) : null}
      <section aria-label="Comments" className="panel">
        <h3>Comments</h3>
        <ul aria-label="Comments">
          {comments.map((comment) => (
            <li key={comment.id} title={comment.createdAt}>
              {comment.author.name}: {comment.text}
            </li>
          ))}
        </ul>
        {readOnly ? null : (
          <>
            <label>
              <span>New comment</span>
              <textarea
                rows={2}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && event.ctrlKey) {
                    event.preventDefault();
                    void post();
                  }
                }}
              />
            </label>
            <button type="button" disabled={busy || draft.trim() === ""} onClick={() => void post()}>
              Post comment
            </button>
          </>
        )}
      </section>
      <div role="alert" className="dialog-alert">
        {alertText}
      </div>
      <div className="dialog-actions">
        {readOnly ? null : (
          <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
            Save task
          </button>
        )}
        {readOnly ? null : (
          <button type="button" disabled={busy} onClick={() => void remove()}>
            Delete task
          </button>
        )}
        <button type="button" onClick={() => onClose()}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

function hoursNumber(text: string): number {
  return text.trim() === "" ? Number.NaN : Number(text);
}

/** A milestone's percent is refused as 0 or 100 only; the server names the field, this words it. */
function milestonePercent(outcome: { ok: false; failure: { body: Record<string, unknown> } }, item: Item, percent: string): string | null {
  const whole = Number(percent);
  return outcome.failure.body.field === "percent" && item.kind === "milestone" && Number.isInteger(whole) && whole > 0 && whole < 100
    ? "A milestone is either 0% or 100% complete."
    : null;
}
