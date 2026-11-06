import { useRef, useState, useSyncExternalStore } from "react";
import { errorBody, readJson, request, resendKept, resume, resumeEvents, sessionInfo, type SessionUser } from "./api.ts";
import { Modal } from "./modal.tsx";

/** Sign in to continue: no timer closes it or clears its fields; it closes only on a successful sign-in, then each kept request is resent once. */
export function SessionDialog() {
  useSyncExternalStore(resumeEvents.subscribe, resumeEvents.snapshot);
  if (!resume.open) return null;
  return <SessionForm />;
}

function SessionForm() {
  const [password, setPassword] = useState("");
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const email = sessionInfo.user?.email ?? "";

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const res = await request({ method: "POST", path: "/api/session", json: { email, password } }, { allowUnauthenticated: true });
    setBusy(false);
    if (res.ok) {
      sessionInfo.adopt(await readJson<{ user: SessionUser; csrfToken: string }>(res));
      resendKept();
      return;
    }
    const code = (await errorBody(res))?.error;
    setAlert(code === "signin_locked" ? "Too many sign-in attempts. Try again later." : code === "invalid_credentials" ? "Email or password is incorrect." : "Something went wrong. Try again.");
    passwordRef.current?.focus();
  };

  return (
    <Modal kind="dialog" label="Sign in to continue" initialFocus={passwordRef} className="dialog-narrow">
      <header className="dialog-head"><h2>Sign in to continue</h2></header>
      <p className="dialog-text">Your session ended. Sign in again and we will save your change.</p>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="field">
          <label htmlFor="resume-email">Email</label>
          <input id="resume-email" type="email" value={email} readOnly autoComplete="username" />
        </div>
        <div className="field">
          <label htmlFor="resume-password">Password</label>
          <input id="resume-password" ref={passwordRef} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div role="alert" className="form-alert">{alert}</div>
        <footer className="dialog-foot">
          <button type="submit" className="btn btn-primary" disabled={busy}>Sign in</button>
        </footer>
      </form>
    </Modal>
  );
}
