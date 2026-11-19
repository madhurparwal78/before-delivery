import { useState, type ReactElement } from "react";
import type { Member } from "../../shared/api";
import { announce } from "../lib/announce";
import { ApiError, api, errorMessage } from "../lib/http";
import { navigate, safeNext, useLocation } from "../lib/router";
import { useSession } from "../lib/session";
import { Alert, FieldError, PageHeading } from "../ui/Bits";

export function SignInPage(): ReactElement {
  const { search } = useLocation();
  const session = useSession();
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState<"code" | "verify" | null>(null);
  const [codeError, setCodeError] = useState("");
  const [verifyError, setVerifyError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});

  const sendCode = async (): Promise<void> => {
    if (pending) return;
    setPending("code");
    setCodeError("");
    try {
      await api("POST", "/api/auth/code", { body: { email } });
      setSentTo(email);
      announce(`Your code is on its way to ${email}.`);
    } catch (e) {
      setCodeError(errorMessage(e));
    } finally {
      setPending(null);
    }
  };

  const verify = async (): Promise<void> => {
    if (pending) return;
    setPending("verify");
    setVerifyError("");
    setFields({});
    try {
      const member = await api<Member>("POST", "/api/auth/verify", {
        body: { email: sentTo, code, ...(name.trim() ? { display_name: name.trim() } : {}) },
      });
      session.signedIn(member);
      navigate(member.roles.includes("founder") && !search.get("next") ? "/founder/id-review" : safeNext(search.get("next")));
    } catch (e) {
      setVerifyError(errorMessage(e));
      if (e instanceof ApiError) setFields(e.fields);
      setPending(null);
    }
  };

  return (
    <div className="sign-in-page">
      <PageHeading>Sign in</PageHeading>
      <form
        className="stack-form"
        onSubmit={(event) => {
          event.preventDefault();
          void sendCode();
        }}
      >
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="actions">
          <button type="submit">{pending === "code" ? "Working" : "Send code"}</button>
        </div>
        <Alert>{codeError}</Alert>
        {sentTo ? <p>{`Your code is on its way to ${sentTo}.`}</p> : null}
      </form>

      {sentTo ? (
        <form
          className="stack-form"
          onSubmit={(event) => {
            event.preventDefault();
            void verify();
          }}
        >
          <div className="field">
            <label htmlFor="code">Code</label>
            <input id="code" type="text" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="display-name">Display name</label>
            <input id="display-name" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} aria-describedby="display-name-error" />
            <FieldError id="display-name-error" message={fields.display_name} />
          </div>
          <div className="actions">
            <button type="submit">
              {pending === "verify" ? "Working" : "Sign in"}
            </button>
          </div>
          <Alert>{verifyError}</Alert>
        </form>
      ) : null}
    </div>
  );
}
