import { useEffect, useState } from "react";
import { api, ApiError } from "./api.ts";
import { store } from "./store.ts";
import type { Invite } from "./types.ts";

export function SignInScreen(props: { next: string | null; onNavigate: (path: string, replace?: boolean) => void }): React.ReactNode {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const submit = async (): Promise<void> => {
    setPending(true);
    setError("Signing in");
    try {
      const { data } = await api.signIn(email, password);
      store.me = data.person;
      store.workspace = data.workspace;
      store.signedOutCopy = false;
      store.emitChange();
      const next = props.next;
      if (data.workspace) {
        if (next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")) {
          props.onNavigate(next, true);
        } else {
          props.onNavigate("/issues", true);
        }
      } else {
        props.onNavigate("/invitations", true);
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "database_unavailable") {
        setError("Tallyroom can't reach its database. Changes are not being saved.");
      } else if (e instanceof ApiError && e.code === "network_error") {
        setError("That email and password don't match.");
      } else {
        setError("That email and password don't match.");
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: "10vh auto", padding: "0 16px" }}>
      <h1>Tallyroom</h1>
      <form
        aria-label="Sign in"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="form-grid">
          <label htmlFor="email">Email</label>
          <input id="email" aria-label="Email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
          <label htmlFor="password">Password</label>
          <input id="password" type="password" aria-label="Password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
        </div>
        <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
          <button className="btn primary" type="submit" aria-label="Sign in" aria-disabled={pending}>
            Sign in
          </button>
          <a
            href="/create-account"
            onClick={(e) => {
              e.preventDefault();
              props.onNavigate("/create-account");
            }}
          >
            Create an account
          </a>
        </div>
      </form>
      <div role="status" style={{ marginTop: 8 }}>
        {error}
      </div>
      {store.signedOutCopy && <p>You've been signed out.</p>}
    </div>
  );
}

export function CreateAccountScreen(props: { onNavigate: (path: string, replace?: boolean) => void }): React.ReactNode {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async (): Promise<void> => {
    setPending(true);
    setMessage("Creating account");
    try {
      const { data } = await api.createAccount(name, email, password);
      store.me = data.person;
      store.workspace = null;
      store.emitChange();
      props.onNavigate("/invitations", true);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === "email_taken") {
          setMessage("An account with that email already exists.");
          return;
        }
        if (e.code === "database_unavailable") {
          setMessage("Tallyroom can't reach its database. Changes are not being saved.");
          return;
        }
        if (e.fields) {
          setMessage(Object.values(e.fields)[0]);
          return;
        }
      }
      setMessage("The account wasn't created.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: "10vh auto", padding: "0 16px" }}>
      <h1>Create account</h1>
      <form
        aria-label="Create account"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="form-grid">
          <label htmlFor="name">Name</label>
          <input id="name" aria-label="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <label htmlFor="email2">Email</label>
          <input id="email2" aria-label="Email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
          <label htmlFor="password2">Password</label>
          <input id="password2" type="password" aria-label="Password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
        </div>
        <div style={{ marginTop: 12 }}>
          <button className="btn primary" type="submit" aria-label="Create account" aria-disabled={pending}>
            Create account
          </button>
        </div>
      </form>
      <div role="status" style={{ marginTop: 8 }}>
        {message}
      </div>
    </div>
  );
}

export function InvitationsScreen(props: { onNavigate: (path: string, replace?: boolean) => void }): React.ReactNode {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [outcome, setOutcome] = useState<{ kind: string } | null>(null);
  const [pendingJoin, setPendingJoin] = useState<string | null>(null);

  const reload = (): void => {
    void api
      .myInvites()
      .then(({ data }) => {
        setInvites(data.invites);
        setOutcome(null);
      })
      .catch(() => setInvites([]));
  };

  useEffect(() => {
    reload();
  }, []);

  const join = async (invite: Invite): Promise<void> => {
    setPendingJoin(invite.id);
    store.announce("Joining");
    try {
      const { data } = await api.acceptInvite(invite.id);
      // The welcome route is claimed before the workspace state lands, so the
      // landing rules do not redirect the still-open invitations screen.
      store.justJoined = true;
      props.onNavigate("/welcome", true);
      store.me = data.person;
      store.workspace = data.workspace;
      store.emitChange();
      void store.bootstrap();
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === "workspace_full") setOutcome({ kind: "full" });
        else if (e.code === "invite_expired") setOutcome({ kind: "expired" });
        else if (e.code === "invite_revoked") setOutcome({ kind: "withdrawn" });
        else if (e.code === "billing_unavailable") setOutcome({ kind: "billing" });
        else if (e.code === "database_unavailable") {
          store.announce("Tallyroom can't reach its database. Changes are not being saved.");
        }
      }
      setPendingJoin(null);
    }
  };

  if (outcome) {
    const workspaceName = invites?.[0]?.workspace_name ?? store.workspace?.name ?? "";
    const ownerName = "the owner";
    return (
      <div style={{ maxWidth: 480, margin: "10vh auto", padding: "0 16px" }}>
        {outcome.kind === "full" && (
          <>
            <h1>This workspace is full</h1>
            <p>{`Ask ${ownerName} to add a seat, then try again.`}</p>
          </>
        )}
        {outcome.kind === "expired" && (
          <>
            <h1>This invite has expired</h1>
            <p>{`Ask ${ownerName} to send a new one.`}</p>
          </>
        )}
        {outcome.kind === "withdrawn" && <h1>This invite was withdrawn</h1>}
        {outcome.kind === "billing" && (
          <>
            <h1>We can't check seats right now</h1>
            <p>Try again in a minute.</p>
          </>
        )}
        <button
          className="btn"
          aria-label="Back to your invitations"
          onClick={(e) => {
            e.preventDefault();
            reload();
          }}
        >
          Back to your invitations
        </button>
        <p className="meta">{workspaceName}</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: "10vh auto", padding: "0 16px" }}>
      <h1>Your invitations</h1>
      {invites === null && <p>Loading…</p>}
      {invites !== null && invites.length === 0 && (
        <p>{`No invitations for ${store.me?.email ?? ""}.`}</p>
      )}
      {invites?.map((invite) => (
        <div key={invite.id} className="row">
          <span className="title">{invite.workspace_name}</span>
          <span className="meta">{invite.role}</span>
          <span className="meta">{invite.status}</span>
          {invite.status === "pending" && (
            <button
              className="btn"
              aria-label={`Join ${invite.workspace_name}`}
              aria-disabled={pendingJoin === invite.id}
              onClick={() => void join(invite)}
            >
              Join
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function WelcomeScreen(props: { onNavigate: (path: string) => void }): React.ReactNode {
  const name = store.workspace?.name ?? "";
  return (
    <div style={{ maxWidth: 480, margin: "10vh auto", padding: "0 16px" }}>
      <h1>{`Welcome to ${name}`}</h1>
      <a
        href="/issues"
        onClick={(e) => {
          e.preventDefault();
          props.onNavigate("/issues");
        }}
      >
        Go to Issues
      </a>
    </div>
  );
}
