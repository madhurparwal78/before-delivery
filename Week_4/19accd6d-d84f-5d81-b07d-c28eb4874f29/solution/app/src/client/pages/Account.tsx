import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, ApiFailure } from "../api";
import { Link, navigate } from "../router";
import { refreshSession, session } from "../session";
import { useStore } from "../store";
import { Screen } from "../ui/Screen";

function AccountStatus({ text }: { text: string }) {
  return <div role="status" aria-label="Account status" aria-live="polite" className="account-status">{text}</div>;
}

function Field({ id, label, type = "text", value, onChange, problem }: {
  id: string; label: string; type?: string; value: string; onChange: (value: string) => void; problem?: string;
}) {
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} value={value} autoComplete={type === "password" ? "current-password" : "off"} onChange={(event) => onChange(event.target.value)} aria-invalid={problem !== undefined} />
      {problem && <p className="field-error">{problem}</p>}
    </div>
  );
}

export function SignUp() {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFields({});
    setStatus("");
    try {
      await api("POST", "/api/auth/signup", { displayName, email, password });
      setStatus(`Check your inbox. We sent a confirmation link to ${email.trim().toLowerCase()}.`);
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (error.details?.fields) setFields(error.details.fields);
      else setStatus(error.message);
    }
    setBusy(false);
  };

  return (
    <Screen label="Sign up" title="Create your account" narrow>
      <form className="form" onSubmit={(event) => void submit(event)} noValidate>
        <Field id="signup-name" label="Display name" value={displayName} onChange={setDisplayName} problem={fields.displayName} />
        <Field id="signup-email" label="Email" type="email" value={email} onChange={setEmail} problem={fields.email} />
        <Field id="signup-password" label="Password" type="password" value={password} onChange={setPassword} problem={fields.password} />
        <button type="submit" className="primary wide" aria-busy={busy}>Create account</button>
      </form>
      <AccountStatus text={status} />
      <p className="row-meta">Already have an account? <Link to="/signin">Sign in</Link></p>
    </Screen>
  );
}

export function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setStatus("");
    try {
      await api("POST", "/api/auth/signin", { email, password });
      await refreshSession();
      navigate("/");
      return;
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      setStatus(error.message);
    }
    setBusy(false);
  };

  return (
    <Screen label="Sign in" title="Sign in" narrow>
      <form className="form" onSubmit={(event) => void submit(event)} noValidate>
        <Field id="signin-email" label="Email" type="email" value={email} onChange={setEmail} />
        <Field id="signin-password" label="Password" type="password" value={password} onChange={setPassword} />
        <button type="submit" className="primary wide" aria-busy={busy}>Sign in</button>
      </form>
      <AccountStatus text={status} />
      <p className="row-meta">New here? <Link to="/signup">Create an account</Link></p>
    </Screen>
  );
}

export function Verify({ token }: { token: string }) {
  const [status, setStatus] = useState("");
  useEffect(() => {
    api("POST", "/api/auth/verify", { token }).then(
      () => setStatus("Your account is confirmed. You can sign in now."),
      (error: unknown) => {
        if (!(error instanceof ApiFailure) || error.status !== 404) throw error;
        setStatus("This link is no longer valid.");
      },
    );
  }, [token]);
  return (
    <Screen label="Confirm your email" title="Confirm your email" narrow>
      <AccountStatus text={status} />
      <p className="row-meta"><Link to="/signin">Go to sign in</Link></p>
    </Screen>
  );
}

export function Invite({ token }: { token: string }) {
  const user = useStore(session, (state) => state.user);
  const [invite, setInvite] = useState<{ teamName: string; inviterName: string; email: string } | null>(null);
  const [status, setStatus] = useState("");
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ invite: { teamName: string; inviterName: string; email: string } }>("GET", `/api/invites/${token}`).then(
      (answer) => setInvite(answer.invite),
      (error: unknown) => {
        if (!(error instanceof ApiFailure) || error.status !== 404) throw error;
        setStatus("This link is no longer valid.");
      },
    );
  }, [token]);

  const join = async (): Promise<void> => {
    if (busy || !invite || !user) return;
    setBusy(true);
    try {
      await api("POST", `/api/invites/${token}/accept`);
      setJoined(true);
      setStatus(`${user.displayName} joined ${invite.teamName}.`);
      await refreshSession();
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      setStatus(error.message);
    }
    setBusy(false);
  };

  const message = invite && !user ? `Sign in or create an account with ${invite.email} to join ${invite.teamName}.` : status;
  return (
    <Screen label="Team invite" title={invite ? `Join ${invite.teamName}` : "Team invite"} narrow>
      {invite && <p className="modal-note">{invite.inviterName} invited you to {invite.teamName}.</p>}
      {invite && user && !joined && (
        <button type="button" className="primary wide" aria-busy={busy} onClick={() => void join()}>Join {invite.teamName}</button>
      )}
      <AccountStatus text={message} />
      {invite && !user && (
        <p className="row-meta"><Link to="/signin">Sign in</Link> or <Link to="/signup">create an account</Link></p>
      )}
      {joined && <p className="row-meta"><Link to="/team">Open team settings</Link></p>}
    </Screen>
  );
}
