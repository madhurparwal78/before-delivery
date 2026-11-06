import { useEffect, useRef, useState } from "react";

import { api } from "./api";
import { PageShell } from "./PageShell";

const LINK_COPY: Record<string, string> = {
  confirmed: "Your Stillhour is confirmed. Reminders are on.",
  signed_in: "You are signed in.",
  link_used: "This link has already been used. Ask for a new one on Manage my hour.",
  link_expired: "This link has expired. Ask for a new one on Manage my hour.",
  link_unknown: "We do not recognise this link.",
};

/** Confirmation links carry a "c-" prefix and sign-in links "s-"; only a confirmation link says the hour is confirmed. */
const isConfirmation = (token: string) => token.startsWith("c-");

/** /signin?token=…: checks the emailed link once, as soon as the page loads, and says what happened. */
export function SigninPage() {
  const [status, setStatus] = useState("Checking your link…");
  const [pending, setPending] = useState(true);
  const checked = useRef(false);

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    if (!token) {
      setStatus(LINK_COPY.link_unknown);
      setPending(false);
      return;
    }
    void api<{ confirmed: boolean }>("POST", "/api/session/verify", { token }).then((result) => {
      setPending(false);
      if (result.ok) setStatus(result.data.confirmed && isConfirmation(token) ? LINK_COPY.confirmed : LINK_COPY.signed_in);
      else if (result.status === 422) setStatus(LINK_COPY.link_unknown);
      else setStatus((result.code && LINK_COPY[result.code]) || result.message || LINK_COPY.link_unknown);
    });
  }, []);

  return (
    <PageShell busy={pending}>
      <section className="sh-panel sh-panel--centred" aria-labelledby="signin-title">
        <h1 className="sh-page__title" id="signin-title">
          Your Stillhour link
        </h1>
        <p className="sh-live sh-live--large" role="status" aria-label="Link status">
          {status}
        </p>
        <p className="sh-panel__actions">
          <a className="sh-button sh-button--ember" href="/manage">
            Manage my hour
          </a>
        </p>
      </section>
    </PageShell>
  );
}
