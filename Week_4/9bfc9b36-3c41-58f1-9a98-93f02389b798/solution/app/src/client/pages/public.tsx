/** The public screens: landing, sign-in and the not-found page. */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ApiError } from "../api.js";
import { useLive } from "../live.js";
import { Link, safeResume, useRouter } from "../router.js";
import { HOME, useSession } from "../session.js";
import { SUCCESS } from "../../shared/copy.js";
import { TextField } from "../ui.js";
import { PageHeading } from "./chrome.js";

export function Landing() {
  const heading = useRef<HTMLHeadingElement>(null);
  const { location } = useRouter();
  useLayoutEffect(() => {
    if ((location.state as { focus?: boolean } | null)?.focus) heading.current?.focus();
  }, [location]);
  return (
    <main className="landing">
      <section className="hero" aria-labelledby="hero-title">
        <svg className="hero-sail" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <polygon points="4,6 4,78 62,78" fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="hero-seams" aria-hidden="true" />
        <h1 id="hero-title" ref={heading} tabIndex={-1}>
          BOLTROPE
        </h1>
        <div className="hero-foot">
          <p>A loft workbench for one sailmaker</p>
          <Link to="/signin" className="button primary">
            Open the loft
          </Link>
        </div>
      </section>
      <section className="poster-field">
        <p className="poster-area">42.60 m² · 458.54 ft²</p>
        <p className="poster-quote">The figure that ruins a sail is the one you misread.</p>
      </section>
    </main>
  );
}

export function SignIn() {
  const { signIn, account } = useSession();
  const { location, navigate } = useRouter();
  const { say, refuse } = useLive();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const resume = safeResume(new URLSearchParams(location.search).get("resume"));
  const ended = (location.state as { ended?: boolean } | null)?.ended === true;

  useEffect(() => {
    if (ended) say(SUCCESS.sessionEnded);
  }, [ended, say]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    refuse(null);
    try {
      const who = await signIn(email, password);
      navigate(resume ?? HOME[who.role], { replace: true });
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      refuse(failure.body.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="signin">
      <section className="field-cobalt signin-head">
        <PageHeading>Sign in to the loft</PageHeading>
        {account ? <p>You are signed in as {account.display_name}.</p> : <p>Use the email and password the sailmaker gave you.</p>}
      </section>
      <section className="field-surface">
        <form onSubmit={submit} noValidate className="signin-form">
          <TextField label="Email" value={email} onChange={setEmail} type="email" autoComplete="username" />
          <TextField label="Password" value={password} onChange={setPassword} type="password" autoComplete="current-password" />
          <button type="submit" className="button primary" aria-busy={busy || undefined}>
            Sign in
          </button>
        </form>
      </section>
    </main>
  );
}

export function NotFound() {
  return (
    <main className="field-cobalt not-found">
      <PageHeading>That page is not in the loft.</PageHeading>
      <p>
        <Link to="/" className="button">
          Back to the start
        </Link>
      </p>
    </main>
  );
}
