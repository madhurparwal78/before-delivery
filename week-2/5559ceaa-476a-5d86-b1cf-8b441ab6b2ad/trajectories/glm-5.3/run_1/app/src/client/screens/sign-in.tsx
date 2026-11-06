import { useState } from "react";
import { api, ApiCallError } from "../lib/api";

export function SignInPage({ erased }: { erased: boolean }): React.ReactElement {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const [fieldError, setFieldError] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const trimmed = email.trim();
    if (!trimmed || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
      setFieldError(true);
      setStatus("Enter an email address like name@example.com.");
      return;
    }
    setFieldError(false);
    setPending(true);
    setStatus("Sending your link…");
    try {
      await api("POST", "/api/auth/magic-link", { email: trimmed });
      setStatus("Check your inbox. The link works once.");
    } catch (err) {
      if (err instanceof ApiCallError && err.code === "mail_unavailable") {
        setStatus("Sign-in email can't be sent right now. Try again in a minute.");
      } else {
        setStatus("Something went wrong. Try again.");
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="signin-page">
      <main className="signin-card">
        <h1 className="product-name">Relay Bench</h1>
        {erased ? (
          <p className="erasure-notice" role="status">
            Your account and your work have been erased.
          </p>
        ) : null}
        <form onSubmit={submit} noValidate>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            aria-label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={fieldError}
            required
          />
          <button type="submit" disabled={pending}>
            Email me a sign-in link
          </button>
        </form>
        <p className="status" role="status" aria-label="Sign-in status">
          {status}
        </p>
      </main>
    </div>
  );
}
