// Sign-in `/signin` and accept invite `/invite/<token>` (brief: Screens and layout; Feedback states).
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { ApiError, type ErrorBody, type InviteInfo, type Me, MUTATION_HEADERS, api, retryAfter } from "./api";
import { STORAGE_OUTAGE, throttledSignIn } from "./copy";
import { Field } from "./dialog";

// The page asked for before sign-in, when this user's role may open it. /account is open to everyone.
function destination(me: Me): string {
  const next = new URLSearchParams(location.search).get("next") ?? "";
  const area = me.user.operator ? "/ops" : "/console";
  const within = (root: string): boolean => next.startsWith(root) && (next.length === root.length || "/?".includes(next.charAt(root.length)));
  return within(area) || within("/account") ? next : area;
}

function signInCopy(error: unknown): string {
  if (error instanceof ApiError && error.code === "invalid_credentials") return "Email or password is incorrect.";
  if (error instanceof ApiError && error.code === "rate_limited") return throttledSignIn(retryAfter(error));
  return STORAGE_OUTAGE;
}

// Sign-in calls answer 401 as part of the flow, so they never take api()'s redirect to sign-in.
async function send<T>(method: string, path: string, body?: Record<string, unknown>): Promise<{ status: number; body: T }> {
  const response = await fetch(path, {
    method,
    headers: { ...MUTATION_HEADERS, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const parsed = (await response.json()) as T | ErrorBody;
  if (!response.ok) throw new ApiError(response.status, parsed as ErrorBody);
  return { status: response.status, body: parsed as T };
}

function Panel({ children }: { children: JSX.Element | JSX.Element[] }): JSX.Element {
  return (
    <main class="auth">
      <span class="wordmark auth__wordmark">
        <span class="wordmark__dot" aria-hidden="true" />
        Farshore
      </span>
      <div class="auth__panel">{children}</div>
    </main>
  );
}

type Step = "loading" | "password" | "code" | "recovery";

export function SignIn(): JSX.Element {
  const [step, setStep] = useState<Step>("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState("");

  // A browser holding a pending two-step session sees the code step.
  useEffect(() => {
    fetch("/api/me").then(
      async (response) => {
        const body = (await response.json()) as ErrorBody | Me;
        setStep(response.status === 401 && (body as ErrorBody).error === "two_step_required" ? "code" : "password");
      },
      () => setStep("password"),
    );
  }, []);

  const signIn = async (event: Event): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setAlert("");
    try {
      const answer = await send<Me>("POST", "/api/session", { email, password });
      if (answer.status === 202) {
        setPassword("");
        setCode("");
        setStep("code");
        setPending(false);
        return;
      }
      location.assign(destination(answer.body));
    } catch (error) {
      setAlert(signInCopy(error));
      setPending(false);
    }
  };

  const verify = async (event: Event): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setAlert("");
    try {
      const answer = await send<Me>("POST", "/api/session/two-step", step === "code" ? { code } : { recovery_code: code });
      location.assign(destination(answer.body));
    } catch (error) {
      setPending(false);
      if (!(error instanceof ApiError)) setAlert(STORAGE_OUTAGE);
      else if (error.code === "unauthenticated") {
        setStep("password");
        setAlert("This sign-in has expired. Enter your email and password again.");
      } else if (error.code === "invalid_credentials") setAlert("That code didn't work.");
      else if (error.code === "rate_limited") setAlert(throttledSignIn(retryAfter(error)));
      else if (error.body.errors?.["code"]) setAlert(error.body.errors["code"]);
      else setAlert(STORAGE_OUTAGE);
    }
  };

  const swap = (next: "code" | "recovery"): void => {
    setStep(next);
    setCode("");
    setAlert("");
  };

  const alertLine = alert ? (
    <p role="alert" class="auth__alert">
      {alert}
    </p>
  ) : null;

  if (step === "code" || step === "recovery") {
    const recovery = step === "recovery";
    return (
      <Panel>
        <h1 class="auth__title">{recovery ? "Enter one of your recovery codes" : "Enter the code from your authenticator app"}</h1>
        {recovery ? <></> : <p class="auth__meta">Codes change every 30 seconds.</p>}
        <form class="auth__form" noValidate onSubmit={verify}>
          <Field label={recovery ? "Recovery code" : "Authenticator code"}>
            {(described, id) => (
              <input key={step} id={id} class="mono-input" required value={code} aria-describedby={described} spellcheck={false}
                inputMode={recovery ? "text" : "numeric"} autocomplete="one-time-code" onInput={(e) => setCode(e.currentTarget.value)} />
            )}
          </Field>
          {alertLine}
          <button type="submit" class="button button--primary button--block" disabled={pending}>
            {pending ? "Verifying…" : "Verify"}
          </button>
          <button type="button" class="button button--quiet button--block" onClick={() => swap(recovery ? "code" : "recovery")}>
            {recovery ? "Use an authenticator code" : "Use a recovery code"}
          </button>
        </form>
      </Panel>
    );
  }

  return (
    <Panel>
      <h1 class="auth__title">Sign in</h1>
      <form class="auth__form" noValidate onSubmit={signIn}>
        <Field label="Email">
          {(described, id) => (
            <input id={id} type="email" autocomplete="username" required value={email} aria-describedby={described}
              onInput={(e) => setEmail(e.currentTarget.value)} />
          )}
        </Field>
        <Field label="Password">
          {(described, id) => (
            <input id={id} type="password" autocomplete="current-password" required value={password}
              aria-describedby={described} onInput={(e) => setPassword(e.currentTarget.value)} />
          )}
        </Field>
        {alertLine}
        <button type="submit" class="button button--primary button--block" disabled={pending || step === "loading"}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </Panel>
  );
}

const INVITE_EXPIRED = "This invite has expired. Ask the workspace owner for a new one.";

function acceptCopy(error: unknown): string {
  if (!(error instanceof ApiError)) return STORAGE_OUTAGE;
  if (error.code === "invite_expired") return INVITE_EXPIRED;
  if (error.code === "invalid_credentials") return "That password doesn't match your Farshore account.";
  if (error.code === "rate_limited") return throttledSignIn(retryAfter(error));
  if (error.code === "service_unavailable") return STORAGE_OUTAGE;
  return error.message;
}

export function AcceptInvite({ token }: { token: string }): JSX.Element {
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const path = `/api/invites/${encodeURIComponent(token)}`;

  useEffect(() => {
    api<InviteInfo>("GET", path).then(setInvite, (error: unknown) => setAlert(acceptCopy(error)));
  }, [path]);

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (!invite) return;
    setPending(true);
    setAlert("");
    setFieldErrors({});
    try {
      const joined = await api<{ two_step?: string }>("POST", `${path}/accept`, invite.existing_account ? { password } : { name, password });
      // An enrolled account finishes with the code step, exactly as at sign-in.
      location.assign(joined.two_step ? "/signin?next=%2Fconsole" : "/console");
    } catch (error) {
      if (error instanceof ApiError && error.body.errors) setFieldErrors(error.body.errors);
      else setAlert(acceptCopy(error));
      setPending(false);
    }
  };

  return (
    <Panel>
      <h1 class="auth__title">{invite ? `Join ${invite.workspace.name}` : "Join a workspace"}</h1>
      {invite ? (
        <p class="auth__meta">
          Invited as <strong>{invite.email}</strong> · {invite.role}
        </p>
      ) : (
        <></>
      )}
      <form class="auth__form" noValidate onSubmit={submit}>
        {invite && !invite.existing_account ? (
          <Field label="Your name" error={fieldErrors["name"]}>
            {(described, id) => (
              <input id={id} autocomplete="name" required value={name} aria-describedby={described}
                onInput={(e) => setName(e.currentTarget.value)} />
            )}
          </Field>
        ) : (
          <></>
        )}
        <Field label="Password" error={fieldErrors["password"]}>
          {(described, id) => (
            <input id={id} type="password" required value={password} aria-describedby={described}
              autocomplete={invite?.existing_account ? "current-password" : "new-password"}
              onInput={(e) => setPassword(e.currentTarget.value)} />
          )}
        </Field>
        {alert ? (
          <p role="alert" class="auth__alert">
            {alert}
          </p>
        ) : (
          <></>
        )}
        <button type="submit" class="button button--primary button--block" disabled={pending || !invite}>
          Join workspace
        </button>
      </form>
    </Panel>
  );
}
