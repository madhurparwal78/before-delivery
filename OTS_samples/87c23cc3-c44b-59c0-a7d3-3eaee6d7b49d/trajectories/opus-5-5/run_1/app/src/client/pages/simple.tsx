import { useState } from "preact/hooks";
import { api } from "../api.js";
import { copy } from "../copy.js";
import { Footer, Shell } from "../shell.js";
import { FieldErrors } from "../ui.js";

export function NotFoundPage() {
  return (
    <Shell>
      <section class="centered-state">
        <span class="badge-round" aria-hidden="true">
          404
        </span>
        <h1>Nothing here</h1>
        <p class="muted">This link or project isn't available. It may have been turned off, or the address may be wrong.</p>
        <a class="text-link" href="/projects">
          Go to your projects
        </a>
      </section>
      <Footer />
    </Shell>
  );
}

const SIGNIN_IDS = { email: "signin-email", displayName: "signin-name", code: "signin-code" };

/** The emailed-code sign-in card, shared by the sign-in page and the edit-link page. */
export function SignInCard({ heading, onSignedIn }: { heading: string; onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState<"code" | "session" | null>(null);
  const [status, setStatus] = useState("");
  const [alert, setAlert] = useState("");
  const [fields, setFields] = useState<Record<string, string> | null>(null);

  const sendCode = async (event: Event) => {
    event.preventDefault();
    setPending("code");
    setAlert("");
    setFields(null);
    setStatus(copy.sendingCode);
    const result = await api("POST", "/api/auth/code", displayName.trim() ? { email, displayName } : { email });
    setPending(null);
    if (result.ok) {
      setSent(true);
      setStatus(copy.codeSent(email));
      return;
    }
    setStatus("");
    if (result.status === 422 && result.error?.fields) setFields(result.error.fields);
    else setAlert(copy.codeMailDown);
  };

  const signIn = async (event: Event) => {
    event.preventDefault();
    setPending("session");
    setFields(null);
    const result = await api("POST", "/api/auth/session", { email, code });
    setPending(null);
    if (result.ok) onSignedIn();
    else if (result.error?.fields) setFields(result.error.fields);
  };

  const describe = (field: keyof typeof SIGNIN_IDS) => (fields?.[field] ? `${SIGNIN_IDS[field]}-error` : undefined);

  return (
    <section class="card signin-card">
      <h1>{heading}</h1>
      <FieldErrors fields={fields} ids={SIGNIN_IDS} />
      {alert && (
        <div role="alert" class="notice-error">
          {alert}
        </div>
      )}
      <form onSubmit={sent ? signIn : sendCode} noValidate>
        <div class="field">
          <label class="field-control">
            <span class="field-label">Email</span>
            <input
              id={SIGNIN_IDS.email}
              type="email"
              autocomplete="email"
              value={email}
              aria-describedby={describe("email")}
              onInput={(e) => setEmail(e.currentTarget.value)}
            />
          </label>
          {fields?.email && (
            <span class="field-error" id={`${SIGNIN_IDS.email}-error`}>
              {fields.email}
            </span>
          )}
        </div>
        <div class="field">
          <label class="field-control">
            <span class="field-label">Display name</span>
            <input
              id={SIGNIN_IDS.displayName}
              type="text"
              autocomplete="name"
              value={displayName}
              aria-describedby={describe("displayName") ?? "signin-name-hint"}
              onInput={(e) => setDisplayName(e.currentTarget.value)}
            />
          </label>
          {fields?.displayName && (
            <span class="field-error" id={`${SIGNIN_IDS.displayName}-error`}>
              {fields.displayName}
            </span>
          )}
          <span class="field-hint" id="signin-name-hint">
            Needed only for a new email address.
          </span>
        </div>
        {!sent && (
          <button type="submit" class="button button-primary" disabled={pending === "code"}>
            {pending === "code" ? copy.sendingCode : "Send code"}
          </button>
        )}
        {sent && (
          <>
            <div class="field">
              <label class="field-control">
                <span class="field-label">Sign-in code</span>
                <input
                  id={SIGNIN_IDS.code}
                  type="text"
                  inputMode="numeric"
                  autocomplete="one-time-code"
                  value={code}
                  aria-describedby={describe("code")}
                  onInput={(e) => setCode(e.currentTarget.value)}
                />
              </label>
              {fields?.code && (
                <span class="field-error" id={`${SIGNIN_IDS.code}-error`}>
                  {fields.code}
                </span>
              )}
            </div>
            <div class="button-row">
              <button type="submit" class="button button-primary" disabled={pending === "session"}>
                Sign in
              </button>
              <button type="button" class="button button-secondary" onClick={(e) => void sendCode(e)} disabled={pending === "code"}>
                {pending === "code" ? copy.sendingCode : "Send code"}
              </button>
            </div>
          </>
        )}
      </form>
      <div role="status" aria-label="Sign-in status" class="signin-status">
        {status}
      </div>
    </section>
  );
}

export function SignInPage() {
  const next = new URLSearchParams(location.search).get("next");
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/projects";
  return (
    <Shell>
      <div class="signin-wrap">
        <SignInCard heading="Sign in to Joinery" onSignedIn={() => location.assign(target)} />
      </div>
      <Footer />
    </Shell>
  );
}
