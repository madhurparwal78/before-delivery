import { useEffect, useRef, useState, type FormEvent } from "react";
import { EMAIL, fieldError } from "../../shared/notices.js";
import { safeRedirect } from "../../shared/redirect.js";
import { api } from "../api.js";
import { FieldMessage } from "../ui/FieldMessage.js";

type Field = "name" | "email" | "password";
const LABEL: Record<Field, string> = { name: "Name", email: "Email", password: "Password" };

/** `/signup` and `/signin`: one centred card on the gridded ground, with an error summary that links to each field. */
export function AuthPage({ mode }: { mode: "signup" | "signin" }) {
  const fields: Field[] = mode === "signup" ? ["name", "email", "password"] : ["email", "password"];
  const [values, setValues] = useState<Record<Field, string>>({ name: "", email: "", password: "" });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [busy, setBusy] = useState(false);
  const summary = useRef<HTMLDivElement>(null);
  const next = new URLSearchParams(location.search).get("next");
  const other = mode === "signup" ? "/signin" : "/signup";
  const otherHref = next ? `${other}?next=${encodeURIComponent(next)}` : other;

  const [attempt, setAttempt] = useState(0);
  const showErrors = (found: Partial<Record<Field, string>>) => {
    setErrors(found);
    setAttempt((n) => n + 1);
  };
  useEffect(() => {
    if (attempt) summary.current?.focus();
  }, [attempt]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const found: Partial<Record<Field, string>> = {};
    if (mode === "signup" && !values.name.trim()) found.name = fieldError.nameEmpty;
    if (!EMAIL.test(values.email.trim())) found.email = fieldError.emailInvalid;
    if (mode === "signup" && values.password.length < 10) found.password = fieldError.passwordShort;
    if (mode === "signin" && !values.password) found.password = fieldError.signInFailed;
    if (Object.keys(found).length) return showErrors(found);
    setBusy(true);
    const body = mode === "signup" ? values : { email: values.email, password: values.password };
    const result = await api<{ user: { id: string } }>("POST", mode === "signup" ? "/api/auth/signup" : "/api/auth/signin", body);
    setBusy(false);
    if (result.ok) return location.assign(safeRedirect(next, "/"));
    if (result.error.code === "email_taken") return showErrors({ email: fieldError.emailTaken });
    if (result.error.code === "invalid_credentials") return showErrors({ email: fieldError.signInFailed });
    const server: Partial<Record<Field, string>> = {};
    for (const f of fields) if (result.error.fields[f]) server[f] = result.error.fields[f];
    showErrors(Object.keys(server).length ? server : { email: result.error.message });
  };

  const listed = fields.filter((f) => errors[f]);
  return (
    <main className="pl-ground pl-auth">
      <div className="pl-card">
        <p className="pl-brand" aria-hidden="true">
          <span className="pl-brand-mark" /> Plinth
        </p>
        <h1>{mode === "signup" ? "Create your account" : "Sign in to Plinth"}</h1>
        {listed.length > 0 && (
          <div className="pl-error-summary" role="alert" tabIndex={-1} ref={summary}>
            <h2>There is a problem</h2>
            <ul>
              {listed.map((f) => (
                <li key={f}>
                  <a
                    href={`#field-${f}`}
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(`field-${f}`)?.focus();
                    }}
                  >
                    {errors[f]}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        <form onSubmit={submit} noValidate>
          {fields.map((f) => (
            <div className={`pl-field${errors[f] ? " pl-field-error" : ""}`} key={f}>
              <label htmlFor={`field-${f}`}>{LABEL[f]}</label>
              <input
                id={`field-${f}`}
                name={f}
                type={f === "password" ? "password" : f === "email" ? "email" : "text"}
                autoComplete={f === "password" ? (mode === "signup" ? "new-password" : "current-password") : f}
                value={values[f]}
                aria-invalid={errors[f] ? true : undefined}
                aria-describedby={errors[f] ? `error-${f}` : undefined}
                onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
              />
              {errors[f] && <FieldMessage id={`error-${f}`}>{errors[f] as string}</FieldMessage>}
            </div>
          ))}
          <button type="submit" className="pl-primary pl-wide" aria-busy={busy || undefined} disabled={busy}>
            {mode === "signup" ? "Sign up" : "Sign in"}
          </button>
        </form>
        <p className="pl-switch">
          {mode === "signup" ? "Already have an account? " : "New to Plinth? "}
          <a href={otherHref}>{mode === "signup" ? "Sign in" : "Create an account"}</a>
        </p>
      </div>
    </main>
  );
}
