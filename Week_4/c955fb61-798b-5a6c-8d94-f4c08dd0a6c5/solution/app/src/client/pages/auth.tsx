import { useState, type FormEvent } from "react";
import type { Person } from "../../shared/types";
import { ApiFailure, call } from "../api";
import { navigate } from "../router";

const SIGN_UP_MESSAGES: Record<string, string> = {
  name: "Enter your name.",
  email: "Enter a valid email address.",
  password: "Password must be at least 10 characters.",
};

/** Only a path on this site is a place to return to after signing in. */
function destination(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function SignIn({ next, onSignedIn }: { next: string | null; onSignedIn: (person: Person) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [alertText, setAlertText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setAlertText("");
    try {
      const result = await call<{ user: Person }>("POST", "/api/session", { email, password });
      onSignedIn(result.body.user);
      navigate(destination(next), true);
    } catch (failure) {
      setAlertText(failure instanceof ApiFailure && failure.status === 401 ? "Email or password is incorrect." : "Your change could not be saved. Try again.");
    }
    setBusy(false);
  };

  return (
    <main className="auth">
      <h1>Sign in</h1>
      <form noValidate onSubmit={(event) => void submit(event)}>
        <label>
          <span>Email</span>
          <input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label>
          <span>Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <div role="alert" className="form-alert">
          {alertText}
        </div>
        <div className="form-actions">
          <button type="submit" className="primary" disabled={busy}>
            Sign in
          </button>
          <a href="/signup" onClick={(event) => { event.preventDefault(); navigate("/signup"); }}>
            Create an account
          </a>
        </div>
      </form>
    </main>
  );
}

export function SignUp({ onSignedIn }: { onSignedIn: (person: Person) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [alertText, setAlertText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setAlertText("");
    try {
      const result = await call<{ user: Person }>("POST", "/api/signup", { name, email, password });
      onSignedIn(result.body.user);
      navigate("/", true);
    } catch (failure) {
      const body = failure instanceof ApiFailure ? failure.body : {};
      setAlertText(body.error === "email_taken" ? "That email already has an account." : (SIGN_UP_MESSAGES[String(body.field)] ?? "Your change could not be saved. Try again."));
    }
    setBusy(false);
  };

  return (
    <main className="auth">
      <h1>Create your account</h1>
      <form noValidate onSubmit={(event) => void submit(event)}>
        <label>
          <span>Name</span>
          <input type="text" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          <span>Email</span>
          <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label>
          <span>Password</span>
          <input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <div role="alert" className="form-alert">
          {alertText}
        </div>
        <div className="form-actions">
          <button type="submit" className="primary" disabled={busy}>
            Create account
          </button>
          <a href="/signin" onClick={(event) => { event.preventDefault(); navigate("/signin"); }}>
            Sign in
          </a>
        </div>
      </form>
    </main>
  );
}
