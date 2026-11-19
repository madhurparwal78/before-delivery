import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Field from "../components/Field.jsx";
import Logo from "../components/Logo.jsx";
import { DB_OUTAGE, OUTAGE } from "../console/api.js";
import { session } from "../console/session.js";


export default function Login() {
  const navigate = useNavigate();
  const [next] = useState(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("next")));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [outage, setOutage] = useState("");

  // Someone already signed in has nothing to do here: straight to the console, replacing this entry.
  useEffect(() => {
    if (session.get()) navigate("/app", { replace: true });
  }, [navigate]);

  const submit = async (event) => {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setOutage("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next === null ? { email, password } : { email, password, next }),
      });
      const body = await response.json().catch(() => null);
      if (response.ok) {
        session.set(body.token);
        navigate(body.redirect_to);
        return;
      }
      if (response.status === 429) {
        const minutes = Math.ceil(Number(response.headers.get("Retry-After")) / 60);
        setMessage(`Too many sign-in attempts. Try again in ${minutes} min.`);
      } else if (response.status === 401) setMessage("Email or password is incorrect.");
      else if (response.status === 503 && body?.error === "service_unavailable") setOutage(DB_OUTAGE);
      else if (response.status >= 500) setOutage(OUTAGE);
      else setMessage("Enter your email and password.");
    } catch {
      setOutage(OUTAGE);
    }
    setPending(false);
  };

  return (
    <main className="auth">
      <form className="auth-card" onSubmit={submit} noValidate>
        <Logo />
        <h1>Sign in</h1>
        <p>Use the email your workspace admin invited.</p>
        {outage && <p role="alert" className="alert">{outage}</p>}
        <Field label="Email">
          {(control) => <input {...control} className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Password">
          {(control) => <input {...control} className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
        <p role="status" aria-label="Sign-in status" className="status-line" style={{ color: message ? "var(--danger)" : undefined }}>{message}</p>
        <p className="field-hint">New here? Ask an admin for an invitation. <Link to="/">Back to Wayline</Link></p>
      </form>
    </main>
  );
}
