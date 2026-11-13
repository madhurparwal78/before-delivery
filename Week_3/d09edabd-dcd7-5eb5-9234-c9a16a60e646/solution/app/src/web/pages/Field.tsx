import { useId, type InputHTMLAttributes } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  name: string;
  /** The message that belongs beside this field, if any. */
  error?: string;
  hint?: string;
}

/** A labelled text input with its validation message beside it. The message stays out of the label, so the control's name is just the label. */
export function Field({ label, error, hint, ...input }: Props) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input {...input} id={id} aria-invalid={error ? true : undefined} aria-describedby={note ? noteId : undefined} />
      {note ? (
        <p id={noteId} className={error ? 'field-error' : 'field-hint'} role={error ? 'alert' : undefined}>
          {note}
        </p>
      ) : null}
    </div>
  );
}
