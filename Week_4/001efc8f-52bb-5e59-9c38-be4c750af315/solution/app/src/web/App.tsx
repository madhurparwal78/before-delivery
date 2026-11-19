import { useEffect, useId, useState, type FormEvent } from "react";
import { api, ApiFailure, apiMessage, whenSessionEnds } from "./api";
import { FieldError } from "./components/Dialog";
import { TagMark } from "./components/TagMark";
import { stop } from "./live";
import { navigate, useAddress } from "./route";
import { Shell } from "./Shell";
import { getState, notify, resetSession, setState, useStore } from "./store";
import type { Me } from "./types";

const SESSION_ENDED = "Your session has ended. Sign in again.";
const INVITE_INVALID = "This invite link is not valid. Ask your operations manager for a new one.";

// Every ended session lands here: a 401 on any request or session.ended on the stream.
export function endSession(): void {
  if (getState().phase !== "ready") return;
  stop();
  resetSession("signedOut", SESSION_ENDED);
}

whenSessionEnds(endSession);

function signedIn(me: Me): void {
  resetSession("ready");
  setState({ me });
}

export function App() {
  const { phase } = useStore();
  const address = useAddress();
  useEffect(() => {
    api<Me>("GET", "/api/me").then(signedIn, () => resetSession("signedOut"));
  }, []);
  if (address.screen === "join") return <Join token={address.token} />;
  if (phase === "booting") return <main className="boot" aria-busy="true" />;
  if (phase === "signedOut") return <SignIn />;
  return <Shell />;
}

export function NoticesRegion({ className }: { className: string }) {
  const { notice } = useStore();
  return (
    <div role="status" aria-label="Notices" className={className}>
      {notice ? <p key={notice.id}>{notice.text}</p> : null}
    </div>
  );
}

function SignIn() {
  const { signInNote } = useStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const ids = { email: useId(), password: useId(), emailError: useId(), passwordError: useId() };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      const me = await api<Me>("POST", "/api/session", { email, password });
      signedIn(me);
    } catch (error) {
      setBusy(false);
      if (error instanceof ApiFailure && error.body?.errors) setErrors(error.body.errors);
      else {
        setFormError(apiMessage(error));
        notify(apiMessage(error));
      }
    }
  };

  return (
    <main className="gate">
      <form className="gate-panel" onSubmit={submit} noValidate>
        <TagMark />
        <h1 className="wordmark">Rimewire</h1>
        <p className="gate-lede">Northcoil Works team messenger</p>
        {signInNote ? <p className="gate-note">{signInNote}</p> : null}
        {formError ? (
          <p className="gate-error" role="alert">
            {formError}
          </p>
        ) : null}
        <div className="field">
          <label htmlFor={ids.email}>Email</label>
          <input
            id={ids.email}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? ids.emailError : undefined}
          />
          <FieldError id={ids.emailError} text={errors.email} />
        </div>
        <div className="field">
          <label htmlFor={ids.password}>Password</label>
          <input
            id={ids.password}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? ids.passwordError : undefined}
          />
          <FieldError id={ids.passwordError} text={errors.password} />
        </div>
        <button className="button button-primary button-block" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <NoticesRegion className="visually-hidden" />
    </main>
  );
}

type Invite = { workspace_name: string; name: string; email: string };

function Join({ token }: { token: string }) {
  const [invite, setInvite] = useState<Invite | "loading" | "invalid">("loading");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const ids = { password: useId(), error: useId() };

  useEffect(() => {
    api<Invite>("GET", `/api/invites/${encodeURIComponent(token)}`).then(setInvite, () => setInvite("invalid"));
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (typeof invite !== "object") return;
    setBusy(true);
    setError(undefined);
    try {
      const me = await api<Me>("POST", `/api/invites/${encodeURIComponent(token)}/accept`, { password });
      signedIn(me);
      notify(`Password set. Welcome to ${me.workspace.name}.`);
      navigate("/", { replace: true });
    } catch (failure) {
      setBusy(false);
      if (failure instanceof ApiFailure && failure.status === 404) setInvite("invalid");
      else setError(failure instanceof ApiFailure && failure.body?.errors?.password ? failure.body.errors.password : apiMessage(failure));
    }
  };

  return (
    <main className="gate">
      <div className="gate-panel">
        <TagMark />
        <h1 className="wordmark">Rimewire</h1>
        {invite === "loading" ? <p className="gate-lede">Checking your invite…</p> : null}
        {invite === "invalid" ? <p className="gate-error">{INVITE_INVALID}</p> : null}
        {typeof invite === "object" ? (
          <form onSubmit={submit} noValidate>
            <p className="gate-lede">
              Join <strong>{invite.workspace_name}</strong>
            </p>
            <dl className="gate-facts">
              <dt>Name</dt>
              <dd>{invite.name}</dd>
              <dt>Email</dt>
              <dd>{invite.email}</dd>
            </dl>
            <div className="field">
              <label htmlFor={ids.password}>New password</label>
              <input
                id={ids.password}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? ids.error : undefined}
              />
              <FieldError id={ids.error} text={error} />
            </div>
            <button className="button button-primary button-block" type="submit" disabled={busy}>
              {busy ? "Joining…" : "Set password and join"}
            </button>
          </form>
        ) : null}
      </div>
      <NoticesRegion className="visually-hidden" />
    </main>
  );
}
