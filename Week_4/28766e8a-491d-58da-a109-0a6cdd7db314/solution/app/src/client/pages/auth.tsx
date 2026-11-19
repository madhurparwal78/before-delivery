// Sign in and sign up (brief: Screens, Accounts). Both carry `next` across and return to it.
import { useState } from "preact/hooks";
import { copy } from "../../shared/copy";
import { safeNext } from "../../shared/redirect";
import { emailError, nameError, passwordError } from "../../shared/text";
import { announce } from "../announce";
import { api } from "../api";
import { Icon } from "../icons";

type Fields = Partial<Record<"name" | "email" | "password", string>>;

const LABELS = { name: "Name", email: "Email", password: "Password" } as const;

export function AuthPage({ mode }: { mode: "signin" | "signup" }) {
  const next = new URLSearchParams(location.search).get("next");
  const carry = next === null ? "" : `?next=${encodeURIComponent(next)}`;
  const [values, setValues] = useState({ name: "", email: "", password: "" });
  const [errors, setErrors] = useState<Fields>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fields = mode === "signup" ? (["name", "email", "password"] as const) : (["email", "password"] as const);

  const submit = async (e: Event) => {
    e.preventDefault();
    setFormError(null);
    const local: Fields = mode === "signup"
      ? Object.fromEntries(Object.entries({ name: nameError(values.name), email: emailError(values.email), password: passwordError(values.password) }).filter(([, v]) => v)) as Fields
      : {};
    if (Object.keys(local).length) {
      setErrors(local);
      announce(Object.values(local).join(" "));
      return;
    }
    setBusy(true);
    const res = await api<{ user: unknown }>("POST", mode === "signup" ? "/api/auth/signup" : "/api/auth/signin",
      mode === "signup" ? values : { email: values.email, password: values.password });
    setBusy(false);
    if (res.ok) {
      location.assign(safeNext(next));
      return;
    }
    if (mode === "signin") {
      setErrors({});
      setFormError(copy.signInError);
      announce(copy.signInError);
      return;
    }
    const found = (res.error.fields ?? {}) as Fields;
    setErrors(found);
    announce(Object.values(found).join(" ") || res.error.message);
  };

  const summary = formError ? [formError] : Object.values(errors);
  return (
    <main class="plain-page">
      <form class="plain-card auth-card" onSubmit={submit} noValidate>
        <p class="brand">Ferrule &amp; Pell <span>Linewell</span></p>
        <h1>{mode === "signin" ? "Sign in" : "Create an account"}</h1>
        {summary.length > 0 && (
          <div class="error-summary">
            <Icon name="alert" size={16} />
            <ul>
              {formError ? <li>{formError}</li> : Object.entries(errors).map(([field, message]) => (
                <li key={field}><a href={`#field-${field}`}>{message}</a></li>
              ))}
            </ul>
          </div>
        )}
        {fields.map((field) => (
          <div class="field" key={field}>
            <label for={`field-${field}`}>{LABELS[field]}</label>
            <input id={`field-${field}`} name={field} type={field === "password" ? "password" : field === "email" ? "email" : "text"}
              autocomplete={field === "password" ? (mode === "signup" ? "new-password" : "current-password") : field}
              value={values[field]} aria-invalid={errors[field] ? "true" : undefined}
              aria-describedby={errors[field] ? `error-${field}` : undefined}
              onInput={(e) => setValues({ ...values, [field]: e.currentTarget.value })} />
            {errors[field] && <p class="field-error" id={`error-${field}`}>{errors[field]}</p>}
          </div>
        ))}
        <button class="primary" type="submit" disabled={busy}>{mode === "signin" ? "Sign in" : "Create account"}</button>
        <p class="switch">
          {mode === "signin"
            ? <a class="text-link" href={`/signup${carry}`}>Create an account</a>
            : <a class="text-link" href={`/signin${carry}`}>Sign in instead</a>}
        </p>
      </form>
    </main>
  );
}
