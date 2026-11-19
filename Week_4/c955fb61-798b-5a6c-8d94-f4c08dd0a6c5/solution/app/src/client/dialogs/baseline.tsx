import { useState } from "react";
import { Dialog } from "../components/dialog";
import type { ProjectSession, SessionState } from "../store";

interface Props {
  session: ProjectSession;
  state: SessionState;
  returnTo: () => HTMLElement | null;
  onClose: () => void;
}

export function SaveBaseline({ session, state, returnTo, onClose }: Props) {
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);
  const [alertText, setAlertText] = useState("");
  const [busy, setBusy] = useState(false);
  const [existing] = useState(state.project?.baseline?.name ?? null);

  const save = async () => {
    setBusy(true);
    setAlertText("");
    const outcome = await session.saveBaseline(name.trim(), existing !== null);
    setBusy(false);
    if (outcome.ok) setSaved(true);
    else setAlertText(outcome.message);
  };

  return (
    <Dialog label="Save baseline" className="narrow" onClose={onClose} returnTo={returnTo}>
      {saved ? (
        <>
          <div className="baseline-set">
            <h2>Baseline set</h2>
            <p>Every date and the finish are stored as the plan to measure against.</p>
          </div>
          <div className="dialog-actions">
            <button type="button" autoFocus onClick={onClose}>
              Back to plan
            </button>
          </div>
        </>
      ) : (
        <>
          <h2>Save baseline</h2>
          <div className="fields">
            <label>
              <span>Baseline name</span>
              <input type="text" value={name} data-autofocus="" onChange={(event) => setName(event.target.value)} />
            </label>
          </div>
          {existing !== null ? <p>This replaces the baseline {existing}.</p> : null}
          <div role="alert" className="dialog-alert">
            {alertText}
          </div>
          <div className="dialog-actions">
            <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
              Save baseline
            </button>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
