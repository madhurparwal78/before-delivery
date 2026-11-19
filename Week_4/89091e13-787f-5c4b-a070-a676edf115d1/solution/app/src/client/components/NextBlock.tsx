import { useEffect, useState } from "react";
import { NEXT_BLOCK_OPTIONS, type NextBlock } from "../../shared/api.ts";
import { api, ApiError } from "../lib/api.ts";
import { useWorkspace } from "../lib/workspace.tsx";
import { useRoleGate } from "./forms.tsx";

/** The owner's choice for the next produced block only; it is saved the moment it changes. */
export function NextBlockControl() {
  const { id, info } = useWorkspace();
  const gate = useRoleGate("producer");
  const [choice, setChoice] = useState<NextBlock | null>(null);
  const [status, setStatus] = useState("");
  const selected = choice ?? info.nextBlock;

  useEffect(() => {
    if (choice === info.nextBlock) setChoice(null);
  }, [choice, info.nextBlock]);

  const choose = async (option: (typeof NEXT_BLOCK_OPTIONS)[number]) => {
    setChoice(option.value);
    setStatus("Working…");
    try {
      await api("PUT", `/api/w/${id}/producer`, { nextBlock: option.value });
      setStatus(`Next block: ${option.label}.`);
    } catch (caught) {
      if (!(caught instanceof ApiError)) throw caught;
      setChoice(null);
      setStatus(caught.message);
    }
  };

  return (
    <div className="panel producer">
      {gate.note}
      <div role="radiogroup" aria-label="Next block" aria-describedby={gate.describedBy} className="choices">
        {NEXT_BLOCK_OPTIONS.map((option) => (
          <label key={option.value} className="choice">
            <input type="radio" name="nextBlock" value={option.value} checked={selected === option.value} disabled={gate.disabled}
              aria-describedby={gate.describedBy} onChange={() => void choose(option)} />
            <span className="choice__mark" aria-hidden="true" />
            {option.label}
          </label>
        ))}
      </div>
      <p role="status" aria-label="Producer status" className="form-status">{status}</p>
    </div>
  );
}
