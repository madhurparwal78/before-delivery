// Sign in (brief: Screens and layout): email and password checked against the people directory.
import { useState } from "react";
import { api, ApiError } from "../api";
import { announce, bindAnnouncer } from "../announce";
import { SIGN_IN_OUTAGE, SOMETHING_WRONG, WRONG_CREDENTIALS } from "../copy";
import { enterApp } from "../App";
import type { Person } from "../../shared/api";

export function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const body = await api<{ person: Person }>("POST", "/api/session", { email, password });
      enterApp(body.person);
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      const text = failure.code === "invalid_credentials" ? WRONG_CREDENTIALS
        : failure.code === "directory_unavailable" ? SIGN_IN_OUTAGE
        : failure.status === 422 ? WRONG_CREDENTIALS : SOMETHING_WRONG;
      setProblem(text);
      announce(text);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <main className="signin-card">
        <div className="signin-mark"><span className="wordmark-mark" aria-hidden="true" /><span className="wordmark">Lintel Drive</span></div>
        <h1>Sign in to Lintel Drive</h1>
        <p className="signin-lede">The Lintelworks file drive for staff and invited partners.</p>
        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="signin-email">Email</label>
            <input id="signin-email" type="email" autoComplete="username" className="field-input" value={email}
              aria-describedby={problem ? "signin-problem" : undefined} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="signin-password">Password</label>
            <input id="signin-password" type="password" autoComplete="current-password" className="field-input" value={password}
              aria-describedby={problem ? "signin-problem" : undefined} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {problem && <p id="signin-problem" className="field-error">{problem}</p>}
          <button type="submit" className="button primary wide" aria-busy={busy || undefined}>Sign in</button>
        </form>
        <dl className="title-block" aria-label="Sheet">
          <div><dt>Firm</dt><dd>Lintelworks</dd></div>
          <div><dt>Office</dt><dd>Tucson, Arizona</dd></div>
          <div><dt>Zone</dt><dd>Phoenix time</dd></div>
        </dl>
      </main>
      <div ref={bindAnnouncer} role="status" aria-label="Announcements" aria-live="polite" className="announcer" />
    </div>
  );
}
