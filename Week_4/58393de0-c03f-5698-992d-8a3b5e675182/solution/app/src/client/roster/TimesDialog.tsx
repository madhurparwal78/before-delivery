import { useState, type FormEvent } from "react";
import { formatLocalWire, parseLocalTime, wireToDisplay } from "../../shared/rules";
import type { Classroom } from "../../shared/types";
import { Field } from "../forms/Field";
import { fieldErrors } from "../forms/fields";
import { ApiError } from "../lib/api";
import { useStatus } from "../lib/status";
import { Dialog } from "../ui/Dialog";

export type TimesPatch = Partial<Pick<Classroom, "joinOpensLocal" | "joinClosesLocal" | "handInLocal">>;

const FIELDS = [
  { key: "joinOpensLocal", label: "Join opens" },
  { key: "joinClosesLocal", label: "Join closes" },
  { key: "handInLocal", label: "Hand-in time" },
] as const;
const KEYS = FIELDS.map((field) => field.key);

type Texts = Record<(typeof KEYS)[number], string>;

/** The wire form of what was typed; text that is not a time goes as typed so the server answers with its format copy. */
function toWire(text: string): string {
  const parts = parseLocalTime(text);
  return parts ? formatLocalWire(parts) : text.trim();
}

interface TimesDialogProps {
  open: boolean;
  classroom: Classroom;
  /** Sends only the changed times and closes the dialog; throws the API error when the server refuses them. */
  onSave: (patch: TimesPatch) => Promise<void>;
  onCancel: () => void;
}

function TimesForm({ classroom, onSave, onCancel }: Omit<TimesDialogProps, "open">) {
  const { announce } = useStatus();
  const stored: Texts = {
    joinOpensLocal: wireToDisplay(classroom.joinOpensLocal),
    joinClosesLocal: wireToDisplay(classroom.joinClosesLocal),
    handInLocal: wireToDisplay(classroom.handInLocal),
  };
  const [texts, setTexts] = useState<Texts>(stored);
  const [errors, setErrors] = useState<Partial<Texts>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const patch: TimesPatch = {};
    for (const { key } of FIELDS) {
      const typed = texts[key].trim();
      if (typed !== "" && typed !== stored[key]) patch[key] = toWire(typed);
    }
    setBusy(true);
    try {
      await onSave(patch);
    } catch (failure) {
      const found = failure instanceof ApiError ? fieldErrors(failure, KEYS) : {};
      setErrors(found);
      Object.values(found).forEach(announce);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      {FIELDS.map(({ key, label }) => (
        <Field key={key} label={label} error={errors[key]} hint="Format YYYY-MM-DD HH:mm">
          {(control) => (
            <input
              {...control}
              type="text"
              value={texts[key]}
              autoComplete="off"
              onChange={(event) => setTexts({ ...texts, [key]: event.currentTarget.value })}
            />
          )}
        </Field>
      ))}
      <p className="hint">Times are in {classroom.timeZone}. An empty field keeps its current time.</p>
      <div className="dialog-actions">
        <button type="submit" className="pill">Save classroom</button>
        <button type="button" className="pill pill--outline" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export function TimesDialog({ open, classroom, onSave, onCancel }: TimesDialogProps) {
  return (
    <Dialog open={open} title="Classroom times" onClose={onCancel}>
      <TimesForm classroom={classroom} onSave={onSave} onCancel={onCancel} />
    </Dialog>
  );
}
