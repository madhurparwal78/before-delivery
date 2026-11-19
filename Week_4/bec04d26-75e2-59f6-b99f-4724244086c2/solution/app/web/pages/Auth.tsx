import { type FormEvent, useRef, useState } from "react";
import type { FieldErrors } from "../../shared/types";
import { request } from "../api";
import { SERVER_ERROR } from "../copy";
import { announce, PRIORITY } from "../announce";
import { TextField, useFirstMessage } from "../components/Fields";
import { Link, navigate } from "../router";
import { homeFor, loadSession } from "../session";

interface Props {
  title: string;
  submit: string;
  path: string;
  fields: { key: "display_name" | "email" | "password"; label: string; type: "text" | "email" | "password"; autoComplete: string }[];
  other: { text: string; href: string };
}

function AuthForm({ title, submit, path, fields, other }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FieldErrors | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useFirstMessage(form, errors, false);

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const body = Object.fromEntries(fields.map((f) => [f.key, values[f.key] ?? ""]));
    const answer = await request<unknown>("POST", path, body);
    if (answer.ok) {
      const me = await loadSession();
      if (me) navigate(homeFor(me));
    } else if (answer.failure.kind === "fields") {
      setErrors({ ...answer.failure.errors });
    } else {
      announce(SERVER_ERROR, PRIORITY.fieldError);
    }
    setBusy(false);
  };

  return (
    <main className="auth">
      <p className="wordmark brand">Duefield</p>
      <form ref={form} onSubmit={onSubmit} noValidate className="panel">
        <h1>{title}</h1>
        {fields.map((f) => (
          <TextField key={f.key} label={f.label} type={f.type} autoComplete={f.autoComplete} value={values[f.key] ?? ""}
            onChange={(value) => setValues((v) => ({ ...v, [f.key]: value }))}
            error={errors?.[f.key]} />
        ))}
        <button type="submit" className="button primary" aria-disabled={busy}>{busy ? "Saving" : submit}</button>
        <p><Link href={other.href}>{other.text}</Link></p>
      </form>
    </main>
  );
}

export const SignIn = () => (
  <AuthForm title="Sign in" submit="Sign in" path="/api/auth/signin"
    fields={[{ key: "email", label: "Email", type: "email", autoComplete: "username" },
      { key: "password", label: "Password", type: "password", autoComplete: "current-password" }]}
    other={{ text: "Create a practice", href: "/sign-up" }} />
);

export const SignUp = () => (
  <AuthForm title="Create your practice" submit="Create practice" path="/api/auth/signup"
    fields={[{ key: "display_name", label: "Your name", type: "text", autoComplete: "name" },
      { key: "email", label: "Email", type: "email", autoComplete: "username" },
      { key: "password", label: "Password", type: "password", autoComplete: "new-password" }]}
    other={{ text: "Sign in", href: "/sign-in" }} />
);
