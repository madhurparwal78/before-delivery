import { useId, useState, type FormEvent } from "react";
import type { Rotation } from "../../../server/oncall.js";
import { ApiFailure, failureText, post } from "../../lib/api.js";
import { Modal } from "../../lib/dialog.js";
import { Button } from "../../lib/ui.js";
import { localTextToIso } from "../../../shared/tz.js";

export interface Person {
  username: string;
  display_name: string;
  active: boolean;
}

/** `dialog "Add override"`: one person covers a rotation for a period typed in the rotation's own time zone. */
export function OverrideDialog({ rotations, people, onClose, onSaved }: { rotations: Rotation[]; people: Person[]; onClose(): void; onSaved(): void }): JSX.Element {
  const ids = { rotation: useId(), person: useId(), start: useId(), end: useId() };
  const [rotation, setRotation] = useState(rotations[0]?.name ?? "");
  const [person, setPerson] = useState(people[0]?.username ?? "");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const zone = rotations.find((entry) => entry.name === rotation)?.time_zone ?? "UTC";

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const found: Record<string, string> = {};
    const from = localTextToIso(start, zone);
    const to = localTextToIso(end, zone);
    if (!from) found.start = "Type the start as YYYY-MM-DD HH:mm.";
    if (!to) found.end = "Type the end as YYYY-MM-DD HH:mm.";
    setErrors(found);
    setMessage("");
    if (!from || !to) return;
    setSaving(true);
    try {
      await post(`/api/rotations/${encodeURIComponent(rotation)}/overrides`, { username: person, start: from, end: to });
      onSaved();
      onClose();
    } catch (error) {
      setMessage(failureText(error));
      setErrors(error instanceof ApiFailure ? (error.fields ?? {}) : {});
      setSaving(false);
    }
  };

  return (
    <Modal label="Add override" onClose={onClose}>
      <form className="stack" onSubmit={(event) => void submit(event)} noValidate>
        <div className="field">
          <label htmlFor={ids.rotation} className="field-label">
            Rotation
          </label>
          <select id={ids.rotation} value={rotation} onChange={(event) => setRotation(event.target.value)}>
            {rotations.map((entry) => (
              <option key={entry.name} value={entry.name}>
                {entry.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.person} className="field-label">
            Person
          </label>
          <select id={ids.person} value={person} onChange={(event) => setPerson(event.target.value)}>
            {people.map((entry) => (
              <option key={entry.username} value={entry.username}>
                {entry.display_name}
              </option>
            ))}
          </select>
          {errors.username ? <p className="field-error">{errors.username}</p> : null}
        </div>
        <div className="field">
          <label htmlFor={ids.start} className="field-label">
            Start
          </label>
          <input id={ids.start} type="text" value={start} placeholder="YYYY-MM-DD HH:mm" autoComplete="off" onChange={(event) => setStart(event.target.value)} />
          {errors.start ? <p className="field-error">{errors.start}</p> : null}
        </div>
        <div className="field">
          <label htmlFor={ids.end} className="field-label">
            End
          </label>
          <input id={ids.end} type="text" value={end} placeholder="YYYY-MM-DD HH:mm" autoComplete="off" onChange={(event) => setEnd(event.target.value)} />
          {errors.end ? <p className="field-error">{errors.end}</p> : null}
        </div>
        <p className="muted">Times are read in {zone}.</p>
        {message ? <p className="form-error">{message}</p> : null}
        <div className="row">
          <Button type="submit" busy={saving} disabled={saving}>
            Save override
          </Button>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </form>
    </Modal>
  );
}
