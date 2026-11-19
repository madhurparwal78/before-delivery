import { useRef, useState, type FormEvent } from "react";
import { ApiError, post } from "../lib/api";
import { useTitle } from "../lib/hooks";
import { Link, useRouter } from "../lib/router";
import { useStore } from "../lib/store";
import { KeyMark } from "../ui/art";
import { Field, SubmitButton, useOnce } from "../ui/Field";
import { LiveRegions, PublicShell } from "./Shell";

const FOLDERS = ["Payroll", "Banking", "Hosting", "Vendor portals", "Office"];

export function Landing() {
  useTitle("Keys kept here");
  return (
    <PublicShell dark>
      <section className="hero">
        <h1>KEYS KEPT HERE</h1>
        <p className="hero-line">One drawer for every login the office shares, who holds it, and when it turns.</p>
        <ul className="hero-stack" aria-label="Drawer folders">
          {FOLDERS.map((name, index) => (
            <li key={name} className={`hero-folder ${index === FOLDERS.length - 1 ? "hero-front" : ""}`} style={{ ["--i" as string]: index }}>
              <span className="hero-tab">{name}</span>
              {index === FOLDERS.length - 1 ? (
                <div className="hero-open"><Link to="/desk" className="btn btn-solid btn-cut hero-cta">Open the drawer</Link></div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </PublicShell>
  );
}

const SIGN_IN_COPY: Record<string, string> = {
  bad_credentials: "That username and password don't match.",
  account_disabled: "This sign-in is switched off. Ask the office manager.",
  sign_in_unavailable: "Sign-in is unavailable right now. Try again in a minute.",
};

export function SignIn() {
  useTitle("Sign in");
  const { location, navigate } = useRouter();
  const { refreshMe, warn } = useStore();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const user = useRef<HTMLInputElement>(null);
  const { pending, run } = useOnce();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const next = new URLSearchParams(location.search).get("next");
      try {
        const body: { username: string; password: string; next?: string } = { username, password };
        if (next) body.next = next;
        const result = await post<{ landing: string }>("/api/sessions", body, { quiet401: true });
        await refreshMe();
        navigate(result.landing);
      } catch (error) {
        if (error instanceof ApiError) warn(SIGN_IN_COPY[error.code] ?? error.message);
        else warn(SIGN_IN_COPY.sign_in_unavailable ?? "");
        user.current?.focus();
      }
    });
  };

  return (
    <PublicShell>
      <LiveRegions />
      <section className="slip-page">
        <form className="slip form-slip" onSubmit={submit} noValidate>
          <h1>Sign in</h1>
          <p className="muted">Use your handle and Keycloak password.</p>
          <Field label="Username">{(p) => <input {...p} ref={user} name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} />}</Field>
          <Field label="Password">{(p) => <input {...p} name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
          <SubmitButton pending={pending} pendingText="Signing in">Sign in</SubmitButton>
        </form>
      </section>
    </PublicShell>
  );
}

function SimpleBar() {
  return (
    <header className="public-bar">
      <span className="pb-spacer" />
      <div className="wordmark"><KeyMark /><span>Wardhouse</span></div>
      <span className="pb-spacer" />
    </header>
  );
}

export function NotFound({ inShell }: { inShell?: boolean }) {
  useTitle("Nothing in this drawer");
  const body = (
    <section className="slip-page">
      <div className="slip notice-slip">
        <h1>Nothing in this drawer</h1>
        <p className="muted">That page is not filed here, or your role does not open it.</p>
        <Link to="/desk" className="btn btn-solid btn-cut">Drawer</Link>
      </div>
    </section>
  );
  if (inShell) return body;
  return <PublicShell>{body}</PublicShell>;
}

export function SessionEnded() {
  const { endedRoute } = useStore();
  const heading = useRef<HTMLHeadingElement>(null);
  useTitle("Your reveal session has ended");
  return (
    <div className="public">
      <SimpleBar />
      <main id="main">
        <section className="slip-page">
          <div className="slip notice-slip">
            <h1 ref={heading} tabIndex={-1}>Your reveal session has ended</h1>
            <p>Sign in again to reveal logins.</p>
            <a className="btn btn-solid btn-cut" href={`/sign-in?next=${encodeURIComponent(endedRoute)}`}>Sign in</a>
          </div>
        </section>
      </main>
    </div>
  );
}
