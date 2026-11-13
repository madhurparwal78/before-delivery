import { type FormEvent, useState } from "react";
import { OFFLINE_COPY, api } from "./api";
import type { User } from "./types";

export function SignIn({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError("");
    const result = await api<{ user: User }>("POST", "/api/session", { email, password });
    setPending(false);
    if (result.ok) onSignedIn(result.data.user);
    else if (!result.error) setError(OFFLINE_COPY);
    else if (result.error.code === "invalid_credentials") setError("Email or password is incorrect.");
    else setError(Object.values(result.error.fields ?? {}).join(" ") || result.error.message);
  };

  return (
    <main className="signin">
      <p className="wordmark wordmark--large" aria-hidden="true">
        <span className="wordmark-mark" />
        Crosshand Relay
      </p>
      <form className="signin-form" aria-label="Sign in" onSubmit={(e) => void submit(e)} noValidate>
        <h1>Sign in to Crosshand Relay</h1>
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
        <div className={`signin-alert${error ? " signin-alert--shown" : ""}`} role="alert" aria-label="Sign-in error">
          {error}
        </div>
        <button type="submit" className="button button--primary button--block" disabled={pending}>
          Sign in
        </button>
      </form>
    </main>
  );
}
