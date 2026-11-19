import { useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { api, ApiFailure, failureText, tooManyAttempts } from "../api.js";
import { Link, navigate, useTitle } from "../ui.js";

export function SignIn() {
  useTitle("Sign in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await api("POST", "/api/session", { email, password });
      navigate("/workshops");
    } catch (failure) {
      setBusy(false);
      setError(failure instanceof ApiFailure && failure.code === "rate_limited" ? tooManyAttempts(failure) : failureText(failure, "You're offline — check your connection and try again."));
    }
  };

  return (
    <div className="page page-narrow">
      <header className="site-header">
        <Link to="/" className="wordmark">
          Lanternfold Rooms
        </Link>
      </header>
      <main className="signin">
        <h1 className="display-sm">Sign in</h1>
        <p className="muted">Facilitators sign in here. Participants join from the link their facilitator shares.</p>
        <form onSubmit={submit} noValidate className="form">
          <div className="field">
            <label htmlFor="signin-email">Email</label>
            <input id="signin-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="signin-password">Password</label>
            <div className="password-row">
              <input
                id="signin-password"
                type={shown ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button type="button" className="icon-btn" aria-label="Show password" aria-pressed={shown} onClick={() => setShown((s) => !s)}>
                {shown ? <EyeOff aria-hidden="true" size={20} strokeWidth={1.75} /> : <Eye aria-hidden="true" size={20} strokeWidth={1.75} />}
              </button>
            </div>
          </div>
          <div role="alert" className="form-alert">
            {error}
          </div>
          <button type="submit" className="btn btn-primary btn-block">
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </main>
    </div>
  );
}
