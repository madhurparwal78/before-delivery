import { useId, useState, type FormEvent } from "react";
import type { Account } from "../../shared/types";
import { Field } from "../forms/Field";
import { api, ApiError } from "../lib/api";
import { Link, useRouter } from "../lib/router";
import { homePath, useSession } from "../lib/session";
import { useStatus } from "../lib/status";
import "./pages.css";

export default function Signin() {
  const { navigate } = useRouter();
  const { setAccount } = useSession();
  const { announce } = useStatus();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const failureId = useId();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const signedIn = await api.post<{ account: Account }>("/api/auth/signin", { email: email.trim(), password });
      setAccount(signedIn.account);
      navigate(homePath(signedIn.account));
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      setFailure(error.message);
      announce(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="column page-body">
      <form className="card auth-card" onSubmit={(event) => void submit(event)} noValidate>
        <h1>Sign in</h1>
        <p className="hint">Educators and Personal makers sign in here. Students join with a class code.</p>
        <Field label="Email">
          {(control) => <input {...control} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Password">
          {(control) => (
            <input
              {...control}
              aria-describedby={failure ? failureId : undefined}
              aria-invalid={failure ? true : undefined}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        {failure ? <p className="field-error auth-failure" id={failureId}>{failure}</p> : null}
        <button className="pill stretch-narrow" type="submit" disabled={busy}>Sign in</button>
        <p className="hint auth-switch">New here? <Link to="/signup">Create an account</Link> or <Link to="/join">join a class</Link></p>
      </form>
    </div>
  );
}
