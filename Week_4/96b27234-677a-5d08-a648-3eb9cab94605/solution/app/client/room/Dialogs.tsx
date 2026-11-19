import { useEffect, useState, type FormEvent } from "react";
import { CATEGORIES, type PersonView, type Relations, type VoteFrame } from "../../shared/protocol";
import { call } from "../lib/api";
import { useAction } from "../lib/useAction";
import { Status } from "../ui/Bits";
import { Dialog, type DialogHandle } from "../ui/Dialog";

interface ActionsProps {
  handle: DialogHandle;
  person: PersonView | null;
  selfId: string;
  relations: Relations;
  sessionId: string;
  safety: ReturnType<typeof useAction>;
  onReport: () => void;
  onRelation: (kind: "blocked" | "muted", id: string, on: boolean) => void;
  onVoteRefused: (text: string) => void;
}

/** What one person can do about another: block, mute, start a removal vote or report. */
export function ActionsDialog({ handle, person, selfId, relations, sessionId, safety, onReport, onRelation, onVoteRefused }: ActionsProps) {
  if (!person) return null;
  const mine = person.personId === selfId;
  const blocked = relations.blocked.includes(person.personId);
  const muted = relations.muted.includes(person.personId);
  const toggle = async (kind: "blocked" | "muted", on: boolean): Promise<void> => {
    const path = `/api/${kind === "blocked" ? "blocks" : "mutes"}/${person.personId}`;
    const words = kind === "blocked" ? (on ? "Blocked." : "Unblocked.") : on ? "Muted." : "Unmuted.";
    const reply = await safety.run(on ? "POST" : "DELETE", path, undefined, () => words);
    if (reply.ok) onRelation(kind, person.personId, on);
  };
  const startVote = async (): Promise<void> => {
    const reply = await call("POST", `/api/sessions/${sessionId}/votes`, { personId: person.personId });
    if (reply.ok) handle.hide();
    else onVoteRefused(reply.error);
  };
  return (
    <Dialog label="Person actions" handle={handle}>
      <h2>{mine ? "That is you" : `Actions for ${person.displayName}`}</h2>
      {mine ? null : (
        <div className="stack">
          <button type="button" className="button danger" onClick={() => void toggle("blocked", !blocked)}>
            {blocked ? "Unblock" : "Block"}
          </button>
          <button type="button" className="button danger" onClick={() => void toggle("muted", !muted)}>
            {muted ? "Unmute" : "Mute"}
          </button>
          <button type="button" className="button danger" onClick={() => void startVote()}>
            Start removal vote
          </button>
          <button type="button" className="button danger" onClick={onReport}>
            Report
          </button>
        </div>
      )}
      <div className="row">
        <button type="button" className="button" onClick={handle.hide}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

/** A report: never shows who sends it. The dialog stays open so its result stays readable. */
export function ReportDialog({ handle, person, sessionId }: { handle: DialogHandle; person: PersonView | null; sessionId: string }) {
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [details, setDetails] = useState("");
  const action = useAction("Sending...");
  useEffect(() => {
    if (handle.open) action.setResult({ text: "", kind: "idle" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle.open]);
  if (!person) return null;
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    await action.run("POST", "/api/reports", { personId: person.personId, sessionId, category, details }, () => "Report sent.");
  };
  return (
    <Dialog label="Report someone" handle={handle}>
      <h2>Report someone</h2>
      <form onSubmit={submit} className="stack">
        <label className="field">
          <span>Category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {CATEGORIES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Details</span>
          <textarea rows={4} value={details} onChange={(event) => setDetails(event.target.value)} />
        </label>
        <div className="row">
          <button type="submit" className="button danger" disabled={action.busy} aria-busy={action.busy}>
            Send report
          </button>
          <button type="button" className="button" onClick={handle.hide}>
            Cancel
          </button>
        </div>
        <Status name="Report result" result={action.result} />
      </form>
    </Dialog>
  );
}

/** A removal vote as the room sees it: the question, the counts and the person's own ballot buttons. */
export function VotePanel({ vote, name, sessionId }: { vote: VoteFrame; name: string; sessionId: string }) {
  const action = useAction("Saving...");
  const cast = (choice: "yes" | "no"): Promise<unknown> => action.run("POST", `/api/sessions/${sessionId}/votes/${vote.id}/ballots`, { choice }, () => "Vote counted.");
  return (
    <section role="region" aria-label="Removal vote" data-vote-status={vote.status} className="panel vote">
      <h2>Vote on removing {name}.</h2>
      <p className="muted">
        {vote.yes} yes, {vote.no} no. {vote.needed} yes votes needed out of {vote.eligible} eligible. The vote is {vote.status}.
      </p>
      {vote.canVote ? (
        <div className="row">
          <button type="button" className="button danger" onClick={() => void cast("yes")}>
            Vote yes
          </button>
          <button type="button" className="button" onClick={() => void cast("no")}>
            Vote no
          </button>
        </div>
      ) : null}
      <Status name="Vote result" result={action.result} />
    </section>
  );
}

