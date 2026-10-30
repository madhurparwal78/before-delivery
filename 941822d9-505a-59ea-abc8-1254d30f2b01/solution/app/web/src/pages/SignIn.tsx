import { useState, type FormEvent } from "react";
import { api, type User } from "../api";
import { Alert, describeFailure, FieldError } from "../ui/feedback";
import { navigate } from "../ui/router";

export function SignIn({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setAlert(null);
    try {
      const body = await api<{ user: User }>("POST", "/api/session", { email, password });
      setFields({});
      onSignedIn(body.user);
      navigate("/courses");
    } catch (error) {
      const failure = describeFailure(error);
      setFields(failure.fields);
      setAlert(failure.alert);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="centre">
      <form className="card" onSubmit={submit} noValidate>
        <div className="stack">
          <p className="eyebrow">Sorrel &amp; Pike Learning</p>
          <h1>Sign in to Credwell</h1>
          <p className="muted">Continuing education for licensed nurses, with one sealed certificate per course.</p>
        </div>
        {alert && <Alert>{alert}</Alert>}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={fields.email ? true : undefined}
            aria-describedby={fields.email ? "email-error" : undefined}
          />
          <FieldError id="email-error" message={fields.email} />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={fields.password ? true : undefined}
            aria-describedby={fields.password ? "password-error" : undefined}
          />
          <FieldError id="password-error" message={fields.password} />
        </div>
        <button type="submit" className={`btn${pending ? " busy" : ""}`} disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
