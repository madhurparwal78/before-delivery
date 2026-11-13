import { type FormEvent, useState } from "react";
import { safeRedirect } from "../../shared/redirect";
import { ApiFailure, api } from "../lib/api";

export function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post("/api/session", { email, password });
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.assign(safeRedirect(next, "/documents"));
    } catch (failure) {
      setError(failure instanceof ApiFailure && failure.status === 401 ? "Email or password is incorrect." : "Something went wrong. Try again.");
      setBusy(false);
    }
  };

  return (
    <main className="auth">
      <p className="brand">Undersign</p>
      <h1>Sign in</h1>
      <form onSubmit={(event) => void submit(event)} className="stack">
        <label className="field-label">
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </label>
        <label className="field-label">
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error ? (
          <p role="alert" className="error">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn primary-ink" disabled={busy} aria-busy={busy}>
          Sign in
        </button>
      </form>
    </main>
  );
}
