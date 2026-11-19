import { useId, useState, type FormEvent } from "react";
import type { Value } from "../../../shared/expression.js";
import { PRIORITY_LABELS } from "../../../shared/fields.js";
import { ApiFailure, failureText, post } from "../../lib/api.js";
import { Modal } from "../../lib/dialog.js";
import { Button } from "../../lib/ui.js";
import type { Conflict, Detail } from "./model.js";

export type Verdict = "mine" | "theirs";

/** The `Field conflict` dialog: per stale field, keep my value or take theirs, then resend. */
export function ConflictDialog({
  conflicts,
  describe,
  onApply,
  onCancel,
}: {
  conflicts: Conflict[];
  describe(field: string, value: Value): string;
  onApply(choices: Record<string, Verdict>): void;
  onCancel: () => void;
}): JSX.Element {
  const [choices, setChoices] = useState<Record<string, Verdict>>(() => Object.fromEntries(conflicts.map((c) => [c.field, "mine" as Verdict])));
  const prefix = useId();
  return (
    <Modal label="Field conflict" onClose={onCancel} className="rf-dialog">
      <h3>Field conflict</h3>
      <p>Someone saved a newer value. Choose which value to keep for each field.</p>
      {conflicts.map((conflict) => (
        <div key={conflict.field} className="rf-conflict">
          <h4 id={`${prefix}-${conflict.field}`}>{conflict.label}</h4>
          <p>Yours: {describe(conflict.field, conflict.yours)}</p>
          <p>
            Theirs: {describe(conflict.field, conflict.theirs)}, saved by {conflict.theirs_by}
          </p>
          <div role="radiogroup" aria-labelledby={`${prefix}-${conflict.field}`} className="rf-radios">
            {(["mine", "theirs"] as const).map((choice) => (
              <label key={choice} className="rf-radio">
                <input type="radio" name={`${prefix}-${conflict.field}`} checked={choices[conflict.field] === choice} onChange={() => setChoices({ ...choices, [conflict.field]: choice })} />
                <span>{choice === "mine" ? "Keep mine" : "Use theirs"}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
      <div className="row">
        <Button onClick={() => onApply(choices)}>Apply choices</Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}

/** The `Override priority` dialog: a priority and a reason, sent to the override endpoint. */
export function OverrideDialog({ number, priority, onDone, onClose }: { number: string; priority: number; onDone(record: Detail): void; onClose: () => void }): JSX.Element {
  const [chosen, setChosen] = useState(priority);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const prefix = useId();

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setBusy(true);
    post<{ record: Detail }>(`/api/records/${number}/priority-override`, { priority: chosen, reason }).then(
      (response) => onDone(response.record),
      (error: unknown) => {
        setBusy(false);
        setErrors(error instanceof ApiFailure && error.fields ? error.fields : {});
        setMessage(error instanceof ApiFailure && error.fields ? "" : failureText(error));
      },
    );
  };

  return (
    <Modal label="Override priority" onClose={onClose} className="rf-dialog">
      <h3>Override priority</h3>
      <form className="stack" onSubmit={submit}>
        <div className="rf-field">
          <label htmlFor={`${prefix}-priority`}>Priority</label>
          <select id={`${prefix}-priority`} value={chosen} onChange={(event) => setChosen(Number(event.target.value))}>
            {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {value} {label}
              </option>
            ))}
          </select>
          {errors.priority ? <p className="field-error">{errors.priority}</p> : null}
        </div>
        <div className="rf-field">
          <label htmlFor={`${prefix}-reason`}>Reason</label>
          <input id={`${prefix}-reason`} type="text" value={reason} maxLength={500} aria-invalid={errors.reason ? true : undefined} onChange={(event) => setReason(event.target.value)} />
          {errors.reason ? <p className="field-error">{errors.reason}</p> : null}
        </div>
        {message ? <p className="form-error">{message}</p> : null}
        <div className="row">
          <button type="submit" className="btn btn-solid" aria-busy={busy || undefined} disabled={busy}>
            Override
          </button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
