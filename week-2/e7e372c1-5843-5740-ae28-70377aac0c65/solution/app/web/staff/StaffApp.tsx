import { useCallback, useEffect, useState, type FormEvent } from "react";
import { request } from "../api.ts";
import { Masthead } from "../board/Masthead.tsx";
import { SIGN_IN_FAILED, UNEXPECTED } from "../copy.ts";
import { navigate } from "../router.ts";
import { Editor } from "./Editor.tsx";
import { RestatementList } from "./List.tsx";
import { Operator } from "./Operator.tsx";
import { StaffContext } from "./session.ts";
import type { StaffUser } from "../../shared/domain.ts";

type SessionState = { kind: "loading" } | { kind: "anonymous" } | { kind: "signed-in"; user: StaffUser };

function SignInPage({ onSignedIn }: { onSignedIn: (user: StaffUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    const answer = await request<{ user: StaffUser }>("POST", "/api/session", { body: { email, password } });
    setBusy(false);
    if (answer.kind === "ok") {
      setMessage("");
      onSignedIn(answer.body.user);
    } else setMessage(answer.kind === "refused" && answer.status === 401 ? SIGN_IN_FAILED : UNEXPECTED);
  };

  return (
    <>
      <Masthead staffLink={false} />
      <main className="page page-narrow">
        <h1>Staff sign in</h1>
        <form onSubmit={(event) => void submit(event)} className="form-grid" style={{ gridTemplateColumns: "1fr", marginTop: 24 }}>
          <div className="field">
            <label htmlFor="sign-in-email">Email</label>
            <input id="sign-in-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="sign-in-password">Password</label>
            <input id="sign-in-password" type="password" role="textbox" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </div>
          <div className="actions">
            <button type="submit" className="primary" disabled={busy}>Sign in</button>
          </div>
        </form>
        <p className="staff-updates" role="status" aria-label="Staff updates">{message}</p>
      </main>
    </>
  );
}

function Frame({ user, path }: { user: StaffUser; path: string }) {
  const signOut = async (): Promise<void> => {
    await request<null>("DELETE", "/api/session");
    window.location.assign("/staff");
  };
  const editor = /^\/staff\/restatements\/([^/]+)$/.exec(path);
  return (
    <>
      <Masthead staffLink={false} />
      <main className="page">
        <div className="staff-bar">
          <span className="who">{user.name}</span>
          <nav aria-label="Staff">
            <a href="/staff/restatements">Restatements</a>
            {user.roles.includes("operator") && <a href="/operator">Operator console</a>}
          </nav>
          <button type="button" onClick={() => void signOut()}>Sign out</button>
        </div>
        {editor ? (
          <Editor key={editor[1]} id={editor[1] ?? ""} />
        ) : path === "/operator" ? (
          <Operator />
        ) : (
          <RestatementList />
        )}
      </main>
    </>
  );
}

export function StaffApp({ path }: { path: string }) {
  const [session, setSession] = useState<SessionState>({ kind: "loading" });

  useEffect(() => {
    void request<{ user: StaffUser }>("GET", "/api/session").then((answer) => {
      setSession(answer.kind === "ok" ? { kind: "signed-in", user: answer.body.user } : { kind: "anonymous" });
    });
  }, []);

  const setUser = useCallback((user: StaffUser) => setSession({ kind: "signed-in", user }), []);
  const signedIn = useCallback(
    (user: StaffUser) => {
      setSession({ kind: "signed-in", user });
      if (path === "/staff") navigate("/staff/restatements", true);
    },
    [path],
  );

  useEffect(() => {
    if (session.kind === "signed-in" && path === "/staff") navigate("/staff/restatements", true);
  }, [session.kind, path]);

  if (session.kind === "loading") return <Masthead staffLink={false} />;
  if (session.kind === "anonymous") return <SignInPage onSignedIn={signedIn} />;
  return (
    <StaffContext.Provider value={{ user: session.user, setUser }}>
      <Frame user={session.user} path={path} />
    </StaffContext.Provider>
  );
}
