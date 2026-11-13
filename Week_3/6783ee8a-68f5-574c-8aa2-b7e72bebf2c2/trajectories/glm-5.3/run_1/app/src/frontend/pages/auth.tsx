import { useState } from "react";
import { api, redirectTo } from "../api.ts";
import { WorkspaceHeader } from "../ui.tsx";

type FieldErrors = Record<string, string>;

function FormAlert({ errors }: { errors: FieldErrors }) {
  const entries = Object.entries(errors);
  if (entries.length === 0) return null;
  return (
    <div className="alert" role="alert">
      <p className="alert__title">Please fix the following:</p>
      <ul className="alert__list">
        {entries.map(([field, message]) => (
          <li key={field}>
            <a href={`#field-${field}`}>{message}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  return next === null || next === "" ? "/notebooks" : next;
}

export function SignInPage({ onAuthChange }: { onAuthChange: () => void }) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <>
      <WorkspaceHeader user={null} />
      <main className="band band--grey" style={{ minHeight: "70vh" }}>
        <div className="container" style={{ maxWidth: 460 }}>
          <div className="card form-card" style={{ marginTop: 24 }}>
            <h1 className="section-heading" style={{ textAlign: "left" }}>Sign in</h1>
            {notice !== null ? <div className="alert" role="alert"><p className="alert__title">{notice}</p></div> : null}
            <FormAlert errors={errors} />
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const email = String(form.get("email") ?? "");
                const password = String(form.get("password") ?? "");
                const result = await api.signin({ email, password });
                if (result.ok) {
                  onAuthChange();
                  redirectTo(nextPath());
                  return;
                }
                if (result.error.error === "invalid_credentials") {
                  setErrors({ email: "Email or password is wrong." });
                  setNotice("Email or password is wrong.");
                } else if (result.error.error === "email_not_verified") {
                  setErrors({});
                  setNotice("Verify your email first. We sent you a link.");
                } else if (result.error.error === "mail_unavailable") {
                  setErrors({});
                  setNotice("We could not send email right now. Try again in a minute.");
                } else {
                  setErrors({});
                  setNotice("Email or password is wrong.");
                }
              }}
            >
              <label className="field">
                <span className="field__label">Email</span>
                <input className="field__input" id="field-email" name="email" type="email" required autoComplete="email" />
              </label>
              <label className="field">
                <span className="field__label">Password</span>
                <input className="field__input" id="field-password" name="password" type="password" required autoComplete="current-password" />
              </label>
              <div style={{ marginTop: 16 }}>
                <button className="button--accent" type="submit">Sign in</button>
              </div>
            </form>
            <p style={{ marginTop: 14 }}>
              <a href="/signup">Create an account</a>
            </p>
          </div>
        </div>
      </main>
    </>
  );
}

export function SignUpPage({ invitationToken, onAuthChange }: { invitationToken: string | null; onAuthChange: () => void }) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(invitationToken === null);

  if (invitationToken !== null && !loaded) {
    void api.invitation(invitationToken).then((result) => {
      if (result.ok) setInvitedEmail(result.value.email);
      setLoaded(true);
    });
    return (
      <>
        <WorkspaceHeader user={null} />
        <main className="band band--grey"><div className="container"><p>Loading…</p></div></main>
      </>
    );
  }

  return (
    <>
      <WorkspaceHeader user={null} />
      <main className="band band--grey" style={{ minHeight: "70vh" }}>
        <div className="container" style={{ maxWidth: 460 }}>
          <div className="card form-card" style={{ marginTop: 24 }}>
            <h1 className="section-heading" style={{ textAlign: "left" }}>Create an account</h1>
            {notice !== null ? <div className="alert" role="alert"><p className="alert__title">{notice}</p></div> : null}
            <FormAlert errors={errors} />
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const display_name = String(form.get("display_name") ?? "");
                const email = String(form.get("email") ?? "");
                const password = String(form.get("password") ?? "");
                const use = String(form.get("use") ?? "");
                const body = invitationToken === null
                  ? { display_name, email, password, use }
                  : { display_name, email, password, use, invitation_token: invitationToken };
                const result = await api.signup(body);
                if (result.ok) {
                  onAuthChange();
                  if (result.value.notebook_id !== undefined) {
                    setNotice("You are in. Opening the notebook…");
                    redirectTo(`/notebooks/${result.value.notebook_id}`);
                  } else {
                    setNotice("Check your inbox to verify your email.");
                  }
                  return;
                }
                const fieldErrors: FieldErrors = {};
                for (const entry of result.error.errors ?? []) {
                  fieldErrors[entry.path.split("[").join(".").split("]").join("")] = entry.message;
                }
                if (result.error.error === "mail_unavailable") {
                  setErrors({});
                  setNotice("We could not send email right now. Try again in a minute.");
                  return;
                }
                if (Object.keys(fieldErrors).length === 0) {
                  setNotice("We could not create your account right now.");
                }
                setErrors(fieldErrors);
              }}
            >
              <label className="field">
                <span className="field__label">Display name</span>
                <input className="field__input" id="field-display_name" name="display_name" required maxLength={40} autoComplete="name" />
              </label>
              <label className="field">
                <span className="field__label">Email</span>
                <input
                  className="field__input"
                  id="field-email"
                  name="email"
                  type="email"
                  required
                  readOnly={invitedEmail !== null}
                  value={invitedEmail ?? undefined}
                  onChange={(event) => setInvitedEmail(event.target.value)}
                  autoComplete="email"
                />
              </label>
              <label className="field">
                <span className="field__label">Password</span>
                <input className="field__input" id="field-password" name="password" type="password" required minLength={10} maxLength={128} autoComplete="new-password" />
              </label>
              <label className="field">
                <span className="field__label">I mostly use notebooks for</span>
                <select className="field__select" id="field-use" name="use" defaultValue="">
                  <option value="" disabled>I mostly use notebooks for *</option>
                  <option value="teaching">Teaching</option>
                  <option value="research">Research</option>
                  <option value="analysis">Analysis</option>
                  <option value="tinkering">Tinkering</option>
                </select>
              </label>
              <div style={{ marginTop: 16 }}>
                <button className="button--accent" type="submit">Create account</button>
              </div>
            </form>
          </div>
        </div>
      </main>
    </>
  );
}

