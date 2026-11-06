import { type FormEvent, useState } from "react";
import { call } from "../api";
import type { User } from "../types";

export function SignInScreen({ onSignedIn }: { onSignedIn: (user: User) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await call<{ user: User }>("POST", "/api/session", { email, password });
    if (result.ok) {
      await onSignedIn(result.data.user);
      return;
    }
    setPending(false);
    setError(result.status === 401 || result.status === 422 ? "Email or password is incorrect." : "Sign-in is unavailable. Try again shortly.");
  };

  return (
    <main className="signin">
      <form className="signin-card" onSubmit={(event) => void submit(event)} noValidate aria-labelledby="signin-title">
        <h1 id="signin-title" className="wordmark-large">
          Pilotlight
        </h1>
        <p className="muted">Night-shift booking for shared kitchens.</p>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={pending} aria-label="Sign in">
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
