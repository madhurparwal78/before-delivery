import { useState, type FormEvent } from "react";
import { BareTopBar } from "../components/Shell.tsx";
import { api } from "../lib.ts";
import type { User } from "../types.ts";

export function SignIn({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setStatus("Signing in.");
    const reply = await api<{ user: User }>("/api/session", { method: "POST", body: { email, password } });
    setBusy(false);
    if (reply.ok) {
      setStatus("");
      onSignedIn(reply.data.user);
    } else {
      setStatus(reply.status === 401 || reply.status === 422 ? "That email and password do not match." : reply.error.message ?? "");
    }
  };

  return (
    <>
      <BareTopBar />
      <main className="page page-signin" id="main">
        <form className="signin card-sheet" aria-label="Sign in" onSubmit={submit} noValidate>
          <h1 className="page-title">Sign in to Ditchbook</h1>
          <p className="muted">Wirrinbah Water Trust ordering and headgate desk.</p>
          <label className="field">
            <span className="field-label">Email</span>
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <button type="submit" className="btn btn-ink btn-block" disabled={busy}>Sign in</button>
          <p role="status" aria-label="Sign-in status" className={`status-line${status && !busy ? " status-alert" : ""}`}>{status}</p>
        </form>
      </main>
    </>
  );
}
