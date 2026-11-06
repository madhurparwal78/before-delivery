// Workspace access (brief: Public screens → sign-in, reset, invitation; Journey 7) and the not-found screen.
import { type FormEvent, useState } from "react";
import { COPY } from "../../shared/copy";
import { api } from "../api";
import { DialFace, DialNumerals } from "../dial";
import { Link, useRouter } from "../router";
import { type Member, ROLE_HOME, type Role, mayOpen, useSession } from "../session";
import { Button, Field, PageTitle, Problems, StatusRegion, refusalMessage, useMessage, useProblems } from "../ui";

/** The `next` staff screen to land on after signing in: a path on this site the member's role may use, query kept. */
function safeNext(search: string, role: Role): string | null {
  const next = new URLSearchParams(search).get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  const target = new URL(next, window.location.origin);
  if (target.origin !== window.location.origin || !mayOpen(role, target.pathname)) return null;
  return `${target.pathname}${target.search}`;
}

function AccessCard({ title, children, intro }: { title: string; children: JSX.Element | JSX.Element[]; intro?: string }): JSX.Element {
  return (
    <div className="access">
      <section className="panel access-card">
        <p className="eyebrow">Hourline studio</p>
        <PageTitle>{title}</PageTitle>
        {intro ? <p className="muted">{intro}</p> : null}
        {children}
      </section>
      <aside className="night-section access-aside" aria-hidden="true">
        <div className="access-dial">
          <DialFace />
          <DialNumerals />
        </div>
        <p className="display-quote">Six markets. One instant.</p>
        <p className="mono">CPH · STO · PAR · LON · NYC · TYO</p>
      </aside>
    </div>
  );
}

export function SignIn(): JSX.Element {
  const { search, navigate } = useRouter();
  const { refresh } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useMessage();
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage("Signing in…");
    const r = await api<{ member: Member }>("POST", "/api/auth/sign-in", { email, password });
    setPending(false);
    if (!r.ok) {
      setMessage(refusalMessage(r));
      return;
    }
    setMessage(null);
    await refresh();
    navigate(safeNext(search, r.data.member.role) ?? ROLE_HOME[r.data.member.role]);
  };
  return (
    <AccessCard title="Sign in" intro="Sign in to plan drops, split editions, confirm allocations and brief the press.">
      <form onSubmit={(e) => void submit(e)} noValidate className="stack">
        <Field id="sign-in-email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="username" />
        <Field id="sign-in-password" label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        <Button type="submit" variant="primary" pending={pending} pendingText="Signing in…">
          Sign in
        </Button>
        <Link to="/forgot-password">Forgot password?</Link>
        <StatusRegion name="Sign-in status" message={message} />
      </form>
    </AccessCard>
  );
}

export function ForgotPassword(): JSX.Element {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useMessage();
  const p = useProblems([{ path: "email", id: "reset-email", label: "Email" }]);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage("Sending…");
    const r = await api("POST", "/api/auth/password-reset", { email });
    setPending(false);
    if (r.ok) {
      p.clear();
      setMessage("If that address belongs to a member, a reset link is on its way.");
      return;
    }
    if (r.status === 422) p.show(r.fields);
    setMessage(refusalMessage(r));
  };
  return (
    <AccessCard title="Reset your password" intro="Enter the email you sign in with and we'll send a link to choose a new password.">
      <form onSubmit={(e) => void submit(e)} noValidate className="stack">
        <Problems problems={p.problems} regionRef={p.regionRef} />
        <Field id="reset-email" label="Email" type="email" value={email} onChange={setEmail} error={p.errors.email} autoComplete="username" />
        <Button type="submit" variant="primary" pending={pending} pendingText="Sending…">
          Send reset link
        </Button>
        <Link to="/sign-in">Back to sign in</Link>
        <StatusRegion name="Reset status" message={message} />
      </form>
    </AccessCard>
  );
}

export function ResetPassword({ token }: { token: string }): JSX.Element {
  const { navigate } = useRouter();
  const { refresh } = useSession();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useMessage();
  const p = useProblems([{ path: "password", id: "new-password", label: "New password" }]);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage("Saving…");
    const r = await api<{ member: Member }>("POST", "/api/auth/password-reset/complete", { token, password });
    setPending(false);
    if (r.ok) {
      p.clear();
      setMessage("Password saved.");
      await refresh();
      navigate(ROLE_HOME[r.data.member.role]);
      return;
    }
    if (r.status === 422) p.show(r.fields);
    setMessage(r.status === 410 || r.status === 404 ? COPY.resetDead : refusalMessage(r));
  };
  return (
    <AccessCard title="Choose a new password" intro="Use 12 to 128 characters.">
      <form onSubmit={(e) => void submit(e)} noValidate className="stack">
        <Problems problems={p.problems} regionRef={p.regionRef} />
        <Field id="new-password" label="New password" type="password" value={password} onChange={setPassword} error={p.errors.password} autoComplete="new-password" />
        <Button type="submit" variant="primary" pending={pending} pendingText="Saving…">
          Save password
        </Button>
        <StatusRegion name="Reset status" message={message} />
      </form>
    </AccessCard>
  );
}

export function AcceptInvitation({ token }: { token: string }): JSX.Element {
  const { navigate } = useRouter();
  const { refresh } = useSession();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useMessage();
  const p = useProblems([
    { path: "name", id: "invite-name", label: "Your name" },
    { path: "password", id: "invite-password", label: "Password" },
  ]);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage("Joining…");
    const r = await api<{ member: Member }>("POST", "/api/auth/invitations/accept", { token, name, password });
    setPending(false);
    if (r.ok) {
      p.clear();
      setMessage(null);
      await refresh();
      navigate(ROLE_HOME[r.data.member.role]);
      return;
    }
    if (r.status === 422) p.show(r.fields);
    setMessage(r.status === 410 || r.status === 404 ? COPY.inviteDead : refusalMessage(r));
  };
  return (
    <AccessCard title="Accept your invitation" intro="Choose the name your teammates see and a password of 12 to 128 characters.">
      <form onSubmit={(e) => void submit(e)} noValidate className="stack">
        <Problems problems={p.problems} regionRef={p.regionRef} />
        <Field id="invite-name" label="Your name" value={name} onChange={setName} error={p.errors.name} autoComplete="name" />
        <Field id="invite-password" label="Password" type="password" value={password} onChange={setPassword} error={p.errors.password} autoComplete="new-password" />
        <Button type="submit" variant="primary" pending={pending} pendingText="Joining…">
          Join workspace
        </Button>
        <StatusRegion name="Invitation status" message={message} />
      </form>
    </AccessCard>
  );
}

export function NotFound(): JSX.Element {
  return (
    <div className="link-page">
      <section className="panel link-panel">
        <PageTitle>Page not found</PageTitle>
        <p>Nothing lives at this address.</p>
        <p>
          <Link to="/">Back to the drop calendar</Link>
        </p>
      </section>
    </div>
  );
}
