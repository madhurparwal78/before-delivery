import { useEffect, useState } from "react";
import type { Member } from "../shared/types.js";
import { api, ApiError } from "./api.js";
import { WorkspaceShell } from "./Workspace.js";

/** The sign-in screen and the top-level app switch. */

export function App(): JSX.Element {
  const [member, setMember] = useState<Member | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    api
      .me()
      .then((reply) => setMember(reply.member))
      .catch(() => setMember(null))
      .finally(() => setChecked(true));
  }, []);

  if (!checked) return <div className="signin" />;
  if (!member) {
    return (
      <SignIn
        onSignedIn={(m) => {
          setMember(m);
        }}
      />
    );
  }
  return <WorkspaceShell member={member} onSignedOut={() => setMember(null)} />;
}

function SignIn({ onSignedIn }: { onSignedIn: (member: Member) => void }): JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const reply = await api.signIn(email, password);
      onSignedIn(reply.member);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.fields ?? {});
      } else {
        setError("No answer from the server. Your change was not confirmed.");
      }
      setPending(false);
    }
  };

  return (
    <div className="signin">
      <form className="signin-card" aria-label="Sign in" onSubmit={submit}>
        <div className="wordmark">Kerfline Bench</div>
        <div className="wordmark-sub">Halyard Instrument Works</div>
        <label htmlFor="signin-email">Email</label>
        <input
          id="signin-email"
          name="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={fieldErrors.email ? "true" : undefined}
          aria-describedby={fieldErrors.email ? "signin-email-error" : undefined}
        />
        {fieldErrors.email ? (
          <div id="signin-email-error" className="field-error">
            {fieldErrors.email}
          </div>
        ) : null}
        <label htmlFor="signin-password">Password</label>
        <input
          id="signin-password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={fieldErrors.password ? "true" : undefined}
          aria-describedby={fieldErrors.password ? "signin-password-error" : undefined}
        />
        {fieldErrors.password ? (
          <div id="signin-password-error" className="field-error">
            {fieldErrors.password}
          </div>
        ) : null}
        <div style={{ marginTop: 16 }}>
          <button type="submit" disabled={pending} style={{ width: "100%" }}>
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </div>
        {error ? (
          <div role="alert" className="field-error" style={{ marginTop: 8 }}>
            {error}
          </div>
        ) : null}
      </form>
    </div>
  );
}

