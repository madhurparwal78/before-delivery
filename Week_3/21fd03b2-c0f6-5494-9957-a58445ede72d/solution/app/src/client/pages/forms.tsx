import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { ApiFailure, send } from "../api";
import { navigate, Link, useLocation } from "../router";
import { DockPanel, Screen } from "../ui";
import { notify } from "../notices";

interface FieldSpec {
  id: string;
  label: string;
  type: string;
  autoComplete?: string;
}

interface FormProps {
  title: string;
  fields: FieldSpec[];
  submitLabel: string;
  action: (values: Record<string, string>) => Promise<void>;
  footer?: ReactNode;
}

/** A form with inline field errors and the `There is a problem` error summary that links to each invalid field. */
function Form({ title, fields, submitLabel, action, footer }: FormProps): JSX.Element {
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refs = useRef<Record<string, HTMLInputElement | null>>({});
  const summary = useRef<HTMLDivElement>(null);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      await action(values);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401 && error.code === "bad_credentials") setFormError(error.message);
      else if (error instanceof ApiFailure && Object.keys(error.fields).length > 0) setErrors(error.fields);
      else setFormError("Something went wrong. Try again.");
      setTimeout(() => summary.current?.focus(), 0);
    } finally {
      setBusy(false);
    }
  };
  const invalid = fields.filter((f) => errors[f.id]);
  return (
    <Screen me={null} workspaceId={null}>
      <DockPanel title={title}>
        {invalid.length > 0 || formError ? (
          <div className="error-summary" role="alert" tabIndex={-1} ref={summary}>
            <h2>There is a problem</h2>
            <ul>
              {formError ? <li>{formError}</li> : null}
              {invalid.map((f) => (
                <li key={f.id}>
                  <a
                    href={`#${f.id}`}
                    onClick={(event) => {
                      event.preventDefault();
                      refs.current[f.id]?.focus();
                    }}
                  >
                    {errors[f.id]}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <form noValidate onSubmit={(event) => void submit(event)} className="stack">
          {fields.map((f) => (
            <div key={f.id} className="field">
              <label htmlFor={f.id}>{f.label}</label>
              <input
                id={f.id}
                ref={(el) => (refs.current[f.id] = el)}
                type={f.type}
                autoComplete={f.autoComplete}
                value={values[f.id] ?? ""}
                aria-invalid={errors[f.id] ? true : undefined}
                aria-describedby={errors[f.id] ? `${f.id}-error` : undefined}
                onChange={(event) => setValues({ ...values, [f.id]: event.target.value })}
              />
              {errors[f.id] ? (
                <p id={`${f.id}-error`} className="field-error">
                  {errors[f.id]}
                </p>
              ) : null}
            </div>
          ))}
          <button type="submit" className="chip primary" disabled={busy} aria-busy={busy}>
            {submitLabel}
          </button>
        </form>
        {footer}
      </DockPanel>
    </Screen>
  );
}

function params(search: string): URLSearchParams {
  return new URLSearchParams(search);
}

export function SignIn(): JSX.Element {
  const { search } = useLocation();
  const query = params(search);
  const invite = query.get("invite");
  const back = query.get("return");
  const qs = invite ? `?invite=${encodeURIComponent(invite)}` : "";
  return (
    <Form
      title="Sign in"
      submitLabel="Sign in"
      fields={[
        { id: "email", label: "Email", type: "email", autoComplete: "email" },
        { id: "password", label: "Password", type: "password", autoComplete: "current-password" },
      ]}
      action={async (values) => {
        const result = await send<{ landing: string }>("POST", "/api/auth/sign-in", { email: values.email ?? "", password: values.password ?? "", invite: invite ?? undefined, return: back ?? undefined }, { quiet: true });
        navigate(result.landing);
      }}
      footer={
        <p className="form-alt">
          New here? <Link href={`/sign-up${qs}`}>Create an account</Link>
        </p>
      }
    />
  );
}

export function SignUp(): JSX.Element {
  const invite = params(useLocation().search).get("invite");
  const qs = invite ? `?invite=${encodeURIComponent(invite)}` : "";
  return (
    <Form
      title="Create your account"
      submitLabel="Create account"
      fields={[
        { id: "displayName", label: "Display name", type: "text", autoComplete: "name" },
        { id: "email", label: "Email", type: "email", autoComplete: "email" },
        { id: "password", label: "Password", type: "password", autoComplete: "new-password" },
      ]}
      action={async (values) => {
        const result = await send<{ landing: string }>("POST", "/api/auth/sign-up", { displayName: values.displayName ?? "", email: values.email ?? "", password: values.password ?? "", invite: invite ?? undefined }, { quiet: true });
        navigate(result.landing);
      }}
      footer={
        <p className="form-alt">
          Already have an account? <Link href={`/sign-in${qs}`}>Sign in here</Link>
        </p>
      }
    />
  );
}

export function NewWorkspace(): JSX.Element {
  return (
    <Form
      title="New workspace"
      submitLabel="Create workspace"
      fields={[{ id: "name", label: "Workspace name", type: "text" }]}
      action={async (values) => {
        const result = await send<{ workspace: { id: string; name: string } }>("POST", "/api/workspaces", { name: values.name ?? "" });
        notify(`${result.workspace.name} created`);
        navigate(`/w/${result.workspace.id}`);
      }}
    />
  );
}

