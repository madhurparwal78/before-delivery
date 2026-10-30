import { useState } from "react";
import { NetworkError, api } from "../api";
import { Status, type StatusMessage, quiet } from "../components/Status";
import type { User } from "../types";

export function SignIn({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<StatusMessage>(quiet);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage({ tone: "neutral", text: "Signing in…" });
    try {
      const result = await api<{ user: User }>("POST", "/api/session", { json: { email, password } });
      if (result.ok) {
        onSignedIn(result.data.user);
        return;
      }
      setMessage({ tone: "error", text: "Email or password is wrong." });
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      setMessage({ tone: "error", text: "Couldn't reach Teamseat. Try again." });
    }
    setBusy(false);
  };

  return (
    <main className="signin">
      <div className="signin-sheet">
        <div className="signin-brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <p className="brand-name">Teamseat</p>
            <p className="brand-agency">Northfold Language Access — dispatch and billing desk</p>
          </div>
        </div>
        <h1>Sign in</h1>
        <form className="form" aria-label="Sign in" onSubmit={(event) => void submit(event)}>
          <div className="field">
            <label htmlFor="signin-email">Email</label>
            <input
              id="signin-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="signin-password">Password</label>
            <input
              id="signin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <button type="submit" className="button button-primary" disabled={busy}>
            Sign in
          </button>
          <Status name="Sign-in status" message={message} />
        </form>
        <p className="signin-note">Accounts are created by your organisation's admin or by Northfold dispatch.</p>
      </div>
    </main>
  );
}
