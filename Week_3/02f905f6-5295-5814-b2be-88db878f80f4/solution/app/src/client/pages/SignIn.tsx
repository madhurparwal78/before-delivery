// The sign-in screen.
import { useState, type FormEvent } from "react";
import type { User } from "../../shared/api";
import { request } from "../api";
import { ConeGlyph } from "../components/ConeGlyph";

export function SignIn({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await request<{ user: User }>("POST", "/api/session", { email, password });
    setBusy(false);
    if (result.ok) onSignedIn(result.data.user);
    else setError(result.status === 401 ? "Email or password is wrong." : "The studio server is unreachable. Try again in a minute.");
  };

  return (
    <main className="signin">
      <div className="signin-card stub">
        <div className="signin-mark">
          <ConeGlyph bent={false} size={40} />
          <div>
            <h1>Shelfmark</h1>
            <p className="muted">The firing desk at Brickfield Lane Clayhouse</p>
          </div>
        </div>
        <form aria-label="Sign in" onSubmit={submit} className="signin-form" noValidate>
          <div className="field">
            <label htmlFor="signin-email">Email</label>
            <input id="signin-email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="signin-password">Password</label>
            <input
              id="signin-password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div role="alert" className="result is-error">
            {error}
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
