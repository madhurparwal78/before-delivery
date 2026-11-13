import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { InvitationInfo, User } from "../../shared/api";
import { get, post } from "../api";
import { Link } from "../components/Link";
import { SiteHeader } from "../components/SiteHeader";
import { navigate, useLocation } from "../router";
import { useSession } from "../session";
import { ErrorSummary, Field, SignupForm, failureOf } from "./Forms";
import type { Failure } from "./Forms";

function Screen({ children }: { children: ReactNode }): ReactNode {
  return (
    <>
      <SiteHeader />
      <main className="band grey auth-band">
        <div className="container">
          <div className="auth-card">{children}</div>
        </div>
      </main>
    </>
  );
}

export function SignIn(): ReactNode {
  const { setUser } = useSession();
  const location = useLocation();
  const next = new URLSearchParams(location.split("?")[1]).get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      const answer = await post<{ user: User }>("/api/auth/signin", { email, password });
      setUser(answer.user);
      navigate(next && next.startsWith("/") ? next : "/notebooks");
    } catch (error) {
      setFailure(failureOf(error, {}));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <h1>Sign in</h1>
      <form aria-label="Sign in" onSubmit={(event) => void submit(event)} noValidate>
        {failure && <ErrorSummary failure={failure} labels={{ email: "Email", password: "Password" }} focus={(field) => inputs.current[field]?.focus()} />}
        <Field name="email" label="Email" type="email" value={email} onChange={setEmail} error={failure?.fields.email} autoComplete="email" inputRef={(el) => (inputs.current.email = el)} />
        <Field name="password" label="Password" type="password" value={password} onChange={setPassword} error={failure?.fields.password} autoComplete="current-password" inputRef={(el) => (inputs.current.password = el)} />
        <button type="submit" className="btn btn-accent" disabled={busy}>Sign in</button>
      </form>
      <p className="auth-alt"><Link to="/signup">Create an account</Link></p>
    </Screen>
  );
}

export function SignUp(): ReactNode {
  const token = new URLSearchParams(useLocation().split("?")[1]).get("invitation");
  const [info, setInfo] = useState<InvitationInfo | null | undefined>(token ? undefined : null);
  useEffect(() => {
    if (!token) return;
    get<InvitationInfo>(`/api/invitations/${token}`).then(setInfo, () => setInfo(null));
  }, [token]);
  return (
    <Screen>
      <h1>Create your account</h1>
      {info === undefined ? <p className="muted">Loading…</p> : <SignupForm invitation={info ? (token as string) : undefined} email={info?.email} />}
      <p className="auth-alt"><Link to="/signin">Sign in</Link></p>
    </Screen>
  );
}

export function Verify({ token }: { token: string }): ReactNode {
  const [result, setResult] = useState<"pending" | "ok" | "bad">("pending");
  useEffect(() => {
    post("/api/auth/verify", { token }).then(
      () => setResult("ok"),
      () => setResult("bad"),
    );
  }, [token]);
  return (
    <Screen>
      <h1>Email verification</h1>
      {result === "pending" && <p className="muted">Checking your link…</p>}
      {result === "ok" && (
        <>
          <p>Email verified. You can sign in now.</p>
          <p><Link className="btn btn-accent" to="/signin">Sign in</Link></p>
        </>
      )}
      {result === "bad" && <p>This verification link is not valid.</p>}
    </Screen>
  );
}

export function Invite({ token }: { token: string }): ReactNode {
  const { user, signOut } = useSession();
  const [info, setInfo] = useState<InvitationInfo | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get<InvitationInfo>(`/api/invitations/${token}`).then(setInfo, () => setInfo(null));
  }, [token]);

  if (info === undefined || user === undefined) return <Screen><p className="muted">Loading…</p></Screen>;
  if (info === null) return <Screen><h1>This invitation is not valid.</h1></Screen>;

  const open = async (): Promise<void> => {
    setBusy(true);
    try {
      const opened = await post<{ notebook_id: string }>(`/api/invitations/${token}/accept`);
      navigate(`/notebooks/${opened.notebook_id}`);
    } finally {
      setBusy(false);
    }
  };

  if (user && user.email.toLowerCase() === info.email.toLowerCase()) {
    return (
      <Screen>
        <h1>{`${info.owner_display_name} shared “${info.notebook_title}” with you`}</h1>
        <p>{`Role: ${info.role === "editor" ? "Editor" : "Viewer"}`}</p>
        <button type="button" className="btn btn-accent" disabled={busy} onClick={() => void open()}>Open notebook</button>
      </Screen>
    );
  }
  if (user) {
    return (
      <Screen>
        <h1>This invitation is for another account.</h1>
        <button type="button" className="btn" onClick={() => void signOut()}>Sign out</button>
      </Screen>
    );
  }
  if (info.account_exists) {
    return (
      <Screen>
        <h1>{`Sign in as ${info.email} to open the shared notebook.`}</h1>
        <p><Link className="btn btn-accent" to={`/signin?next=${encodeURIComponent(`/invite/${token}`)}`}>Sign in</Link></p>
      </Screen>
    );
  }
  return (
    <Screen>
      <h1>{`Create an account to open “${info.notebook_title}”`}</h1>
      <p><Link className="btn btn-accent" to={`/signup?invitation=${token}`}>Create an account</Link></p>
    </Screen>
  );
}
