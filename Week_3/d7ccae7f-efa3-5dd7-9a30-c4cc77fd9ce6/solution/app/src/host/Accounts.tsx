import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { z } from "zod";
import { quizmasterSchema } from "../../shared/schemas";
import { Field, Status, Wordmark, describedBy, type StatusMessage } from "../components";
import { ApiFailure, api, fieldErrors } from "../lib/api";
import { useSession } from "../lib/session";

const accountReply = z.object({ quizmaster: quizmasterSchema });

type Mode = "login" | "signup";

export function AccountForm({ mode }: { mode: Mode }) {
  const { session, signedIn } = useSession();
  const navigate = useNavigate();
  const [message, setMessage] = useState<StatusMessage>({ tone: "idle", text: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (session.status === "signedIn") return <Navigate to="/host" replace />;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(["displayName", "email", "password"].flatMap((name) => (form.has(name) ? [[name, String(form.get(name))]] : [])));
    const missing: Record<string, string> = {};
    if (mode === "login" && !body["email"]) missing["email"] = "Enter your email address";
    if (mode === "login" && !body["password"]) missing["password"] = "Enter your password";
    setErrors(missing);
    if (Object.keys(missing).length > 0) return;
    setMessage({ tone: "pending", text: mode === "login" ? "Signing in…" : "Creating your account…" });
    try {
      const { quizmaster } = await api(mode === "login" ? "/api/auth/login" : "/api/auth/signup", { method: "POST", body, schema: accountReply });
      signedIn(quizmaster);
      navigate("/host", { replace: true });
    } catch (error) {
      setErrors(fieldErrors(error));
      const code = error instanceof ApiFailure ? error.body.error : "";
      const text =
        code === "invalid_credentials"
          ? "That email and password don't match."
          : code === "email_taken"
            ? "An account already uses that email."
            : code === "validation_failed"
              ? "Check the highlighted fields."
              : "Something went wrong. Try again.";
      setMessage({ tone: "error", text });
    }
  }

  return (
    <main className="account">
      <form className="account-form panel" onSubmit={(event) => void submit(event)} noValidate>
        <Wordmark size="var(--step-3)" />
        <h1 className="account-title">{mode === "login" ? "Quizmaster sign in" : "Create your account"}</h1>
        {mode === "signup" ? (
          <Field id="displayName" label="Display name" error={errors["displayName"]}>
            <input id="displayName" name="displayName" autoComplete="name" {...describedBy("displayName", errors["displayName"])} />
          </Field>
        ) : null}
        <Field id="email" label="Email" error={errors["email"]}>
          <input id="email" name="email" type="email" autoComplete="email" {...describedBy("email", errors["email"])} />
        </Field>
        <Field id="password" label="Password" error={errors["password"]}>
          <input id="password" name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} {...describedBy("password", errors["password"])} />
        </Field>
        <button type="submit" className="button-primary" aria-busy={message.tone === "pending"}>
          {mode === "login" ? "Sign in" : "Create account"}
        </button>
        <Status name="Account status" message={message.text} tone={message.tone} />
        <p className="account-switch">
          {mode === "login" ? <Link to="/host/signup">Create an account</Link> : <Link to="/host/login">Back to sign in</Link>}
        </p>
      </form>
    </main>
  );
}
