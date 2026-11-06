import { useId } from "react";

interface FieldProps {
  label: string;
  error?: string | undefined;
  hint?: string;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => React.ReactNode;
}

/** A labelled control with its hint and its error shown under it and linked as its description. */
export function Field({ label, error, hint, children }: FieldProps) {
  const id = useId();
  const described = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return (
    <div className={`field ${error ? "field-invalid" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <span className="field-hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
      {children({ id, ...(described ? { "aria-describedby": described } : {}), ...(error ? { "aria-invalid": true } : {}) })}
      {error ? (
        <span className="field-error" id={`${id}-error`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