export function VerifyPage({ token }: { token: string }) {
  const [state, setState] = useState<"loading" | "ok" | "invalid">("loading");
  if (state === "loading") {
    void api.verify(token).then((result) => setState(result.ok ? "ok" : "invalid"));
  }
  return (
    <>
      <WorkspaceHeader user={null} />
      <main className="band band--grey" style={{ minHeight: "60vh" }}>
        <div className="container" style={{ maxWidth: 460 }}>
          <div className="card" style={{ marginTop: 48, textAlign: "center" }}>
            {state === "loading" ? <p>Verifying…</p> : null}
            {state === "ok" ? <p>Email verified. You can sign in now.</p> : null}
            {state === "invalid" ? <p>This verification link is not valid.</p> : null}
            <p><a href="/signin">Sign in</a></p>
          </div>
        </div>
      </main>
    </>
  );
}

export function InvitePage({ token, user, onAuthChange }: { token: string; user: unknown; onAuthChange: () => void }) {
  const [state, setState] = useState<"loading" | "ready" | "unknown" | "accepted">("loading");
  const [invite, setInvite] = useState<{ email: string; role: string; notebook_title: string; owner_display_name: string; account_exists: boolean } | null>(null);
  const [heading, setHeading] = useState("");
  const [busy, setBusy] = useState(false);

  if (state === "loading") {
    void api.invitation(token).then((result) => {
      if (!result.ok) {
        setState("unknown");
        return;
      }
      setInvite(result.value);
      const me = user as { email: string } | null;
      if (me !== null && me.email.toLowerCase() === result.value.email.toLowerCase()) {
        setHeading(`${result.value.owner_display_name} shared “${result.value.notebook_title}” with you`);
        setState("ready");
      } else if (me !== null) {
        setHeading("This invitation is for another account.");
        setState("ready");
      } else {
        setHeading(result.value.account_exists
          ? `Sign in as ${result.value.email} to open the shared notebook.`
          : `Create an account to open “${result.value.notebook_title}”`);
        setState("ready");
      }
    });
  }

  const invitedUser = user as { email: string } | null;
  const isInvitedAccount = invitedUser !== null && invite !== null && invitedUser.email.toLowerCase() === invite.email.toLowerCase();

  return (
    <>
      <WorkspaceHeader user={user as never} onSignOut={onAuthChange} />
      <main className="band band--grey" style={{ minHeight: "60vh" }}>
        <div className="container" style={{ maxWidth: 520 }}>
          <div className="card" style={{ marginTop: 48, textAlign: "center" }}>
            {state === "loading" || (state === "ready" && invite === null) ? <p>Loading…</p> : null}
            {state === "unknown" ? (
              <>
                <h1 className="card__title">This invitation is not valid.</h1>
              </>
            ) : null}
            {state === "ready" && invite !== null ? (
              <>
                <h1 className="card__title" style={{ fontSize: "1.2rem" }}>{heading}</h1>
                {isInvitedAccount ? (
                  <>
                    <p>Role: {invite.role === "editor" ? "Editor" : "Viewer"}</p>
                    <button
                      className="button--accent"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        const result = await api.acceptInvitation(token);
                        if (result.ok) {
                          setState("accepted");
                          redirectTo(`/notebooks/${result.value.notebook_id}`);
                        }
                      }}
                    >
                      Open notebook
                    </button>
                  </>
                ) : invitedUser !== null ? (
                  <button
                    className="button--accent"
                    onClick={async () => {
                      await api.signout();
                      onAuthChange();
                      window.location.reload();
                    }}
                  >
                    Sign out
                  </button>
                ) : invite.account_exists ? (
                  <a className="button--accent" href={`/signin?next=${encodeURIComponent(`/invite/${token}`)}`} style={{ textDecoration: "none", display: "inline-block" }}>Sign in</a>
                ) : (
                  <a className="button--accent" href={`/signup?invitation=${token}`} style={{ textDecoration: "none", display: "inline-block" }}>Create an account</a>
                )}
              </>
            ) : null}
          </div>
        </div>
      </main>
    </>
  );
}
