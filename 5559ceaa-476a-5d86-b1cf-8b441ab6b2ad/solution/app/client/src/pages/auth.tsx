import { useRef, useState } from "react";
import { api, Refusal, UNEXPECTED } from "../api";
import { ERASED_NOTICE } from "../header";
import { navigate } from "../router";
import type { User } from "../types";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EMAIL_ERROR = "Enter an email address like name@example.com.";

export function validEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <h1 id="auth-title" className="brand auth-brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">Relay Bench</span>
        </h1>
        {children}
      </section>
    </main>
  );
}

export function SignInPage({ notice }: { notice: unknown }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState(
    (notice as { notice?: string } | null)?.notice === ERASED_NOTICE ? "Your account and your work have been erased." : "",
  );
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  const send = async () => {
    if (!validEmail(email)) {
      setStatus(EMAIL_ERROR);
      field.current?.focus();
      return;
    }
    setBusy(true);
    setStatus("Sending your link…");
    try {
      await api("/api/auth/magic-link", { method: "POST", body: { email: email.trim() } });
      setStatus("Check your inbox. The link works once.");
    } catch (error) {
      const code = error instanceof Refusal ? error.code : "";
      setStatus(
        code === "mail_unavailable"
          ? "Sign-in email can't be sent right now. Try again in a minute."
          : code === "validation"
            ? EMAIL_ERROR
            : UNEXPECTED,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <form
        className="auth-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className="field">
          <span>Email</span>
          <input
            ref={field}
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-describedby="sign-in-status"
          />
        </label>
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          Email me a sign-in link
        </button>
        <p id="sign-in-status" role="status" aria-label="Sign-in status" className="region">
          {status}
        </p>
      </form>
    </Card>
  );
}

const VERIFY_ERRORS: Record<string, string> = {
  link_used: "This sign-in link has already been used. Request a new one.",
  link_expired: "This sign-in link has expired. Request a new one.",
  link_not_found: "This sign-in link isn't valid. Request a new one.",
  validation: "This sign-in link isn't valid. Request a new one.",
};

export function VerifyPage({ token }: { token: string }) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    setBusy(true);
    setStatus("Signing you in…");
    try {
      const result = await api<{ user: User; landing: string }>("/api/auth/verify", { method: "POST", body: { token } });
      navigate(result.landing);
    } catch (error) {
      setBusy(false);
      setStatus(VERIFY_ERRORS[error instanceof Refusal ? error.code : ""] ?? UNEXPECTED);
    }
  };

  return (
    <Card>
      <div className="auth-form">
        <button type="button" className="button button-primary" disabled={busy} onClick={() => void finish()}>
          {busy && <span className="spinner" aria-hidden="true" />}
          Finish signing in
        </button>
        <p role="status" aria-label="Sign-in status" className="region">
          {status}
        </p>
      </div>
    </Card>
  );
}
