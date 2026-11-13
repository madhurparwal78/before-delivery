import { useId, type ReactNode } from 'react';

// One field per row: a label, the control, and the error written under it in ink.
export function Field({ label, error, children }: {
  label: string;
  error?: string | undefined;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
}): ReactNode {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, ...(error ? { 'aria-describedby': errorId, 'aria-invalid': true } : {}) })}
      {error ? <span id={errorId} className="field-error">{error}</span> : null}
    </div>
  );
}
