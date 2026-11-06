import { useEffect, useState } from "react";
import { encodeNext } from "../../shared/next.ts";
import { errorBody, readJson, request, sessionInfo, type SessionUser } from "../api.ts";
import { navigate } from "../router.ts";
import { NotFound } from "./NotFound.tsx";

interface Invite {
  diagramTitle: string;
  inviterName: string;
  role: "editor" | "viewer";
  email: string;
  accountExists: boolean;
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; invite: Invite; signedIn: boolean }
  | { kind: "expired" }
  | { kind: "limited" }
  | { kind: "missing" };

export function Invitation({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ name?: string; password?: string; alert?: string }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await request({ method: "GET", path: `/api/invites/${encodeURIComponent(token)}` }, { allowUnauthenticated: true });
      if (res.status === 410) return setState({ kind: "expired" });
      if (res.status === 429) return setState({ kind: "limited" });
      if (!res.ok) return setState({ kind: "missing" });
      const invite = (await readJson<{ invite: Invite }>(res)).invite;
      const me = await request({ method: "GET", path: "/api/session" }, { allowUnauthenticated: true });
      if (me.ok) sessionInfo.adopt(await readJson<{ user: SessionUser; csrfToken: string }>(me));
      setState({ kind: "ready", invite, signedIn: me.ok });
    })();
  }, [token]);

  const accept = async (withAccount: boolean) => {
    if (busy) return;
    setBusy(true);
    const res = await request(
      { method: "POST", path: `/api/invites/${encodeURIComponent(token)}/accept`, json: withAccount ? { displayName: name, password } : {} },
      { allowUnauthenticated: true },
    );
    setBusy(false);
    if (res.ok) {
      const body = await readJson<{ diagramId: string; firstPageId: string }>(res);
      location.assign(`/d/${body.diagramId}/p/${body.firstPageId}`);
      return;
    }
    const err = await errorBody(res);
    if (res.status === 410) return setState({ kind: "expired" });
    if (res.status === 429) return setState({ kind: "limited" });
    if (res.status === 404) return setState({ kind: "missing" });
    if (err?.error === "invite_email_mismatch") return setErrors({ alert: "This invitation was sent to a different email address." });
    if (err?.error === "validation") {
      return setErrors({
        name: err.fields?.displayName ? "Use 1 to 80 characters, with no line breaks or control characters." : undefined,
        password: err.fields?.password ? "Use 12 to 128 characters." : undefined,
      });
    }
    setErrors({ alert: "Something went wrong. Try again." });
  };

  if (state.kind === "missing") return <NotFound kind="page" />;
  return (
    <main className="center-screen">
      <section className="card">
        <p className="eyebrow">Scopewright</p>
        {state.kind === "loading" && <div className="skeleton-rows" aria-hidden="true"><span /><span /></div>}
        {state.kind === "expired" && (
          <>
            <h1>This invitation has expired</h1>
            <p>Ask the diagram owner to send you a new one.</p>
          </>
        )}
        {state.kind === "limited" && (
          <>
            <h1>Too many attempts</h1>
            <p>Wait a few minutes and open the link again.</p>
          </>
        )}
        {state.kind === "ready" && (
          <>
            <h1>Invitation to {state.invite.diagramTitle}</h1>
            <p className="card-lede">{state.invite.inviterName} invited you to {state.invite.diagramTitle} as {state.invite.role}.</p>
            <p className="hint">Sent to <span className="mono">{state.invite.email}</span></p>
            {state.signedIn ? (
              <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => void accept(false)}>Accept invitation</button>
            ) : state.invite.accountExists ? (
              <a
                className="btn btn-primary btn-block"
                href={`/signin?next=${encodeNext(`/invite/${token}`)}`}
                onClick={(e) => {
                  e.preventDefault();
                  void navigate(`/signin?next=${encodeNext(`/invite/${token}`)}`);
                }}
              >
                Sign in to accept
              </a>
            ) : (
              <form noValidate onSubmit={(e) => {
                e.preventDefault();
                void accept(true);
              }}>
                <div className="field">
                  <label htmlFor="inv-name">Display name</label>
                  <input id="inv-name" type="text" autoComplete="name" value={name} maxLength={80} aria-describedby={errors.name ? "inv-name-error" : undefined} onChange={(e) => setName(e.target.value)} />
                  {errors.name && <p className="field-error" id="inv-name-error">{errors.name}</p>}
                </div>
                <div className="field">
                  <label htmlFor="inv-password">Password</label>
                  <input id="inv-password" type="password" autoComplete="new-password" value={password} aria-describedby={errors.password ? "inv-password-error" : "inv-password-hint"} onChange={(e) => setPassword(e.target.value)} />
                  {errors.password ? <p className="field-error" id="inv-password-error">{errors.password}</p> : <p className="hint" id="inv-password-hint">12 to 128 characters.</p>}
                </div>
                <button type="submit" className="btn btn-primary btn-block" disabled={busy}>Accept invitation</button>
              </form>
            )}
            {errors.alert && <div role="alert" className="form-alert">{errors.alert}</div>}
          </>
        )}
      </section>
    </main>
  );
}
