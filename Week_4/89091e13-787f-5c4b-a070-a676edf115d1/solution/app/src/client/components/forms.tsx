import { useId, useState, type ReactNode } from "react";
import { VIEWER_COPY, OWNER_MEMBERS_COPY, OWNER_PRODUCER_COPY } from "../../shared/copy.ts";
import { ApiError } from "../lib/api.ts";
import { useWorkspace } from "../lib/workspace.tsx";

interface StatusSink {
  status: string;
  setStatus: (status: string) => void;
}

export function useStatusSink(): StatusSink {
  const [status, setStatus] = useState("");
  return { status, setStatus };
}

export interface FormModel {
  pending: boolean;
  errors: Record<string, string>;
  alert: string;
  status: string;
  run: (form: HTMLFormElement | null, action: () => Promise<string>) => Promise<void>;
}

/** Pending, field errors, the form alert and the status line of one write. */
export function useFormModel(sink?: StatusSink): FormModel {
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState("");
  const [ownStatus, setOwnStatus] = useState("");
  const status = sink ? sink.status : ownStatus;
  const setStatus = sink ? sink.setStatus : setOwnStatus;

  const run = async (form: HTMLFormElement | null, action: () => Promise<string>) => {
    setPending(true);
    setErrors({});
    setAlert("");
    setStatus("Working…");
    try {
      setStatus(await action());
    } catch (caught) {
      if (!(caught instanceof ApiError)) throw caught;
      setStatus("");
      const [field, message] = Object.entries(caught.body.errors ?? {})[0] ?? [];
      if (field && message) {
        setErrors({ [field]: message });
        setAlert(message);
        form?.querySelector<HTMLElement>(`[name="${field}"]`)?.focus();
      } else {
        setAlert(caught.message);
      }
    } finally {
      setPending(false);
    }
  };
  return { pending, errors, alert, status, run };
}

export function FormAlert({ model }: { model: FormModel }) {
  return <p role="alert" className="form-alert">{model.alert}</p>;
}

export function FormStatus({ model, label }: { model: FormModel; label: string }) {
  return <p role="status" aria-label={label} className="form-status">{model.status}</p>;
}

export function Field({ name, label, error, extraDescription, children }: {
  name: string;
  label: string;
  error?: string;
  extraDescription?: string;
  children: (props: { id: string; name: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, extraDescription].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, name, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {error && <p id={errorId} className="field-error">{error}</p>}
    </div>
  );
}

type GateKind = "write" | "producer" | "members";

export interface Gate {
  disabled: boolean;
  describedBy: string | undefined;
  note: ReactNode;
}

/** Controls the person's role cannot use stay visible, disabled, and described by the role copy. */
export function useRoleGate(kind: GateKind): Gate {
  const { role } = useWorkspace();
  const noteId = useId();
  const copy =
    role === "viewer" ? VIEWER_COPY
    : role === "developer" && kind === "producer" ? OWNER_PRODUCER_COPY
    : role === "developer" && kind === "members" ? OWNER_MEMBERS_COPY
    : null;
  return {
    disabled: copy !== null,
    describedBy: copy ? noteId : undefined,
    note: copy ? <span id={noteId} hidden>{copy}</span> : null,
  };
}

export function SubmitButton({ model, gate, children, className = "" }: {
  model: FormModel;
  gate?: Gate;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button type="submit" className={`pill pill--solid ${className}`.trim()} disabled={gate?.disabled || model.pending}
      aria-busy={model.pending || undefined} aria-describedby={gate?.describedBy}>
      {children}
    </button>
  );
}
