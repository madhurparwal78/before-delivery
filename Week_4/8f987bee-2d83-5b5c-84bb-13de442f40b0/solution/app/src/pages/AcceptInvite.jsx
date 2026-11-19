import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Field from "../components/Field.jsx";
import Logo from "../components/Logo.jsx";
import { DB_OUTAGE, OUTAGE } from "../console/api.js";
import { session } from "../console/session.js";

const REFUSALS = {
  invite_used: "This invitation has already been used.",
  not_found: "This invitation link is not valid.",
  invite_expired: "This invitation has expired. Ask an admin for a new one.",
  invite_unusable: "This invitation link is not valid.",
};

export default function AcceptInvite() {
  const navigate = useNavigate();
  const [invitationToken] = useState(() => (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("token") || ""));
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [outage, setOutage] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setFieldError("");
    setOutage("");
    try {
      const response = await fetch("/api/auth/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invite_token: invitationToken, password }),
      });
      const body = await response.json().catch(() => null);
      if (response.ok) {
        session.set(body.token);
        navigate("/app");
        return;
      }
      if (response.status === 503 && body?.error === "service_unavailable") setOutage(DB_OUTAGE);
      else if (response.status >= 500 || !body) setOutage(OUTAGE);
      else if (body.error === "validation" && body.fields?.password) setFieldError(body.fields.password);
      else setMessage(REFUSALS[body.error] || REFUSALS.not_found);
    } catch {
      setOutage(OUTAGE);
    }
    setPending(false);
  };

  return (
    <main className="auth">
      <form className="auth-card" onSubmit={submit} noValidate>
        <Logo />
        <h1>Join your workspace</h1>
        <p>Choose a password of at least 12 characters to accept the invitation.</p>
        {outage && <p role="alert" className="alert">{outage}</p>}
        <Field label="Password" error={fieldError}>
          {(control) => <input {...control} className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Accepting…" : "Accept invitation"}</button>
        <p role="status" aria-label="Invitation status" className="status-line">{message || fieldError}</p>
      </form>
    </main>
  );
}
