import { type FormEvent, type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { type UserInfo, asFailure, post } from "../api.js";
import { Page } from "../components/Page.js";
import { Link, navigate, useLocation } from "../router.js";
import { useSession } from "../session.js";

/** Sign-up with an emailed code, the code screen and sign-in. Results appear in the Account status region. */

const PENDING_EMAIL = "jarful.pending-email";

const notice = { text: "", listeners: new Set<() => void>() };
function say(text: string): void {
  notice.text = text;
  notice.listeners.forEach((listener) => listener());
}
const subscribeNotice = (listener: () => void): (() => void) => {
  notice.listeners.add(listener);
  return () => void notice.listeners.delete(listener);
};

const REFUSALS: Record<string, string> = {
  invalid_code: "That code is not right",
  invalid_credentials: "Email or password is not right",
  not_confirmed: "Confirm your email first",
  email_taken: "An account with this email already exists",
};

const FIELD_HELP: Record<string, string> = {
  email: "Enter a valid email address",
  password: "Password needs at least 8 characters",
  name: "Name needs 1 to 80 characters",
};

function refusalText(error: unknown): string {
  const failure = asFailure(error);
  if (failure.body.error === "invalid_field") return FIELD_HELP[String(failure.body["field"])] ?? "Check the form and try again";
  return REFUSALS[failure.body.error] ?? "Something went wrong. Try again";
}

function AccountStatus({ busy }: { busy: boolean }): ReactNode {
  const text = useSyncExternalStore(subscribeNotice, () => notice.text);
  return (
    <p className="status-line" role="status" aria-label="Account status" aria-busy={busy || undefined}>
      {text}
    </p>
  );
}

function Field({ label, type = "text", value, onChange, autoComplete }: { label: string; type?: string; value: string; onChange: (value: string) => void; autoComplete?: string }): ReactNode {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        className="input"
        type={type}
        role={type === "password" ? "textbox" : undefined}
        value={value}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function useForm(): { busy: boolean; submit: (work: () => Promise<void>) => (event: FormEvent) => void } {
  const [busy, setBusy] = useState(false);
  const submit = (work: () => Promise<void>) => (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    work()
      .catch((error: unknown) => say(refusalText(error)))
      .finally(() => setBusy(false));
  };
  return { busy, submit };
}

function nextPath(search: URLSearchParams): string {
  const next = search.get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/projects";
}

export function SignUp(): ReactNode {
  const { busy, submit } = useForm();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <Page signedIn={false}>
      <h1>START A JAR</h1>
      <p className="muted">Make an account, then type the code we email you.</p>
      <form
        className="stack"
        noValidate
        onSubmit={submit(async () => {
          await post("/api/auth/signup", { email, password, name });
          sessionStorage.setItem(PENDING_EMAIL, email.trim().toLowerCase());
          say(`Check ${email.trim().toLowerCase()} for your code`);
          navigate("/confirm");
        })}
      >
        <Field label="Name" value={name} onChange={setName} autoComplete="name" />
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="new-password" />
        <AccountStatus busy={busy} />
        <div className="actions">
          <button type="submit" className="btn btn-lime" aria-disabled={busy || undefined}>
            Create account
          </button>
          <Link to="/signin" className="text-link">
            Sign in
          </Link>
        </div>
      </form>
    </Page>
  );
}

export function Confirm(): ReactNode {
  const { signedIn } = useSession();
  const { search } = useLocation();
  const { busy, submit } = useForm();
  const [code, setCode] = useState("");
  const email = sessionStorage.getItem(PENDING_EMAIL);
  useEffect(() => {
    if (!email) navigate("/signup", true);
  }, [email]);
  if (!email) return null;
  return (
    <Page signedIn={false}>
      <h1>CHECK YOUR EMAIL</h1>
      <p className="muted">Type the six digits from the message sent to {email}.</p>
      <form
        className="stack"
        noValidate
        onSubmit={submit(async () => {
          const answer = await post<{ user: UserInfo }>("/api/auth/confirm", { email, code: code.trim() });
          sessionStorage.removeItem(PENDING_EMAIL);
          say("");
          signedIn(answer.user);
          navigate(nextPath(search));
        })}
      >
        <Field label="Code" value={code} onChange={setCode} autoComplete="one-time-code" />
        <AccountStatus busy={busy} />
        <div className="actions">
          <button type="submit" className="btn btn-lime" aria-disabled={busy || undefined}>
            Confirm
          </button>
          <button
            type="button"
            className="btn"
            onClick={submit(async () => {
              await post("/api/auth/resend", { email });
              say(`Check ${email} for your code`);
            })}
          >
            Send a new code
          </button>
        </div>
      </form>
    </Page>
  );
}

export function SignIn(): ReactNode {
  const { signedIn } = useSession();
  const { search } = useLocation();
  const { busy, submit } = useForm();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <Page signedIn={false}>
      <h1>WELCOME BACK</h1>
      <p className="muted">Sign in to open your jars.</p>
      <form
        className="stack"
        noValidate
        onSubmit={submit(async () => {
          const answer = await post<{ user: UserInfo }>("/api/auth/signin", { email, password });
          say("");
          signedIn(answer.user);
          navigate(nextPath(search));
        })}
      >
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        <AccountStatus busy={busy} />
        <div className="actions">
          <button type="submit" className="btn btn-lime" aria-disabled={busy || undefined}>
            Sign in
          </button>
          <Link to="/signup" className="text-link">
            Start a project
          </Link>
        </div>
      </form>
    </Page>
  );
}
