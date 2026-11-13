import { useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { FieldError, User } from "../../shared/api";
import { ApiFailure, post } from "../api";
import { navigate } from "../router";
import { useSession } from "../session";

/** Field errors from a refused submit, ready for the summary alert and the inline messages. */
export interface Failure {
  fields: Record<string, string>;
  general: string | null;
}

export function failureOf(error: unknown, fieldNames: Record<string, string>): Failure {
  if (!(error instanceof ApiFailure)) throw error;
  const body = error.body;
  if (body.error === "validation_failed") {
    const fields: Record<string, string> = {};
    for (const entry of body.errors ?? ([] as FieldError[])) fields[fieldNames[entry.path] ?? entry.path] = entry.message;
    return { fields, general: null };
  }
  if (body.error === "invalid_credentials") return { fields: {}, general: "Email or password is wrong." };
  if (body.error === "email_not_verified") return { fields: {}, general: "Verify your email first. We sent you a link." };
  if (body.error === "mail_unavailable") return { fields: {}, general: "We could not send email right now. Try again in a minute." };
  return { fields: {}, general: body.message };
}

/** The alert at the top of a failed form: one link per field error, each moving focus to its field. */
export function ErrorSummary({ failure, labels, focus }: { failure: Failure; labels: Record<string, string>; focus: (field: string) => void }): ReactNode {
  const entries = Object.entries(failure.fields);
  return (
    <div role="alert" className="error-summary">
      <p>Please fix the following:</p>
      <ul>
        {entries.map(([field, message]) => (
          <li key={field}>
            <a href={`#${field}`} onClick={(event) => { event.preventDefault(); focus(field); }}>{message}</a>
            <span className="sr-only">{` (${labels[field] ?? field})`}</span>
          </li>
        ))}
        {failure.general && (
          <li>
            <a href="#email" onClick={(event) => { event.preventDefault(); focus("email"); }}>{failure.general}</a>
          </li>
        )}
      </ul>
    </div>
  );
}

interface FieldProps {
  name: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  readOnly?: boolean;
  required?: boolean;
  autoComplete?: string;
  inputRef?: (element: HTMLInputElement | null) => void;
}

export function Field({ name, label, type = "text", value, onChange, error, readOnly, required, autoComplete, inputRef }: FieldProps): ReactNode {
  return (
    <label className="field">
      <input
        ref={inputRef}
        id={`field-${name}`}
        name={name}
        type={type}
        aria-label={label}
        placeholder={required ? `${label} *` : label}
        value={value}
        readOnly={readOnly}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `error-${name}` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && <span id={`error-${name}`} className="error">{error}</span>}
    </label>
  );
}

const SIGNUP_LABELS = { display_name: "Display name", email: "Email", password: "Password" };

/** The sign-up form: on the landing page's dark footer, on /signup, and with the invited address read-only. */
export function SignupForm({ invitation, email: invited, onDark = false }: { invitation?: string; email?: string; onDark?: boolean }): ReactNode {
  const { setUser } = useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(invited ?? "");
  const [password, setPassword] = useState("");
  const [use, setUse] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      const body = { display_name: name, email, password, ...(use ? { use } : {}), ...(invitation ? { invitation_token: invitation } : {}) };
      const answer = await post<{ user: User }>("/api/auth/signup", body);
      if (invitation) {
        setDone("You are in. Opening the notebook…");
        setUser(answer.user);
        const opened = await post<{ notebook_id: string }>(`/api/invitations/${invitation}/accept`);
        navigate(`/notebooks/${opened.notebook_id}`);
      } else setDone("Check your inbox to verify your email.");
    } catch (error) {
      setFailure(failureOf(error, { invitation_token: "email" }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form aria-label="Create your account" className={`signup-form${onDark ? " on-dark" : ""}`} onSubmit={(event) => void submit(event)} noValidate>
      {failure && <ErrorSummary failure={failure} labels={SIGNUP_LABELS} focus={(field) => inputs.current[field]?.focus()} />}
      {done && <p role="status" className="notice">{done}</p>}
      <div className="form-grid">
        <Field name="display_name" label="Display name" required value={name} onChange={setName} error={failure?.fields.display_name} autoComplete="name" inputRef={(el) => (inputs.current.display_name = el)} />
        <Field name="email" label="Email" type="email" required value={email} onChange={setEmail} readOnly={invited !== undefined} error={failure?.fields.email} autoComplete="email" inputRef={(el) => (inputs.current.email = el)} />
        <Field name="password" label="Password" type="password" required value={password} onChange={setPassword} error={failure?.fields.password} autoComplete="new-password" inputRef={(el) => (inputs.current.password = el)} />
        <label className="field">
          <select aria-label="I mostly use notebooks for" value={use} onChange={(event) => setUse(event.target.value)}>
            <option value="">I mostly use notebooks for *</option>
            {["Teaching", "Research", "Analysis", "Tinkering"].map((choice) => <option key={choice} value={choice}>{choice}</option>)}
          </select>
        </label>
      </div>
      <button type="submit" className={`btn ${onDark ? "btn-bright" : "btn-accent"} submit`} disabled={busy}>Create account</button>
    </form>
  );
}
