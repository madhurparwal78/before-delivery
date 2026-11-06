// Sign in. The form sends `next` with the credentials and goes to the `home` the server returns.
import { useLayoutEffect, useRef, useState } from "react";
import { api, NoResponse, Stale, type User } from "../api";
import { searchParams } from "../router";

export function SignIn({ onSignedIn }: { onSignedIn: (user: User, home: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  // Read on every render: the idle sign-out's history entry may arrive after this page has mounted.
  const idle = (window.history.state as { idle?: boolean } | null)?.idle === true;
  const shown = error ?? (idle ? "You were signed out after 30 minutes without activity." : null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const summary = useRef<HTMLDivElement>(null);
  const password = useRef<HTMLInputElement>(null);
  const shownError = useRef(0);

  useLayoutEffect(() => {
    if (shown) summary.current?.focus();
  }, [shown, shownError.current]);

  const fail = (message: string) => {
    shownError.current += 1;
    setError(message);
    setStatus("");
    if (password.current) password.current.value = "";
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget);
    const next = searchParams().get("next");
    setBusy(true);
    setStatus("Signing in");
    try {
      const result = await api<{ user: User; home: string }>("/api/session", {
        method: "POST",
        own401: true,
        body: { email: form.get("email"), password: form.get("password"), ...(next !== null ? { next } : {}) },
      });
      if (result.ok) onSignedIn(result.data.user, result.data.home);
      else if (result.status === 429) fail(result.error?.message ?? "Too many sign-in attempts.");
      else fail("Email or password is incorrect.");
    } catch (error) {
      if (error instanceof NoResponse) fail("Could not reach Swathdeck — try again in a moment.");
      else if (!(error instanceof Stale)) throw error;
    } finally {
      setBusy(false);
    }
  };

  return (
    <main>
      <div className="signin">
        <div>
          <p className="caption">Fathomwright Survey Works</p>
          <h1>Sign in to Swathdeck</h1>
        </div>
        {shown && (
          <div ref={summary} className="summary" role="alert" tabIndex={-1}>
            <p>{shown}</p>
          </div>
        )}
        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="username" required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input ref={password} id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          <button type="submit" className="primary" disabled={busy}>Sign in</button>
        </form>
        <p className="sr-only" role="status" aria-live="polite" aria-label="Sign-in status">{status}</p>
      </div>
    </main>
  );
}
