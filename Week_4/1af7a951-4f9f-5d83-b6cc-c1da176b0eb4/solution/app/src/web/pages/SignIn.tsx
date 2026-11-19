import { useId, useState, type FormEvent } from "react";
import type { Session } from "../../shared/api";
import { api } from "../api";
import { COPY } from "../copy";
import { Status } from "../ui/Status";

export function SignIn({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const fieldId = useId();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!navigator.onLine) {
      setStatus(COPY.offlineSignIn);
      return;
    }
    setBusy(true);
    try {
      const result = await api<Session & { status?: string }>("POST", "/api/session", { access_code: code });
      if (result.status === 200) {
        onSignedIn({ role: result.data.role, name: result.data.name, id: result.data.id });
        return;
      }
      setStatus(
        result.data.status === "pending_payment" ? COPY.waitingCode : result.data.status === "refunded" ? COPY.refundedCode : COPY.badCode,
      );
    } catch {
      setStatus(COPY.offlineSignIn);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="column">
      <form className="panel form-stack" aria-labelledby={`${fieldId}-title`} onSubmit={(event) => void submit(event)}>
        <h1 id={`${fieldId}-title`}>Sign in</h1>
        <p className="hint">Use the access code from your enrollment receipt, or your coach code.</p>
        <div className="field">
          <label htmlFor={fieldId}>Access code</label>
          <input id={fieldId} className="input" autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <button type="submit" className="button primary" disabled={busy}>
          Sign in
        </button>
        <Status label="Sign in">{status}</Status>
      </form>
    </main>
  );
}
