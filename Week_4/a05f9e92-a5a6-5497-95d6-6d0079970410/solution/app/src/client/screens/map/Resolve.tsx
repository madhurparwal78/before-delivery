import { useState, type FormEvent } from "react";
import type { RecordJson } from "../../../server/records.js";
import { RESOLUTION_CODES } from "../../../shared/fields.js";
import { ApiFailure, failureText, post } from "../../lib/api.js";
import { useAnnounce } from "../../lib/announce.js";
import { Modal } from "../../lib/dialog.js";
import { Button, Field } from "../../lib/ui.js";
import { sentence } from "./mapData.js";

export function ResolveDialog({ number, onClose, onDone }: { number: string; onClose: () => void; onDone: () => void }): JSX.Element {
  const announce = useAnnounce();
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    setProblems({});
    post<{ record: RecordJson }>(`/api/records/${encodeURIComponent(number)}/transition`, {
      to: "resolved",
      fields: { resolution_code: { value: code === "" ? null : code }, resolution_note: { value: note } },
    }).then(
      (answer) => {
        announce(`${number} moved to ${answer.record.state_label}.`);
        onDone();
      },
      (error: unknown) => {
        setProblems(error instanceof ApiFailure ? (error.fields ?? {}) : {});
        setMessage(failureText(error));
        setBusy(false);
      },
    );
  };

  return (
    <Modal label="Resolve together" onClose={onClose} className="map-dialog">
      <div className="dialog-head">
        <h2>Resolve together</h2>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </div>
      <form className="stack" onSubmit={submit} noValidate>
        <p>Resolving {number} resolves every open child incident with the same code and note.</p>
        <Field label="Resolution code" error={problems.resolution_code}>
          <select value={code} onChange={(event) => setCode(event.target.value)}>
            <option value="">Choose a code</option>
            {RESOLUTION_CODES.map((value) => (
              <option key={value} value={value}>
                {sentence(value)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Resolution note" error={problems.resolution_note}>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
        {message ? <p className="form-error">{message}</p> : null}
        <div className="row">
          <Button type="submit" busy={busy}>
            {busy ? "Moving..." : "Resolve"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
