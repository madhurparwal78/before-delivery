// Sign in, sign up and invite acceptance (brief: Screens > Sign in, Sign up, Invite acceptance; Business
// rules > Return after sign-in).
import { useEffect, useState, type FormEvent } from "react";
import type { Account, InviteView } from "../../shared/api.js";
import { api } from "../lib/api.js";
import { afterSignIn } from "../lib/returnPath.js";
import { linkClick, navigate, useLocation } from "../lib/router.js";
import { useSession } from "../lib/session.js";
import { ErrorSummary, FieldError, fieldAttrs, useFieldErrors } from "../components/ErrorSummary.js";
import { Pending } from "../components/bits.js";
import { NotFound } from "./NotFound.js";

function TextField({ id, label, type = "text", value, onChange, error, autoComplete }: { id: string; label: string; type?: string; value: string; onChange: (v: string) => void; error: string | undefined; autoComplete?: string }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input type={type} {...fieldAttrs(id, error)} value={value} autoComplete={autoComplete} onChange={(e) => onChange(e.target.value)} />
      <FieldError id={id} message={error} />
    </div>
  );
}

const withNext = (path: string, next: string | null): string => (next === null ? path : `${path}?next=${encodeURIComponent(next)}`);

export function SignIn() {
  const { setAccount } = useSession();
  const { query } = useLocation();
  const next = query.get("next");
  const form = useFieldErrors();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    const answer = await api<Account>("POST", "/api/auth/signin", { body: { email, password } });
    setBusy(false);
    if (answer.ok) {
      setAccount(answer.data);
      navigate(afterSignIn(answer.data, next), { replace: true });
    } else if (answer.error?.error === "invalid_credentials") form.show({ email: answer.error.message });
    else if (answer.error?.errors) form.show(answer.error.errors);
    else form.show({ email: "Sign in is unavailable right now. Try again." });
  };
  return (
    <main className="auth" id="main">
      <form className="auth__form panel" onSubmit={(e) => void submit(e)} noValidate>
        <h1 className="page-title">Sign in to Rushes</h1>
        <ErrorSummary errors={form.errors} shown={form.shown} targets={{ email: "signin-email", password: "signin-password" }} />
        <TextField id="signin-email" label="Email" type="email" autoComplete="email" value={email} onChange={setEmail} error={form.errors.email} />
        <TextField id="signin-password" label="Password" type="password" autoComplete="current-password" value={password} onChange={setPassword} error={form.errors.password} />
        <button type="submit" className="btn btn--primary btn--wide" disabled={busy}>
          Sign in
          {busy && <Pending />}
        </button>
        <p className="auth__switch">
          New to Rushes?{" "}
          <a href={withNext("/signup", next)} onClick={(e) => linkClick(e, withNext("/signup", next))}>
            Create an account
          </a>
        </p>
      </form>
    </main>
  );
}

export function SignUp() {
  const { setAccount } = useSession();
  const { query } = useLocation();
  const next = query.get("next");
  const form = useFieldErrors();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    const answer = await api<Account>("POST", "/api/auth/signup", { body: { email, displayName, handle, password } });
    setBusy(false);
    if (answer.ok) {
      setAccount(answer.data);
      navigate(afterSignIn(answer.data, next), { replace: true });
    } else form.show(answer.error?.errors ?? { email: "The account could not be created. Try again." });
  };
  return (
    <main className="auth" id="main">
      <form className="auth__form panel" onSubmit={(e) => void submit(e)} noValidate>
        <h1 className="page-title">Follow curators on Rushes</h1>
        <ErrorSummary errors={form.errors} shown={form.shown} targets={{ email: "signup-email", displayName: "signup-name", handle: "signup-handle", password: "signup-password" }} />
        <TextField id="signup-email" label="Email" type="email" autoComplete="email" value={email} onChange={setEmail} error={form.errors.email} />
        <TextField id="signup-name" label="Display name" autoComplete="name" value={displayName} onChange={setDisplayName} error={form.errors.displayName} />
        <TextField id="signup-handle" label="Handle" autoComplete="username" value={handle} onChange={setHandle} error={form.errors.handle} />
        <TextField id="signup-password" label="Password" type="password" autoComplete="new-password" value={password} onChange={setPassword} error={form.errors.password} />
        <button type="submit" className="btn btn--primary btn--wide" disabled={busy}>
          Create account
          {busy && <Pending />}
        </button>
        <p className="auth__switch">
          Already have an account?{" "}
          <a href={withNext("/signin", next)} onClick={(e) => linkClick(e, withNext("/signin", next))}>
            Sign in
          </a>
        </p>
      </form>
    </main>
  );
}

export function Invite({ token }: { token: string }) {
  const { setAccount } = useSession();
  const [invite, setInvite] = useState<InviteView | null | undefined>(undefined);
  const [used, setUsed] = useState(false);
  const form = useFieldErrors();
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<InviteView>("GET", `/api/invites/${encodeURIComponent(token)}`).then((answer) => {
      if (answer.ok) setInvite(answer.data);
      else {
        setUsed(answer.error?.error === "invite_used");
        setInvite(null);
      }
    });
  }, [token]);
  if (invite === null && !used) return <NotFound />;
  if (invite === null) {
    return (
      <main className="auth" id="main">
        <div className="auth__form panel">
          <h1 className="page-title">This invite has already been used.</h1>
          <p>
            <a href="/signin" onClick={(e) => linkClick(e, "/signin")}>
              Sign in
            </a>{" "}
            with the account it created.
          </p>
        </div>
      </main>
    );
  }
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    const answer = await api<Account>("POST", `/api/invites/${encodeURIComponent(token)}/accept`, { body: { handle, password } });
    setBusy(false);
    if (answer.ok) {
      setAccount(answer.data);
      navigate(afterSignIn(answer.data, null), { replace: true });
    } else if (answer.error?.errors) form.show(answer.error.errors);
    else form.show({ handle: answer.error?.message ?? "The invite could not be accepted. Try again." });
  };
  return (
    <main className="auth" id="main">
      <form className="auth__form panel" onSubmit={(e) => void submit(e)} noValidate>
        {invite === undefined ? (
          <div className="skeleton-block" aria-hidden="true" />
        ) : (
          <>
            <h1 className="page-title">Join {invite.workspaceName}</h1>
            <p className="lede">
              {invite.displayName}, you were invited as <strong>{invite.email}</strong>.
            </p>
            <ErrorSummary errors={form.errors} shown={form.shown} targets={{ handle: "invite-handle", password: "invite-password" }} />
            <TextField id="invite-handle" label="Handle" autoComplete="username" value={handle} onChange={setHandle} error={form.errors.handle} />
            <TextField id="invite-password" label="Password" type="password" autoComplete="new-password" value={password} onChange={setPassword} error={form.errors.password} />
            <button type="submit" className="btn btn--primary btn--wide" disabled={busy}>
              Join {invite.workspaceName}
              {busy && <Pending />}
            </button>
          </>
        )}
      </form>
    </main>
  );
}
