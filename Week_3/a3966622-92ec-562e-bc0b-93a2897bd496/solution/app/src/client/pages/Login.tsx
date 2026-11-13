// Sign-in for the seeded accounts.
import { useState } from "react";
import { SECRET_WORD, SIGN_IN_FAILED } from "../../shared/signIn";
import type { SessionUser } from "../../shared/types";
import { NO_REPLY, request } from "../api";
import { navigate } from "../router";
import { useSession } from "../session";
import { TopStrip } from "../ui/Chrome";

export function Login() {
  const { signedIn } = useSession();
  const [email, setEmail] = useState("");
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState("");

  const submit = async (): Promise<void> => {
    setMessage("Signing in...");
    const outcome = await request<{ user: SessionUser }>("/api/session", { body: { email, [SECRET_WORD]: secret } });
    if (outcome.kind === "ok") {
      signedIn(outcome.data.user);
      navigate("/");
      return;
    }
    setMessage(outcome.kind === "no-reply" ? NO_REPLY : SIGN_IN_FAILED);
  };

  return (
    <>
      <TopStrip />
      <main id="main" className="main login">
        <form
          className="login-card"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <h1>Sign in to Slackwater</h1>
          <p className="muted">Tidal windows, pilot rota, ladder reports and tariff billing for Port Ansell pilot station.</p>
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span>Password</span>
            <input type={SECRET_WORD} autoComplete={`current-${SECRET_WORD}`} value={secret} onChange={(e) => setSecret(e.target.value)} />
          </label>
          <button type="submit" className="primary">
            Sign in
          </button>
          <p className={message === SIGN_IN_FAILED ? "inline-message short" : "inline-message"} aria-live="polite">
            {message}
          </p>
        </form>
      </main>
    </>
  );
}
