import { useId, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";

interface FieldControl {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": true | undefined;
}

interface FieldProps {
  label: string;
  /** The field's error copy: shown under the field and linked as its accessible description. */
  error?: string | undefined;
  hint?: string;
  children: (control: FieldControl) => ReactNode;
}

/** A labelled form field whose error sits under it and is the control's accessible description. */
export function Field({ label, error, hint, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const described = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-describedby": described || undefined, "aria-invalid": error ? true : undefined })}
      {hint ? <p className="hint field-hint" id={hintId}>{hint}</p> : null}
      {error ? (
        <p className="field-error" id={errorId}>
          <CircleAlert size={18} aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
