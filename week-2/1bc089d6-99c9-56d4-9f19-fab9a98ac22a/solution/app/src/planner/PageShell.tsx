import { useState, type FormEvent, type ReactNode } from "react";

import { Wordmark } from "../story/components/Mark";
import { api, retryMinutes } from "./api";
import { EmailField } from "./fields";
import { copy, normaliseEmail } from "../shared/hour";

/** The calm single-column frame shared by /manage, /signin and /p/<token>. */
export function PageShell({ children, busy = false, wide = false }: { children: ReactNode; busy?: boolean; wide?: boolean }) {
  return (
    <div className="sh-account-page">
      <header className="sh-account-page__bar">
        <a className="sh-page__brand" href="/">
          <Wordmark className="sh-wordmark" />
        </a>
      </header>
      <main className={wide ? "sh-account sh-account--wide" : "sh-account"} aria-busy={busy || undefined}>
        {children}
      </main>
    </div>
  );
}

const LINK_SENT = "If that address has a Stillhour, a sign-in link is on its way. It works once, for 15 minutes.";

/** "Send me a sign-in link": the same reply for every address. */
export function SignInRequest() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const problem = normaliseEmail(email) ? undefined : copy.email;
    setError(problem);
    if (problem) {
      setStatus(problem);
      return;
    }
    setPending(true);
    setStatus("Sending your link…");
    const result = await api<{ status: string }>("POST", "/api/session/request", { email: email.trim() });
    setPending(false);
    if (result.ok) setStatus(LINK_SENT);
    else if (result.status === 422) {
      setError(result.fields.email);
      setStatus(result.fields.email ?? result.message ?? "");
    } else if (result.status === 429) {
      setStatus(`That address has asked for five links in the last hour. Try again in ${retryMinutes(result)} minutes.`);
    } else setStatus(result.message ?? "We could not send your link. Please try again.");
  }

  return (
    <form className="sh-panel sh-signin-request" noValidate onSubmit={submit} aria-labelledby="signin-request-title">
      <h2 className="sh-panel__title" id="signin-request-title">
        Sign in with an emailed link
      </h2>
      <p>We will email you a link that works once, for 15 minutes. No password needed.</p>
      <EmailField prefix="signin" value={email} error={error} onChange={setEmail} />
      <div className="sh-panel__actions">
        <button className="sh-button sh-button--ember" type="submit" aria-busy={pending || undefined}>
          Send me a sign-in link
        </button>
      </div>
      <p className="sh-live" role="status" aria-label="Sign-in status">
        {status}
      </p>
    </form>
  );
}
