import { useEffect, useState } from "react";
import type { JSX } from "react";
import { api, ApiFail } from "../lib/api";
import { fieldErrors, s } from "../../common/copy";

export function AuthPages(props: { page: string; token?: string; query: URLSearchParams }): JSX.Element {
  if (props.page === "signup") return <SignUpForm />;
  if (props.page === "signin") return <SignInForm next={props.query.get("next") ?? "/"} />;
  if (props.page === "verify") return <VerifyNotice token={props.query.get("token") ?? ""} />;
  if (props.page === "invite") return <InviteForm token={props.token ?? ""} />;
  return <p>{s.notFound}</p>;
}

function SignUpForm(): JSX.Element {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  return (
    <div className="panel">
      {done ? (
        <p>{s.checkEmail}</p>
      ) : (
        <>
          <div className="field">
            <label htmlFor="signup-name">Name</label>
            <input id="signup-name" value={name} aria-label="Name" aria-invalid={field === "name" ? "true" : undefined} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="signup-email">Email</label>
            <input id="signup-email" type="email" value={email} aria-label="Email" aria-invalid={field === "email" ? "true" : undefined} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="signup-password">Password</label>
            <input id="signup-password" type="password" value={password} aria-label="Password" aria-invalid={field === "password" ? "true" : undefined} onChange={(event) => setPassword(event.target.value)} />
          </div>
          {error ? (
            <p className="alert" role="alert" aria-label="Sign-up error">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            className="button-primary"
            aria-busy={busy}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api("/api/signup", { method: "POST", body: JSON.stringify({ name, email, password }) });
                setDone(true);
              } catch (failure) {
                if (failure instanceof ApiFail && failure.status === 422) {
                  setError(String(failure.payload.message ?? ""));
                  setField(String(failure.payload.field ?? ""));
                } else if (failure instanceof ApiFail && failure.status === 409) {
                  setError(fieldErrors.emailTaken);
                } else if (failure instanceof ApiFail && failure.status === 503) {
                  setError(s.mailFailed);
                }
                setBusy(false);
              }
            }}
          >
            Create account
          </button>
        </>
      )}
    </div>
  );
}

function SignInForm(props: { next: string }): JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="panel">
      <div className="field">
        <label htmlFor="signin-email">Email</label>
        <input id="signin-email" type="email" value={email} aria-label="Email" onChange={(event) => setEmail(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="signin-password">Password</label>
        <input id="signin-password" type="password" value={password} aria-label="Password" onChange={(event) => setPassword(event.target.value)} />
      </div>
      {error ? (
        <p className="alert" role="alert" aria-label="Sign-in error">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="button-primary"
        aria-busy={busy}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api("/api/session", { method: "POST", body: JSON.stringify({ email, password }) });
            window.location.href = props.next;
          } catch (failure) {
            if (failure instanceof ApiFail) {
              if (failure.payload.error === "unverified") setError(fieldErrors.unverified);
              else setError(fieldErrors.signInBad);
            }
            setBusy(false);
          }
        }}
      >
        Sign in
      </button>
    </div>
  );
}

function VerifyNotice(props: { token: string }): JSX.Element {
  const [state, setState] = useState<"loading" | "ok" | "expired">("loading");
  useEffect(() => {
    void api("/api/verify", { method: "POST", body: JSON.stringify({ token: props.token }) })
      .then(() => setState("ok"))
      .catch((failure) => {
        setState(failure instanceof ApiFail && failure.status === 409 ? "expired" : "expired");
      });
  }, [props.token]);
  return (
    <div className="panel">
      {state === "loading" ? <p>{s.loading}</p> : null}
      {state === "ok" ? (
        <p>
          {s.verified} <a href="/signin">{s.signInLink}</a>
        </p>
      ) : null}
      {state === "expired" ? <p>{s.linkExpired}</p> : null}
    </div>
  );
}

function InviteForm(props: { token: string }): JSX.Element {
  const [state, setState] = useState<"loading" | "form" | "expired" | "used" | "gone">("loading");
  const [hasAccount, setHasAccount] = useState(false);
  const [patternName, setPatternName] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ patternName: string; hasAccount: boolean; status: string }>(`/api/invites/${props.token}`)
      .then((data) => {
        setPatternName(data.patternName);
        setHasAccount(data.hasAccount);
        setState(data.status === "accepted" ? "used" : data.status === "expired" ? "expired" : "form");
      })
      .catch(() => setState("gone"));
  }, [props.token]);

  if (state === "loading") {
    return (
      <div className="panel">
        <p>{s.loading}</p>
      </div>
    );
  }
  if (state === "gone") {
    return (
      <div className="panel">
        <h1 className="lead">{s.notFound}</h1>
      </div>
    );
  }
  if (state === "expired" || state === "used") {
    return (
      <div className="panel">
        <p>{state === "expired" ? s.inviteExpired : s.inviteUsed}</p>
      </div>
    );
  }
  return (
    <div className="panel">
      <p>{patternName}</p>
      {!hasAccount ? (
        <div className="field">
          <label htmlFor="invite-name">Name</label>
          <input id="invite-name" value={name} aria-label="Name" aria-invalid={field === "name" ? "true" : undefined} onChange={(event) => setName(event.target.value)} />
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="invite-password">Password</label>
        <input id="invite-password" type="password" value={password} aria-label="Password" aria-invalid={field === "password" ? "true" : undefined} onChange={(event) => setPassword(event.target.value)} />
      </div>
      {error ? (
        <p className="alert" role="alert" aria-label="Invite error">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="button-primary"
        aria-busy={busy}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const body = hasAccount ? { password } : { name, password };
            const result = await api<{ patternId: string }>(`/api/invites/${props.token}/accept`, {
              method: "POST",
              body: JSON.stringify(body),
            });
            window.location.href = `/follow/${result.patternId}`;
          } catch (failure) {
            if (failure instanceof ApiFail) {
              if (failure.status === 422) {
                setError(String(failure.payload.message ?? ""));
                setField(String(failure.payload.field ?? ""));
              } else if (failure.status === 401) {
                setError(fieldErrors.signInBad);
              } else if (failure.status === 409) {
                setError(String(failure.payload.message ?? ""));
              }
            }
            setBusy(false);
          }
        }}
      >
        Join as tester
      </button>
    </div>
  );
}
