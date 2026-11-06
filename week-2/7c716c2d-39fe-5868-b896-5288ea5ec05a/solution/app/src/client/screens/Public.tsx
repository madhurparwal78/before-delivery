// Screens outside the workspace: sign-in, create account, Your invitations with the outcome
// screens, and welcome.
import { LogOut } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, ApiFailure, get, type Invite, type Me, type Person } from "../api";
import { prefetchWorkspace } from "../boot";
import { EmptyNote } from "../components/Sheet";
import { navigate, safeNext } from "../router";

function Frame(props: { children: ReactNode; onSignOut?: () => void }): JSX.Element {
  return (
    <div className="public">
      <header className="public-head">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Tallyroom
        </span>
        {props.onSignOut && (
          <button type="button" className="button ghost" onClick={props.onSignOut}>
            <LogOut aria-hidden="true" size={18} strokeWidth={1.5} />
            Sign out
          </button>
        )}
      </header>
      <main className="public-sheet">{props.children}</main>
    </div>
  );
}

function Field(props: { label: string; type?: string; value: string; onChange: (v: string) => void; error?: string; autoComplete?: string }): JSX.Element {
  const id = `field-${props.label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        className="input"
        type={props.type ?? "text"}
        value={props.value}
        autoComplete={props.autoComplete}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={props.error ? `${id}-error` : undefined}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.error && (
        <p id={`${id}-error`} className="field-error">
          {props.error}
        </p>
      )}
    </div>
  );
}

export function SignIn(props: { signedOut: boolean; next: string | null; onSignedIn: (me: Me) => void }): JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [line, setLine] = useState<{ text: string; error: boolean } | null>(props.signedOut ? { text: "You've been signed out.", error: false } : null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setLine({ text: "Signing in", error: false });
    try {
      const me = await api<Me>("POST", "/api/session", { email, password });
      await prefetchWorkspace(me);
      props.onSignedIn(me);
      navigate(me.workspace ? (safeNext(props.next) ?? "/issues") : "/invitations", { replace: true });
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "invalid_credentials") setLine({ text: "That email and password don't match.", error: true });
      else setLine(null);
    }
  };

  return (
    <Frame>
      <h1>Sign in</h1>
      <form aria-label="Sign in" className="form" noValidate onSubmit={(e) => void submit(e)}>
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="username" />
        <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        <p className={line?.error ? "form-line error" : "form-line"} role="status">
          {line?.text}
        </p>
        <button type="submit" className="button primary">
          Sign in
        </button>
      </form>
      <p className="aside">
        New here?{" "}
        <a
          href="/create-account"
          onClick={(e) => {
            e.preventDefault();
            navigate("/create-account");
          }}
        >
          Create an account
        </a>
      </p>
    </Frame>
  );
}

export function CreateAccount(props: { onCreated: (person: Person) => void }): JSX.Element {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [line, setLine] = useState<{ text: string; error: boolean } | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setFields({});
    setLine({ text: "Creating account", error: false });
    try {
      const { person } = await api<{ person: Person }>("POST", "/api/accounts", { name, email, password });
      props.onCreated(person);
    } catch (error) {
      if (!(error instanceof ApiFailure)) return setLine(null);
      if (error.code === "email_taken") return setLine({ text: "An account with that email already exists.", error: true });
      setFields(error.fields);
      setLine(null);
    }
  };

  return (
    <Frame>
      <h1>Create account</h1>
      <form aria-label="Create account" className="form" noValidate onSubmit={(e) => void submit(e)}>
        <Field label="Name" value={name} onChange={setName} error={fields.name} autoComplete="name" />
        <Field label="Email" type="email" value={email} onChange={setEmail} error={fields.email} autoComplete="email" />
        <Field label="Password" type="password" value={password} onChange={setPassword} error={fields.password} autoComplete="new-password" />
        <p className={line?.error ? "form-line error" : "form-line"} role="status">
          {line?.text}
        </p>
        <button type="submit" className="button primary">
          Create account
        </button>
      </form>
    </Frame>
  );
}

const STATUS_TEXT: Record<Invite["status"], string> = { pending: "Pending", accepted: "Accepted", revoked: "Withdrawn", expired: "Expired" };

interface Outcome {
  heading: string;
  body: string | null;
}

function outcomeFor(code: string, invite: Invite): Outcome | null {
  switch (code) {
    case "workspace_full":
      return { heading: "This workspace is full", body: `Ask ${invite.owner_name} to add a seat, then try again.` };
    case "invite_expired":
      return { heading: "This invite has expired", body: `Ask ${invite.owner_name} to send a new one.` };
    case "invite_revoked":
      return { heading: "This invite was withdrawn", body: null };
    case "billing_unavailable":
      return { heading: "We can't check seats right now", body: "Try again in a minute." };
    default:
      return null;
  }
}

export function Invitations(props: { me: Me; onJoined: (me: Me) => void; onSignOut: () => void }): JSX.Element {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [joining, setJoining] = useState<string | null>(null);

  const load = useCallback(() => {
    get<{ invites: Invite[] }>("/api/invites/mine")
      .then((r) => setInvites(r.invites))
      .catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  const join = async (invite: Invite): Promise<void> => {
    setJoining(invite.id);
    try {
      const joined = await api<Me>("POST", `/api/invites/${invite.id}/accept`, {});
      await prefetchWorkspace(joined);
      props.onJoined(joined);
    } catch (error) {
      setJoining(null);
      if (error instanceof ApiFailure) setOutcome(outcomeFor(error.code, invite));
    }
  };

  if (outcome) {
    return (
      <Frame onSignOut={props.onSignOut}>
        <h1>{outcome.heading}</h1>
        {outcome.body && <p className="lede">{outcome.body}</p>}
        <a
          href="/invitations"
          className="button"
          onClick={(e) => {
            e.preventDefault();
            setOutcome(null);
            setInvites(null);
            load();
          }}
        >
          Back to your invitations
        </a>
      </Frame>
    );
  }

  return (
    <Frame onSignOut={props.onSignOut}>
      <h1>Your invitations</h1>
      {invites !== null && invites.length === 0 && <EmptyNote>{`No invitations for ${props.me.person.email}.`}</EmptyNote>}
      <ul className="invite-cards">
        {(invites ?? []).map((invite) => (
          <li key={invite.id} className="invite-card">
            <div>
              <h2>{invite.workspace_name}</h2>
              <p className="muted">
                Invited as {invite.role} · <span className="mono">{STATUS_TEXT[invite.status]}</span>
              </p>
            </div>
            {invite.status === "pending" && (
              <button type="button" className="button primary" aria-busy={joining === invite.id} onClick={() => void join(invite)}>
                {joining === invite.id ? "Joining" : `Join ${invite.workspace_name}`}
              </button>
            )}
          </li>
        ))}
      </ul>
    </Frame>
  );
}

export function Welcome(props: { workspace: string; onSignOut: () => void }): JSX.Element {
  return (
    <Frame onSignOut={props.onSignOut}>
      <h1>{`Welcome to ${props.workspace}`}</h1>
      <p className="lede">Your issues, cycles, chat, docs and the office floor are one click away.</p>
      <a
        href="/issues"
        className="button primary"
        onClick={(e) => {
          e.preventDefault();
          navigate("/issues");
        }}
      >
        Go to Issues
      </a>
    </Frame>
  );
}
