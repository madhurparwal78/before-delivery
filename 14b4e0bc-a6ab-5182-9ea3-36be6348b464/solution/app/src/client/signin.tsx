import { useState } from "preact/hooks";
import { api, ApiFailure } from "./lib.ts";

export function SignIn() {
  const [ended] = useState(() => {
    const flag = sessionStorage.getItem("strata-session-ended") === "1";
    sessionStorage.removeItem("strata-session-ended");
    return flag;
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(ended ? "Your session ended. Sign in again." : "");

  const submit = async (event: Event) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await api("POST", "/api/session", { email, password });
      location.assign("/catalog");
    } catch (failure) {
      setPending(false);
      setError(failure instanceof ApiFailure ? failure.message : "Sign-in is unavailable. Try again.");
    }
  };

  return (
    <main class="signin" data-motion={document.documentElement.dataset.motion}>
      <form class="signin-form" onSubmit={submit} noValidate>
        <h1 class="signin-wordmark">Quarrystone Strata</h1>
        <p class="signin-sub">Data governance catalog</p>
        <div role="alert" class="signin-alert">{error}</div>
        <label class="field">
          <span class="field-label">Email</span>
          <input type="email" name="email" autocomplete="username" value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
        </label>
        <label class="field">
          <span class="field-label">Password</span>
          <input type="password" name="password" autocomplete="current-password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} />
        </label>
        <button type="submit" class="btn btn-ink">Sign in</button>
        <div role="status" aria-label="Sign-in status" class="signin-status">{pending ? "Signing in..." : ""}</div>
      </form>
    </main>
  );
}
