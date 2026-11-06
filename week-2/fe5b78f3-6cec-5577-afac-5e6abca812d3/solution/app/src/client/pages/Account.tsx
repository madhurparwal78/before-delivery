// Sign in (`/signin`) and Create account (`/register`). Both keep `next`; landing follows the return-path rule.
import { type FormEvent, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Account as AccountBody } from "../../shared/api";
import { useRibbon } from "../components/Shell";
import { ApiFailure, api } from "../lib/api";
import { landingAfterSignIn } from "../lib/returnPath";
import { Link, historyState, navigate, useLocation } from "../lib/router";
import { useSession } from "../lib/session";

interface FieldSpec {
  key: string;
  label: string;
  type: string;
  autoComplete: string;
}

const SIGN_IN: FieldSpec[] = [
  { key: "email", label: "Email", type: "email", autoComplete: "email" },
  { key: "password", label: "Password", type: "password", autoComplete: "current-password" },
];
const REGISTER: FieldSpec[] = [
  { key: "name", label: "Full name", type: "text", autoComplete: "name" },
  { key: "email", label: "Email", type: "email", autoComplete: "email" },
  { key: "phone", label: "Mobile number", type: "tel", autoComplete: "tel" },
  { key: "password", label: "Password", type: "password", autoComplete: "new-password" },
];

export function Account({ mode }: { mode: "signin" | "register" }) {
  const { search, path } = useLocation();
  const { signedIn } = useSession();
  const fields = mode === "signin" ? SIGN_IN : REGISTER;
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState(
    mode === "signin" && historyState().sessionEnded ? "Your session ended. Sign in again to finish this booking. Nothing was charged." : "",
  );
  const [busy, setBusy] = useState(false);
  const summary = useRef<HTMLDivElement>(null);
  useRibbon([]);
  useEffect(() => {
    if (Object.keys(errors).length) summary.current?.focus();
  }, [errors]);
  const query = path.slice(path.indexOf("?") >= 0 ? path.indexOf("?") : path.length);
  const next = search.get("next");

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      const body = mode === "signin" ? { email: values.email ?? "", password: values.password ?? "" } : {
        name: values.name ?? "", email: values.email ?? "", phone: values.phone ?? "", password: values.password ?? "",
      };
      const account = await api<AccountBody>(mode === "signin" ? "/api/session" : "/api/accounts", { method: "POST", body });
      flushSync(() => signedIn(account));
      navigate(landingAfterSignIn(query), { replace: true });
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (error.status === 422) {
        setProblem("");
        setErrors(error.body?.errors ?? {});
      } else {
        setErrors({});
        setProblem(
          error.code === "invalid_credentials"
            ? "Email or password is wrong."
            : error.code === "email_taken"
              ? "An account already uses this email."
              : "Can't reach Pakka right now. Try again.",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const other = mode === "signin" ? "/register" : "/signin";
  const otherHref = next === null ? other : `${other}?next=${encodeURIComponent(next)}`;
  return (
    <section className="panel stack account-card" aria-labelledby="account-title">
      <h1 id="account-title">{mode === "signin" ? "Sign in" : "Create account"}</h1>
      <div role="alert" aria-label="Sign-in problem" className="alert-region">
        {problem}
      </div>
      {Object.keys(errors).length ? (
        <div className="problems" role="alert" aria-label="Form problems" tabIndex={-1} ref={summary}>
          <h2>Check these fields</h2>
          <ul>
            {Object.entries(errors).map(([key, message]) => (
              <li key={key}>
                <a href={`#account-${key}`} onClick={(e) => { e.preventDefault(); document.getElementById(`account-${key}`)?.focus(); }}>
                  {message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <form className="stack" onSubmit={(e) => void submit(e)} noValidate>
        {fields.map((f) => (
          <div className="field" key={f.key}>
            <label htmlFor={`account-${f.key}`}>{f.label}</label>
            <input
              id={`account-${f.key}`}
              type={f.type}
              autoComplete={f.autoComplete}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              aria-invalid={errors[f.key] ? true : undefined}
              aria-describedby={errors[f.key] ? `account-${f.key}-error` : undefined}
            />
            {errors[f.key] ? <span className="field-error" id={`account-${f.key}-error`}>{errors[f.key]}</span> : null}
          </div>
        ))}
        <div className="row">
          <button type="submit" className="button primary" disabled={busy}>
            {mode === "signin" ? "Sign in" : "Create account"}
          </button>
          <Link href={otherHref} className="account-switch">{mode === "signin" ? "Create account" : "Sign in instead"}</Link>
        </div>
      </form>
    </section>
  );
}
