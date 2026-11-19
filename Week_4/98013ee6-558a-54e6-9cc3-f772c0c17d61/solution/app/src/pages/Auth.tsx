import { useState, type FormEvent } from "react";
import { api, ApiFailure, GENERIC_ERROR } from "../lib/api";
import { navigate, params, safeNext, useLocation } from "../lib/router";
import { useSession } from "../session";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Link } from "../ui/Link";
import { InlineAlert } from "../ui/InlineAlert";

const SIGN_UP_ERRORS: Record<string, string> = {
  email: "Enter a valid email address.",
  password: "Use at least 8 characters.",
  handle: "Use 3 to 20 lowercase letters, digits or underscores.",
  name: "Add your name.",
};

function AuthFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="auth">
      <Link to="/" className="wordmark">MOTHLIGHT</Link>
      <div className="auth-column">
        <h1 className="auth-title">{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function SignIn() {
  const { refresh } = useSession();
  const location = useLocation();
  const next = safeNext(params(location.search).get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/session", { email, password });
      await refresh();
      navigate(next, { replace: true });
    } catch (failure) {
      setError(failure instanceof ApiFailure && failure.status === 401 ? "That email and password don't match." : GENERIC_ERROR);
      setBusy(false);
    }
  };

  return (
    <AuthFrame title="Sign in">
      <form className="stack" noValidate onSubmit={(event) => void submit(event)}>
        <Field label="Email">{(props) => <input {...props} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />}</Field>
        <Field label="Password">{(props) => <input {...props} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />}</Field>
        {error ? <InlineAlert>{error}</InlineAlert> : null}
        <Button variant="primary" type="submit" busy={busy} busyLabel="Signing in">Sign in</Button>
      </form>
      <p className="auth-switch">
        New here? <Link to={`/signup${next === "/" ? "" : `?next=${encodeURIComponent(next)}`}`}>Sign up</Link>
      </p>
    </AuthFrame>
  );
}

export function SignUp() {
  const { refresh } = useSession();
  const location = useLocation();
  const next = safeNext(params(location.search).get("next"));
  const [fields, setFields] = useState({ name: "", email: "", handle: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const set = (key: keyof typeof fields, value: string): void => setFields((held) => ({ ...held, [key]: value }));

  const create = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setFailure(null);
    try {
      await api.post("/api/accounts", fields);
      setSentTo(fields.email);
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "handle_taken") setErrors({ handle: "That handle is taken." });
      else if (error instanceof ApiFailure && error.field && SIGN_UP_ERRORS[error.field]) setErrors({ [error.field]: SIGN_UP_ERRORS[error.field] ?? GENERIC_ERROR });
      else setFailure(GENERIC_ERROR);
    }
    setBusy(false);
  };

  const submitCode = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setCodeError(null);
    try {
      await api.post("/api/accounts/confirm", { email: sentTo, code });
      await refresh();
      navigate(next, { replace: true });
    } catch (error) {
      setCodeError(error instanceof ApiFailure && error.status === 422 ? "That code doesn't match." : GENERIC_ERROR);
      setBusy(false);
    }
  };

  if (sentTo !== null) {
    return (
      <AuthFrame title="Check your email">
        <p>{`We sent a code to ${sentTo}.`}</p>
        <form className="stack" noValidate onSubmit={(event) => void submitCode(event)}>
          <Field label="Code" error={codeError}>
            {(props) => <input {...props} type="text" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} />}
          </Field>
          <Button variant="primary" type="submit" busy={busy} busyLabel="Confirming">Confirm</Button>
        </form>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Sign up">
      <form className="stack" noValidate onSubmit={(event) => void create(event)}>
        <Field label="Name" error={errors["name"]}>{(props) => <input {...props} type="text" autoComplete="name" value={fields.name} onChange={(event) => set("name", event.target.value)} />}</Field>
        <Field label="Email" error={errors["email"]}>{(props) => <input {...props} type="email" autoComplete="email" value={fields.email} onChange={(event) => set("email", event.target.value)} />}</Field>
        <Field label="Handle" error={errors["handle"]}>{(props) => <input {...props} type="text" autoComplete="username" autoCapitalize="none" value={fields.handle} onChange={(event) => set("handle", event.target.value)} />}</Field>
        <Field label="Password" error={errors["password"]}>{(props) => <input {...props} type="password" autoComplete="new-password" value={fields.password} onChange={(event) => set("password", event.target.value)} />}</Field>
        {failure ? <InlineAlert>{failure}</InlineAlert> : null}
        <Button variant="primary" type="submit" busy={busy} busyLabel="Creating account">Create account</Button>
      </form>
      <p className="auth-switch">
        Already collecting? <Link to={`/signin${next === "/" ? "" : `?next=${encodeURIComponent(next)}`}`}>Sign in</Link>
      </p>
    </AuthFrame>
  );
}
