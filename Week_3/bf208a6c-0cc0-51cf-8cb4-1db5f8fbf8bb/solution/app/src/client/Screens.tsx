import { useState, type FormEvent } from "react";
import { Link } from "./router";

export function NotFound() {
  return (
    <main className="page narrow">
      <Link href="/" className="brand">
        Pinsheet
      </Link>
      <h1>Board not found</h1>
      <p>This board doesn't exist, or you don't have access to it.</p>
    </main>
  );
}

export function PasswordScreen({ onUnlock }: { onUnlock: (password: string) => Promise<boolean> }) {
  const [password, setPassword] = useState("");
  const [refused, setRefused] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setRefused(!(await onUnlock(password)));
    setBusy(false);
  };
  return (
    <main className="page narrow">
      <Link href="/" className="brand">
        Pinsheet
      </Link>
      <h1>This board is password protected</h1>
      <form className="form" onSubmit={(event) => void submit(event)}>
        <div className="field">
          <label htmlFor="unlock-password">Board password</label>
          <input id="unlock-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="off" />
        </div>
        <div role="alert" className="field-error">
          {refused ? "That password didn't open this board." : ""}
        </div>
        <button type="submit" aria-busy={busy}>
          {busy ? "Opening…" : "Open board"}
        </button>
      </form>
    </main>
  );
}
