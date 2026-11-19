import { useState, type FormEvent } from "react";
import type { User } from "../shared/api";
import { call } from "./api";
import { useBusy } from "./hooks";

export const homeOf = (user: User): string => (user.role === "housekeeper" ? "/board" : "/desk");

export function SignIn({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, guard] = useBusy();

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void guard(async () => {
      setMessage("Signing in…");
      const answer = await call<{ user: User }>("POST", "/api/session", { email, password });
      if (answer.ok) onSignedIn(answer.data.user);
      else setMessage(answer.error);
    });
  };

  return (
    <main className="page signin">
      <form onSubmit={submit} className="sheet">
        <h1>Tallybell Nightroll</h1>
        <p className="muted">Sign in to the front desk.</p>
        <label>
          Email
          <input type="email" value={email} autoComplete="username" onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label>
          Password
          <input type="password" role="textbox" value={password} autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} />
        </label>
        <button type="submit" className="primary" aria-busy={busy}>Sign in</button>
        <div role="status" aria-label="Sign-in status" className="notice">{message}</div>
      </form>
    </main>
  );
}
