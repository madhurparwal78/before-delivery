import { useState, type FormEvent } from "react";
import { ALERTS, codeSent } from "../../shared/copy";
import { ApiFailure, post } from "../lib/api";
import { announce, refuse } from "../lib/announce";
import { Link, navigate } from "../lib/router";
import { refreshMe } from "../lib/session";

const params = () => new URLSearchParams(location.search);

/** Only paths on this site are followed after sign-in. */
function safeNext(value: string | null): string {
  return value !== null && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

interface FieldProps {
  id: string;
  label: string;
  type?: string;
  value: string;
  error?: string | undefined;
  autoComplete?: string;
  onChange: (value: string) => void;
}

function Field({ id, label, type = "text", value, error, autoComplete, onChange }: FieldProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id} type={type} value={value} autoComplete={autoComplete} aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : `${id}-error`} onChange={(event) => onChange(event.target.value)}
      />
      {error !== undefined && <p className="field-error" id={`${id}-error`}>{error}</p>}
    </div>
  );
}

export function SignUp() {
  const query = params();
  const [step, setStep] = useState<"details" | "code">("details");
  const [fields, setFields] = useState({ name: "", email: query.get("email") ?? "", password: "" });
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const email = fields.email.trim().toLowerCase();

  const sendCode = async (event?: FormEvent) => {
    event?.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await post("/api/signup", fields);
      announce(codeSent(email));
      setStep("code");
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 422) setErrors(error.errors);
      else if (error instanceof ApiFailure && error.code === "mail_unavailable") refuse(ALERTS.codeNotSent);
      else throw error;
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await post("/api/signup/confirm", { email, code });
      await refreshMe();
      navigate(safeNext(query.get("next")));
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 422) setErrors(error.errors);
      else throw error;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-band">
      {step === "details" ? (
        <form className="card" onSubmit={sendCode} noValidate>
          <h1>Start your outline</h1>
          <p className="form-note">One outline for plans, drafts and lists. We will email you a 6-digit code.</p>
          <Field id="su-name" label="Name" value={fields.name} error={errors.name} autoComplete="name"
            onChange={(name) => setFields({ ...fields, name })} />
          <Field id="su-email" label="Email" type="email" value={fields.email} error={errors.email} autoComplete="email"
            onChange={(value) => setFields({ ...fields, email: value })} />
          <Field id="su-password" label="Password" type="password" value={fields.password} error={errors.password}
            autoComplete="new-password" onChange={(password) => setFields({ ...fields, password })} />
          <button type="submit" className="pill pill-sky pill-block" disabled={busy} aria-busy={busy}>
            {busy ? "Sending" : "Send code"}
          </button>
          <p className="form-foot">Already have an account? <Link className="inline-link" to={`/signin${location.search}`}>Sign in</Link></p>
        </form>
      ) : (
        <form className="card" onSubmit={confirm} noValidate>
          <h1>Check your email</h1>
          <p className="form-note">{codeSent(email)}</p>
          <Field id="su-code" label="Confirmation code" value={code} error={errors.code} autoComplete="one-time-code"
            onChange={setCode} />
          <button type="submit" className="pill pill-sky pill-block" disabled={busy} aria-busy={busy}>Confirm</button>
          <button type="button" className="pill pill-quiet pill-block" disabled={busy} onClick={() => void sendCode()}>
            Send a new code
          </button>
        </form>
      )}
    </div>
  );
}

export function SignIn() {
  const query = params();
  const [email, setEmail] = useState(query.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await post("/api/session", { email, password });
      await refreshMe();
      navigate(safeNext(query.get("next")));
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401) refuse(ALERTS.signInFailed);
      else throw error;
    } finally {
      setBusy(false);
    }
  };

  const carried = new URLSearchParams();
  if (email !== "") carried.set("email", email);
  const next = query.get("next");
  if (next !== null) carried.set("next", next);

  return (
    <div className="page-band">
      <form className="card" onSubmit={submit} noValidate>
        <h1>Sign in</h1>
        <Field id="si-email" label="Email" type="email" value={email} autoComplete="email" onChange={setEmail} />
        <Field id="si-password" label="Password" type="password" value={password} autoComplete="current-password" onChange={setPassword} />
        <button type="submit" className="pill pill-sky pill-block" disabled={busy} aria-busy={busy}>Sign in</button>
        <p className="form-foot"><Link className="inline-link" to={`/signup?${carried.toString()}`}>Create an account</Link></p>
      </form>
    </div>
  );
}
