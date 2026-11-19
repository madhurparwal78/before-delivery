import { useState } from "react";
import { LINK_TYPE_WORDS, LINK_TYPES, type Item, type LinkType } from "../../shared/types";
import { Combobox } from "../components/combobox";
import { Dialog } from "../components/dialog";
import type { ProjectSession, SessionState } from "../store";

interface Props {
  session: ProjectSession;
  state: SessionState;
  from: Item;
  returnTo: () => HTMLElement | null;
  onClose: () => void;
}

export function AddLink({ session, state, from, returnTo, onClose }: Props) {
  const [successor, setSuccessor] = useState<string | null>(null);
  const [type, setType] = useState<LinkType>("FS");
  const [lag, setLag] = useState("0");
  const [alertText, setAlertText] = useState("");
  const [busy, setBusy] = useState(false);
  const choices = (state.project?.items ?? [])
    .filter((item) => item.kind !== "group" && item.id !== from.id)
    .map((item) => ({ value: item.id, label: `${item.row} ${item.name}` }));

  const add = async () => {
    setBusy(true);
    setAlertText("");
    const outcome = await session.addLink(from, successor ?? "", type, lag.trim() === "" ? Number.NaN : Number(lag));
    setBusy(false);
    if (outcome.ok) onClose();
    else setAlertText(outcome.message);
  };

  return (
    <Dialog label="Add link" className="narrow" onClose={onClose} returnTo={returnTo}>
      <h2>Link from {from.name}</h2>
      <div className="fields">
        <div className="field">
          <span aria-hidden="true">Successor</span>
          <Combobox label="Successor" choices={choices} selected={successor} onSelect={setSuccessor} autoFocus />
        </div>
        <div role="radiogroup" aria-label="Link type" className="radios">
          {LINK_TYPES.map((kind) => (
            <label key={kind} className="radio">
              <input type="radio" name="link-type" checked={type === kind} onChange={() => setType(kind)} />
              <span>{LINK_TYPE_WORDS[kind].replace(/^./, (letter) => letter.toUpperCase())}</span>
            </label>
          ))}
        </div>
        <label>
          <span>Lag in working days</span>
          <input type="number" min={-30} max={30} step={1} value={lag} onChange={(event) => setLag(event.target.value)} />
        </label>
      </div>
      <div role="alert" className="dialog-alert">
        {alertText}
      </div>
      <div className="dialog-actions">
        <button type="button" className="primary" disabled={busy} onClick={() => void add()}>
          Add link
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
