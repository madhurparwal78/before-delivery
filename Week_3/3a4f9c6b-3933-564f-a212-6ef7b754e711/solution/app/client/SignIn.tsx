// The sign-in screen: one centred panel.
import { useId, useState, type FormEvent } from "react";
import type { SessionBody } from "../shared/api";
import { call } from "./api";
import { activity, FeedbackRegions, generalError, problem, useFeedback } from "./feedback";

export function SignIn({ onSignedIn }: { onSignedIn: (session: SessionBody) => void }) {
  const say = useFeedback();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState("");
  const id = useId();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFieldError("");
    say(activity("Signing in…"));
    const result = await call<SessionBody>("POST", "/api/session", { body: { email, password }, guest: true });
    setBusy(false);
    if (result.ok) {
      say(activity(""));
      onSignedIn(result.data);
    } else if (result.error?.error === "invalid_credentials") {
      say(problem("Email or password is wrong."));
    } else if (result.error?.error === "validation") {
      setFieldError(Object.values(result.error.fields ?? {}).join(" "));
      say(problem(Object.values(result.error.fields ?? {}).join(" ")));
    } else {
      say(problem(generalError(result)));
    }
  };
  return (
    <main className="signin">
      <div className="signin-panel">
        <p className="brand"><span className="brand-name">Keelson</span><span className="brand-maker">Tideline Works</span></p>
        <h1 className="page-title">Sign in to Keelson</h1>
        <form className="signin-form" onSubmit={submit} noValidate>
          <label className="field">
            <span className="field-label">Email</span>
            <input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)}
              aria-describedby={`${id}-error`} aria-invalid={fieldError ? true : undefined} />
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {fieldError && <p id={`${id}-error`} className="field-error">{fieldError}</p>}
          <button type="submit" className="button primary wide" disabled={busy}>Sign in</button>
        </form>
        <FeedbackRegions />
      </div>
    </main>
  );
}
