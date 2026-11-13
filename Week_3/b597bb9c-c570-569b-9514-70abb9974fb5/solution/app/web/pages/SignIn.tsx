import { useState, type ReactNode } from "react";
import { api, ApiError } from "../lib/api";
import { clearNotices, notify } from "../lib/notices";
import { navigate } from "../lib/router";
import { Notices, onSubmit, TextField } from "../ui";

export function SignIn(): ReactNode {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);

  const signIn = async (): Promise<void> => {
    setPending(true);
    notify("Signing in…");
    try {
      await api.post("/api/session", { email, password });
      clearNotices();
      navigate("/", true);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <header className="band">
        <div className="band-row">
          <span className="brand title">Gatecut</span>
        </div>
      </header>
      <Notices />
      <main className="sheet-form">
        <form onSubmit={onSubmit(() => void signIn())} aria-label="Sign in">
          <TextField label="Email" name="email" type="email" value={email} onChange={setEmail} />
          <TextField label="Password" name="password" type="password" value={password} onChange={setPassword} />
          <button type="submit" disabled={pending}>
            Sign in
          </button>
        </form>
      </main>
    </>
  );
}
