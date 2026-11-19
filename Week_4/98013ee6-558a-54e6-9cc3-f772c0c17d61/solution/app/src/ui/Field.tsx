import { useId, type ReactNode } from "react";

interface ControlProps {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": true | undefined;
}

interface Props {
  label: string;
  error?: string | null;
  counter?: ReactNode;
  children: (props: ControlProps) => ReactNode;
}

/** A labelled control with its counter and its error under it; the error is announced as an alert. */
export function Field({ label, error, counter, children }: Props) {
  const id = useId();
  const noteId = `${id}-note`;
  const described = error || counter ? noteId : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-describedby": described, "aria-invalid": error ? true : undefined })}
      {error || counter ? (
        <div className="field-foot" id={noteId}>
          {error ? <p role="alert" className="field-error">{error}</p> : <span />}
          {counter}
        </div>
      ) : null}
    </div>
  );
}
