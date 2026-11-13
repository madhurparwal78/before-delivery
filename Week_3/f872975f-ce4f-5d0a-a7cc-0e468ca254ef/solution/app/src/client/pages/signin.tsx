import { useEffect, useState, type FormEvent } from "react";
import type { User } from "../../shared/api";
import { safeNext } from "../../shared/domain";
import { api, navigate, sessionStore, useSession } from "../api";

const nextPath = (): string => safeNext(new URLSearchParams(window.location.search).get("next"));

export function SignInPage() {
  const { loaded, user } = useSession();
  // Someone already signed in goes straight on to where they were heading.
  useEffect(() => {
    if (loaded && user !== null) navigate(nextPath(), true);
  }, [loaded, user]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    const r = await api<{ user: User }>("POST", "/api/session", { email, password });
    setPending(false);
    if (!r.ok) {
      setError(r.status === 401 || r.status === 422 ? "That email and password don't match." : "Something went wrong. Try again.");
      return;
    }
    sessionStore.set({ loaded: true, user: r.data.user });
  };
  return (
    <section className="signin">
      <h1>Sign in</h1>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <label className="field">
          <span>Email</span>
          <input type="email" name="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <div role="alert" className="error-line">{error}</div>
        <button type="submit" className="primary" disabled={pending}>{pending ? "Signing in" : "Sign in"}</button>
      </form>
    </section>
  );
}
