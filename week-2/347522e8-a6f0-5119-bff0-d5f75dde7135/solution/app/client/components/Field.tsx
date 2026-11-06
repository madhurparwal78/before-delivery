import { type InputHTMLAttributes, type Ref, useId } from "react";
import { ErrorNote } from "./Feedback.js";

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  error?: string | null;
  hint?: string;
  inputRef?: Ref<HTMLInputElement>;
}

/** A labelled text field with its message beside it. */
export function Field({ label, error, hint, className = "", inputRef, ...input }: FieldProps) {
  const id = useId();
  const described = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field ${className}`}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {hint ? (
        <span id={`${id}-hint`} className="field__hint">
          {hint}
        </span>
      ) : null}
      <input ref={inputRef} id={id} className="field__input" aria-invalid={error ? true : undefined} aria-describedby={described} {...input} />
      {error ? <ErrorNote id={`${id}-error`}>{error}</ErrorNote> : null}
    </div>
  );
}
