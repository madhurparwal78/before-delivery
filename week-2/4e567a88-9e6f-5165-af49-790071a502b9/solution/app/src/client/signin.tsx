// The Sign in screen: a centred, narrow form with email and passcode.

import { useState } from "preact/hooks";
import { ApiError, request, type Member } from "./api";
import { Alert } from "./ui";

export function SignIn({ onSignedIn }: { onSignedIn: (member: Member) => void }) {
  const [email, setEmail] = useState("");
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: Event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await request<{ member: Member }>("POST", "/api/session", { body: { email: email.trim(), passcode } });
      onSignedIn(data.member);
    } catch (failure) {
      setError(failure instanceof ApiError && failure.status === 401
        ? "That email and passcode do not match."
        : "Dispatch could not be reached. Try again.");
      setBusy(false);
    }
  };

  return (
    <main id="main" class="signin">
      <form class="signin__card" aria-label="Sign in" onSubmit={submit} noValidate>
        <p class="brand brand--large">Lumenfold Dispatch</p>
        <h1 class="signin__title">Sign in to Dispatch</h1>
        <div class="field">
          <label for="signin-email">Email</label>
          <input id="signin-email" type="email" class="input" autoComplete="username" value={email}
            onInput={(e) => setEmail(e.currentTarget.value)} />
        </div>
        <div class={`field${error ? " field--invalid" : ""}`}>
          <label for="signin-passcode">Passcode</label>
          <input id="signin-passcode" type="password" class="input" autoComplete="current-password" value={passcode}
            onInput={(e) => setPasscode(e.currentTarget.value)} />
        </div>
        <Alert text={error} />
        <button type="submit" class="btn btn--primary btn--block" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </main>
  );
}
