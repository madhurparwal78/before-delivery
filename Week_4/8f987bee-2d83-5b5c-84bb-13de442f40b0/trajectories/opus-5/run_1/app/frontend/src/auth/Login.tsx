import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Field, LiveStatus } from "../components/ui";
import { Logo } from "../components/Icon";
import { api, RequestError, readToken } from "../lib/api";
import { DATABASE_OUTAGE_COPY, OUTAGE_COPY } from "../lib/copy";
import { useSession, type User } from "../lib/session";

const WRONG_PASSWORD = "Email or password is incorrect.";

export function Login(): JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [outage, setOutage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const session = useSession();
  const next = new URLSearchParams(location.search).get("next");

  useEffect(() => {
    if (readToken() && session.signedIn) navigate("/app", { replace: true });
  }, [session.signedIn, navigate]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setOutage(null);
    try {
      const answer = await api<{ token: string; user: User; redirect_to: string }>(
        "POST",
        "/api/auth/login",
        { body: next === null ? { email, password } : { email, password, next }, anonymous: true },
      );
      session.signIn(answer.token, answer.user);
      navigate(answer.redirect_to, { replace: true });
    } catch (error) {
      const refusal = error as RequestError;
      if (refusal.code === "invalid_credentials") setMessage(WRONG_PASSWORD);
      else if (refusal.code === "too_many_attempts") {
        const minutes = Math.ceil((refusal.retryAfter ?? 60) / 60);
        setMessage(`Too many sign-in attempts. Try again in ${minutes} min.`);
      } else if (refusal.code === "service_unavailable") setOutage(DATABASE_OUTAGE_COPY);
      else if (refusal.status === 0 || refusal.status >= 500) setOutage(OUTAGE_COPY);
      else setMessage(Object.values(refusal.fields)[0] ?? WRONG_PASSWORD);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="auth-page dotted">
      <form className="auth-card" onSubmit={submit}>
        <p className="logo">
          <Logo />
        </p>
        <h1 style={{ fontSize: "1.8rem" }}>Sign in to Wayline</h1>
        {outage ? (
          <div className="alert" role="alert">
            {outage}
          </div>
        ) : null}
        <Field label="Email">
          {(attributes) => (
            <input
              {...attributes}
              type="text"
              value={email}
              autoComplete="username"
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </Field>
        <Field label="Password">
          {(attributes) => (
            <input
              {...attributes}
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>
        <button type="submit" className="button" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
        <LiveStatus name="Sign-in status" message={message} />
      </form>
    </div>
  );
}

export function AcceptInvite(): JSX.Element {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const session = useSession();
  const token = new URLSearchParams(location.search).get("token") ?? "";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setFieldError(null);
    try {
      const answer = await api<{ token: string; user: User }>("POST", "/api/auth/accept-invite", {
        body: { invite_token: token, password },
        anonymous: true,
      });
      session.signIn(answer.token, answer.user);
      navigate("/app", { replace: true });
    } catch (error) {
      const refusal = error as RequestError;
      if (refusal.code === "validation") setFieldError(Object.values(refusal.fields)[0] ?? null);
      else if (refusal.code === "invite_used") setMessage("This invitation has already been used.");
      else if (refusal.code === "not_found") setMessage("This invitation link is not valid.");
      else if (refusal.code === "invite_expired")
        setMessage("This invitation has expired. Ask an admin for a new one.");
      else if (refusal.code === "invite_unusable") setMessage("This invitation link is not valid.");
      else if (refusal.code === "service_unavailable") setMessage(DATABASE_OUTAGE_COPY);
      else setMessage(OUTAGE_COPY);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="auth-page dotted">
      <form className="auth-card" onSubmit={submit}>
        <p className="logo">
          <Logo />
        </p>
        <h1 style={{ fontSize: "1.8rem" }}>Accept your invitation</h1>
        <Field label="Password" error={fieldError} hint="At least twelve characters.">
          {(attributes) => (
            <input
              {...attributes}
              type="password"
              value={password}
              autoComplete="new-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>
        <button type="submit" className="button" disabled={pending}>
          {pending ? "Accepting…" : "Accept invitation"}
        </button>
        <LiveStatus name="Invitation status" message={message} />
      </form>
    </div>
  );
}
