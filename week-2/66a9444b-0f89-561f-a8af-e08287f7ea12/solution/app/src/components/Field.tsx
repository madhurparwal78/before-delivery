// A labelled form field: the label names the control, the hint and the error describe it.
import { cloneElement, useId, type ReactElement } from "react";

type Props = { label: string; hint?: string; error?: string; children: ReactElement<Record<string, unknown>>; className?: string };

export function Field({ label, hint, error, children, className = "" }: Props) {
  const id = useId();
  const described = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id} className="field__label">{label}</label>
      {cloneElement(children, { id, "aria-describedby": described, "aria-invalid": error ? true : undefined })}
      {hint && <span id={`${id}-hint`} className="field__hint">{hint}</span>}
      {error && <span id={`${id}-error`} className="field__error">{error}</span>}
    </div>
  );
}
