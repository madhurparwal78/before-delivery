// Sign in and sign up (DP-54): one centred form each.
import { useRef, useState, type FormEvent } from "react";
import type { ApiError } from "../shared/api";
import { KeyedAction } from "./api";
import { PageHeading } from "./chrome";
import { Icon } from "./icons";
import { Alert } from "./partDialogs";
import { navigate, queryOf, useLocation } from "./router";
import { useSession } from "./session";
import { Link } from "./shell";

function FieldError({ message }: { message?: string }) {
  return message ? (
    <p className="field-error">
      <Icon name="alert" size={16} />
      {message}
    </p>
  ) : null;
}

export function SignInPage() {
  const { search } = useLocation();
  const query = queryOf(search);
  const next = query.get("next");
  const { refresh } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [alert, setAlert] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const action = useRef(new KeyedAction());

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setAlert(null);
    const reply = await action.current.send<{ landing: string } & ApiError>("POST", "/api/auth/signin", { email, password, ...(next !== null ? { next } : {}) });
    setPending(false);
    if (!reply) setAlert("Not sent yet. Try again.");
    else if (reply.ok) {
      await refresh();
      navigate((reply.data as { landing: string }).landing);
    } else setAlert(reply.data.message);
  };

  return (
    <div className="auth">
      <PageHeading>Sign in</PageHeading>
      {query.get("expired") === "1" ? (
        <p className="notice">
          <Icon name="info" size={16} />
          This link has expired or was already used.
        </p>
      ) : null}
      <form onSubmit={submit} className="stack">
        <label className="stacked">
          <span>Email</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
        </label>
        <label className="stacked">
          <span>Password</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
        </label>
        {alert ? <Alert>{alert}</Alert> : null}
        <button type="submit" className="button primary" disabled={pending}>
          <span className={pending ? "busy" : undefined}>Sign in</span>
        </button>
        <Link to="/signup" className="button">
          Create an account
        </Link>
      </form>
    </div>
  );
}

export function SignUpPage() {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const action = useRef(new KeyedAction());

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setErrors({});
    setAlert(null);
    const reply = await action.current.send<ApiError>("POST", "/api/auth/signup", { email, password, displayName, next: "/dashboard" });
    setPending(false);
    if (!reply) setAlert("Not sent yet. Try again.");
    else if (reply.status === 201) setSent(`Check your inbox: we sent a link to ${email}.`);
    else if (reply.status === 409) setErrors({ email: reply.data.message });
    else if (reply.status === 422 && reply.data.errors) setErrors(reply.data.errors);
    else setAlert(reply.data.message);
  };

  return (
    <div className="auth">
      <PageHeading>Create an account</PageHeading>
      <form onSubmit={submit} className="stack">
        <label className="stacked">
          <span>Email</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
        </label>
        <FieldError message={errors.email} />
        <label className="stacked">
          <span>Display name</span>
          <input type="text" value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="nickname" />
        </label>
        <FieldError message={errors.displayName} />
        <label className="stacked">
          <span>Password</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
        </label>
        <FieldError message={errors.password} />
        {sent ? <p className="success">{sent}</p> : null}
        {alert ? <Alert>{alert}</Alert> : null}
        <button type="submit" className="button primary" disabled={pending}>
          <span className={pending ? "busy" : undefined}>Create account</span>
        </button>
        <Link to="/signin" className="button">
          I already have an account
        </Link>
      </form>
    </div>
  );
}
