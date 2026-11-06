import { useState, type FormEvent } from "react";
import { api, RequestError } from "../lib/api";
import { navigate, useLocation } from "../lib/router";
import { homeFor, useSession } from "../session";
import { COPY } from "../../shared/copy";
import type { User } from "../../shared/domain";

/** A `next` address is followed only when it is a path on this site. */
function safeNext(search: string): string | null {
  const next = new URLSearchParams(search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : null;
}

export function SignIn() {
  const { search } = useLocation();
  const { setUser } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const { user } = await api<{ user: User }>("/api/session", { body: { email, password } });
      setUser(user);
      navigate(safeNext(search) ?? homeFor(user));
      window.scrollTo(0, 0);
    } catch (failure) {
      setError(failure instanceof RequestError && failure.status === 401 ? COPY.signInError : "We couldn't sign you in right now. Try again in a moment.");
      setPending(false);
    }
  };

  return (
    <section className="page page--narrow">
      <p className="eyebrow">Client portal and studio</p>
      <h1>Sign in</h1>
      <form className="sheet-form" onSubmit={submit} noValidate>
        {error ? <p role="alert" className="form-alert">{error}</p> : null}
        <div className="field">
          <label htmlFor="sign-in-email">Email</label>
          <input id="sign-in-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="sign-in-password">Password</label>
          <input id="sign-in-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <button type="submit" className="button button--primary" disabled={pending}>
          Sign in
        </button>
      </form>
    </section>
  );
}
