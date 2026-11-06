import { useState, type FormEvent } from "react";
import type { User } from "../../shared/domain";
import { ApiFailure, api } from "../api";
import { COPY } from "../copy";

export function SignIn({ ended, onSignedIn }: { ended: boolean; onSignedIn: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const { user } = await api<{ user: User }>("POST", "/api/session", { email, password }, { quietAuth: true });
      onSignedIn(user);
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : "Signing in needs a connection.");
      setPending(false);
    }
  };

  return (
    <div className="page page--narrow">
      <h1>Sign in</h1>
      {ended && <p className="signed-out">{COPY.signedOut}</p>}
      <form className="signin-card" onSubmit={submit} noValidate>
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
        <button type="submit" className="btn btn--primary" disabled={pending} aria-busy={pending}>
          {pending ? COPY.saving : "Sign in"}
        </button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
