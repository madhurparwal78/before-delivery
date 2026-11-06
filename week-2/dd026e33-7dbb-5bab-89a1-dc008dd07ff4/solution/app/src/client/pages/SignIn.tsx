// Sign in (brief: Screens and layout › Sign in). The server decides where to land (return address).
import { useState } from "react";
import { HOUSE_NAME } from "../../shared/domain.js";
import { ErrorSummary, FieldError, summaryOf } from "../ui/Feedback.js";

const FIELD_ID: Record<string, string> = { email: "sign-in-email", password: "sign-in-password" };

export function SignIn({ revoked, onSignedIn }: { revoked: boolean; onSignedIn: (redirect: string) => Promise<void> }): JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState(revoked ? "Your access has been revoked." : "");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (): Promise<void> => {
    setPending(true);
    setRefusal("");
    setErrors({});
    const next = new URLSearchParams(window.location.search).get("next") ?? undefined;
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email, password, next }),
        credentials: "same-origin",
      });
      const body = (await response.json()) as { redirect?: string; errors?: Record<string, string> };
      if (response.ok && body.redirect) {
        await onSignedIn(body.redirect);
        return;
      }
      if (response.status === 422 && body.errors) setErrors(body.errors);
      else setRefusal("Email or password is wrong.");
    } catch {
      setRefusal("Email or password is wrong.");
    }
    setPending(false);
  };

  const items = summaryOf(errors, ["email", "password"]);
  return (
    <main className="sign-in">
      <form
        className="sign-in-card form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="brand-house">{HOUSE_NAME}</p>
        <h1>Sign in to Lacquer</h1>
        <ErrorSummary items={items} idFor={(field) => FIELD_ID[field] ?? field} extra={refusal ? <p>{refusal}</p> : undefined} />
        <div className="field">
          <label htmlFor={FIELD_ID.email}>Email</label>
          <input
            id={FIELD_ID.email}
            type="email"
            autoComplete="username"
            value={email}
            aria-invalid={errors.email ? true : undefined}
            onChange={(event) => setEmail(event.target.value)}
          />
          <FieldError id="sign-in-email-error" message={errors.email} />
        </div>
        <div className="field">
          <label htmlFor={FIELD_ID.password}>Password</label>
          <input
            id={FIELD_ID.password}
            type="password"
            autoComplete="current-password"
            value={password}
            aria-invalid={errors.password ? true : undefined}
            onChange={(event) => setPassword(event.target.value)}
          />
          <FieldError id="sign-in-password-error" message={errors.password} />
        </div>
        <button type="submit" className="button primary">
          Sign in
        </button>
        <p role="status" className="field-note">
          {pending ? "Signing in..." : ""}
        </p>
      </form>
    </main>
  );
}
