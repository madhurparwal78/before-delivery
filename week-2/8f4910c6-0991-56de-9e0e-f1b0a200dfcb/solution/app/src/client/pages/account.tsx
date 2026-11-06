// Account pages: sign in, forgot password, and setting a password from a reset or invitation link.

import { useState, type FormEvent } from "react";
import { api } from "../api.js";
import { Link, definePage, navigate, useLocation } from "../router.js";
import { Button } from "../ui/button.js";
import { FieldError, TextField } from "../ui/fields.js";
import { Problems, useFormErrors } from "../ui/problems.js";
import { StatusLine, useAnnouncer } from "../ui/status.js";
import { HOMES, safeReturn, signedIn, type Member } from "../session.js";

function SignIn() {
  const { query } = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const { message, announce } = useAnnouncer();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    const result = await api<{ member: Member; home: string }>("POST", "/api/session", { email, password });
    setPending(false);
    if (result.ok) {
      signedIn(result.data.member);
      navigate(safeReturn(query.get("return")) ?? HOMES[result.data.member.role]);
      return;
    }
    announce(result.error.error === "invalid_credentials" ? "That email and password do not match."
      : "Signing in is not possible right now. Try again in a moment.");
  };

  return (
    <section className="account-form">
      <p className="eyebrow">Rungboard</p>
      <h1 tabIndex={-1} className="display-l">Sign in</h1>
      <p className="muted">The booking and casting workspace of Vesper &amp; Rowe Talent.</p>
      <StatusLine name="Account" message={message} />
      <form noValidate onSubmit={(event) => void submit(event)} className="stack">
        <TextField id="signin-email" label="Email" type="email" autoComplete="username" value={email} onChange={setEmail} />
        <div className="field">
          <label htmlFor="signin-password">Password</label>
          <input id="signin-password" className="input" type="password" autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="btn-row">
          <Button type="submit" pending={pending} pendingLabel="Signing in…">Sign in</Button>
          <Link href="/forgot-password" className="btn-text">Forgot password?</Link>
        </div>
      </form>
    </section>
  );
}

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const { message, announce } = useAnnouncer();
  const form = useFormErrors({ email: "forgot-email" });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    const result = await api<{ message: string }>("POST", "/api/password-resets", { email });
    setPending(false);
    if (result.ok) {
      form.clear();
      announce(result.data.message);
    } else if (!form.take(result.error, announce)) {
      announce("The reset link could not be sent. Try again in a moment.");
    }
  };

  return (
    <section className="account-form">
      <h1 tabIndex={-1} className="display-l">Forgot password</h1>
      <p className="muted">Enter your work email and we will send a link to set a new password.</p>
      <StatusLine name="Account" message={message} />
      <form noValidate onSubmit={(event) => void submit(event)} className="stack">
        <Problems items={form.problems} />
        <TextField id="forgot-email" label="Email" type="email" autoComplete="username" value={email} onChange={setEmail}
          error={form.error("email")} />
        <div className="btn-row">
          <Button type="submit" pending={pending} pendingLabel="Sending…">Send reset link</Button>
          <Link href="/sign-in" className="btn-text">Back to sign in</Link>
        </div>
      </form>
    </section>
  );
}

function SetPassword({ title, endpoint, intro }: { title: string; endpoint: string; intro: string }) {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const { message, announce } = useAnnouncer();
  const form = useFormErrors({ password: "new-password" });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    const result = await api<{ member: Member; home: string }>("POST", endpoint, { password });
    setPending(false);
    if (result.ok) {
      signedIn(result.data.member);
      navigate(result.data.home);
      return;
    }
    if (form.take(result.error, announce)) return;
    announce(result.status === 410 || result.status === 404
      ? "This link no longer works. Ask for a new one." : "The password could not be set. Try again in a moment.");
  };

  return (
    <section className="account-form">
      <h1 tabIndex={-1} className="display-l">{title}</h1>
      <p className="muted">{intro}</p>
      <StatusLine name="Account" message={message} />
      <form noValidate onSubmit={(event) => void submit(event)} className="stack">
        <Problems items={form.problems} />
        <div className="field">
          <label htmlFor="new-password">New password</label>
          <p id="new-password-hint" className="field-hint">At least 12 characters.</p>
          <input id="new-password" className="input" type="password" autoComplete="new-password" value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby={form.error("password") ? "new-password-hint new-password-error" : "new-password-hint"}
            aria-invalid={form.error("password") ? true : undefined} />
          <FieldError id="new-password" error={form.error("password")} />
        </div>
        <Button type="submit" pending={pending} pendingLabel="Saving…">Set password</Button>
      </form>
    </section>
  );
}

definePage({ pattern: "/sign-in", kind: "account", render: () => <SignIn /> });
definePage({ pattern: "/forgot-password", kind: "account", render: () => <ForgotPassword /> });
definePage({
  pattern: "/reset/:token", kind: "account",
  render: (match) => <SetPassword title="Set a new password" endpoint={`/api/password-resets/${encodeURIComponent(match.params.token)}`}
    intro="Choose a new password for your Rungboard account." />,
});
definePage({
  pattern: "/invite/:token", kind: "account",
  render: (match) => <SetPassword title="Join Rungboard" endpoint={`/api/invitations/${encodeURIComponent(match.params.token)}/accept`}
    intro="You have been invited to the Vesper & Rowe Talent workspace. Choose a password to finish." />,
});
