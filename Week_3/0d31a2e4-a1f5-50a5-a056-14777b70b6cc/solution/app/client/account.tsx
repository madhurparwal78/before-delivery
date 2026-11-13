// The account pages: sign-up, sign-in, forgotten password, new password and the verify link.
import type { ComponentChildren, JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { ApiFailure, post } from "./api.js";
import { COPY } from "./copy.js";
import { announce, announceFailure } from "./notices.js";
import { navigate } from "./router.js";
import { me } from "./state.js";
import { Field, SubmitButton, useAction } from "./ui.js";
import type { Me } from "../shared/api.js";

function Card({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <main class="account">
      <p class="brand"><span class="brand-maker">Wobblewell Arcade</span> Pratfall Cup</p>
      <section class="card account-card" aria-labelledby="account-title">
        <h1 id="account-title">{title}</h1>
        {children}
      </section>
    </main>
  );
}

type Fields = Record<string, string>;

// Field errors sit under their fields; the Notices region asks the player to check them.
function fieldFailure(error: unknown, setErrors: (fields: Fields) => void, known: Record<string, string> = {}): void {
  if (error instanceof ApiFailure && error.code === "validation_failed" && Object.keys(error.fields).length > 0) {
    setErrors(error.fields);
    announce(COPY.checkFields);
    return;
  }
  announceFailure(error, known);
}

function submitWith(run: (work: () => Promise<void>) => Promise<void>, work: () => Promise<void>) {
  return (event: JSX.TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(work);
  };
}

export function SignupPage() {
  const [email, setEmail] = useState("");
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Fields>({});
  const [pending, run] = useAction();
  const submit = submitWith(run, async () => {
    setErrors({});
    try {
      const created = await post<{ user: Me; verificationEmail: "sent" | "failed" }>("/api/auth/signup", { email, handle, password });
      me.set(created.user);
      announce(created.verificationEmail === "sent" ? COPY.created(created.user.email) : COPY.createdMailFailed);
      navigate("/");
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "email_taken") {
        setErrors({ email: COPY.emailTaken });
        announce(COPY.checkFields);
      } else if (error instanceof ApiFailure && error.code === "handle_taken") {
        setErrors({ handle: COPY.handleTaken });
        announce(COPY.checkFields);
      } else {
        fieldFailure(error, setErrors);
      }
    }
  });
  return (
    <Card title="Create your account">
      <form onSubmit={submit} noValidate>
        <Field id="signup-email" label="Email" type="email" autocomplete="email" value={email} error={errors["email"]} onInput={setEmail} />
        <Field id="signup-handle" label="Handle" autocomplete="username" value={handle} error={errors["handle"]} onInput={setHandle} />
        <Field id="signup-password" label="Password" type="password" autocomplete="new-password" value={password} error={errors["password"]} onInput={setPassword} />
        <SubmitButton label="Create account" pendingLabel={COPY.creating} pending={pending} />
      </form>
      <p class="aside">Already playing? <a href="/signin">Sign in</a></p>
    </Card>
  );
}

export function SigninPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, run] = useAction();
  const submit = submitWith(run, async () => {
    try {
      const { user } = await post<{ user: Me }>("/api/auth/login", { email, password });
      me.set(user);
      navigate("/");
    } catch (error) {
      announceFailure(error, { invalid_credentials: COPY.wrongCredentials });
    }
  });
  return (
    <Card title="Sign in">
      <form onSubmit={submit} noValidate>
        <Field id="signin-email" label="Email" type="email" autocomplete="email" value={email} onInput={setEmail} />
        <Field id="signin-password" label="Password" type="password" autocomplete="current-password" value={password} onInput={setPassword} />
        <SubmitButton label="Sign in" pendingLabel={COPY.signingIn} pending={pending} />
      </form>
      <p class="aside"><a href="/forgot-password">Forgot password?</a></p>
      <p class="aside">New here? <a href="/signup">Create an account</a></p>
    </Card>
  );
}

export function ForgotPage() {
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<Fields>({});
  const [pending, run] = useAction();
  const submit = submitWith(run, async () => {
    setErrors({});
    try {
      await post("/api/auth/password-reset", { email });
      announce(COPY.resetSent);
    } catch (error) {
      fieldFailure(error, setErrors, { mail_unavailable: COPY.mailDown });
    }
  });
  return (
    <Card title="Reset your password">
      <form onSubmit={submit} noValidate>
        <Field id="forgot-email" label="Email" type="email" autocomplete="email" value={email} error={errors["email"]} onInput={setEmail} />
        <SubmitButton label="Send reset link" pendingLabel={COPY.sending} pending={pending} />
      </form>
      <p class="aside"><a href="/signin">Back to sign in</a></p>
    </Card>
  );
}

const LINK_COPY = { link_expired: COPY.linkExpired, link_invalid: COPY.linkUsed };

export function ResetPage({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Fields>({});
  const [pending, run] = useAction();
  const submit = submitWith(run, async () => {
    setErrors({});
    try {
      await post("/api/auth/password-reset/confirm", { token, password });
      announce(COPY.passwordChanged);
    } catch (error) {
      fieldFailure(error, setErrors, LINK_COPY);
    }
  });
  return (
    <Card title="Choose a new password">
      <form onSubmit={submit} noValidate>
        <Field id="reset-password" label="New password" type="password" autocomplete="new-password" value={password} error={errors["password"]} onInput={setPassword} />
        <SubmitButton label="Set new password" pendingLabel={COPY.saving} pending={pending} />
      </form>
      <p class="aside"><a href="/signin">Back to sign in</a></p>
    </Card>
  );
}

export function VerifyPage({ token }: { token: string }) {
  const [message, setMessage] = useState<string>(COPY.checking);
  const [done, setDone] = useState(false);
  useEffect(() => {
    let current = true;
    post<{ user: Me }>("/api/auth/verify", { token })
      .then(({ user }) => {
        if (me.get()?.id === user.id) me.set(user);
        if (current) setMessage(COPY.verified);
      })
      .catch((error: unknown) => {
        if (!current) return;
        const code = error instanceof ApiFailure ? error.code : "";
        setMessage(code === "link_expired" ? COPY.linkExpired : code === "link_invalid" ? COPY.linkUsed : COPY.unexpected);
      })
      .finally(() => { if (current) setDone(true); });
    return () => { current = false; };
  }, [token]);
  return (
    <Card title="Verify your email">
      <div role="region" aria-label="Verification" aria-busy={done ? undefined : "true"} class="verification">
        <p>{message}</p>
      </div>
      {done ? <p class="aside"><a href="/">Go to Pratfall Cup</a></p> : null}
    </Card>
  );
}
