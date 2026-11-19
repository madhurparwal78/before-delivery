import { useId } from "react";

// One labelled field: label above, hint and error beneath, both linked as the control's description.
export default function Field({ label, error, hint, children, className = "" }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : null;
  const errorId = error ? `${id}-error` : null;
  const control = {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": [errorId, hintId].filter(Boolean).join(" ") || undefined,
  };
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>{label}</label>
      {children(control)}
      {hint && <span id={hintId} className="field-hint">{hint}</span>}
      {error && <span id={errorId} className="field-error">{error}</span>}
    </div>
  );
}
