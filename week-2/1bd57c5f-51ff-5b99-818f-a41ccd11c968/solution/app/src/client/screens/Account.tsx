import { useState, type FormEvent } from "react";
import { useAnnounce } from "../activity";
import { ApiFailure, api } from "../api";
import { ErrorSummary, FieldError, type FieldProblem } from "../components/ErrorSummary";
import { COPY } from "../copy";

const FIELDS = { current_password: "account-current", new_password: "account-new" } as const;

export function Account() {
  const announce = useAnnounce();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    announce(COPY.saving);
    try {
      await api("POST", "/api/me/password", { current_password: current, new_password: next });
      setErrors({});
      setCurrent("");
      setNext("");
      announce("Password changed. Every other session is signed out.");
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        setErrors(failure.body.fields ?? {});
        announce(failure.message);
      } else announce("Changing your password needs a connection.");
    } finally {
      setPending(false);
    }
  };

  const problems: FieldProblem[] = Object.entries(errors).map(([field, message]) => ({
    target: FIELDS[field as keyof typeof FIELDS] ?? FIELDS.current_password,
    message,
  }));

  return (
    <div className="page page--narrow">
      <h1>Account</h1>
      <form className="signin-card" onSubmit={submit} noValidate>
        <h2 className="section-title">Change password</h2>
        <ErrorSummary problems={problems} />
        <div className="field">
          <label htmlFor={FIELDS.current_password}>Current password</label>
          <input
            id={FIELDS.current_password}
            className="input"
            type="password"
            autoComplete="current-password"
            value={current}
            aria-invalid={errors.current_password ? true : undefined}
            aria-describedby={errors.current_password ? "account-current-error" : undefined}
            onChange={(e) => setCurrent(e.target.value)}
          />
          <FieldError id="account-current-error" message={errors.current_password} />
        </div>
        <div className="field">
          <label htmlFor={FIELDS.new_password}>New password</label>
          <input
            id={FIELDS.new_password}
            className="input"
            type="password"
            autoComplete="new-password"
            value={next}
            aria-invalid={errors.new_password ? true : undefined}
            aria-describedby={errors.new_password ? "account-new-error" : "account-new-hint"}
            onChange={(e) => setNext(e.target.value)}
          />
          <p className="hint" id="account-new-hint">
            At least 10 characters.
          </p>
          <FieldError id="account-new-error" message={errors.new_password} />
        </div>
        <button type="submit" className="btn btn--primary" disabled={pending} aria-busy={pending}>
          {pending ? COPY.saving : "Change password"}
        </button>
      </form>
    </div>
  );
}
