import { useState } from "react";
import { formatLong } from "../../shared/calendar";
import { Dialog } from "../components/dialog";
import type { ProjectSession, SessionState } from "../store";

interface Props {
  session: ProjectSession;
  state: SessionState;
  returnTo: () => HTMLElement | null;
  onClose: () => void;
}

export function Holidays({ session, state, returnTo, onClose }: Props) {
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [alertText, setAlertText] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    setAlertText("");
    const outcome = await session.addHoliday(date.trim(), name.trim());
    setBusy(false);
    if (outcome.ok) {
      setDate("");
      setName("");
    } else setAlertText(outcome.message);
  };

  const remove = async (day: string, holiday: string) => {
    setBusy(true);
    setAlertText("");
    const outcome = await session.removeHoliday(day, holiday);
    setBusy(false);
    if (!outcome.ok) setAlertText(outcome.message);
  };

  return (
    <Dialog label="Holidays" className="narrow" onClose={onClose} returnTo={returnTo}>
      <h2>Holidays</h2>
      <ul aria-label="Holidays" className="holiday-list">
        {(state.project?.holidays ?? []).map((holiday) => (
          <li key={holiday.date}>
            <span>
              {formatLong(holiday.date)} {holiday.name}
            </span>
            <button type="button" aria-label={`Remove ${holiday.name}`} disabled={busy} onClick={() => void remove(holiday.date, holiday.name)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="fields">
        <label>
          <span>Date</span>
          <input type="text" value={date} placeholder="YYYY-MM-DD" data-autofocus="" onChange={(event) => setDate(event.target.value)} />
        </label>
        <label>
          <span>Holiday name</span>
          <input type="text" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
      </div>
      <div role="alert" className="dialog-alert">
        {alertText}
      </div>
      <div className="dialog-actions">
        <button type="button" className="primary" disabled={busy} onClick={() => void add()}>
          Add holiday
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
