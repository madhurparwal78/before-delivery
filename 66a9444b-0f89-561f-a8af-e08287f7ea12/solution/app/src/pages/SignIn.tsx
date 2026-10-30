// Sign in and create an account: one narrow form column at every size.
import { useState, type FormEvent } from "react";
import { api } from "../api.ts";
import { copy } from "../copy.ts";
import { navigate, useLocation } from "../router.ts";
import { useSession } from "../session.tsx";
import type { User } from "../types.ts";
import { Field } from "../components/Field.tsx";

function afterSignIn(next: string | null): void {
  navigate(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export function SignIn() {
  const { refresh } = useSession();
  const { search } = useLocation();
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    const r = await api.post<{ user: User }>("/api/auth/signin", { email: form.get("email"), password: form.get("password") });
    setBusy(false);
    if (!r.ok) return setProblem(copy.badCredentials);
    setProblem("");
    await refresh();
    afterSignIn(search.get("next"));
  };
  return (
    <div className="auth grid">
      <h1 className="display auth__title">Sign in</h1>
      <form className="auth__form" onSubmit={(e) => void submit(e)} noValidate>
        <Field label="Email"><input name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Password"><input name="password" type="password" autoComplete="current-password" required /></Field>
        <p role="alert" aria-label="Sign-in problem" className="field__error auth__problem">{problem}</p>
        <button type="submit" className="button button--primary" disabled={busy}>Sign in</button>
        <a className="auth__switch" href="/register" onClick={(e) => { e.preventDefault(); navigate(`/register${window.location.search}`); }}>Create an account</a>
      </form>
    </div>
  );
}

export function Register() {
  const { refresh } = useSession();
  const { search } = useLocation();
  const [problem, setProblem] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    const r = await api.post<{ user: User }>("/api/auth/register", { name: form.get("name"), email: form.get("email"), password: form.get("password") });
    setBusy(false);
    if (!r.ok) {
      if (r.error === "email_taken") { setErrors({}); return setProblem(copy.emailTaken); }
      const next = {
        ...(r.errors?.name ? { name: "Enter your name." } : {}),
        ...(r.errors?.email ? { email: "Enter a valid email address." } : {}),
        ...(r.errors?.password ? { password: "Use 10 to 200 characters." } : {}),
      };
      setErrors(next);
      return setProblem(Object.values(next).join(" "));
    }
    await refresh();
    afterSignIn(search.get("next"));
  };
  return (
    <div className="auth grid">
      <h1 className="display auth__title">Create account</h1>
      <form className="auth__form" onSubmit={(e) => void submit(e)} noValidate>
        <Field label="Name" error={errors.name}><input name="name" type="text" autoComplete="name" /></Field>
        <Field label="Email" error={errors.email}><input name="email" type="email" autoComplete="email" /></Field>
        <Field label="Password" hint="10 to 200 characters." error={errors.password}><input name="password" type="password" autoComplete="new-password" /></Field>
        <p role="alert" aria-label="Sign-in problem" className="field__error auth__problem">{problem}</p>
        <button type="submit" className="button button--primary" disabled={busy}>Create account</button>
        <a className="auth__switch" href="/signin" onClick={(e) => { e.preventDefault(); navigate("/signin"); }}>I already have an account</a>
      </form>
    </div>
  );
}
