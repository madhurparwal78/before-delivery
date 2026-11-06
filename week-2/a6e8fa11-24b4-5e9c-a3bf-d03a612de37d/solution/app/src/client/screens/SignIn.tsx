import { type FormEvent, useState } from "react";
import { ApiFailure, api } from "../api.js";
import { COPY } from "../copy.js";
import { navigate } from "../router.js";
import { type User } from "../types.js";
import { FieldError, Mark } from "../ui/Icon.js";

/** A small drawn trial plot: four replicate blocks of ruled plots with one check plot in rust. */
function PlotDrawing(): JSX.Element {
  const plots = [];
  for (let block = 0; block < 4; block++) {
    for (let p = 0; p < 3; p++) {
      const check = (block + p) % 3 === 2;
      plots.push(<rect key={`${block}-${p}`} x={8 + p * 26} y={8 + block * 18} width="22" height="14" rx="2" fill={check ? "var(--rust)" : "none"} stroke="var(--ink)" strokeWidth="1.4" opacity={check ? 0.9 : 0.75} />);
    }
  }
  return (
    <svg className="plot-drawing" width="96" height="88" viewBox="0 0 96 88" aria-hidden="true" focusable="false">
      {plots}
      <path d="M4 84h88" stroke="var(--rule-strong)" strokeWidth="1.2" strokeDasharray="3 3" />
    </svg>
  );
}

export function SignIn({ onSignedIn }: { onSignedIn: (u: User) => void }): JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api.post<{ user: User }>("/api/session", { email, password });
      onSignedIn(r.user);
      navigate("/", true);
    } catch (err) {
      setError(err instanceof ApiFailure && err.status === 401 ? COPY.wrongCredentials : "Sign-in didn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page page-center graph-ground">
      <form className="card card-narrow signin" onSubmit={(e) => void submit(e)} noValidate>
        <div className="signin-head">
          <div>
            <p className="mark-line">
              <Mark size={30} />
              <span className="mark-word">Furrowbook</span>
            </p>
            <h1>Sign in</h1>
            <p className="muted">Field-trial workbooks that keep every plot reading.</p>
          </div>
          <PlotDrawing />
        </div>
        <label className="field">
          <span>Email</span>
          <input type="email" name="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button type="submit" className="btn btn-primary btn-wide" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <FieldError>{error}</FieldError>
      </form>
    </main>
  );
}
