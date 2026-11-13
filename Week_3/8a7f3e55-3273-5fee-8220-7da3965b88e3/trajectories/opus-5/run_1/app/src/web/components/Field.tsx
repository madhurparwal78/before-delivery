import type { ReactNode } from 'react';

export interface FieldProps {
  id: string;
  label: string;
  hint?: ReactNode;
  hintId?: string;
  error?: string | undefined;
  children: ReactNode;
}

/**
 * A labelled control whose accessible name is exactly its label: hints and messages sit
 * outside the label and reach the control through its accessible description instead.
 */
export function Field({ id, label, hint, hintId, error, children }: FieldProps): ReactNode {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint === undefined ? null : (
        <span className="hint mono" id={hintId}>
          {hint}
        </span>
      )}
      {error === undefined ? null : <span className="field-error">{error}</span>}
    </div>
  );
}
