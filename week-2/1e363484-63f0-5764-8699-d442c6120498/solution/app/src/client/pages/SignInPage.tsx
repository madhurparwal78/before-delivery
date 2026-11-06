import { useState, type FormEvent } from "react";
import { request } from "../api";
import { COPY } from "../copy";
import { navigate } from "../router";
import { Wordmark } from "../ui/Shell";

export function SignInPage() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    const r = await request("POST", "/api/session", { email: form.get("email"), password: form.get("password") }, { allowUnauthenticated: true });
    setBusy(false);
    if (r.status === 200) {
      const next = (history.state as { next?: string } | null)?.next;
      navigate(next && next.startsWith("/") && !next.startsWith("//") ? next : "/projects", { replace: true });
    } else setError(COPY.wrongCredentials);
  };

  return (
    <main className="signin">
      <div className="signin-column">
        <h1 className="signin-mark"><Wordmark /></h1>
        <p className="signin-sub">Sedgemoor Instrument Works</p>
        <form onSubmit={(e) => void submit(e)} className="signin-form" noValidate>
          <label className="field">
            <span>Email</span>
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label className="field">
            <span>Password</span>
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          {error && <p role="alert" className="alert">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={busy}>Sign in</button>
        </form>
      </div>
    </main>
  );
}
