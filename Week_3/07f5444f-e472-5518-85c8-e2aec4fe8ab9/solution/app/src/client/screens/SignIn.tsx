// Sign in: email and passcode; the browser then goes to the role's landing route.

import { useRef, useState, type FormEvent } from "react";
import type { User } from "../../shared/api";
import { call } from "../api";

export function SignIn({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const email = useRef<HTMLInputElement>(null);
  const passcode = useRef<HTMLInputElement>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setError("");
    const answer = await call<{ user: User }>("POST", "/api/session", {
      email: email.current?.value ?? "",
      passcode: passcode.current?.value ?? "",
    });
    setPending(false);
    if (answer.ok) {
      onSignedIn(answer.data.user);
      return;
    }
    setError("That email and passcode don't match.");
    email.current?.focus();
  };

  return (
    <main className="signin">
      <form className="signin__form" onSubmit={submit} noValidate>
        <p className="signin__eyebrow">Music library</p>
        <h1 className="signin__title">Quirewell Stand Desk</h1>
        <p className="signin__lede">Programmes, cuts, folders and rental sets for the orchestra library.</p>
        <label className="field">
          <span className="field__label">Email</span>
          <input ref={email} className="field__control" name="email" type="email" autoComplete="username" required />
        </label>
        <label className="field">
          <span className="field__label">Passcode</span>
          <input ref={passcode} className="field__control" name="passcode" type="password" autoComplete="current-password" required />
        </label>
        <div role="alert" className="signin__error">
          {error}
        </div>
        <button className="button button--primary signin__submit" type="submit" disabled={pending}>
          {pending ? "Signing in" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
