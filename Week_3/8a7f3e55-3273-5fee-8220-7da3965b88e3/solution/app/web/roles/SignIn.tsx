import { useState } from "react";
import type { SessionUser } from "../../shared/api";
import { useAction } from "../lib/actions";
import { apiSignIn } from "../lib/api";
import { PENDING } from "../lib/copy";
import { requestSignInFocus } from "../lib/signin";

/** The one centred form on the ruled grid. */
export function SignIn({ onSignedIn }: { onSignedIn: (user: SessionUser) => void }) {
  const action = useAction();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const answer = await action.run({
      kind: "sign_in",
      pending: PENDING.sign_in,
      work: () => apiSignIn(email, password),
      success: () => "",
    });
    if (answer !== undefined) {
      requestSignInFocus();
      onSignedIn(answer.user);
    }
  };

  return (
    <main className="signin-screen">
      <form className="signin" aria-label="Sign in" noValidate onSubmit={(event) => void submit(event)}>
        <h1 className="signin-title">Relayline</h1>
        <p className="signin-lede">Dispatch and billing desk for Tandem Hands Collective.</p>
        <div className="field">
          <label htmlFor="signin-email" className="field-label">
            Email
          </label>
          <input id="signin-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="signin-password" className="field-label">
            Password
          </label>
          <input id="signin-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </div>
        <button type="submit" className="btn btn--primary" disabled={action.pending}>
          {action.pending ? PENDING.sign_in : "Sign in"}
        </button>
      </form>
    </main>
  );
}
