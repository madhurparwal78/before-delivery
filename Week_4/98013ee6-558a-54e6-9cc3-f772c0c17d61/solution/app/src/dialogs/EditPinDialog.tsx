import { useState, type FormEvent } from "react";
import { codePoints } from "../../shared/text";
import { api, ApiFailure, GENERIC_ERROR } from "../lib/api";
import { FIELD_ERRORS } from "../lib/fieldErrors";
import { announce } from "../lib/feedback";
import { reportOperation } from "../lib/operations";
import { useSession } from "../session";
import { Button } from "../ui/Button";
import { Counter } from "../ui/Counter";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { InlineAlert } from "../ui/InlineAlert";
import type { OperationView, Pin } from "../../shared/types";

interface Draft {
  title: string;
  description: string;
  alt: string;
  source: string;
}

const draftOf = (pin: Pin): Draft => ({ title: pin.title, description: pin.description, alt: pin.alt, source: pin.source ?? "" });

export function EditPinDialog({ pin, onClose, onSaved, onGone }: { pin: Pin; onClose: () => void; onSaved: (pin: Pin) => void; onGone: () => void }) {
  const { config } = useSession();
  const [draft, setDraft] = useState<Draft>(draftOf(pin));
  const [version, setVersion] = useState(pin.version);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const set = (key: keyof Draft, value: string): void => setDraft((held) => ({ ...held, [key]: value }));
  const overLimit = codePoints(draft.title) > config.limits.title_max || codePoints(draft.description) > config.limits.description_max;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy("save");
    setErrors({});
    setConflict(false);
    setFailure(null);
    try {
      const saved = await api.patch<Pin>(`/api/pins/${pin.id}`, { version, title: draft.title, description: draft.description, alt: draft.alt, source: draft.source });
      announce("Pin updated");
      onSaved(saved);
      onClose();
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "version_conflict") setConflict(true);
      else if (error instanceof ApiFailure && error.field && FIELD_ERRORS[error.field]) setErrors({ [error.field]: FIELD_ERRORS[error.field] ?? GENERIC_ERROR });
      else setFailure(GENERIC_ERROR);
      setBusy(null);
    }
  };

  const loadLatest = async (): Promise<void> => {
    const latest = await api.get<Pin>(`/api/pins/${pin.id}`);
    setDraft(draftOf(latest));
    setVersion(latest.version);
    setConflict(false);
    onSaved(latest);
  };

  const remove = async (): Promise<void> => {
    setBusy("delete");
    try {
      const operation = await api.delete<OperationView>(`/api/pins/${pin.id}`);
      reportOperation(operation, "1 pin deleted");
      onGone();
      onClose();
    } catch {
      setFailure(GENERIC_ERROR);
      setBusy(null);
    }
  };

  return (
    <Dialog title="Edit pin" onClose={onClose}>
      <form className="stack" onSubmit={(event) => void submit(event)}>
        {conflict ? (
          <InlineAlert>
            <p>This pin was changed somewhere else.</p>
            <Button onClick={() => void loadLatest()}>Load latest</Button>
          </InlineAlert>
        ) : null}
        {failure ? <InlineAlert>{failure}</InlineAlert> : null}
        <Field label="Title" error={errors["title"]} counter={<Counter value={draft.title} max={config.limits.title_max} />}>
          {(props) => <input {...props} type="text" value={draft.title} data-autofocus onChange={(event) => set("title", event.target.value)} />}
        </Field>
        <Field label="Description" counter={<Counter value={draft.description} max={config.limits.description_max} />}>
          {(props) => <textarea {...props} rows={3} value={draft.description} onChange={(event) => set("description", event.target.value)} />}
        </Field>
        <Field label="Alt text" error={errors["alt"]}>
          {(props) => <textarea {...props} rows={2} value={draft.alt} onChange={(event) => set("alt", event.target.value)} />}
        </Field>
        <Field label="Source link" error={errors["source"]}>
          {(props) => <input {...props} type="text" inputMode="url" value={draft.source} onChange={(event) => set("source", event.target.value)} />}
        </Field>
        <div className="actions actions--split">
          <Button variant="danger" busy={busy === "delete"} busyLabel="Deleting" disabled={busy !== null} onClick={() => void remove()}>
            Delete pin
          </Button>
          <Button variant="primary" type="submit" busy={busy === "save"} busyLabel="Saving" disabled={overLimit || busy !== null}>
            Save changes
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
