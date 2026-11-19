import { useState, type FormEvent } from "react";
import { useAction } from "../lib/useAction";
import { Status } from "./Bits";
import { Dialog, type DialogHandle } from "./Dialog";

/** The Schedule gathering dialog, the same control on a community page and in a community room. */
export function ScheduleDialog({
  communityId,
  handle,
  action,
  onScheduled,
}: {
  communityId: string;
  handle: DialogHandle;
  action: ReturnType<typeof useAction>;
  onScheduled?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [starts, setStarts] = useState("");
  const [duration, setDuration] = useState("60");
  const [repeats, setRepeats] = useState("none");
  const [limit, setLimit] = useState("20");
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const body = { title, startsLocal: starts, durationMinutes: Number(duration), recurrence: repeats, limit: Number(limit) };
    const reply = await action.run("POST", `/api/communities/${communityId}/gatherings`, body, () => "Gathering scheduled.");
    if (reply.ok) {
      handle.hide();
      onScheduled?.();
    }
  };
  return (
    <Dialog label="Schedule gathering" handle={handle}>
      <h2>Schedule gathering</h2>
      <form onSubmit={submit} className="stack">
        <label className="field">
          <span>Title</span>
          <input type="text" value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="field">
          <span>Starts</span>
          <input type="text" aria-label="Starts" inputMode="numeric" placeholder="2027-03-07T19:00" value={starts} onChange={(event) => setStarts(event.target.value)} />
          <small className="hint">Local time in the community's zone, like 2027-03-07T19:00.</small>
        </label>
        <label className="field">
          <span>Duration in minutes</span>
          <input type="number" value={duration} onChange={(event) => setDuration(event.target.value)} />
        </label>
        <label className="field">
          <span>Repeats</span>
          <select value={repeats} onChange={(event) => setRepeats(event.target.value)}>
            <option value="none">none</option>
            <option value="weekly">weekly</option>
          </select>
        </label>
        <label className="field">
          <span>Limit</span>
          <input type="number" value={limit} onChange={(event) => setLimit(event.target.value)} />
        </label>
        <div className="row">
          <button type="submit" className="button primary" disabled={action.busy} aria-busy={action.busy}>
            Save gathering
          </button>
          <button type="button" className="button" onClick={handle.hide}>
            Cancel
          </button>
        </div>
        <Status name="Gathering result" result={action.result} />
      </form>
    </Dialog>
  );
}

