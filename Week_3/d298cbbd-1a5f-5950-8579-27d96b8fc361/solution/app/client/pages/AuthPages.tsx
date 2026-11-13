import type { ComponentChildren, JSX } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";
import { ApiError, api, exchange } from "../api";
import { Link, navigate, previousPage } from "../router";
import { useStore } from "../store";
import { Store } from "../store";
import { viewer } from "../viewer";

/** Set when a sign-up could not send its mail: the page shows the banner and the mail follows when mail recovers. */
export const mailOutage = new Store<boolean>(false);

const AUTH_PATHS = ["/signin", "/signup", "/reset", "/verify"];

function Field({ label, type = "text", value, onInput, error, autocomplete }: { label: string; type?: "text" | "email" | "password"; value: string; onInput: (value: string) => void; error?: string; autocomplete?: string }): JSX.Element {
  const id = `field-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <input id={id} type={type as "text"} value={value} autocomplete={autocomplete} aria-invalid={error ? "true" : undefined} aria-describedby={error ? `${id}-error` : undefined} onInput={(event) => onInput(event.currentTarget.value)} />
      {error && <p id={`${id}-error`} class="field-error" role="alert">{error}</p>}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ComponentChildren }): JSX.Element {
  return (
    <section class="paper narrow">
      <h1 class="page-title">{title}</h1>
      {children}
    </section>
  );
}

export function SignUpPage(): JSX.Element {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const outage = useStore(mailOutage);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    setPending(true);
    const answer = await exchange("POST", "/api/signup", { name, email, password });
    setPending(false);
    if (answer.status === 201) {
      mailOutage.set(answer.body.mail === "retrying");
      await viewer.signedIn({ id: String(answer.body.id), name: name.trim(), verified: false });
      setSentTo(String(answer.body.email));
    } else if (answer.status === 409) setErrors({ email: "An account with that email already exists." });
    else if (answer.status === 422) setErrors(answer.body.errors as Record<string, string>);
  }

  if (sentTo !== null) {
    return (
      <Panel title="Check your email">
        {!outage && <p>We sent a verification link to {sentTo}.</p>}
        <p>Until you verify, your runs are not filed.</p>
        <Link href="/" class="button">Start typing</Link>
      </Panel>
    );
  }
  return (
    <Panel title="Sign up">
      <form class="form" onSubmit={(event) => void submit(event)} noValidate>
        <Field label="Display name" value={name} onInput={setName} error={errors.name} autocomplete="nickname" />
        <Field label="Email" type="email" value={email} onInput={setEmail} error={errors.email} autocomplete="email" />
        <Field label="Password" type="password" value={password} onInput={setPassword} error={errors.password} autocomplete="new-password" />
        <button type="submit" class="button" disabled={pending}>Create account</button>
      </form>
      <p class="aside">Already have an account? <Link href="/signin">Sign in</Link></p>
    </Panel>
  );
}

export function SignInPage(): JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    setPending(true);
    const answer = await exchange("POST", "/api/session", { email, password });
    setPending(false);
    if (answer.status === 200) {
      await viewer.signedIn({ id: String(answer.body.id), name: String(answer.body.name), verified: answer.body.verified === true });
      const back = previousPage();
      navigate(AUTH_PATHS.some((path) => back.startsWith(path)) ? "/" : back);
    } else if (answer.status === 429) setProblem(`Too many attempts. Try again in ${String(answer.body.retryAfter)} seconds.`);
    else setProblem("Email or password is incorrect.");
  }

  return (
    <Panel title="Sign in">
      <form class="form" onSubmit={(event) => void submit(event)} noValidate>
        {problem && <p class="alert" role="alert">{problem}</p>}
        <Field label="Email" type="email" value={email} onInput={setEmail} autocomplete="email" />
        <Field label="Password" type="password" value={password} onInput={setPassword} autocomplete="current-password" />
        <button type="submit" class="button" disabled={pending}>Sign in</button>
      </form>
      <p class="aside"><Link href="/reset">Forgot password</Link></p>
      <p class="aside">New here? <Link href="/signup">Sign up</Link></p>
    </Panel>
  );
}

export function ResetRequestPage(): JSX.Element {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    setPending(true);
    await exchange("POST", "/api/password-reset", { email });
    setPending(false);
    setSent(true);
  }

  return (
    <Panel title="Reset your password">
      <form class="form" onSubmit={(event) => void submit(event)} noValidate>
        <Field label="Email" type="email" value={email} onInput={setEmail} autocomplete="email" />
        <button type="submit" class="button" disabled={pending}>Send reset link</button>
      </form>
      {sent && <p class="notice">If that email has an account, a reset link is on its way.</p>}
    </Panel>
  );
}

export function ResetConfirmPage({ token }: { token: string }): JSX.Element {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<"form" | "changed" | "expired">("form");
  const [pending, setPending] = useState(false);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    setPending(true);
    const answer = await exchange("POST", "/api/password-reset/confirm", { token, password });
    setPending(false);
    if (answer.status === 200) {
      viewer.signedOut();
      setOutcome("changed");
    } else if (answer.status === 410) setOutcome("expired");
    else setError(String((answer.body.errors as Record<string, string> | undefined)?.password ?? "Something went wrong. Try again."));
  }

  if (outcome === "changed") {
    return (
      <Panel title="Password changed">
        <p>Sign in with your new password.</p>
        <Link href="/signin" class="button">Sign in</Link>
      </Panel>
    );
  }
  if (outcome === "expired") return <ExpiredLink />;
  return (
    <Panel title="Choose a new password">
      <form class="form" onSubmit={(event) => void submit(event)} noValidate>
        <Field label="New password" type="password" value={password} onInput={setPassword} error={error} autocomplete="new-password" />
        <button type="submit" class="button" disabled={pending}>Set password</button>
      </form>
    </Panel>
  );
}

function ExpiredLink(): JSX.Element {
  return (
    <Panel title="Link expired">
      <p>This link has expired or was already used.</p>
    </Panel>
  );
}

export function VerifyPage({ token }: { token: string }): JSX.Element {
  const [outcome, setOutcome] = useState<"checking" | "verified" | "expired">("checking");
  useLayoutEffect(() => {
    api("POST", "/api/verify", { token }).then(
      () => {
        viewer.verified();
        setOutcome("verified");
      },
      (error: unknown) => {
        if (error instanceof ApiError) setOutcome("expired");
      },
    );
  }, [token]);
  if (outcome === "expired") return <ExpiredLink />;
  if (outcome === "verified") {
    return (
      <Panel title="Email verified">
        <p>Your runs will now be filed.</p>
        <Link href="/" class="button">Start typing</Link>
      </Panel>
    );
  }
  return (
    <Panel title="Checking your link">
      <p aria-busy="true">One moment.</p>
    </Panel>
  );
}
