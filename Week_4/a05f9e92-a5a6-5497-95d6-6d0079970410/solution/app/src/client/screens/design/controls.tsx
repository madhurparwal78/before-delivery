import { useId, type ReactNode } from "react";

interface Described {
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

/** A labelled control: the label names the control, while the hint and the error sit outside it and describe it. */
export function Labelled({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (described: Described) => ReactNode }): JSX.Element {
  const id = useId();
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter((v): v is string => v !== null);
  const described: Described = { "aria-describedby": ids.length > 0 ? ids.join(" ") : undefined, "aria-invalid": error ? true : undefined };
  return (
    <div className="field">
      <label>
        <span className="field-label">{label}</span>
        {children(described)}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }): JSX.Element {
  return (
    <label className="check-field">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="field-label">{label}</span>
    </label>
  );
}
