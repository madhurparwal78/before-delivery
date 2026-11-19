import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import { Skeleton } from "../components/ui";
import { COPY } from "../copy";
import { NotFoundPage } from "./Errors";

// Loaded on its own (lazy chunk) so only invitees download the password form.
export default function AcceptInvitePage({ token }: { token: string }) {
  const [invite, setInvite] = useState<{ email: string; venue_name: string } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "expired" | "missing" | "done">("loading");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    api<{ email: string; venue_name: string }>(`/api/invites/${encodeURIComponent(token)}`)
      .then((found) => {
        setInvite(found);
        setState("ready");
      })
      .catch((error: unknown) => setState(error instanceof ApiError && error.status === 410 ? "expired" : "missing"));
  }, [token]);
  if (state === "missing") return <NotFoundPage />;
  const accept = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api(`/api/invites/${encodeURIComponent(token)}/accept`, { body: { password } });
      setState("done");
    } catch (error) {
      if (error instanceof ApiError && error.status === 410) setState("expired");
      else if (error instanceof ApiError && error.status === 503) setMessage(COPY.invite.keycloakDown);
      else if (error instanceof ApiError && error.status === 404) setState("missing");
      else setMessage("Choose a password of 12 to 128 characters.");
    }
  };
  return (
    <div className="field field-slate one-page">
      <main className="one-page-body">
        <section className="card invite-card">
          {state === "expired" ? (
            <h1 className="one-line">{COPY.invite.expired}</h1>
          ) : state === "done" ? (
            <>
              <h1>You're in</h1>
              <p>Your password is set for {invite?.email}.</p>
              <a className="pill" href="/auth/login?next=/">Sign in</a>
            </>
          ) : invite ? (
            <>
              <p className="eyebrow">{invite.venue_name}</p>
              <h1>Join {invite.venue_name}</h1>
              <p className="muted">{invite.email}</p>
              <form className="form" aria-label="Accept invite" onSubmit={(e) => void accept(e)}>
                <div className="field-row">
                  <label htmlFor="invite-password">Choose a password</label>
                  <input id="invite-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <p className="field-error" role="status" aria-live="polite">{message}</p>
                <button type="submit" className="pill">Accept invite</button>
              </form>
            </>
          ) : (
            <Skeleton />
          )}
        </section>
      </main>
    </div>
  );
}
