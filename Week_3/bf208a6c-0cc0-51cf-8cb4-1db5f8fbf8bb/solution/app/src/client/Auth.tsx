import { useState, type FormEvent } from "react";
import { ApiFailure, call } from "./api";
import { Link, navigate, safeNext, useLocation } from "./router";
import { signupErrors } from "../shared/rules";
import type { Account, FieldErrors } from "../shared/types";

interface Props {
  onSignedIn: (user: Account) => void;
}

function Field({ id, label, type = "text", value, onChange, error, autoComplete }: { id: string; label: string; type?: string; value: string; onChange: (value: string) => void; error?: string; autoComplete?: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} />
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

export function SignUp({ onSignedIn }: Props) {
  const { search } = useLocation();
  const next = safeNext(search.get("next"));
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setErrors({});
    setAlert("");
    try {
      await work();
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (error.status === 422) setErrors(error.body.errors ?? {});
      else if (error.status === 503) setAlert("We can't send your code right now. Try again in a few minutes.");
      else throw error;
    } finally {
      setBusy(false);
    }
  };

  const create = (event: FormEvent): void => {
    event.preventDefault();
    const found = signupErrors(displayName, email, password);
    if (Object.keys(found).length) return setErrors(found);
    void run(async () => {
      await call("POST", "/api/auth/signup", { display_name: displayName, email, password });
      setSentTo(email.trim());
    });
  };

  const confirm = (event: FormEvent): void => {
    event.preventDefault();
    void run(async () => {
      const { user } = await call<{ user: Account }>("POST", "/api/auth/verify", { email: sentTo, code });
      onSignedIn(user);
      navigate(next);
    });
  };

  return (
    <main className="page narrow">
      <Link href="/" className="brand">
        Pinsheet
      </Link>
      {sentTo ? (
        <form className="form" onSubmit={confirm} noValidate>
          <h1>Confirm your email</h1>
          <p>{`We sent a 6-digit code to ${sentTo}.`}</p>
          <Field id="code" label="Code" value={code} onChange={setCode} error={errors["code"]} autoComplete="one-time-code" />
          <button type="submit" aria-busy={busy}>
            {busy ? "Confirming…" : "Confirm email"}
          </button>
        </form>
      ) : (
        <form className="form" onSubmit={create} noValidate>
          <h1>Create your account</h1>
          <Field id="display-name" label="Display name" value={displayName} onChange={setDisplayName} error={errors["display_name"]} autoComplete="name" />
          <Field id="email" label="Email" type="email" value={email} onChange={setEmail} error={errors["email"]} autoComplete="email" />
          <Field id="password" label="Password" type="password" value={password} onChange={setPassword} error={errors["password"]} autoComplete="new-password" />
          <div role="alert" className="field-error">
            {alert}
          </div>
          <button type="submit" aria-busy={busy}>
            {busy ? "Creating…" : "Create account"}
          </button>
          <p className="small muted">
            Already have an account? <Link href={`/signin?next=${encodeURIComponent(next)}`}>Sign in</Link>
          </p>
        </form>
      )}
      {sentTo && <div role="alert" className="field-error">{alert}</div>}
    </main>
  );
}

export function SignIn({ onSignedIn }: Props) {
  const { search } = useLocation();
  const next = safeNext(search.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const { user } = await call<{ user: Account }>("POST", "/api/auth/signin", { email, password });
      onSignedIn(user);
      navigate(next);
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (error.status === 401) setMessage("That email and password don't match.");
      else if (error.status === 403) setMessage("Confirm your email first.");
      else throw error;
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page narrow">
      <Link href="/" className="brand">
        Pinsheet
      </Link>
      <form className="form" onSubmit={(event) => void submit(event)} noValidate>
        <h1>Sign in</h1>
        <Field id="email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field id="password" label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        <div role="alert" className="field-error">
          {message}
        </div>
        <button type="submit" aria-busy={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="small muted">
          New here? <Link href={`/signup?next=${encodeURIComponent(next)}`}>Create account</Link>
        </p>
      </form>
    </main>
  );
}
