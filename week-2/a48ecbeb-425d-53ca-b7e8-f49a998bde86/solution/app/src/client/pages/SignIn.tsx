import { useId, useState, type FormEvent } from "react";
import { api, ApiFailure } from "../lib/api";
import { Link, navigate, useLocation } from "../lib/router";
import type { User } from "../lib/types";
import { useShop } from "../state/shop";

/** Only same-site paths are followed after signing in. */
function safeNext(next: string | null, user: User): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return user.role === "customer" ? "/account" : "/office";
}

const ACCOUNT_COPY: Record<string, string> = {
  invalid_credentials: "That email and password don't match.",
  email_taken: "An account with that email already exists.",
  accounts_unavailable: "Sign-in is unavailable right now. Your crate is still held.",
  store_unavailable: "Sign-in is unavailable right now. Your crate is still held.",
};

export function AccountForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const { refreshUser, refreshCart } = useShop();
  const { search } = useLocation();
  const id = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const signUp = mode === "sign-up";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setStatus(signUp ? "Creating your account." : "Signing you in.");
    try {
      const { user } = await api<{ user: User }>("POST", signUp ? "/api/auth/sign-up" : "/api/auth/sign-in", signUp ? { name, email, password } : { email, password });
      await refreshUser();
      await refreshCart();
      setStatus("");
      navigate(safeNext(search.get("next"), user));
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "validation") {
        setErrors(error.body.fields ?? {});
        setStatus("Check the highlighted fields.");
      } else {
        setStatus(error instanceof ApiFailure ? (ACCOUNT_COPY[error.code] ?? error.message) : ACCOUNT_COPY.accounts_unavailable);
      }
    } finally {
      setBusy(false);
    }
  };

  const field = (key: "name" | "email" | "password", label: string, value: string, set: (v: string) => void, type: string, auto: string) => (
    <div className="field">
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <input
        id={`${id}-${key}`}
        type={type}
        autoComplete={auto}
        value={value}
        onChange={(e) => set(e.target.value)}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={errors[key] ? `${id}-${key}-error` : undefined}
      />
      {errors[key] && (
        <p className="field-error" id={`${id}-${key}-error`}>
          {errors[key]}
        </p>
      )}
    </div>
  );

  const next = search.get("next");
  const other = signUp ? "/sign-in" : "/sign-up";
  return (
    <div className="page page-narrow account-form">
      <div className="panel">
        <h1>{signUp ? "Create your account" : "Sign in"}</h1>
        <p className="lede">{signUp ? "An account keeps your addresses, orders and auto-delivery in one place." : "Welcome back. Your crate stays held while you sign in."}</p>
        <form onSubmit={submit} noValidate>
          {signUp && field("name", "Name", name, setName, "text", "name")}
          {field("email", "Email", email, setEmail, "email", "email")}
          {field("password", "Password", password, setPassword, "password", signUp ? "new-password" : "current-password")}
          {signUp && <p className="hint">Use 10 to 128 characters.</p>}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {signUp ? "Create account" : "Sign in"}
          </button>
          <p className="status-line" role="status" aria-label="Account status">
            {status}
          </p>
        </form>
        <p className="muted">
          {signUp ? "Already have an account? " : "New to Ceibo? "}
          <Link className="text-link" href={next ? `${other}?next=${encodeURIComponent(next)}` : other}>{signUp ? "Sign in" : "Create an account"}</Link>
        </p>
      </div>
    </div>
  );
}
