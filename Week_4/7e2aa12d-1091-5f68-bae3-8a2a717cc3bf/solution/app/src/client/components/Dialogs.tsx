import { useState, type FormEvent, type ReactNode } from 'react';
import type { Outcome } from '../lib/workspace.js';
import { Dialog } from './Dialog.js';

export const Problem = ({ message }: { message: string }) => (
  <div role="alert" aria-label="Dialog problem" className="problem">
    {message}
  </div>
);

interface FormDialogProps {
  label: string;
  field: string;
  initial: string;
  submit: string;
  mono?: boolean;
  inputMode?: 'numeric';
  /** Sends the typed value; the dialog closes on success and shows the refusal otherwise. */
  onSubmit: (value: string) => Promise<Outcome>;
  onClose: () => void;
  returnFocus?: () => HTMLElement | null;
  hint?: ReactNode;
}

/** A dialog of one text field with Save/Cancel buttons: Name area, Add breakpoint and Save version. */
export function FormDialog({ label, field, initial, submit, mono, inputMode, onSubmit, onClose, returnFocus, hint }: FormDialogProps) {
  const [value, setValue] = useState(initial);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <Dialog label={label} onClose={onClose} returnFocus={returnFocus}>
      {(close) => (
        <form
          onSubmit={async (event: FormEvent) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            const outcome = await onSubmit(value);
            setBusy(false);
            if (outcome.ok) close();
            else setProblem(outcome.message);
          }}
        >
          <h2>{label}</h2>
          <label className="field">
            <span>{field}</span>
            <input
              type="text"
              data-autofocus
              className={mono ? 'mono' : undefined}
              aria-label={field}
              inputMode={inputMode}
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          {hint}
          <Problem message={problem} />
          <div className="button-row end">
            <button type="button" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="primary">
              {submit}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
