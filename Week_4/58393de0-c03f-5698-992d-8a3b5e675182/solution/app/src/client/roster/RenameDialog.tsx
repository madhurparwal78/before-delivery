import { useState, type FormEvent } from "react";
import type { RosterStudent } from "../../shared/types";
import { Field } from "../forms/Field";
import { ApiError } from "../lib/api";
import { useStatus } from "../lib/status";
import { Dialog } from "../ui/Dialog";

interface RenameDialogProps {
  open: boolean;
  student: RosterStudent;
  /** Renames and closes the dialog; throws the API error when the nickname is refused. */
  onSave: (nickname: string) => Promise<void>;
  onCancel: () => void;
  /** Where focus goes when the dialog closes; the opener when this returns null. */
  returnFocus: () => HTMLElement | null;
}

function RenameForm({ student, onSave, onCancel }: Pick<RenameDialogProps, "student" | "onSave" | "onCancel">) {
  const { announce } = useStatus();
  const [nickname, setNickname] = useState(student.nickname);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await onSave(nickname);
    } catch (failure) {
      const message = failure instanceof ApiError ? (failure.fields.nickname ?? failure.message) : undefined;
      if (message) {
        setError(message);
        announce(message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <Field label="Nickname" error={error}>
        {(control) => (
          <input
            {...control}
            type="text"
            value={nickname}
            autoComplete="off"
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setNickname(event.currentTarget.value)}
          />
        )}
      </Field>
      <div className="dialog-actions">
        <button type="submit" className="pill">Save nickname</button>
        <button type="button" className="pill pill--outline" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export function RenameDialog({ open, student, onSave, onCancel, returnFocus }: RenameDialogProps) {
  return (
    <Dialog open={open} title={`Rename ${student.nickname}`} onClose={onCancel} returnFocus={returnFocus}>
      <RenameForm student={student} onSave={onSave} onCancel={onCancel} />
    </Dialog>
  );
}
