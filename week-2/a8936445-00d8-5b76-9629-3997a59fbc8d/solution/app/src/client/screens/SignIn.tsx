import { useState } from "preact/hooks";
import type { User } from "../../shared/api";
import { KITCHEN_NAME, PRODUCT_NAME } from "../../shared/kitchen";
import { api } from "../api";
import { act } from "../feedback";
import { navigate, session } from "../router";
import { StatusLine } from "../ui/parts";

export function SignInScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    const outcome = await act(
      {
        pending: "Signing in…",
        own401: true,
        error: (f) => {
          if (f.status === 401) return "That email and password don't match an account.";
          if (f.code === "tenant_offboarded") return "This business has been offboarded. Contact the kitchen.";
          return null;
        },
      },
      () => api<{ user: User }>("POST", "/api/session", { body: { email, password } }),
    );
    setBusy(false);
    if (outcome.ok) {
      session.set(outcome.value.user);
      navigate("/");
    }
  };

  return (
    <div class="signin-page">
      <StatusLine />
      <main class="signin">
        <div class="signin-sheet">
          <h1>{PRODUCT_NAME}</h1>
          <p class="signin-kitchen">{KITCHEN_NAME}</p>
          <form class="signin-form" onSubmit={(e) => void submit(e)}>
            <div class="field">
              <label for="signin-email">Email</label>
              <input
                id="signin-email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onInput={(e) => setEmail(e.currentTarget.value)}
              />
            </div>
            <div class="field">
              <label for="signin-password">Password</label>
              <input
                id="signin-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onInput={(e) => setPassword(e.currentTarget.value)}
              />
            </div>
            <button type="submit" class="btn btn-primary" disabled={busy}>
              Sign in
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
